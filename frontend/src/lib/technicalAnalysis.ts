// Deterministic technical-analysis signal generator. Everything here is
// plain arithmetic over real price history — no AI call, nothing
// hallucinated, fully reproducible from the same input data. This is
// informational only: it does not place trades, and it is not personalized
// financial advice.

export interface TAFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  detail: string;
}

export interface TAResult {
  currentPrice: number;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  momentum7dPct: number | null;
  signal: "buy" | "sell" | "hold";
  confidencePct: number; // 0-100, based on how many indicators agree
  factors: TAFactor[];
}

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function analyzeTechnicals(closes: number[]): TAResult | null {
  if (closes.length < 20) return null;

  const currentPrice = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const momentum7dPct = closes.length >= 168 ? ((currentPrice - closes[closes.length - 168]) / closes[closes.length - 168]) * 100 : null;

  const factors: TAFactor[] = [];
  let score = 0;
  let voteCount = 0;

  if (sma20 !== null) {
    voteCount++;
    if (currentPrice > sma20) {
      score += 1;
      factors.push({ label: "Price above 20-period SMA", impact: "positive", detail: `$${currentPrice.toFixed(2)} > $${sma20.toFixed(2)}` });
    } else {
      score -= 1;
      factors.push({ label: "Price below 20-period SMA", impact: "negative", detail: `$${currentPrice.toFixed(2)} < $${sma20.toFixed(2)}` });
    }
  }

  if (sma20 !== null && sma50 !== null) {
    voteCount++;
    if (sma20 > sma50) {
      score += 1;
      factors.push({ label: "20-SMA above 50-SMA", impact: "positive", detail: "short-term trend above long-term trend" });
    } else {
      score -= 1;
      factors.push({ label: "20-SMA below 50-SMA", impact: "negative", detail: "short-term trend below long-term trend" });
    }
  }

  if (rsi14 !== null) {
    voteCount++;
    if (rsi14 < 30) {
      score += 1;
      factors.push({ label: "RSI oversold", impact: "positive", detail: `RSI(14) = ${rsi14.toFixed(0)}, below 30` });
    } else if (rsi14 > 70) {
      score -= 1;
      factors.push({ label: "RSI overbought", impact: "negative", detail: `RSI(14) = ${rsi14.toFixed(0)}, above 70` });
    } else {
      factors.push({ label: "RSI neutral", impact: "neutral", detail: `RSI(14) = ${rsi14.toFixed(0)}` });
    }
  }

  if (momentum7dPct !== null) {
    voteCount++;
    if (momentum7dPct > 2) {
      score += 1;
      factors.push({ label: "Positive 7-day momentum", impact: "positive", detail: `+${momentum7dPct.toFixed(1)}%` });
    } else if (momentum7dPct < -2) {
      score -= 1;
      factors.push({ label: "Negative 7-day momentum", impact: "negative", detail: `${momentum7dPct.toFixed(1)}%` });
    } else {
      factors.push({ label: "Flat 7-day momentum", impact: "neutral", detail: `${momentum7dPct.toFixed(1)}%` });
    }
  }

  const normalizedScore = voteCount > 0 ? score / voteCount : 0;
  const signal: TAResult["signal"] = normalizedScore >= 0.4 ? "buy" : normalizedScore <= -0.4 ? "sell" : "hold";
  const confidencePct = Math.round(Math.abs(normalizedScore) * 100);

  return { currentPrice, sma20, sma50, rsi14, momentum7dPct, signal, confidencePct, factors };
}
