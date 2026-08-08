"use client";

import { useEffect, useState } from "react";
import { fetchMovers, isQualifiedMover, type MoverCandidate } from "@/lib/movers";

const REFRESH_INTERVAL_MS = 30_000;

export default function MoversFeed({ onSelect }: { onSelect: (mint: string) => void }) {
  const [movers, setMovers] = useState<MoverCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fetchMovers();
      if (!cancelled) {
        setMovers(data.filter((m) => isQualifiedMover(m).qualified));
        setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Movers</h2>
        {loading && <span className="font-mono text-[10px] text-muted">loading…</span>}
      </div>

      {!loading && movers.length === 0 && <p className="font-mono text-xs text-muted">No qualifying movers right now.</p>}

      <ul className="space-y-1.5">
        {movers.map((m) => (
          <li key={m.mint}>
            <button
              onClick={() => onSelect(m.mint)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 text-left transition hover:border-accent"
            >
              <div>
                <div className="font-mono text-xs text-foreground">{m.symbol}</div>
                <div className="font-mono text-[10px] text-muted">bonding {m.bondingCurveProgressPct.toFixed(0)}%</div>
              </div>
              <div
                className={`font-mono text-xs tabular ${m.priceChange5mPct >= 0 ? "text-bull" : "text-bear"}`}
              >
                {m.priceChange5mPct >= 0 ? "+" : ""}
                {m.priceChange5mPct.toFixed(1)}%
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
