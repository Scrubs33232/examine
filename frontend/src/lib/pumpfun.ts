// Best-effort client for pump.fun's public (undocumented) coin-info API.
// UNVERIFIED: pump.fun does not publish official API docs and this endpoint
// has changed shape before. If this stops working, check the current
// endpoint in your browser's network tab while viewing a pump.fun coin page
// and update BASE_URL / the field names below accordingly.

const BASE_URL = "https://frontend-api-v3.pump.fun";

export interface PumpFunCoinData {
  bondingCurveComplete: boolean | null;
  bondingCurveProgressPct: number | null;
  creatorAddress: string | null;
  usdMarketCap: number | null;
}

export async function fetchPumpFunCoin(mint: string): Promise<PumpFunCoinData | null> {
  try {
    const res = await fetch(`${BASE_URL}/coins/${mint}`);
    if (!res.ok) return null;
    const data = await res.json();

    const virtualSol = Number(data.virtual_sol_reserves ?? 0);
    const complete = Boolean(data.complete);
    // Bonding curve completes around 85 SOL of virtual reserves historically;
    // this is an approximation for a progress bar, not an exact on-chain value.
    const progressPct = complete ? 100 : Math.min((virtualSol / 85) * 100, 99);

    return {
      bondingCurveComplete: complete,
      bondingCurveProgressPct: progressPct,
      creatorAddress: data.creator ?? null,
      usdMarketCap: data.usd_market_cap ?? null,
    };
  } catch {
    return null;
  }
}
