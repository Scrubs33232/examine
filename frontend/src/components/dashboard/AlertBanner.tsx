"use client";

export interface BannerAlert {
  id: string;
  symbol: string;
  reason: "take_profit" | "stop_loss";
  message: string;
}

export default function AlertBanner({ alert, onDismiss }: { alert: BannerAlert | null; onDismiss: () => void }) {
  if (!alert) return null;

  const isProfit = alert.reason === "take_profit";

  return (
    <div
      className={`fixed inset-x-0 top-0 z-50 animate-pulse-soft border-b px-4 py-3 text-center font-mono text-sm ${
        isProfit ? "border-bull-dim bg-bull-bg text-bull" : "border-bear-dim bg-bear-bg text-bear"
      }`}
    >
      {isProfit ? "▲ TAKE-PROFIT HIT" : "▼ STOP-LOSS HIT"} — {alert.symbol}: {alert.message}
      <button onClick={onDismiss} className="ml-4 underline">
        dismiss
      </button>
    </div>
  );
}
