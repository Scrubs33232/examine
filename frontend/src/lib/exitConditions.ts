// Pure function — prices in, an alert-or-null out. Never calls anything,
// never sells anything. The caller (usePositions) only ever uses the result
// to show a notification; the actual sell is always a manual click.

export interface ExitAlert {
  reason: "take_profit" | "stop_loss";
  message: string;
}

export function checkExitConditions(
  entryPriceUsd: number,
  currentPriceUsd: number,
  takeProfitPct: number,
  stopLossPct: number
): ExitAlert | null {
  if (entryPriceUsd <= 0 || currentPriceUsd <= 0) return null;

  const changePct = ((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100;

  if (changePct >= takeProfitPct) {
    return { reason: "take_profit", message: `up ${changePct.toFixed(1)}% from entry (target ${takeProfitPct}%)` };
  }
  if (changePct <= -stopLossPct) {
    return { reason: "stop_loss", message: `down ${Math.abs(changePct).toFixed(1)}% from entry (stop ${stopLossPct}%)` };
  }
  return null;
}
