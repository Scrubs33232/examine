/** Mutable, persisted trading settings — everything editable from the
 * website's Copy Trader settings panel without touching .env or restarting
 * the process. Seeded once from the env-based defaults in config.ts, then
 * settings.json (gitignored, local runtime state — not secret, just not
 * meaningful to version) is the source of truth.
 *
 * Deliberately excludes anything that's a credential or infra/network
 * config (RPC URLs, the wallet encryption key, API port, CORS origin) —
 * those stay in .env, edited by hand, same reasoning as target wallets
 * being public-address-only in targetWalletStore.ts. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "./config.js";

export interface EditableSettings {
  dryRun: boolean;
  buySolCap: number; // SOL
  buyPortfolioPercent: number; // 0-100
  feeBufferSol: number;
  slippageBps: number;
  minLiquiditySol: number;
  maxPriceImpactPct: number; // 0-100
  maxSafeWalletSol: number;
  jitoBlockEngineUrl: string;
  jitoTipSol: number;
  priorityFeePercentile: number;

  /** Wallet-performance-based buy sizing — see ledger.ts. Off by default:
   * needs real closed-trade history to mean anything, so it starts neutral. */
  walletPriorityEnabled: boolean;
  /** A wallet needs at least this many closed (sold) trades before its
   * track record affects sizing — avoids overreacting to 1-2 lucky/unlucky trades. */
  walletPriorityMinTrades: number;
  walletPriorityMinMultiplier: number; // applied to the worst-performing eligible wallet
  walletPriorityMaxMultiplier: number; // applied to the best-performing eligible wallet

  /** Independent exit rules, checked on a timer against live quotes (see
   * bot.ts's position monitor) — the only other exit path is "the target
   * wallet sold" (calculator.ts), which never fires if a target holds
   * long-term, goes quiet, or a token rugs while they're still holding. */
  stopLossEnabled: boolean;
  stopLossPct: number; // sell a position once it's down this many % from cost basis
  takeProfitEnabled: boolean;
  takeProfitPct: number; // sell a position once it's up this many % from cost basis

  /** Trailing stop: exits once price drops this many % from the position's
   * highest observed value since entry, rather than from a fixed cost
   * basis. Independent of (and checked before) the static stopLoss above —
   * whichever fires first wins for a given tick. */
  trailingStopEnabled: boolean;
  trailingStopPct: number;

  /** Take-profit laddering: partial exits at increasing ROI targets (e.g.
   * 25% of the position at +100%, another 25% at +200%), instead of one
   * all-or-nothing take-profit. Each rung fires at most once per position
   * (tracked in positionState.ts). Stored as JSON since it's a list, not a
   * scalar — validated in validate() below (roiPct > 0, 0 < exitPct <= 100,
   * sorted ascending, max 10 rungs). Independent of takeProfitEnabled
   * above, which remains as a simple full-exit fallback. */
  takeProfitLaddersEnabled: boolean;
  takeProfitLadders: { roiPct: number; exitPct: number }[];

  /** Time-based liquidation: force-exits a position if it hasn't reached
   * timeLimitMinRoiPct within timeLimitMinutes of the first fill — prevents
   * slow-bleed holding a target that's gone quiet on a token that's just
   * drifting. */
  timeLimitEnabled: boolean;
  timeLimitMinutes: number;
  timeLimitMinRoiPct: number;

  /** "proportional" (default, existing behavior): min(% of spendable
   * balance, buySolCap). "fixed": always spend buySolCap (subject only to
   * the priority multiplier and available balance) — a fixed $-equivalent
   * ticket size per trade instead of scaling with the target's own size. */
  positionSizingMode: "proportional" | "fixed";

  /** FOMO/momentum validation gate (momentum.ts) — run on every detected
   * buy before it's sized/executed. Off by default: it depends on
   * Dexscreener having an indexed pair for the mint, which brand-new
   * pre-migration pump.fun bonding-curve tokens usually don't have yet (see
   * momentum.ts and the README for the tradeoff this implies). */
  fomoValidationEnabled: boolean;
  /** Which Dexscreener window price velocity/volume surge are computed
   * over. "m5" reacts faster; "h1" is less noisy. */
  momentumWindow: "m5" | "h1";
  minPriceChangePct: number; // required % move over momentumWindow
  minVolumeSurgeMultiple: number; // current 5-min volume rate vs. its own hourly average
  minLiquidityUsd: number;
  maxSellTaxBps: number; // Token-2022 transfer-fee extension ceiling, in basis points
  momentumValidationTimeoutMs: number; // hard budget for the whole check (spec: <1.5s)
  /** What to do when Dexscreener has no pair for the mint at all (distinct
   * from "has a pair but it fails a threshold"). false = skip the buy
   * (safe default — "don't buy blindly"). true = let it through unvalidated
   * — only sensible if you're deliberately copy-trading pre-migration
   * pump.fun bonding-curve entries, where no aggregator has indexed a pair
   * yet by definition. */
  momentumFailOpenOnNoData: boolean;
}

function seedFromConfig(): EditableSettings {
  return {
    dryRun: config.dryRun,
    buySolCap: Number(config.buySolCapLamports) / 1e9,
    buyPortfolioPercent: config.buyPortfolioPercent * 100,
    feeBufferSol: Number(config.feeBufferLamports) / 1e9,
    slippageBps: config.slippageBps,
    minLiquiditySol: config.minLiquiditySol,
    maxPriceImpactPct: config.maxPriceImpactPct * 100,
    maxSafeWalletSol: config.maxSafeWalletSol,
    jitoBlockEngineUrl: config.jitoBlockEngineUrl,
    jitoTipSol: Number(config.jitoTipLamports) / 1e9,
    priorityFeePercentile: config.priorityFeePercentile,

    // No corresponding .env vars — these are UI-managed from day one.
    walletPriorityEnabled: false,
    walletPriorityMinTrades: 3,
    walletPriorityMinMultiplier: 0.5,
    walletPriorityMaxMultiplier: 1.5,

    stopLossEnabled: false,
    stopLossPct: 25,
    takeProfitEnabled: false,
    takeProfitPct: 100,

    trailingStopEnabled: false,
    trailingStopPct: 20,

    takeProfitLaddersEnabled: false,
    takeProfitLadders: [
      { roiPct: 100, exitPct: 25 },
      { roiPct: 200, exitPct: 25 },
    ],

    timeLimitEnabled: false,
    timeLimitMinutes: 60,
    timeLimitMinRoiPct: 10,

    positionSizingMode: "proportional",

    fomoValidationEnabled: false,
    momentumWindow: "m5",
    minPriceChangePct: 5,
    minVolumeSurgeMultiple: 3,
    minLiquidityUsd: 3000,
    maxSellTaxBps: 500,
    momentumValidationTimeoutMs: 1500,
    momentumFailOpenOnNoData: false,
  };
}

function load(): EditableSettings {
  if (existsSync(config.settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(config.settingsPath, "utf-8"));
      return { ...seedFromConfig(), ...raw };
    } catch {
      // fall through to a fresh seed
    }
  }
  return seedFromConfig();
}

function save(settings: EditableSettings): void {
  writeFileSync(config.settingsPath, JSON.stringify(settings, null, 2));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Only accepts known numeric/boolean/string fields, clamped to sane
 * ranges — this is reachable from the website with no auth, same posture
 * as the rest of the control API, so it shouldn't be possible to set
 * something that breaks trading math (e.g. negative slippage). */
function validate(input: Partial<EditableSettings>): Partial<EditableSettings> {
  const out: Partial<EditableSettings> = {};
  if (input.dryRun !== undefined) out.dryRun = Boolean(input.dryRun);
  if (isFiniteNumber(input.buySolCap)) out.buySolCap = clamp(input.buySolCap, 0, 1000);
  if (isFiniteNumber(input.buyPortfolioPercent)) out.buyPortfolioPercent = clamp(input.buyPortfolioPercent, 0, 100);
  if (isFiniteNumber(input.feeBufferSol)) out.feeBufferSol = clamp(input.feeBufferSol, 0, 10);
  if (isFiniteNumber(input.slippageBps)) out.slippageBps = clamp(Math.round(input.slippageBps), 1, 5000);
  if (isFiniteNumber(input.minLiquiditySol)) out.minLiquiditySol = clamp(input.minLiquiditySol, 0, 100_000);
  if (isFiniteNumber(input.maxPriceImpactPct)) out.maxPriceImpactPct = clamp(input.maxPriceImpactPct, 0, 100);
  if (isFiniteNumber(input.maxSafeWalletSol)) out.maxSafeWalletSol = clamp(input.maxSafeWalletSol, 0, 1_000_000);
  if (typeof input.jitoBlockEngineUrl === "string") out.jitoBlockEngineUrl = input.jitoBlockEngineUrl.trim();
  if (isFiniteNumber(input.jitoTipSol)) out.jitoTipSol = clamp(input.jitoTipSol, 0, 1);
  if (isFiniteNumber(input.priorityFeePercentile)) out.priorityFeePercentile = clamp(Math.round(input.priorityFeePercentile), 1, 100);
  if (input.walletPriorityEnabled !== undefined) out.walletPriorityEnabled = Boolean(input.walletPriorityEnabled);
  if (isFiniteNumber(input.walletPriorityMinTrades)) out.walletPriorityMinTrades = clamp(Math.round(input.walletPriorityMinTrades), 1, 1000);
  if (isFiniteNumber(input.walletPriorityMinMultiplier)) out.walletPriorityMinMultiplier = clamp(input.walletPriorityMinMultiplier, 0, 1);
  if (isFiniteNumber(input.walletPriorityMaxMultiplier)) out.walletPriorityMaxMultiplier = clamp(input.walletPriorityMaxMultiplier, 1, 5);
  if (input.stopLossEnabled !== undefined) out.stopLossEnabled = Boolean(input.stopLossEnabled);
  if (isFiniteNumber(input.stopLossPct)) out.stopLossPct = clamp(input.stopLossPct, 1, 100);
  if (input.takeProfitEnabled !== undefined) out.takeProfitEnabled = Boolean(input.takeProfitEnabled);
  if (isFiniteNumber(input.takeProfitPct)) out.takeProfitPct = clamp(input.takeProfitPct, 1, 10_000);

  if (input.trailingStopEnabled !== undefined) out.trailingStopEnabled = Boolean(input.trailingStopEnabled);
  if (isFiniteNumber(input.trailingStopPct)) out.trailingStopPct = clamp(input.trailingStopPct, 1, 100);

  if (input.takeProfitLaddersEnabled !== undefined) out.takeProfitLaddersEnabled = Boolean(input.takeProfitLaddersEnabled);
  if (Array.isArray(input.takeProfitLadders)) {
    const rungs = input.takeProfitLadders
      .filter(
        (r): r is { roiPct: number; exitPct: number } =>
          !!r && isFiniteNumber((r as { roiPct: unknown }).roiPct) && isFiniteNumber((r as { exitPct: unknown }).exitPct)
      )
      .map((r) => ({ roiPct: clamp(r.roiPct, 1, 100_000), exitPct: clamp(r.exitPct, 1, 100) }))
      .sort((a, b) => a.roiPct - b.roiPct)
      .slice(0, 10);
    if (rungs.length > 0) out.takeProfitLadders = rungs;
  }

  if (input.timeLimitEnabled !== undefined) out.timeLimitEnabled = Boolean(input.timeLimitEnabled);
  if (isFiniteNumber(input.timeLimitMinutes)) out.timeLimitMinutes = clamp(Math.round(input.timeLimitMinutes), 1, 43_200);
  if (isFiniteNumber(input.timeLimitMinRoiPct)) out.timeLimitMinRoiPct = clamp(input.timeLimitMinRoiPct, -100, 100_000);

  if (input.positionSizingMode === "proportional" || input.positionSizingMode === "fixed") {
    out.positionSizingMode = input.positionSizingMode;
  }

  if (input.fomoValidationEnabled !== undefined) out.fomoValidationEnabled = Boolean(input.fomoValidationEnabled);
  if (input.momentumWindow === "m5" || input.momentumWindow === "h1") out.momentumWindow = input.momentumWindow;
  if (isFiniteNumber(input.minPriceChangePct)) out.minPriceChangePct = clamp(input.minPriceChangePct, 0, 10_000);
  if (isFiniteNumber(input.minVolumeSurgeMultiple)) out.minVolumeSurgeMultiple = clamp(input.minVolumeSurgeMultiple, 0, 1000);
  if (isFiniteNumber(input.minLiquidityUsd)) out.minLiquidityUsd = clamp(input.minLiquidityUsd, 0, 100_000_000);
  if (isFiniteNumber(input.maxSellTaxBps)) out.maxSellTaxBps = clamp(Math.round(input.maxSellTaxBps), 0, 10_000);
  if (isFiniteNumber(input.momentumValidationTimeoutMs)) out.momentumValidationTimeoutMs = clamp(Math.round(input.momentumValidationTimeoutMs), 100, 10_000);
  if (input.momentumFailOpenOnNoData !== undefined) out.momentumFailOpenOnNoData = Boolean(input.momentumFailOpenOnNoData);

  return out;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

class SettingsStore {
  private settings: EditableSettings = load();

  get(): EditableSettings {
    return { ...this.settings };
  }

  update(patch: Partial<EditableSettings>): EditableSettings {
    this.settings = { ...this.settings, ...validate(patch) };
    save(this.settings);
    return this.get();
  }

  // Convenience derived values for calculator.ts/executor.ts, which work in
  // lamports/fractions rather than the human-friendly SOL/percent units
  // stored above.
  get buySolCapLamports(): bigint {
    return BigInt(Math.round(this.settings.buySolCap * 1e9));
  }
  get buyPortfolioFraction(): number {
    return this.settings.buyPortfolioPercent / 100;
  }
  get feeBufferLamports(): bigint {
    return BigInt(Math.round(this.settings.feeBufferSol * 1e9));
  }
  get maxPriceImpactFraction(): number {
    return this.settings.maxPriceImpactPct / 100;
  }
  get jitoTipLamports(): bigint {
    return BigInt(Math.round(this.settings.jitoTipSol * 1e9));
  }
}

export const settingsStore = new SettingsStore();
