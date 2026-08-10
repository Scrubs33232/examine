"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { analyzeImage, analyzeText, analyzeUrl, ApiError } from "@/lib/api";
import { recognizeTextFromImage } from "@/lib/clientOcr";
import ResearchLoader from "@/components/ResearchLoader";
import type { Analysis } from "@/lib/types";

type Mode = "url" | "image";

async function analyzeScreenshot(file: File): Promise<Analysis> {
  let rawText: string;
  try {
    rawText = await recognizeTextFromImage(file);
  } catch {
    // Client-side OCR (tesseract.js/WASM) failed to load or run in this
    // browser — fall back to the server's Tesseract-based OCR endpoint
    // instead of failing the whole analysis outright.
    return analyzeImage(file);
  }
  return analyzeText(rawText);
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) {
    return "Couldn't reach the analysis server. Make sure the backend is running, then try again.";
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Something went wrong: ${detail}`;
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = mode === "url" ? url.trim().length > 0 : file !== null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      const analysis = mode === "url" ? await analyzeUrl(url.trim()) : await analyzeScreenshot(file as File);
      router.push(`/results/${analysis.id}`);
    } catch (err) {
      setError(describeError(err));
      setIsLoading(false);
    }
  }, [canSubmit, isLoading, mode, url, file, router]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.type.startsWith("image/")) {
      setFile(dropped);
      setError(null);
    }
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-grid px-4 py-20">
      {isLoading && <ResearchLoader />}

      {/* Decorative background glow — purely visual, no data implied. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-bull/15 blur-[120px]" />
        <div className="absolute -right-24 top-0 h-80 w-80 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-bear/10 blur-[140px]" />
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <div className="h-full w-1/3 animate-scan-line bg-gradient-to-r from-transparent via-bull/60 to-transparent" />
        </div>
      </div>

      <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2">
        <Link
          href="/charts"
          className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground"
        >
          Charts →
        </Link>
        <Link
          href="/trade"
          className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground"
        >
          Trade →
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground"
        >
          Dashboard →
        </Link>
        <Link
          href="/calibration"
          className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground"
        >
          Track record →
        </Link>
        <Link
          href="/copy-trader"
          className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground"
        >
          Copy Trader →
        </Link>
      </div>

      <div className="relative mb-10 text-center">
        <div className="mb-5 flex justify-center">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface shadow-glow">
            <span className="absolute inset-0 rounded-2xl border border-bull/30 animate-pulse-soft" />
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-bull" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-bull" />
          Polymarket · Kalshi · PredictIt · Manifold
        </div>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          Exa<span className="text-bull">min</span>e
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance text-sm text-muted">
          Paste a prediction market link or drop a screenshot. Get an AI fair-odds
          read, edge, and Kelly-sized recommendation in seconds.
        </p>
      </div>

      <div className="relative w-full max-w-xl rounded-2xl border border-border bg-surface p-2 shadow-2xl shadow-black/40">
        <div className="mb-2 flex gap-1 rounded-xl bg-surface-raised p-1 font-mono text-xs">
          <button
            onClick={() => setMode("url")}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === "url" ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            PASTE LINK
          </button>
          <button
            onClick={() => setMode("image")}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === "image" ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            UPLOAD SCREENSHOT
          </button>
        </div>

        {mode === "url" ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="https://polymarket.com/event/..."
            className="w-full rounded-xl bg-transparent px-4 py-4 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`m-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
              isDragging ? "border-accent bg-accent/5" : "border-border hover:border-muted"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="font-mono text-sm text-foreground">{file.name}</p>
            ) : (
              <>
                <p className="font-mono text-sm text-foreground">Drop a screenshot here</p>
                <p className="mt-1 text-xs text-muted">or click to browse — PNG, JPG</p>
              </>
            )}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isLoading}
          className="mt-2 w-full rounded-xl bg-bull py-3 font-mono text-sm font-medium text-black transition enabled:hover:shadow-glow disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-muted"
        >
          ANALYZE MARKET
        </button>
      </div>

      {error && (
        <div className="mt-4 max-w-xl rounded-lg border border-bear-dim bg-bear-bg px-4 py-3 text-center font-mono text-xs text-bear">
          {error}
        </div>
      )}

      <div className="relative mt-12 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          {
            icon: (
              <path
                d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
            title: "Fast reads",
            body: "Odds and edge back in seconds, no manual digging.",
          },
          {
            icon: (
              <>
                <path d="M12 3v18M5 8l-2 5a3 3 0 0 0 6 0l-2-5Zm14 0-2 5a3 3 0 0 0 6 0l-2-5Z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 8h14" strokeLinecap="round" />
              </>
            ),
            title: "Fair-odds model",
            body: "AI estimate compared against the live market price.",
          },
          {
            icon: (
              <path
                d="M4 19V10M10 19V4M16 19v-6M4 19h16"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
            title: "Kelly sizing",
            body: "A stake suggestion scaled to your edge, not a flat bet.",
          },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-surface/60 p-4 text-left backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="mb-2 h-5 w-5 text-bull" fill="none" stroke="currentColor" strokeWidth="1.5">
              {f.icon}
            </svg>
            <div className="font-mono text-xs text-foreground">{f.title}</div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed text-muted">{f.body}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
