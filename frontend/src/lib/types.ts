export interface MarketOdds {
  yes: number;
  no: number;
  volume: number | null;
  liquidity: number | null;
  close_date: string | null;
  source: "api" | "scrape" | "fallback" | "ocr" | "ocr_no_odds";
}

export interface KeyFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
}

export interface Sentiment {
  score: number;
  label: "bearish" | "neutral" | "bullish";
  summary: string;
  sources: string[];
}

export interface HistoricalComparison {
  question: string;
  resolved: string;
  similarity: number;
}

export interface LiveOdds {
  yes: number;
  no: number;
  volume: number | null;
  edge_pct: number;
  expected_value: number;
  kelly_fraction: number;
  recommendation: "yes" | "no" | "pass";
}

export interface CalibrationBucket {
  range_label: string;
  predicted_avg: number;
  actual_rate: number;
  count: number;
}

export interface CalibrationResponse {
  overall_brier_score: number | null;
  total_resolved: number;
  total_analyses: number;
  buckets: CalibrationBucket[];
}

export interface Analysis {
  id: string;
  source_type: "url" | "image";
  source_url: string | null;
  platform: string;
  market_id: string | null;
  question: string;
  market_odds: MarketOdds;
  ai_probability: number;
  confidence: number;
  edge_pct: number;
  expected_value: number;
  kelly_fraction: number;
  recommendation: "yes" | "no" | "pass";
  reasoning: string;
  key_factors: KeyFactor[];
  sentiment: Sentiment;
  historical_comparisons: HistoricalComparison[];
  status: "open" | "resolved";
  actual_outcome: boolean | null;
  brier_score: number | null;
  created_at: string;
}
