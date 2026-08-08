// Extracts a plain ticker (e.g. "BTC", "SOL") from a pasted TradingView URL
// or from raw text the user typed directly.

export function extractSymbolFromInput(input: string): string {
  const trimmed = input.trim();

  if (!/^https?:\/\//i.test(trimmed)) {
    // Not a URL — treat as a raw symbol, stripping an EXCHANGE: prefix if present.
    return trimmed.toUpperCase().split(":").pop() ?? trimmed.toUpperCase();
  }

  try {
    const url = new URL(trimmed);

    // https://www.tradingview.com/chart/xxxx/?symbol=BINANCE%3ABTCUSDT
    const symbolParam = url.searchParams.get("symbol");
    if (symbolParam) return symbolParam.toUpperCase().split(":").pop() ?? symbolParam.toUpperCase();

    // https://www.tradingview.com/symbols/BTCUSD/  or  /symbols/BINANCE-BTCUSDT/
    const parts = url.pathname.split("/").filter(Boolean);
    const symbolsIdx = parts.indexOf("symbols");
    if (symbolsIdx !== -1 && parts[symbolsIdx + 1]) {
      const raw = parts[symbolsIdx + 1].toUpperCase();
      const afterDash = raw.includes("-") ? raw.split("-").pop()! : raw;
      // Strip a common quote-currency suffix so "BTCUSD"/"BTCUSDT" -> "BTC".
      return afterDash.replace(/(USDT|USDC|USD|BUSD)$/i, "");
    }

    return trimmed.toUpperCase();
  } catch {
    return trimmed.toUpperCase();
  }
}
