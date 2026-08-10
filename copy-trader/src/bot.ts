/** Wraps the listener/sizing/execution pipeline in a start/stop-able
 * controller with a structured event log, so it can be driven either by
 * the CLI (auto-start on boot, same as before) or by the control API that
 * backs the website's Copy Trader page.
 *
 * Detection (watching target wallets) and execution (trading the operator's
 * own encrypted wallet) are deliberately decoupled: detection runs as soon
 * as there's at least one target wallet, independent of start()/stop() —
 * which only gates whether *this bot's own wallet* trades. That's what lets
 * signalServer.ts broadcast the same "target-trade" events to mirror
 * clients (other people's connected browser wallets) regardless of whether
 * the operator personally has their own auto-execution turned on. */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { config } from "./config.js";
import { settingsStore } from "./settingsStore.js";
import { ledger, type OpenPosition } from "./ledger.js";
import { loadBotKeypair, assertBalanceGuard, redactPubkey } from "./security.js";
import { TargetWalletListener } from "./listener.js";
import { sizeOrder } from "./calculator.js";
import { Executor } from "./executor.js";
import { TargetWalletStore } from "./targetWalletStore.js";
import { validateFomo } from "./momentum.js";
import { positionStateStore } from "./positionState.js";
import { notifyTradeExecuted, notifyTradeSkipped, notifyExit, notifyError } from "./notifier.js";
import type { SizedOrder, TargetTradeEvent } from "./types.js";

export type BotStatus = "stopped" | "running" | "error";
export type BotEventKind = "trade-detected" | "sizing" | "execution" | "info" | "error";

export interface BotEvent {
  id: string;
  at: number;
  kind: BotEventKind;
  message: string;
  data?: Record<string, unknown>;
}

export interface BotStatusSnapshot {
  status: BotStatus;
  dryRun: boolean;
  walletPubkey: string;
  walletBalanceSol: number | null;
  targetWallets: string[];
  slippageBps: number;
  buySolCap: number;
  buyPortfolioPercent: number;
  jitoEnabled: boolean;
  startedAt: number | null;
  lastError: string | null;
}

export interface PositionSnapshot extends OpenPosition {
  /** null = no quote available this tick (e.g. brand-new bonding-curve
   * token not yet indexed by the aggregator), not "worthless". */
  currentValueLamports: string | null;
  currentValueSol: number | null;
  unrealizedPnlSol: number | null;
  unrealizedPnlPct: number | null;
}

const MAX_EVENTS = 200;
const POSITION_CHECK_INTERVAL_MS = 15_000;

async function getSolBalance(connection: Connection, pubkey: PublicKey): Promise<bigint> {
  return BigInt(await connection.getBalance(pubkey, "confirmed"));
}

async function getTokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return 0n; // no token account yet == zero balance, not an error
  }
}

export class BotController extends EventEmitter {
  status: BotStatus = "stopped";
  /** Gates whether detected trades also fire the operator's own execution.
   * Detection itself (detectionListener below) always runs. */
  private executionEnabled = false;
  private detectionListener: TargetWalletListener | null = null;
  private readonly executor: Executor;
  private readonly connection: Connection;
  private readonly wallet: Keypair;
  private readonly walletStore = new TargetWalletStore();
  private readonly events: BotEvent[] = [];
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private positionMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private checkingPositions = false;

  constructor() {
    super();
    this.connection = new Connection(config.rpcHttpUrl, "confirmed");
    this.wallet = loadBotKeypair();
    this.executor = new Executor(this.connection, this.wallet);
    this.restartDetection();
  }

  getTargetWallets(): string[] {
    return this.walletStore.list();
  }

  /** Adds a target wallet (validated as a real Solana address — these are
   * public addresses, not secrets, so this is safe to expose to the UI). */
  async addTargetWallet(address: string): Promise<string[]> {
    const wallets = this.walletStore.add(address);
    this.pushEvent("info", `now watching ${address.slice(0, 4)}…${address.slice(-4)}`);
    this.restartDetection();
    return wallets;
  }

  async removeTargetWallet(address: string): Promise<string[]> {
    const wallets = this.walletStore.remove(address);
    this.pushEvent("info", `stopped watching ${address.slice(0, 4)}…${address.slice(-4)}`);
    this.restartDetection();
    return wallets;
  }

  /** (Re)subscribes detection to the current target-wallet list. Runs
   * unconditionally — independent of executionEnabled/status — so mirror
   * clients keep receiving signals even when the operator's own bot is
   * stopped, and so newly added/removed wallets take effect immediately. */
  private restartDetection(): void {
    this.detectionListener?.stop();
    this.detectionListener = null;

    const wallets = this.walletStore.list();
    if (wallets.length === 0) return;

    const listener = new TargetWalletListener(wallets);
    listener.on("trade", (event: TargetTradeEvent) => {
      this.emit("target-trade", event); // consumed by signalServer.ts regardless of executionEnabled

      if (!this.executionEnabled) return;
      this.handleTrade(event).catch((err) => {
        this.lastError = (err as Error).message;
        this.pushEvent("error", `failed to process trade event: ${(err as Error).message}`);
        notifyError(`failed to process trade event on ${event.mint}: ${(err as Error).message}`);
      });
    });
    listener.start();
    this.detectionListener = listener;
  }

  private pushEvent(kind: BotEventKind, message: string, data?: Record<string, unknown>): void {
    const event: BotEvent = { id: randomUUID(), at: Date.now(), kind, message, data };
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    this.emit("event", event);

    const log = kind === "error" ? console.error : console.log;
    log(`[${kind}] ${message}`);
  }

  getRecentEvents(limit = 50): BotEvent[] {
    return this.events.slice(0, limit);
  }

  async getStatusSnapshot(): Promise<BotStatusSnapshot> {
    const lamports = await this.connection.getBalance(this.wallet.publicKey, "confirmed").catch(() => null);
    const settings = settingsStore.get();
    return {
      status: this.status,
      dryRun: settings.dryRun,
      walletPubkey: redactPubkey(this.wallet.publicKey),
      walletBalanceSol: lamports !== null ? lamports / 1e9 : null,
      targetWallets: this.walletStore.list(),
      slippageBps: settings.slippageBps,
      buySolCap: settings.buySolCap,
      buyPortfolioPercent: settings.buyPortfolioPercent,
      jitoEnabled: !!settings.jitoBlockEngineUrl,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  /** Turns on execution against the operator's OWN encrypted wallet.
   * Detection (and mirror-client signals) run regardless of this. */
  async start(): Promise<void> {
    if (this.status === "running") return;

    if (this.walletStore.list().length === 0) {
      throw new Error("No target wallets configured — add at least one before starting.");
    }

    await assertBalanceGuard(this.connection, this.wallet.publicKey);

    this.executionEnabled = true;
    this.status = "running";
    this.startedAt = Date.now();
    this.lastError = null;
    this.pushEvent(
      "info",
      `own-wallet execution started — watching ${this.walletStore.list().length} wallet(s), ${settingsStore.get().dryRun ? "DRY RUN" : "LIVE"}`
    );

    if (!this.positionMonitorTimer) {
      this.positionMonitorTimer = setInterval(() => {
        this.checkPositions().catch((err) => {
          this.pushEvent("error", `position exit check failed: ${(err as Error).message}`);
          notifyError(`position exit check failed: ${(err as Error).message}`);
        });
      }, POSITION_CHECK_INTERVAL_MS);
    }
  }

  stop(): void {
    if (this.status !== "running") return;
    this.executionEnabled = false;
    this.status = "stopped";
    this.pushEvent("info", "own-wallet execution stopped (detection still running for mirror clients)");

    if (this.positionMonitorTimer) {
      clearInterval(this.positionMonitorTimer);
      this.positionMonitorTimer = null;
    }
  }

  private async handleTrade(event: TargetTradeEvent): Promise<void> {
    this.pushEvent("trade-detected", `${event.direction.toUpperCase()} on ${event.dex} — mint ${event.mint}`, {
      signature: event.signature,
      mint: event.mint,
      dex: event.dex,
      direction: event.direction,
    });

    // FOMO/momentum validation gate — buy-side only (see momentum.ts). A
    // target's sell should never be blocked by momentum thresholds; exiting
    // is about following the target out, not chasing a trend.
    if (event.direction === "buy" && settingsStore.get().fomoValidationEnabled) {
      const validation = await validateFomo(this.connection, event.mint);
      this.pushEvent("sizing", `FOMO check (${validation.elapsedMs}ms): ${validation.reason}`, {
        mint: event.mint,
        pass: validation.pass,
        ...validation.metrics,
      });
      if (!validation.pass) {
        notifyTradeSkipped({ mint: event.mint, sourceWallet: event.sourceWallet, reason: validation.reason });
        return;
      }
    }

    const [solBalance, tokenBalance] = await Promise.all([
      getSolBalance(this.connection, this.wallet.publicKey),
      getTokenBalance(this.connection, this.wallet.publicKey, new PublicKey(event.mint)),
    ]);

    const order = sizeOrder(event, solBalance, tokenBalance);
    if (!order) {
      this.pushEvent("sizing", "skipped — nothing to mirror (insufficient balance, or no proportional-sell basis)", {
        mint: event.mint,
      });
      return;
    }
    this.pushEvent("sizing", order.reason, { mint: event.mint, direction: order.direction });
    await this.executeAndRecord(order);
  }

  /** Submits a sized order and, on success with verified on-chain amounts,
   * records it into the ledger. Shared by handleTrade (mirroring a target)
   * and exitPosition (independent stop-loss/take-profit) — both end the
   * same way: execute, log, and (if verifiable) attribute P&L. */
  private async executeAndRecord(order: SizedOrder): Promise<void> {
    const result = await this.executor.executeOrder(order);
    if (result.success) {
      this.pushEvent(
        "execution",
        `✓ ${result.route} via ${result.submittedVia} in ${result.latencyMs}ms — sig ${result.signature ?? "(dry run)"}`,
        { mint: order.mint, signature: result.signature }
      );

      if (result.signature) {
        if (result.actualSolLamports !== undefined && result.actualTokenRawAmount !== undefined) {
          ledger.recordFill({
            at: Date.now(),
            sourceWallet: order.sourceWallet,
            mint: order.mint,
            direction: order.direction,
            dex: order.dex,
            solLamports: result.actualSolLamports,
            tokenRawAmount: result.actualTokenRawAmount,
            signature: result.signature,
          });
        } else {
          this.pushEvent(
            "info",
            "executed, but couldn't verify exact on-chain amounts — this trade won't count toward P&L tracking",
            { mint: order.mint, signature: result.signature }
          );
        }
      }

      notifyTradeExecuted({
        direction: order.direction,
        mint: order.mint,
        dex: order.dex,
        sourceWallet: order.sourceWallet,
        signature: result.signature,
        solAmount: result.actualSolLamports !== undefined ? Number(result.actualSolLamports) / 1e9 : undefined,
        dryRun: settingsStore.get().dryRun,
      });
    } else {
      this.pushEvent("execution", `✗ blocked/failed: ${result.error}`, { mint: order.mint });
    }
  }

  /** Open positions with a live unrealized P&L, priced via Jupiter quote.
   * Backs both the stop-loss/take-profit check below and the website's
   * position list (GET /api/ledger/positions) — read-only there, no
   * execution side effects. */
  async getOpenPositionsWithPnl(): Promise<PositionSnapshot[]> {
    const positions = ledger.getOpenPositions();
    return Promise.all(
      positions.map(async (pos): Promise<PositionSnapshot> => {
        const tokenRawAmount = BigInt(pos.tokenRawAmount);
        const costBasisLamports = BigInt(pos.costBasisLamports);
        const currentValue = await this.executor.getCurrentPositionValueLamports(pos.mint, tokenRawAmount).catch(() => null);
        const unrealizedPnlLamports = currentValue !== null ? currentValue - costBasisLamports : null;
        return {
          ...pos,
          currentValueLamports: currentValue !== null ? currentValue.toString() : null,
          currentValueSol: currentValue !== null ? Number(currentValue) / 1e9 : null,
          unrealizedPnlSol: unrealizedPnlLamports !== null ? Number(unrealizedPnlLamports) / 1e9 : null,
          unrealizedPnlPct:
            unrealizedPnlLamports !== null && costBasisLamports > 0n
              ? (Number(unrealizedPnlLamports) / Number(costBasisLamports)) * 100
              : null,
        };
      })
    );
  }

  /** Independent exit check, run on a timer while the bot is running (see
   * start()/stop()) — this is the only exit path that doesn't depend on the
   * target wallet itself selling. Guarded against overlapping runs since a
   * slow quote round-trip could otherwise outlast the next tick.
   *
   * Checks, in order, first-match-wins per position per tick (a position
   * that fully exits via one mechanism skips the rest until next tick):
   *   1. Trailing stop — drop from the position's peak value since entry.
   *   2. Static stop-loss / full take-profit — vs. cost basis (legacy,
   *      still the simplest full-exit config).
   *   3. Take-profit laddering — one partial-exit rung per tick.
   *   4. Time-based liquidation — hasn't hit target ROI within the window.
   */
  private async checkPositions(): Promise<void> {
    if (this.checkingPositions) return;
    const settings = settingsStore.get();
    const anyExitEnabled =
      settings.stopLossEnabled ||
      settings.takeProfitEnabled ||
      settings.trailingStopEnabled ||
      settings.takeProfitLaddersEnabled ||
      settings.timeLimitEnabled;
    if (!anyExitEnabled) return;

    this.checkingPositions = true;
    try {
      const positions = await this.getOpenPositionsWithPnl();
      for (const pos of positions) {
        if (pos.currentValueLamports === null || pos.unrealizedPnlPct === null) continue; // no quote this tick — try again next tick

        const state = positionStateStore.observe(pos.sourceWallet, pos.mint, BigInt(pos.currentValueLamports));

        if (settings.trailingStopEnabled) {
          const peak = BigInt(state.peakValueLamports);
          const current = BigInt(pos.currentValueLamports);
          const dropFromPeakPct = peak > 0n ? (Number(peak - current) / Number(peak)) * 100 : 0;
          if (dropFromPeakPct >= settings.trailingStopPct) {
            await this.exitPosition(pos, "trailing-stop", 1, `${dropFromPeakPct.toFixed(1)}% below peak`);
            continue;
          }
        }

        const hitStopLoss = settings.stopLossEnabled && pos.unrealizedPnlPct <= -settings.stopLossPct;
        const hitTakeProfit = settings.takeProfitEnabled && pos.unrealizedPnlPct >= settings.takeProfitPct;
        if (hitStopLoss || hitTakeProfit) {
          const pctStr = `${pos.unrealizedPnlPct >= 0 ? "+" : ""}${pos.unrealizedPnlPct.toFixed(1)}% vs cost basis`;
          await this.exitPosition(pos, hitStopLoss ? "stop-loss" : "take-profit", 1, pctStr);
          continue;
        }

        if (settings.takeProfitLaddersEnabled) {
          const nextRung = settings.takeProfitLadders.find(
            (r) => pos.unrealizedPnlPct! >= r.roiPct && !state.takenLadderRungs.includes(r.roiPct)
          );
          if (nextRung) {
            await this.exitPosition(
              pos,
              `take-profit-ladder(+${nextRung.roiPct}%)`,
              nextRung.exitPct / 100,
              `+${pos.unrealizedPnlPct.toFixed(1)}% hit the ${nextRung.roiPct}% rung — selling ${nextRung.exitPct}% of position`
            );
            positionStateStore.markRungTaken(pos.sourceWallet, pos.mint, nextRung.roiPct);
            continue;
          }
        }

        if (settings.timeLimitEnabled) {
          const elapsedMinutes = (Date.now() - state.firstEntryAt) / 60_000;
          if (elapsedMinutes >= settings.timeLimitMinutes && pos.unrealizedPnlPct < settings.timeLimitMinRoiPct) {
            await this.exitPosition(
              pos,
              "time-limit",
              1,
              `${elapsedMinutes.toFixed(0)}min elapsed, only ${pos.unrealizedPnlPct.toFixed(1)}% (target ${settings.timeLimitMinRoiPct}%)`
            );
          }
        }
      }
    } finally {
      this.checkingPositions = false;
    }
  }

  /** Force-closes some fraction of a position outside the normal
   * mirror-a-target-sell path. Caps the sell to the wallet's actual
   * on-chain balance for the mint — the ledger tracks cost basis per
   * (sourceWallet, mint), but the bot only has one token account per mint,
   * so if two target wallets both hold positions in the same mint the
   * tracked amounts can exceed what's actually left to sell (e.g. after an
   * earlier partial exit). Never oversell; worst case this exit is smaller
   * than intended. `fraction` of 1 = full exit (clears trailing/ladder
   * state for this position); less than 1 = partial (take-profit ladder). */
  private async exitPosition(pos: PositionSnapshot, label: string, fraction: number, detail: string): Promise<void> {
    const trackedAmount = BigInt(pos.tokenRawAmount);
    const actualBalance = await getTokenBalance(this.connection, this.wallet.publicKey, new PublicKey(pos.mint));
    const available = trackedAmount < actualBalance ? trackedAmount : actualBalance;
    const fractionBps = BigInt(Math.round(Math.min(Math.max(fraction, 0), 1) * 10_000));
    const sellAmount = (available * fractionBps) / 10_000n;
    if (sellAmount <= 0n) return;

    const shortWallet = `${pos.sourceWallet.slice(0, 4)}…${pos.sourceWallet.slice(-4)}`;
    this.pushEvent("trade-detected", `${label} triggered on ${pos.mint} (${detail}, position from ${shortWallet})`, {
      mint: pos.mint,
      sourceWallet: pos.sourceWallet,
    });

    const order: SizedOrder = {
      direction: "sell",
      mint: pos.mint,
      dex: pos.dex,
      sourceWallet: pos.sourceWallet,
      tokenRawAmountIn: sellAmount,
      tokenDecimals: 0,
      priorityMultiplier: 1,
      reason: `${label}: ${detail}`,
    };

    this.pushEvent("sizing", order.reason, { mint: order.mint, direction: order.direction });
    await this.executeAndRecord(order);
    notifyExit({ label, mint: pos.mint, sourceWallet: pos.sourceWallet, pnlPct: pos.unrealizedPnlPct ?? 0 });

    if (fraction >= 1) positionStateStore.clear(pos.sourceWallet, pos.mint);
  }
}
