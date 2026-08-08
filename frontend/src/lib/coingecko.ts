// CoinGecko's public API — no key required. Used instead of Binance's API
// because Binance geo-blocks some server locations (confirmed while
// building this); CoinGecko has no such restriction.

const COMMON_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  MATIC: "matic-network",
};

// CoinGecko lists "tokenized stock" proxies (e.g. "Apple • Robinhood Token",
// symbol AAPL, market_cap_rank ~2300) that exact-match real stock tickers.
// Confirmed live while building this: a naive symbol match on "AAPL" grabs
// one of these instead of falling through to real Apple stock data. Require
// a reasonably liquid/tracked rank so obscure synthetic-stock tokens don't
// shadow the actual ticker the user meant.
const MAX_ACCEPTABLE_MARKET_CAP_RANK = 500;

export async function resolveSymbolToCoinGeckoId(symbol: string): Promise<{ id: string; name: string; symbol: string } | null> {
  const upper = symbol.toUpperCase();
  if (COMMON_IDS[upper]) {
    return { id: COMMON_IDS[upper], name: upper, symbol: upper };
  }

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const exactMatches = (data.coins ?? []).filter((c: any) => c.symbol?.toUpperCase() === upper);
    const match = exactMatches.find(
      (c: any) => typeof c.market_cap_rank === "number" && c.market_cap_rank <= MAX_ACCEPTABLE_MARKET_CAP_RANK
    );
    if (!match) return null;
    return { id: match.id, name: match.name, symbol: match.symbol?.toUpperCase() ?? upper };
  } catch {
    return null;
  }
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export async function fetchPriceHistory(coinGeckoId: string, days = 30): Promise<PricePoint[]> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinGeckoId}/market_chart?vs_currency=usd&days=${days}&interval=hourly`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const prices = data.prices as [number, number][] | undefined;
    if (!prices) return [];
    return prices.map(([timestamp, price]) => ({ timestamp, price }));
  } catch {
    return [];
  }
}
