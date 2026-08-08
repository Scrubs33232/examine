"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCalibration, ApiError } from "@/lib/api";
import type { CalibrationResponse } from "@/lib/types";
import ReliabilityDiagram from "@/components/ReliabilityDiagram";

export default function CalibrationPage() {
  const [data, setData] = useState<CalibrationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCalibration()
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Failed to load track record"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-grid px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="mb-6 inline-block font-mono text-xs text-muted hover:text-foreground">
          ← Examine
        </Link>

        <h1 className="mb-1 text-xl font-semibold text-foreground sm:text-2xl">Track Record</h1>
        <p className="mb-8 max-w-lg font-mono text-xs text-muted">
          How well the AI&apos;s fair-odds calls have matched reality, across every analysis resolved with
          a real outcome. A point on the diagonal means predicted probability matched actual frequency.
        </p>

        {error && <p className="font-mono text-sm text-bear">{error}</p>}

        {!error && !data && (
          <div className="flex items-center gap-2 font-mono text-xs text-muted">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
            Loading track record…
          </div>
        )}

        {data && data.total_resolved === 0 && (
          <div className="rounded-2xl border border-border bg-surface p-6 font-mono text-sm text-muted">
            No resolved analyses yet. Once you mark analyses with their real outcome (via{" "}
            <code className="text-foreground">POST /api/analyses/&#123;id&#125;/resolve</code>), calibration
            shows up here.
          </div>
        )}

        {data && data.total_resolved > 0 && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border bg-surface p-4 text-center">
                <div className="font-mono text-2xl font-semibold tabular text-foreground">
                  {data.overall_brier_score !== null ? data.overall_brier_score.toFixed(3) : "—"}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Brier score</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4 text-center">
                <div className="font-mono text-2xl font-semibold tabular text-foreground">{data.total_resolved}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Resolved</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4 text-center">
                <div className="font-mono text-2xl font-semibold tabular text-foreground">{data.total_analyses}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Total analyses</div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Reliability Diagram</h2>
              <div className="flex justify-center">
                <ReliabilityDiagram buckets={data.buckets} />
              </div>
              <p className="mt-3 text-center font-mono text-[10px] text-muted">
                Dot size = number of analyses in that bucket. Dots near the dashed diagonal are well-calibrated.
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="px-4 py-2 text-left font-normal">Predicted range</th>
                    <th className="px-4 py-2 text-right font-normal">Predicted avg</th>
                    <th className="px-4 py-2 text-right font-normal">Actual rate</th>
                    <th className="px-4 py-2 text-right font-normal">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((b) => (
                    <tr key={b.range_label} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-foreground">{b.range_label}</td>
                      <td className="px-4 py-2 text-right tabular text-foreground">{Math.round(b.predicted_avg * 100)}%</td>
                      <td className="px-4 py-2 text-right tabular text-foreground">{Math.round(b.actual_rate * 100)}%</td>
                      <td className="px-4 py-2 text-right tabular text-muted">{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
