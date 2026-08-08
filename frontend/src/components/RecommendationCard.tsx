import type { Analysis } from "@/lib/types";

const REC_STYLES: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  yes: { label: "BUY YES", bg: "bg-bull-bg", text: "text-bull", ring: "border-bull-dim" },
  no: { label: "BUY NO", bg: "bg-bear-bg", text: "text-bear", ring: "border-bear-dim" },
  pass: { label: "PASS", bg: "bg-surface-raised", text: "text-muted", ring: "border-border" },
};

export default function RecommendationCard({ analysis }: { analysis: Analysis }) {
  const style = REC_STYLES[analysis.recommendation];

  return (
    <div className={`rounded-2xl border ${style.ring} ${style.bg} p-5`}>
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Recommendation</h2>
        <span className={`rounded-full border ${style.ring} px-3 py-1 font-mono text-xs font-semibold ${style.text}`}>
          {style.label}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="font-mono text-xl font-semibold tabular text-foreground">
            {(analysis.expected_value * 100).toFixed(1)}%
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Expected value</div>
        </div>
        <div>
          <div className="font-mono text-xl font-semibold tabular text-foreground">
            {(analysis.kelly_fraction * 100).toFixed(1)}%
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Kelly size</div>
        </div>
        <div>
          <div className={`font-mono text-xl font-semibold tabular ${style.text}`}>
            {analysis.edge_pct > 0 ? "+" : ""}
            {analysis.edge_pct.toFixed(1)}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">Edge (pp)</div>
        </div>
      </div>

      {analysis.recommendation !== "pass" && (
        <p className="mt-4 text-center text-xs text-muted">
          Half-Kelly, confidence-scaled sizing. Never stake more than you can afford to lose.
        </p>
      )}
    </div>
  );
}
