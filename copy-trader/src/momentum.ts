/** FOMO / momentum validation engine — the "is this momentum real" gate
 * that runs between detecting a target wallet's buy and mirroring it.
 *
 * Checks four things, all sourced from data we don't have to build our own
 * pipeline for:
 *   1. Price velocity   — % price move over a short window (Dexscreener).
 *   2. Volume surge      — current short-window volume vs. its own rolling
 *                          average, approximated from Dexscreener's m5/h1
 *                          buckets (see computeVolumeSurgeMultiple below).
 *   3. Liquidity floor    — pool depth in USD (Dexscreener).
 *   4. Mint/tax safety    — mint & freeze authority renounced, and for
 *                          Token-2022 mints, the transfer-fee ("tax")
 *                          extension is within the configured max.
 *
 * Data source: Dexscreener's public token-pairs API (no key required). This
 * only has data for tokens with an indexed AMM/CLMM pair — a brand-new
 * pump.fun bonding-curve token *pre-migration* usually won't be indexed yet.
 * That's a real gap, not a bug: see `momentumFailOpenOnNoData` in
 * settingsStore.ts for how to handle it, and the README for the tradeoff.
 *
 * Runs under a hard timeout (`validationTimeoutMs`, default 1500ms per the
 * spec) via Promise.race — a slow/hanging fetch degrades to "no data"
 * rather than blocking the whole detection pipeline.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getTransferFeeConfig, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { settingsStore } from "./settingsStore.js";
import type { FomoValidationResult } from "./types.js";

const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";
const SOLANA_CHAIN_ID = "solana";

interface DexscreenerPair {
  chainId: string;
  liquidity?: { usd?: number };
  volume?: { m5?: number; h1?: number };
  priceChange?: { m5?: number; h1?: number };
}

async function fetchTokenPairs(mint: string, timeoutMs: number): Promise<DexscreenerPair[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DEXSCREENER_TOKENS_URL}/${mint}`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { pairs?: DexscreenerPair[] };
    const pairs = (body.pairs ?? []).filter((p) => p.chainId === SOLANA_CHAIN_ID);
    return pairs.length > 0 ? pairs : null;
  } catch {
    return null; // timeout, network error, or no indexed pair — all "no data"
  } finally {
    clearTimeout(timer);
  }
}

/** Picks the deepest-liquidity pair when a mint has more than one pool —
 * that's the one whose price/volume best represents the real market. */
function pickDeepestPair(pairs: DexscreenerPair[]): DexscreenerPair {
  return pairs.reduce((best, p) => ((p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best));
}

/** Dexscreener gives cumulative volume for m5/h1 windows, not a rolling
 * 30-minute average directly. We approximate "average volume over the last
 * ~30-60min" as the steady-state 5-minute rate implied by h1 volume
 * (h1Volume / 12), then compare the actual m5 volume against that rate.
 * A m5 volume equal to the hourly average would score 1x (no surge); a m5
 * volume 5x the hourly average scores 5x. This is a real, monotonic surge
 * signal, but note it's biased low right after a genuine breakout (the
 * spike itself inflates the h1 baseline it's being compared against) —
 * treat the threshold as conservative, not exact. */
function computeVolumeSurgeMultiple(pair: DexscreenerPair): number | null {
  const m5 = pair.volume?.m5;
  const h1 = pair.volume?.h1;
  if (m5 === undefined || h1 === undefined || h1 <= 0) return null;
  const avg5MinRate = h1 / 12;
  if (avg5MinRate <= 0) return m5 > 0 ? Infinity : null;
  return m5 / avg5MinRate;
}

interface TokenSafetyResult {
  ok: boolean;
  reason?: string;
  sellTaxBps: number | null;
}

/** Mint/freeze authority + Token-2022 transfer-fee ("tax") check. Separate
 * from executor.ts's checkExecutionGuards (which re-checks mint/freeze
 * authority again immediately before submission, as defense in depth) —
 * this runs earlier, as part of the FOMO gate, and additionally covers
 * Token-2022's transfer-fee extension, which is the closest on-chain
 * equivalent Solana SPL tokens have to an EVM-style buy/sell tax. */
async function checkTokenSafety(connection: Connection, mint: string, maxSellTaxBps: number): Promise<TokenSafetyResult> {
  const mintPubkey = new PublicKey(mint);

  // Token-2022 mints and classic SPL mints are read differently — probe
  // classic first (the overwhelmingly common case for pump.fun/Raydium).
  let mintInfo;
  let programId = TOKEN_PROGRAM_ID;
  try {
    mintInfo = await getMint(connection, mintPubkey, "confirmed", TOKEN_PROGRAM_ID);
  } catch {
    try {
      mintInfo = await getMint(connection, mintPubkey, "confirmed", TOKEN_2022_PROGRAM_ID);
      programId = TOKEN_2022_PROGRAM_ID;
    } catch (err) {
      return { ok: false, reason: `could not read mint info: ${(err as Error).message}`, sellTaxBps: null };
    }
  }

  if (mintInfo.mintAuthority !== null) {
    return { ok: false, reason: "mint authority is not renounced — supply can be inflated after we buy", sellTaxBps: null };
  }
  if (mintInfo.freezeAuthority !== null) {
    return { ok: false, reason: "freeze authority is set — our token account could be frozen after we buy", sellTaxBps: null };
  }

  if (programId !== TOKEN_2022_PROGRAM_ID) {
    return { ok: true, sellTaxBps: 0 }; // classic SPL tokens have no transfer-fee extension
  }

  const feeConfig = getTransferFeeConfig(mintInfo);
  if (!feeConfig) return { ok: true, sellTaxBps: 0 };

  // Use whichever of older/newer fee applies right now would require an
  // epoch lookup; newerTransferFee is the conservative (usually current)
  // choice and avoids an extra RPC round-trip inside the latency budget.
  const bps = feeConfig.newerTransferFee.transferFeeBasisPoints;
  if (bps > maxSellTaxBps) {
    return { ok: false, reason: `Token-2022 transfer fee is ${(bps / 100).toFixed(2)}%, above the ${(maxSellTaxBps / 100).toFixed(2)}% max`, sellTaxBps: bps };
  }
  return { ok: true, sellTaxBps: bps };
}

/** Runs the full FOMO validation gate for a candidate buy. Buy-side only —
 * mirroring a target's sell should never be blocked by momentum thresholds,
 * since exiting is about following the target out, not chasing a trend. */
export async function validateFomo(connection: Connection, mint: string): Promise<FomoValidationResult> {
  const start = Date.now();
  const settings = settingsStore.get();
  const metrics: FomoValidationResult["metrics"] = {
    priceChangePct: null,
    volumeSurgeMultiple: null,
    liquidityUsd: null,
    sellTaxBps: null,
    dataSource: "unavailable",
  };

  const timeoutMs = settings.momentumValidationTimeoutMs;
  const deadline = new Promise<FomoValidationResult>((resolve) =>
    setTimeout(
      () =>
        resolve({
          pass: settings.momentumFailOpenOnNoData,
          reason: `momentum validation timed out after ${timeoutMs}ms — ${settings.momentumFailOpenOnNoData ? "failing open" : "failing closed (no data in time)"}`,
          metrics,
          elapsedMs: Date.now() - start,
        }),
      timeoutMs
    )
  );

  const run = (async (): Promise<FomoValidationResult> => {
    const [pairs, safety] = await Promise.all([
      fetchTokenPairs(mint, timeoutMs),
      checkTokenSafety(connection, mint, settings.maxSellTaxBps),
    ]);

    metrics.sellTaxBps = safety.sellTaxBps;
    if (!safety.ok) {
      return { pass: false, reason: `safety check failed: ${safety.reason}`, metrics, elapsedMs: Date.now() - start };
    }

    if (!pairs) {
      return {
        pass: settings.momentumFailOpenOnNoData,
        reason: settings.momentumFailOpenOnNoData
          ? "no Dexscreener data (likely a pre-migration bonding-curve token) — failing open per momentumFailOpenOnNoData"
          : "no Dexscreener data (likely a pre-migration bonding-curve token) — failing closed, skipping buy",
        metrics,
        elapsedMs: Date.now() - start,
      };
    }

    const pair = pickDeepestPair(pairs);
    metrics.dataSource = "dexscreener";
    metrics.liquidityUsd = pair.liquidity?.usd ?? null;
    metrics.priceChangePct = settings.momentumWindow === "h1" ? pair.priceChange?.h1 ?? null : pair.priceChange?.m5 ?? null;
    metrics.volumeSurgeMultiple = computeVolumeSurgeMultiple(pair);

    if (metrics.liquidityUsd === null || metrics.liquidityUsd < settings.minLiquidityUsd) {
      return {
        pass: false,
        reason: `liquidity floor: $${metrics.liquidityUsd?.toFixed(0) ?? "unknown"} < $${settings.minLiquidityUsd} minimum`,
        metrics,
        elapsedMs: Date.now() - start,
      };
    }

    if (metrics.priceChangePct === null || metrics.priceChangePct < settings.minPriceChangePct) {
      return {
        pass: false,
        reason: `price velocity: ${metrics.priceChangePct?.toFixed(1) ?? "unknown"}% < ${settings.minPriceChangePct}% required over ${settings.momentumWindow}`,
        metrics,
        elapsedMs: Date.now() - start,
      };
    }

    if (metrics.volumeSurgeMultiple === null || metrics.volumeSurgeMultiple < settings.minVolumeSurgeMultiple) {
      return {
        pass: false,
        reason: `volume surge: ${metrics.volumeSurgeMultiple?.toFixed(1) ?? "unknown"}x < ${settings.minVolumeSurgeMultiple}x required`,
        metrics,
        elapsedMs: Date.now() - start,
      };
    }

    return {
      pass: true,
      reason: `momentum confirmed: price +${metrics.priceChangePct.toFixed(1)}%, volume ${metrics.volumeSurgeMultiple.toFixed(1)}x, liquidity $${metrics.liquidityUsd.toFixed(0)}`,
      metrics,
      elapsedMs: Date.now() - start,
    };
  })();

  return Promise.race([run, deadline]);
}
