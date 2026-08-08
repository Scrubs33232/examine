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
