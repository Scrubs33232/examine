"use client";

import { useEffect, useState } from "react";
import { fetchPriceHistory, resolveSymbolToCoinGeckoId } from "@/lib/coingecko";
import { fetchStockCloses } from "@/lib/stocks";
import { analyzeTechnicals, type TAResult } from "@/lib/technicalAnalysis";

const SIGNAL_STYLES: Record<TAResult["signal"], { label: string; text: string; bg: string; border: string }> = {
  buy: { label: "BUY SIGNAL", text: "text-bull", bg: "bg-bull-bg", border: "border-bull-dim" },
  sell: { label: "SELL SIGNAL", text: "text-bear", bg: "bg-bear-bg", border: "border-bear-dim" },
  hold: { label: "HOLD / NEUTRAL", text: "text-muted", bg: "bg-surface-raised", border: "border-border" },
};

const IMPACT_COLOR: Record<string, string> = {
  positive: "text-bull",
  negative: "text-bear",
  neutral: "text-muted",
};

export default function PredictionPanel({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<TAResult | null>(null);
  const [resolvedName, setResolvedName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);

    (async () => {
      // Try crypto first (CoinGecko), then fall back to stocks (Yahoo Finance
      // via our backend proxy) — covers "predict BTC" and "predict AAPL" with
      // the same input field.
      const resolved = await resolveSymbolToCoinGeckoId(symbol);
      if (cancelled) return;

      if (resolved) {
        const history = await fetchPriceHistory(resolved.id, 30);
        if (cancelled) return;
        if (history.length >= 20) {
          setResolvedName(`${resolved.name} (crypto)`);
          setResult(analyzeTechnicals(history.map((p) => p.price)));
          setLoading(false);
          return;
        }
      }

      const stockCloses = await fetchStockCloses(symbol);
      if (cancelled) return;
      if (stockCloses && stockCloses.length >= 20) {
        setResolvedName(`${symbol.toUpperCase()} (stock)`);
        setResult(analyzeTechnicals(stockCloses));
        setLoading(false);
        return;
      }

      setError(`Couldn't find price history for "${symbol}" as either a crypto asset or a stock ticker.`);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (!symbol) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
          Technical Signal {resolvedName && `— ${resolvedName}`}
        </h2>
        {loading && <span className="font-mono text-[10px] text-muted">analyzing…</span>}
      </div>

      {error && <p className="font-mono text-xs text-bear">{error}</p>}

      {result && (
        <>
          <div className={`mb-4 rounded-xl border ${SIGNAL_STYLES[result.signal].border} ${SIGNAL_STYLES[result.signal].bg} p-4`}>
            <div className="flex items-center justify-between">
              <span className={`font-mono text-lg font-semibold ${SIGNAL_STYLES[result.signal].text}`}>
                {SIGNAL_STYLES[result.signal].label}
              </span>
              <span className="font-mono text-sm tabular text-muted">{result.confidencePct}% confidence</span>
            </div>
            <div className="mt-1 font-mono text-xs text-muted">Current price: ${result.currentPrice.toLocaleString()}</div>
          </div>

          <ul className="space-y-2">
            {result.factors.map((f, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2">
                <span className={`font-mono text-xs ${IMPACT_COLOR[f.impact]}`}>{f.label}</span>
                <span className="font-mono text-[10px] text-muted">{f.detail}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 font-mono text-[10px] text-muted">
            Deterministic technical analysis (SMA/RSI/momentum) over real price history — not AI-generated, not
            personalized financial advice. Purely informational; you decide what, if anything, to do with it.
          </p>
        </>
      )}
    </div>
  );
}
