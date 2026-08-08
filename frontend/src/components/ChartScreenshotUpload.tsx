"use client";

import { useRef, useState } from "react";
import { recognizeTextFromImage } from "@/lib/clientOcr";
import { guessTickersFromText } from "@/lib/tickerExtraction";

export default function ChartScreenshotUpload({ onSymbolDetected }: { onSymbolDetected: (symbol: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [manualSymbol, setManualSymbol] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const rawText = await recognizeTextFromImage(file);
      const guesses = guessTickersFromText(rawText);
      if (guesses.length === 0) {
        setError("Couldn't detect a ticker in this screenshot — type it manually below.");
        return;
      }
      setCandidates(guesses);
      setManualSymbol(guesses[0]);
    } catch {
      setError("Failed to read this screenshot — type the ticker manually below instead.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">Upload Chart Screenshot</h2>
      <p className="mb-3 font-mono text-[10px] text-muted">
        Screenshot of a TradingView chart, a stock ticker, or a Kalshi 15-min crypto market — we&apos;ll OCR it and
        guess the ticker. Always double-check the detected symbol below before predicting.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          isDragging ? "border-accent bg-accent/5" : "border-border hover:border-muted"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <p className="font-mono text-xs text-foreground">
          {loading ? "Reading screenshot in your browser (first time may take a few seconds)…" : "Drop a screenshot here or click to browse"}
        </p>
      </div>

      {error && <p className="mt-3 font-mono text-xs text-bear">{error}</p>}

      {candidates.length > 0 && (
        <p className="mt-3 font-mono text-[10px] text-muted">
          Detected: {candidates.slice(0, 5).join(", ")}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={manualSymbol}
          onChange={(e) => setManualSymbol(e.target.value)}
          placeholder="Confirm or type ticker (BTC, AAPL...)"
          className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
        />
        <button
          disabled={!manualSymbol.trim()}
          onClick={() => onSymbolDetected(manualSymbol.trim())}
          className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-xs text-accent hover:bg-accent/20 disabled:opacity-40"
        >
          Predict
        </button>
      </div>
    </div>
  );
}
