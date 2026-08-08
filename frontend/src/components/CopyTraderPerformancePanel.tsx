"use client";

import { useCallback, useEffect, useState } from "react";
import { getLedgerSummary, type LedgerSummary, type WalletStats } from "@/lib/copyTraderApi";

const POLL_MS = 10_000;

function shortAddr(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function pnlColor(sol: number): string {
  if (sol > 0) return "text-bull";
  if (sol < 0) return "text-bear";
  return "text-muted";
}

function WalletRow({ stats, rank }: { stats: WalletStats; rank: number }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-3">
        <span className="text-muted">#{rank}</span>
        <span className="text-foreground">{shortAddr(stats.wallet)}</span>
        {stats.priorityMultiplier !== 1 && (
          <span className={stats.priorityMultiplier > 1 ? "text-bull" : "text-bear"}>×{stats.priorityMultiplier.toFixed(2)}</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-right">
        <span className="text-muted">
          {stats.closedTradeCount} closed{stats.closedTradeCount > 0 ? `, ${(stats.winRate * 100).toFixed(0)}% win` : ""}
        </span>
        <span className={pnlColor(stats.realizedPnlSol)}>
          {stats.realizedPnlSol > 0 ? "+" : ""}
          {stats.realizedPnlSol.toFixed(4)} SOL
        </span>
      </div>
    </li>
  );
}

export default function CopyTraderPerformancePanel() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getLedgerSummary()
      .then((s) => {
        setSummary(s);
        setError(null);
      })
      .catch(() => setError("Couldn't load performance data from the bot."));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-1 font-mono text-xs uppercase tracking-widest text-muted">Performance</h2>
      <p className="mb-4 font-mono text-[10px] text-muted">
        Realized P&amp;L from actual on-chain fills only — dry-run trades and unverified amounts aren&apos;t
        counted. Closed trades = mirrored sells matched against a tracked buy for that wallet.
      </p>

      {error && <p className="font-mono text-xs text-bear">{error}</p>}

      {!error && !summary && <p className="font-mono text-xs text-muted">Loading…</p>}

      {summary && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-center">
              <div className={`font-mono text-lg font-semibold tabular ${pnlColor(summary.totalRealizedPnlSol)}`}>
                {summary.totalRealizedPnlSol > 0 ? "+" : ""}
                {summary.totalRealizedPnlSol.toFixed(4)}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Realized P&amp;L (SOL)</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-center">
              <div className="font-mono text-lg font-semibold tabular text-foreground">{summary.totalClosedTrades}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Closed trades</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-center">
              <div className="font-mono text-lg font-semibold tabular text-foreground">{summary.wallets.length}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Wallets tracked</div>
            </div>
          </div>

          {summary.wallets.length === 0 ? (
            <p className="font-mono text-xs text-muted">No trades executed yet — this fills in as the bot trades live.</p>
          ) : (
            <ul className="space-y-2">
              {summary.wallets.map((w, i) => (
                <WalletRow key={w.wallet} stats={w} rank={i + 1} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
