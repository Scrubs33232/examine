import type { HistoricalComparison } from "@/lib/types";

export default function HistoricalComparisons({ comparisons }: { comparisons: HistoricalComparison[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Similar Historical Markets</h2>
      <ul className="space-y-3">
        {comparisons.map((c, i) => (
          <li key={i} className="rounded-xl border border-border bg-surface-raised p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-foreground">{c.question}</p>
              <span className="shrink-0 font-mono text-[10px] text-muted">{Math.round(c.similarity * 100)}% similar</span>
            </div>
            <p className="mt-1.5 font-mono text-xs text-muted">{c.resolved}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
