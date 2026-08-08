import type { Analysis } from "@/lib/types";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function money(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const DATA_QUALITY_WARNINGS: Partial<Record<Analysis["market_odds"]["source"], string>> = {
  scrape: "Market price was scraped from the page (not a live API) — treat it as approximate.",
  fallback: "No real market price could be found — this is a neutral placeholder, not the actual odds.",
  ocr: "Market price was read via OCR from a screenshot — double-check it against the original.",
  ocr_no_odds: "No price could be read from the screenshot — this is a neutral placeholder, not the actual odds.",
};

function Row({
  label,
  yesValue,
  barColorClass,
  sublabel,
}: {
  label: string;
  yesValue: number;
  barColorClass: string;
  sublabel?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular text-foreground">
          {pct(yesValue)} <span className="text-muted">YES</span>
          {sublabel && <span className="ml-2 text-muted">{sublabel}</span>}
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-raised">
        <div className={`h-full ${barColorClass} transition-all`} style={{ width: pct(yesValue) }} />
      </div>
    </div>
  );
}

export default function OddsComparison({ analysis }: { analysis: Analysis }) {
  const edgeFavorsYes = analysis.ai_probability >= analysis.market_odds.yes;
  const warning = DATA_QUALITY_WARNINGS[analysis.market_odds.source];

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Odds Comparison</h2>
      {warning && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 font-mono text-[10px] text-accent">
          ⚠ {warning}
        </div>
      )}
      <div className="space-y-5">
        <Row label="Market-implied odds" yesValue={analysis.market_odds.yes} barColorClass="bg-accent" />
        <Row
          label="AI fair odds"
          yesValue={analysis.ai_probability}
          barColorClass={edgeFavorsYes ? "bg-bull shadow-glow" : "bg-bear shadow-glow-bear"}
          sublabel={`conf. ${Math.round(analysis.confidence * 100)}%`}
        />
      </div>

      <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
        <span className="font-mono text-xs text-muted">Edge</span>
        <span
          className={`font-mono text-lg font-semibold tabular ${
            Math.abs(analysis.edge_pct) < 3 ? "text-muted" : analysis.recommendation === "yes" ? "text-bull" : "text-bear"
          }`}
        >
          {analysis.edge_pct > 0 ? "+" : ""}
          {analysis.edge_pct.toFixed(1)} pp
        </span>
      </div>

      {(analysis.market_odds.volume || analysis.market_odds.liquidity) && (
        <div className="mt-3 flex gap-4 font-mono text-[10px] text-muted">
          {analysis.market_odds.volume ? <span>Volume {money(analysis.market_odds.volume)}</span> : null}
          {analysis.market_odds.liquidity ? <span>Liquidity {money(analysis.market_odds.liquidity)}</span> : null}
        </div>
      )}
    </div>
  );
}
