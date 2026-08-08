"use client";

import { useEffect, useRef, useState } from "react";
import { getLiveOdds } from "@/lib/api";
import type { Analysis, LiveOdds } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default function LiveOddsBadge({ analysis }: { analysis: Analysis }) {
  const [live, setLive] = useState<LiveOdds | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!analysis.source_url) {
      setUnavailable(true);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const odds = await getLiveOdds(analysis.id);
        if (!cancelled) {
          setLive(odds);
          setLastUpdated(Date.now());
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [analysis.id, analysis.source_url]);

  if (unavailable) return null;

  if (!live) {
    return (
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-muted" />
        Checking live odds…
      </div>
    );
  }

  const deltaPp = (live.yes - analysis.market_odds.yes) * 100;
  const moved = Math.abs(deltaPp) >= 0.5;
  const towardAi = analysis.ai_probability >= analysis.market_odds.yes ? deltaPp > 0 : deltaPp < 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 font-mono text-[10px]">
      <span className="flex items-center gap-1.5 text-muted">
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-bull" />
        LIVE {pct(live.yes)} YES
      </span>
      {moved && (
        <span className={towardAi ? "text-bull" : "text-bear"}>
          {deltaPp > 0 ? "▲" : "▼"} {Math.abs(deltaPp).toFixed(1)} pp since analysis
        </span>
      )}
      <span className="text-muted">
        edge now <span className={live.recommendation === "pass" ? "text-muted" : "text-foreground"}>{live.edge_pct > 0 ? "+" : ""}{live.edge_pct.toFixed(1)} pp</span>
        {live.recommendation !== analysis.recommendation && (
          <span className="ml-1 text-accent">(was {analysis.recommendation})</span>
        )}
      </span>
      {lastUpdated && <span className="text-muted">updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
    </div>
  );
}
