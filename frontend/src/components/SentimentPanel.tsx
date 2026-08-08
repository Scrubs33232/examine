import type { Sentiment } from "@/lib/types";

const LABEL_STYLES: Record<string, string> = {
  bullish: "text-bull border-bull-dim bg-bull-bg",
  bearish: "text-bear border-bear-dim bg-bear-bg",
  neutral: "text-muted border-border bg-surface-raised",
};

export default function SentimentPanel({ sentiment }: { sentiment: Sentiment }) {
  const pos = ((sentiment.score + 1) / 2) * 100;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">News &amp; Social Sentiment</h2>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${LABEL_STYLES[sentiment.label]}`}>
          {sentiment.label}
        </span>
      </div>

      <div className="relative mb-4 h-2 w-full rounded-full bg-gradient-to-r from-bear via-surface-raised to-bull">
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${pos}%` }}
        />
      </div>

      <p className="text-sm text-muted">{sentiment.summary}</p>

      {sentiment.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sentiment.sources.map((s, i) => (
            <span key={i} className="rounded-md bg-surface-raised px-2 py-0.5 font-mono text-[10px] text-muted">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
