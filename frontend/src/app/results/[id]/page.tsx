"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAnalysis, ApiError } from "@/lib/api";
import { platformLabel } from "@/lib/platform";
import type { Analysis } from "@/lib/types";
import OddsComparison from "@/components/OddsComparison";
import RecommendationCard from "@/components/RecommendationCard";
import ConfidenceMeter from "@/components/ConfidenceMeter";
import KeyFactors from "@/components/KeyFactors";
import SentimentPanel from "@/components/SentimentPanel";
import HistoricalComparisons from "@/components/HistoricalComparisons";
import ReasoningPanel from "@/components/ReasoningPanel";
import LiveOddsBadge from "@/components/LiveOddsBadge";

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAnalysis(params.id)
      .then((a) => !cancelled && setAnalysis(a))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Failed to load analysis"));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="font-mono text-sm text-bear">{error}</p>
        <Link href="/" className="font-mono text-xs text-accent hover:underline">
          ← Back to Examine
        </Link>
      </main>
    );
  }

  if (!analysis) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 font-mono text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
          Loading analysis…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-grid px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-6 inline-block font-mono text-xs text-muted hover:text-foreground">
          ← New analysis
        </Link>

        <header className="mb-8 rounded-2xl border border-border bg-surface p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-surface-raised px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              {platformLabel(analysis.platform)}
            </span>
            {analysis.market_odds.close_date && (
              <span className="font-mono text-[10px] text-muted">Closes {analysis.market_odds.close_date}</span>
            )}
            {analysis.source_url && (
              <a
                href={analysis.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-accent hover:underline"
              >
                View original ↗
              </a>
            )}
          </div>
          <h1 className="mb-3 text-xl font-semibold text-foreground sm:text-2xl">{analysis.question}</h1>
          <LiveOddsBadge analysis={analysis} />
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <OddsComparison analysis={analysis} />
            <ReasoningPanel reasoning={analysis.reasoning} />
            <KeyFactors factors={analysis.key_factors} />
            <HistoricalComparisons comparisons={analysis.historical_comparisons} />
          </div>

          <div className="space-y-6">
            <RecommendationCard analysis={analysis} />
            <ConfidenceMeter confidence={analysis.confidence} />
            <SentimentPanel sentiment={analysis.sentiment} />
          </div>
        </div>
      </div>
    </main>
  );
}
