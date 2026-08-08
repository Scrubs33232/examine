import type { KeyFactor } from "@/lib/types";

const IMPACT_STYLES: Record<string, { text: string; bg: string; symbol: string }> = {
  positive: { text: "text-bull", bg: "bg-bull", symbol: "+" },
  negative: { text: "text-bear", bg: "bg-bear", symbol: "−" },
  neutral: { text: "text-muted", bg: "bg-muted", symbol: "·" },
};

export default function KeyFactors({ factors }: { factors: KeyFactor[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Key Factors</h2>
      <ul className="space-y-3">
        {factors.map((factor, i) => {
          const style = IMPACT_STYLES[factor.impact];
          return (
            <li key={i} className="flex items-center gap-3">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.text} bg-surface-raised`}>
                {style.symbol}
              </span>
              <span className="flex-1 text-sm text-foreground">{factor.label}</span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-raised">
                <div className={`h-full ${style.bg}`} style={{ width: `${factor.weight * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
