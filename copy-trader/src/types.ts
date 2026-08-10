export type Dex = "pumpfun" | "raydium";
export type TradeDirection = "buy" | "sell";

/** A trade detected on a watched target wallet, already normalized regardless
 * of which DEX/instruction shape produced it (see listener.ts — detection
 * works by diffing pre/post balances, not by decoding each DEX's layout). */
export interface TargetTradeEvent {
  signature: string;
  slot: number;
  dex: Dex;
  direction: TradeDirection;
  mint: string;
  /** The target wallet that triggered this — lets ledger.ts attribute P&L
   * back to a specific wallet for the leaderboard/prioritization feature. */
  sourceWallet: string;
  /** Absolute SOL moved by the target in this trade, in lamports. */
  solLamports: bigint;
  /** Absolute token amount moved, in raw base units (pre-decimals). */
  tokenRawAmount: bigint;
  tokenDecimals: number;
  /** For sells only: what fraction (0-1) of the target's PRE-trade token
   * balance this sell represents. Null for buys, or if the target's
   * pre-trade balance was zero (can't compute a fraction of zero). */
  sellFractionOfHoldings: number | null;
  detectedAt: number;
}

/** A trade sized for the bot's own wallet, ready for the executor. */
export interface SizedOrder {
  direction: TradeDirection;
  mint: string;
  dex: Dex;
  sourceWallet: string;
  /** Buys only: lamports of SOL to spend. */
  solLamportsIn?: bigint;
  /** Sells only: raw token amount to sell. */
  tokenRawAmountIn?: bigint;
  tokenDecimals: number;
  reason: string;
  /** Sizing multiplier applied for this source wallet's track record (1 =
   * neutral/not enough data yet). Recorded for transparency in the log. */
  priorityMultiplier: number;
}

/** Result of the pre-trade FOMO/momentum validation engine (see momentum.ts)
 * — run only for buy-side mirrors, before sizing/execution. `metrics` is
 * populated best-effort even on failure/timeout, for logging. */
export interface FomoValidationResult {
  pass: boolean;
  reason: string;
  metrics: {
    priceChangePct: number | null;
    volumeSurgeMultiple: number | null;
    liquidityUsd: number | null;
    sellTaxBps: number | null;
    dataSource: "dexscreener" | "unavailable";
  };
  elapsedMs: number;
}

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  route: "jupiter" | "pumpfun-direct";
  submittedVia: "jito" | "rpc";
  latencyMs: number;
  /** Actual amounts moved in OUR OWN wallet, read back from the confirmed
   * transaction (not the requested/estimated amounts) — this is what P&L
   * tracking in ledger.ts is built on. Undefined for dry runs or failures. */
  actualSolLamports?: bigint;
  actualTokenRawAmount?: bigint;
}
