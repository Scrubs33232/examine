/** Position-sizing math. All amounts are bigint (lamports / raw token base
 * units) throughout — no floating point near money, ever. Sizing parameters
 * (buy %, cap, fee buffer) come from settingsStore, which is live-editable
 * from the website — so a change there takes effect on the very next trade,
 * no restart needed. Buy sizing also factors in a per-source-wallet
 * priority multiplier from ledger.ts (1x = neutral) when that feature is
 * enabled — wallets with a stronger realized track record get sized up,
 * weaker ones sized down, within configured bounds. */
import { settingsStore } from "./settingsStore.js";
import { ledger } from "./ledger.js";
import type { SizedOrder, TargetTradeEvent } from "./types.js";

const BPS_DENOMINATOR = 10_000n;

/** How much SOL (lamports) to spend mirroring a target BUY, given the bot's
 * current SOL balance: min(portfolio-percent * priority multiplier, fixed
 * cap), minus a fee buffer. The cap is a hard ceiling regardless of the
 * multiplier — a good track record sizes you up toward the cap, never past it. */
export function calculateBuySize(botSolBalanceLamports: bigint, sourceWallet: string): bigint {
  const spendable = botSolBalanceLamports - settingsStore.feeBufferLamports;
  if (spendable <= 0n) return 0n;

  const multiplier = ledger.getPriorityMultiplier(sourceWallet);
  const effectiveFraction = settingsStore.buyPortfolioFraction * multiplier;
  const percentBps = BigInt(Math.round(effectiveFraction * 10_000));
  const byPercent = (spendable * percentBps) / BPS_DENOMINATOR;

  const cap = settingsStore.buySolCapLamports;
  const sized = byPercent < cap ? byPercent : cap;
  return sized > spendable ? spendable : sized;
}

/** Raw token amount to sell so the bot mirrors the exact fraction of holdings
 * the target sold (e.g. target sold 25% of their tokens -> sell 25% of ours).
 * Not affected by the priority multiplier — exiting proportionally isn't a
 * sizing decision, it's just following the target out. */
export function calculateSellAmount(botTokenRawBalance: bigint, targetSellFraction: number): bigint {
  if (targetSellFraction <= 0 || botTokenRawBalance <= 0n) return 0n;
  const fraction = Math.min(targetSellFraction, 1);
  const fractionBps = BigInt(Math.round(fraction * 10_000));
  return (botTokenRawBalance * fractionBps) / BPS_DENOMINATOR;
}

/** Applies a slippage bound to an amount. direction "min" shrinks it (use for
 * minimum acceptable output), "max" grows it (use for maximum acceptable cost). */
export function applySlippage(amount: bigint, slippageBps: number, direction: "min" | "max"): bigint {
  const factor = direction === "min" ? 10_000 - slippageBps : 10_000 + slippageBps;
  return (amount * BigInt(factor)) / BPS_DENOMINATOR;
}

/** Turns a detected target trade into a sized order for the bot's own
 * wallet, or null if there's nothing sensible to mirror (e.g. buy size
 * rounds to zero, or we don't know the target's holding fraction for a sell). */
export function sizeOrder(
  event: TargetTradeEvent,
  botSolBalanceLamports: bigint,
  botTokenRawBalance: bigint
): SizedOrder | null {
  if (event.direction === "buy") {
    const multiplier = ledger.getPriorityMultiplier(event.sourceWallet);
    const solIn = calculateBuySize(botSolBalanceLamports, event.sourceWallet);
    if (solIn <= 0n) return null;
    const settings = settingsStore.get();
    const multiplierNote = multiplier !== 1 ? ` (×${multiplier.toFixed(2)} priority for this wallet's track record)` : "";
    return {
      direction: "buy",
      mint: event.mint,
      dex: event.dex,
      sourceWallet: event.sourceWallet,
      solLamportsIn: solIn,
      tokenDecimals: event.tokenDecimals,
      priorityMultiplier: multiplier,
      reason: `mirroring buy: ${settings.buyPortfolioPercent.toFixed(0)}% of spendable balance${multiplierNote}, capped at ${settings.buySolCap} SOL (spending ${Number(solIn) / 1e9} SOL)`,
    };
  }

  if (event.sellFractionOfHoldings === null) return null;
  const tokenOut = calculateSellAmount(botTokenRawBalance, event.sellFractionOfHoldings);
  if (tokenOut <= 0n) return null;

  return {
    direction: "sell",
    mint: event.mint,
    dex: event.dex,
    sourceWallet: event.sourceWallet,
    tokenRawAmountIn: tokenOut,
    tokenDecimals: event.tokenDecimals,
    priorityMultiplier: 1,
    reason: `mirroring sell: target sold ${(event.sellFractionOfHoldings * 100).toFixed(1)}% of their holdings`,
  };
}
