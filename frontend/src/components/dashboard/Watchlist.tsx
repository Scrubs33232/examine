"use client";

import { useEffect, useRef, useState } from "react";
import { fetchDexScreenerData } from "@/lib/dexscreener";

const STORAGE_KEY = "examine_watchlist_v1";
const POLL_INTERVAL_MS = 20_000;

interface TrackedTokenLive {
  mint: string;
  symbol: string | null;
  priceUsd: number | null;
  priceChange5mPct: number | null;
  volume5mUsd: number | null;
}

function load(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // non-fatal
  }
}

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function Watchlist({ current, onSelect }: { current: string; onSelect: (mint: string) => void }) {
  const [list, setList] = useState<string[]>([]);
  const [live, setLive] = useState<Record<string, TrackedTokenLive>>({});
  const listRef = useRef<string[]>([]);
  listRef.current = list;

  useEffect(() => {
    setList(load());
  }, []);

  const inWatchlist = current && list.includes(current);

  function toggle() {
    if (!current) return;
    const next = inWatchlist ? list.filter((m) => m !== current) : [...list, current];
    setList(next);
    save(next);
  }

  function remove(mint: string) {
    const next = list.filter((m) => m !== mint);
    setList(next);
    save(next);
  }

  useEffect(() => {
    if (list.length === 0) return;
    let cancelled = false;

    async function poll() {
      const entries = await Promise.all(
        listRef.current.map(async (mint) => {
          const dex = await fetchDexScreenerData(mint);
          const data: TrackedTokenLive = {
            mint,
            symbol: dex?.baseSymbol ?? null,
            priceUsd: dex?.priceUsd ?? null,
            priceChange5mPct: dex?.priceChange5mPct ?? null,
            volume5mUsd: dex?.volume5mUsd ?? null,
          };
          return [mint, data] as const;
        })
      );
      if (!cancelled) setLive(Object.fromEntries(entries));
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [list]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Track</h2>
        <button
          onClick={toggle}
          disabled={!current}
          className="font-mono text-[10px] text-accent hover:underline disabled:opacity-40"
        >
          {inWatchlist ? "− untrack current" : "+ track current"}
        </button>
      </div>

      {list.length === 0 && <p className="font-mono text-xs text-muted">Nothing tracked yet — load a token and hit &quot;track current&quot;.</p>}

      <ul className="space-y-1.5">
        {list.map((mint) => {
          const data = live[mint];
          const label = data?.symbol || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
          const change = data?.priceChange5mPct ?? null;

          return (
            <li key={mint}>
              <div
                className={`flex items-center justify-between rounded-lg border px-3 py-2 transition ${
                  mint === current ? "border-accent bg-accent/10" : "border-border bg-surface-raised"
                }`}
              >
                <button onClick={() => onSelect(mint)} className="flex-1 text-left">
                  <div className={`font-mono text-xs ${mint === current ? "text-accent" : "text-foreground"}`}>{label}</div>
                  <div className="font-mono text-[10px] text-muted">
                    {data?.priceUsd ? `$${data.priceUsd.toFixed(8)}` : "loading…"} · vol5m {fmtUsd(data?.volume5mUsd ?? null)}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {change !== null && (
                    <span className={`font-mono text-xs tabular ${change >= 0 ? "text-bull" : "text-bear"}`}>
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(1)}%
                    </span>
                  )}
                  <button onClick={() => remove(mint)} className="font-mono text-[10px] text-muted hover:text-bear">
                    ✕
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
