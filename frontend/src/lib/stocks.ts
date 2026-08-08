// Proxies through our own backend (see backend/app/routers/market_tools.py)
// rather than calling Yahoo Finance directly from the browser — Yahoo's
// chart API doesn't reliably send CORS headers for arbitrary origins.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function fetchStockCloses(ticker: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${API_URL}/api/stocks/history?${new URLSearchParams({ ticker })}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.closes ?? null;
  } catch {
    return null;
  }
}
