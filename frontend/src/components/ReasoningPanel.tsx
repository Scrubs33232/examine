export default function ReasoningPanel({ reasoning }: { reasoning: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">AI Reasoning</h2>
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{reasoning}</p>
    </div>
  );
}
