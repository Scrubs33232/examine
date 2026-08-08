"use client";

import { useCallback, useEffect, useState } from "react";
import { getOpenPositions, type OpenPosition } from "@/lib/copyTraderApi";

const POLL_MS = 10_000;

function shortAddr(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function pnlColor(pct: number | null): string {
  if (pct === null) return "text-muted";
  if (pct > 0) return "text-bull";
  if (pct < 0) return "text-bear";
  return "text-muted";
}

function PositionRow({ position }: { position: OpenPosition }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-3">
        <span className="text-foreground">{shortAddr(position.mint)}</span>
        <span className="text-muted">via {shortAddr(position.sourceWallet)}</span>
      </div>
      <div className="flex items-center gap-4 text-right">
        <span className="text-muted">{position.costBasisSol.toFixed(4)} SOL in</span>
        <span className={pnlColor(position.unrealizedPnlPct)}>
          {position.unrealizedPnlPct === null
            ? "no quote"
            : `${position.unrealizedPnlPct > 0 ? "+" : ""}${position.unrealizedPnlPct.toFixed(1)}%`}
        </span>
      </div>
    </li>
  );
}

export default function CopyTraderPositionsPanel() {
  const [positions, setPositions] = useState<OpenPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getOpenPositions()
      .then((p) => {
        setPositions(p);
        setError(null);
      })
      .catch(() => setError("Couldn't load open positions from the bot."));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-1 font-mono text-xs uppercase tracking-widest text-muted">Open Positions</h2>
      <p className="mb-4 font-mono text-[10px] text-muted">
        Live unrealized P&amp;L vs. cost basis, priced via Jupiter quote. This is what stop-loss / take-profit
        (in Settings below) watches — independent of whether the target wallet has sold.
      </p>

      {error && <p className="font-mono text-xs text-bear">{error}</p>}
      {!error && !positions && <p className="font-mono text-xs text-muted">Loading…</p>}

      {positions &&
        (positions.length === 0 ? (
          <p className="font-mono text-xs text-muted">No open positions right now.</p>
        ) : (
          <ul className="space-y-2">
            {positions.map((p) => (
              <PositionRow key={`${p.sourceWallet}:${p.mint}`} position={p} />
            ))}
          </ul>
        ))}
    </div>
  );
}
