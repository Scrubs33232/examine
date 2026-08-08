/** Tracks real P&L per source (target) wallet, and derives a buy-sizing
 * multiplier that rewards wallets with a better track record.
 *
 * Accounting model: cost basis is tracked per (sourceWallet, mint) pair,
 * not per mint globally. When wallet A's buy of TOKEN mirrors into our
 * wallet, that opens a position attributed to A; when A later sells TOKEN,
 * we close the portion of THAT position (average-cost-basis), realizing
 * P&L attributed back to A. This avoids ambiguity if two different target
 * wallets independently trade the same mint — each gets its own mirrored
 * lot, exactly mirroring what "copying wallet A" vs "copying wallet B"
 * conceptually means. Sells for a wallet we have no tracked position for
 * (e.g. ledger started after a manual/earlier buy) are skipped — there's no
 * cost basis to compute P&L against.
 *
 * Only live (non-dry-run) fills with successfully-verified actual amounts
 * (see executor.ts's post-trade balance diff) count toward P&L — estimates
 * aren't good enough to trade real money on.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "./config.js";
import { settingsStore } from "./settingsStore.js";

export interface Fill {
  id: string;
  at: number;
  sourceWallet: string;
  mint: string;
  direction: "buy" | "sell";
  dex: "pumpfun" | "raydium";
  solLamports: bigint; // actual SOL spent (buy) or received (sell)
  tokenRawAmount: bigint; // actual tokens bought or sold
  signature: string;
}

interface StoredFill extends Omit<Fill, "solLamports" | "tokenRawAmount"> {
  solLamports: string;
  tokenRawAmount: string;
}

export interface PlainFill extends Omit<Fill, "solLamports" | "tokenRawAmount"> {
  solLamports: string;
  solAmount: number; // convenience — SOL, not lamports
  tokenRawAmount: string;
}

export interface WalletStats {
  wallet: string;
  buyCount: number;
  closedTradeCount: number;
  realizedPnlLamports: string;
  realizedPnlSol: number;
  winRate: number; // 0-1, fraction of closed trades that were profitable
  avgRoiPct: number;
  priorityMultiplier: number;
}

export interface LedgerSummary {
  totalRealizedPnlLamports: string;
  totalRealizedPnlSol: number;
  totalClosedTrades: number;
  wallets: WalletStats[]; // sorted best to worst by realized P&L
}

export interface OpenPosition {
  sourceWallet: string;
  mint: string;
  dex: "pumpfun" | "raydium";
  costBasisLamports: string;
  costBasisSol: number;
  tokenRawAmount: string;
}

const MAX_FILLS = 5000;

function load(): Fill[] {
  if (!existsSync(config.ledgerPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(config.ledgerPath, "utf-8")) as StoredFill[];
    return raw.map((f) => ({ ...f, solLamports: BigInt(f.solLamports), tokenRawAmount: BigInt(f.tokenRawAmount) }));
  } catch {
    return [];
  }
}

function save(fills: Fill[]): void {
  const stored: StoredFill[] = fills.map((f) => ({
    ...f,
    solLamports: f.solLamports.toString(),
    tokenRawAmount: f.tokenRawAmount.toString(),
  }));
  writeFileSync(config.ledgerPath, JSON.stringify(stored, null, 2));
}

interface Position {
  costBasisLamports: bigint;
  tokenRawAmount: bigint;
  dex: Fill["dex"];
}

interface ClosedTrade {
  wallet: string;
  realizedPnlLamports: bigint;
  costBasisLamports: bigint;
}

interface ReplayResult {
  closedTrades: ClosedTrade[];
  openPositions: Map<string, Position>; // key: `${wallet}:${mint}`, only positions still open at replay end
}

function replay(fills: Fill[]): ReplayResult {
  const positions = new Map<string, Position>(); // key: `${wallet}:${mint}`
  const closedTrades: ClosedTrade[] = [];
  const sorted = [...fills].sort((a, b) => a.at - b.at);

  for (const fill of sorted) {
    const key = `${fill.sourceWallet}:${fill.mint}`;

    if (fill.direction === "buy") {
      const pos = positions.get(key) ?? { costBasisLamports: 0n, tokenRawAmount: 0n, dex: fill.dex };
      pos.costBasisLamports += fill.solLamports;
      pos.tokenRawAmount += fill.tokenRawAmount;
      pos.dex = fill.dex;
      positions.set(key, pos);
      continue;
    }

    // sell
    const pos = positions.get(key);
    if (!pos || pos.tokenRawAmount <= 0n) continue; // no tracked cost basis to close against

    const sellAmount = fill.tokenRawAmount > pos.tokenRawAmount ? pos.tokenRawAmount : fill.tokenRawAmount;
    const proportionalCostBasis = (pos.costBasisLamports * sellAmount) / pos.tokenRawAmount;
    const realizedPnlLamports = fill.solLamports - proportionalCostBasis;

    closedTrades.push({ wallet: fill.sourceWallet, realizedPnlLamports, costBasisLamports: proportionalCostBasis });

    pos.costBasisLamports -= proportionalCostBasis;
    pos.tokenRawAmount -= sellAmount;
    pos.dex = fill.dex;
    positions.set(key, pos);
  }

  return { closedTrades, openPositions: positions };
}

class Ledger {
  private fills: Fill[] = load();

  recordFill(fill: Omit<Fill, "id">): void {
    this.fills.push({ ...fill, id: randomUUID() });
    if (this.fills.length > MAX_FILLS) this.fills = this.fills.slice(-MAX_FILLS);
    save(this.fills);
  }

  getRecentFills(limit = 50): PlainFill[] {
    return this.fills
      .slice(-limit)
      .reverse()
      .map((f) => ({
        ...f,
        solLamports: f.solLamports.toString(),
        solAmount: Number(f.solLamports) / 1e9,
        tokenRawAmount: f.tokenRawAmount.toString(),
      }));
  }

  computeWalletStats(): WalletStats[] {
    const { closedTrades } = replay(this.fills);

    const buyCounts = new Map<string, number>();
    for (const f of this.fills) {
      if (f.direction === "buy") buyCounts.set(f.sourceWallet, (buyCounts.get(f.sourceWallet) ?? 0) + 1);
    }

    const byWallet = new Map<string, { pnl: bigint; count: number; wins: number; roiSum: number }>();
    for (const ct of closedTrades) {
      const agg = byWallet.get(ct.wallet) ?? { pnl: 0n, count: 0, wins: 0, roiSum: 0 };
      agg.pnl += ct.realizedPnlLamports;
      agg.count += 1;
      if (ct.realizedPnlLamports > 0n) agg.wins += 1;
      if (ct.costBasisLamports > 0n) agg.roiSum += Number(ct.realizedPnlLamports) / Number(ct.costBasisLamports);
      byWallet.set(ct.wallet, agg);
    }

    const allWallets = new Set<string>([...buyCounts.keys(), ...byWallet.keys()]);
    const settings = settingsStore.get();

    const raw = [...allWallets].map((wallet) => {
      const agg = byWallet.get(wallet) ?? { pnl: 0n, count: 0, wins: 0, roiSum: 0 };
      return {
        wallet,
        buyCount: buyCounts.get(wallet) ?? 0,
        closedTradeCount: agg.count,
        realizedPnlLamports: agg.pnl,
        winRate: agg.count > 0 ? agg.wins / agg.count : 0,
        avgRoiPct: agg.count > 0 ? (agg.roiSum / agg.count) * 100 : 0,
      };
    });

    // Linear-map avg ROI across wallets with enough closed trades into
    // [minMultiplier, maxMultiplier]. Everyone else (not enough data yet)
    // stays neutral at 1x — no reason to reward/punish on thin samples.
    const eligible = raw.filter((s) => s.closedTradeCount >= settings.walletPriorityMinTrades);
    const scores = eligible.map((s) => s.avgRoiPct);
    const worst = scores.length ? Math.min(...scores) : 0;
    const best = scores.length ? Math.max(...scores) : 0;
    const spread = best - worst;

    return raw
      .map((s) => {
        let priorityMultiplier = 1;
        if (settings.walletPriorityEnabled && s.closedTradeCount >= settings.walletPriorityMinTrades) {
          priorityMultiplier =
            spread > 0
              ? settings.walletPriorityMinMultiplier +
                ((s.avgRoiPct - worst) / spread) * (settings.walletPriorityMaxMultiplier - settings.walletPriorityMinMultiplier)
              : 1; // all eligible wallets tied on ROI — no basis to differentiate
        }
        return {
          wallet: s.wallet,
          buyCount: s.buyCount,
          closedTradeCount: s.closedTradeCount,
          realizedPnlLamports: s.realizedPnlLamports.toString(),
          realizedPnlSol: Number(s.realizedPnlLamports) / 1e9,
          winRate: s.winRate,
          avgRoiPct: s.avgRoiPct,
          priorityMultiplier,
        };
      })
      .sort((a, b) => Number(BigInt(b.realizedPnlLamports) - BigInt(a.realizedPnlLamports)));
  }

  getSummary(): LedgerSummary {
    const wallets = this.computeWalletStats();
    const totalPnl = wallets.reduce((sum, w) => sum + BigInt(w.realizedPnlLamports), 0n);
    return {
      totalRealizedPnlLamports: totalPnl.toString(),
      totalRealizedPnlSol: Number(totalPnl) / 1e9,
      totalClosedTrades: wallets.reduce((sum, w) => sum + w.closedTradeCount, 0),
      wallets,
    };
  }

  /** Positions still holding tokens, per (sourceWallet, mint) — the same
   * attribution model computeWalletStats() uses for closed trades, so a
   * position here can be closed out to credit/debit the right wallet's
   * track record. This is what the stop-loss/take-profit monitor in bot.ts
   * watches, since it's the only source of "what do we still hold and what
   * did it cost" independent of the target wallet's own behavior. */
  getOpenPositions(): OpenPosition[] {
    const { openPositions } = replay(this.fills);
    const out: OpenPosition[] = [];
    for (const [key, pos] of openPositions) {
      if (pos.tokenRawAmount <= 0n) continue;
      const separator = key.indexOf(":");
      out.push({
        sourceWallet: key.slice(0, separator),
        mint: key.slice(separator + 1),
        dex: pos.dex,
        costBasisLamports: pos.costBasisLamports.toString(),
        costBasisSol: Number(pos.costBasisLamports) / 1e9,
        tokenRawAmount: pos.tokenRawAmount.toString(),
      });
    }
    return out.sort((a, b) => Number(BigInt(b.costBasisLamports) - BigInt(a.costBasisLamports)));
  }

  /** 1 = neutral (prioritization off, or not enough closed trades yet to judge). */
  getPriorityMultiplier(wallet: string): number {
    if (!settingsStore.get().walletPriorityEnabled) return 1;
    const stats = this.computeWalletStats().find((s) => s.wallet === wallet);
    return stats?.priorityMultiplier ?? 1;
  }
}

export const ledger = new Ledger();
