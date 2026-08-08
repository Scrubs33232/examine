"use client";

import { useState } from "react";
import Link from "next/link";
import TradingViewWidget from "@/components/TradingViewWidget";
import PredictionPanel from "@/components/PredictionPanel";
import ChartScreenshotUpload from "@/components/ChartScreenshotUpload";
import { extractSymbolFromInput } from "@/lib/tradingViewUrl";

const PRESETS = [
  { label: "SOL/USDT", symbol: "BINANCE:SOLUSDT" },
  { label: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
  { label: "ETH/USDT", symbol: "BINANCE:ETHUSDT" },
  { label: "DOGE/USDT", symbol: "BINANCE:DOGEUSDT" },
];

export default function ChartsPage() {
  const [symbol, setSymbol] = useState(PRESETS[0].symbol);
  const [customInput, setCustomInput] = useState("");
  const [predictInput, setPredictInput] = useState("");
  const [predictSymbol, setPredictSymbol] = useState("");

  function loadForPrediction() {
    const base = extractSymbolFromInput(predictInput);
    if (!base) return;
    setSymbol(`BINANCE:${base}USDT`);
    setPredictSymbol(base);
  }

  function loadFromScreenshot(detectedSymbol: string) {
    const base = extractSymbolFromInput(detectedSymbol);
    setSymbol(`BINANCE:${base}USDT`);
    setPredictSymbol(base);
  }

  return (
    <main className="flex min-h-screen flex-col bg-grid px-4 py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" className="font-mono text-xs text-muted hover:text-foreground">
            ← Examine
          </Link>
          <span className="font-mono text-xs uppercase tracking-widest text-muted">Charts (view only)</span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadForPrediction();
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={predictInput}
            onChange={(e) => setPredictInput(e.target.value)}
            placeholder="Paste a TradingView.com link (or type BTC, ETH, SOL...) to view + predict"
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <button type="submit" className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 font-mono text-sm text-accent hover:bg-accent/20">
            Load &amp; Predict
          </button>
        </form>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.symbol}
              onClick={() => {
                setSymbol(p.symbol);
                setPredictSymbol("");
              }}
              className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition ${
                symbol === p.symbol
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customInput.trim()) {
                setSymbol(customInput.trim().toUpperCase());
                setPredictSymbol("");
              }
            }}
            className="flex items-center gap-1.5"
          >
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="EXCHANGE:SYMBOL e.g. COINBASE:SOLUSD"
              className="w-64 rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground"
            >
              Go
            </button>
          </form>
        </div>

        <div className="h-[560px] overflow-hidden rounded-2xl border border-border bg-surface">
          <TradingViewWidget symbol={symbol} />
        </div>

        <div className="mt-4">
          <ChartScreenshotUpload onSymbolDetected={loadFromScreenshot} />
        </div>

        {predictSymbol && (
          <div className="mt-4">
            <PredictionPanel symbol={predictSymbol} />
          </div>
        )}

        <p className="mt-3 font-mono text-[10px] text-muted">
          Charts only — nothing here places trades. Freshly-launched tokens (e.g. brand-new
          Pump.fun listings) usually won&apos;t have data until they&apos;re picked up by an
          indexed exchange/DEX feed. The prediction panel uses CoinGecko price history for
          established coins, not brand-new pump.fun tokens.
        </p>
      </div>
    </main>
  );
}
