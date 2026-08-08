// Best-effort ticker guess from OCR'd chart-screenshot text. TradingView
// (and most other charting UIs) show the ticker prominently near the top of
// the screen, often followed by an exchange name or timeframe, so we weight
// early matches and common suffix patterns rather than just grabbing any
// all-caps word (which would false-positive on things like "BUY", "USD",
// "VOL" that also appear on these screens).

const NOISE_WORDS = new Set([
  "USD", "USDT", "USDC", "BUY", "SELL", "VOL", "OPEN", "HIGH", "LOW", "CLOSE",
  "THE", "AND", "FOR", "NEW", "ALL", "MAX", "MIN", "AVG", "RSI", "MACD",
  "SMA", "EMA", "CHART", "TRADE", "TRADINGVIEW", "INDICATORS",
]);

export function guessTickersFromText(rawText: string): string[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates: string[] = [];

  for (const line of lines.slice(0, 8)) {
    // "BTCUSD", "BTC/USD", "NASDAQ:AAPL", "AAPL", "SOLUSDT" style matches.
    const matches = line.match(/\b[A-Z]{2,10}(?:[/:][A-Z]{2,10})?\b/g) ?? [];
    for (const raw of matches) {
      const parts = raw.split(/[/:]/);
      const symbol = parts[parts.length - 1];
      const stripped = symbol.replace(/(USDT|USDC|USD|BUSD)$/, "");
      const candidate = stripped.length >= 2 ? stripped : symbol;
      if (!NOISE_WORDS.has(candidate) && candidate.length >= 2 && candidate.length <= 6) {
        candidates.push(candidate);
      }
    }
  }

  // De-dupe while preserving order (earlier = more likely the main ticker).
  return Array.from(new Set(candidates));
}
