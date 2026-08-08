export default function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const segments = 20;
  const filled = Math.round((pct / 100) * segments);

  const level = pct >= 70 ? "high" : pct >= 40 ? "medium" : "low";
  const color = level === "high" ? "bg-bull" : level === "medium" ? "bg-accent" : "bg-bear";

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Confidence</h2>
        <span className="font-mono text-sm tabular text-foreground">{pct}%</span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} className={`h-4 flex-1 rounded-sm ${i < filled ? color : "bg-surface-raised"}`} />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        {level === "high" ? "High conviction" : level === "medium" ? "Moderate conviction" : "Low conviction"}
      </p>
    </div>
  );
}
