import { fetchDexScreenerData } from "./dexscreener";

// TypeScript port of token-scanner/data_feed.py + evaluator.py's Movers
// logic, for the dashboard's watchlist feed. Read-only: fetches and scores
// candidate tokens, never trades.
//
// Deliberately skips the dev-holding-% check that the Python tool does —
// that requires a Solana RPC call (getTokenLargestAccounts), and running
// that from every visitor's browser would hammer the public RPC's rate
// limit far harder than the single-process Python script does. Use
// token-scanner/data_feed.py (with a real RPC key) if you need that check.

const PUMPFUN_COINS_URL = "https://frontend-api-v3.pump.fun/coins"; // unverified, see token-scanner/README.md
const CANDIDATE_LIMIT = 30;
const ENRICH_CONCURRENCY = 5;

export interface MoverCandidate {
  mint: string;
  name: string;
  symbol: string;
  bondingCurveProgressPct: number;
  volume5mUsd: number;
  txns5mBuys: number;
  txns5mSells: number;
  marketCapUsd: number | null;
  priceChange5mPct: number;
}

export interface MoverThresholds {
  min5mVolumeUsd: number;
  minBondingCurveProgressPct: number;
  minBuySellRatio: number;
}

export const DEFAULT_MOVER_THRESHOLDS: MoverThresholds = {
  min5mVolumeUsd: 5,
  minBondingCurveProgressPct: 20,
  minBuySellRatio: 1.2,
};

export interface MoverEvaluation {
  qualified: boolean;
  reasons: string[];
}

export function isQualifiedMover(token: MoverCandidate, thresholds: MoverThresholds = DEFAULT_MOVER_THRESHOLDS): MoverEvaluation {
  const reasons: string[] = [];

  if (token.volume5mUsd < thresholds.min5mVolumeUsd) {
    reasons.push(`5m volume $${token.volume5mUsd.toFixed(0)} < $${thresholds.min5mVolumeUsd}`);
  }
  if (token.bondingCurveProgressPct < thresholds.minBondingCurveProgressPct) {
    reasons.push(`bonding curve ${token.bondingCurveProgressPct.toFixed(0)}% < ${thresholds.minBondingCurveProgressPct}%`);
  }
  const ratio = token.txns5mSells > 0 ? token.txns5mBuys / token.txns5mSells : token.txns5mBuys > 0 ? Infinity : 0;
  if (ratio < thresholds.minBuySellRatio) {
    reasons.push(`buy/sell ratio ${ratio.toFixed(2)} < ${thresholds.minBuySellRatio}`);
  }

  return { qualified: reasons.length === 0, reasons };
}

function bondingCurveProgressPct(coin: any): number {
  if (coin.complete) return 100;
  const virtualSol = (coin.virtual_sol_reserves ?? 0) / 1e9;
  return Math.min((virtualSol / 85) * 100, 99);
}

async function fetchCandidates(): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      offset: "0",
      limit: String(CANDIDATE_LIMIT),
      sort: "last_trade_timestamp",
      order: "DESC",
      includeNsfw: "false",
    });
    const res = await fetch(`${PUMPFUN_COINS_URL}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      const result = await fn(item);
      if (result !== null) results.push(result);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export async function fetchMovers(): Promise<MoverCandidate[]> {
  const candidates = await fetchCandidates();
  if (candidates.length === 0) return [];

  return mapWithConcurrency(candidates, ENRICH_CONCURRENCY, async (coin) => {
    const mint = coin.mint;
    if (!mint) return null;

    const dex = await fetchDexScreenerData(mint);
    if (!dex) return null; // no DEX pair yet — bonding-curve-only, skip

    return {
      mint,
      name: coin.name ?? "unknown",
      symbol: coin.symbol ?? "?",
      bondingCurveProgressPct: bondingCurveProgressPct(coin),
      volume5mUsd: dex.volume5mUsd ?? 0,
      txns5mBuys: dex.txns5mBuys ?? 0,
      txns5mSells: dex.txns5mSells ?? 0,
      marketCapUsd: dex.marketCapUsd,
      priceChange5mPct: dex.priceChange5mPct ?? 0,
    };
  });
}
