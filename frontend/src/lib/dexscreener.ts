// DexScreener's public API — no key required, documented at
// https://docs.dexscreener.com/api/reference. Stable and reliable; used as
// the primary source for price/liquidity/market-cap data.

export interface DexPairData {
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume5mUsd: number | null;
  txns5mBuys: number | null;
  txns5mSells: number | null;
  priceChange24hPct: number | null;
  priceChange5mPct: number | null;
  dexUrl: string | null;
  baseSymbol: string | null;
  baseName: string | null;
}

export async function fetchDexScreenerData(tokenAddress: string): Promise<DexPairData | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = data.pairs as any[] | null;
    if (!pairs || pairs.length === 0) return null;

    // Prefer the pair with the highest liquidity if there are several.
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));

    return {
      priceUsd: best.priceUsd ? parseFloat(best.priceUsd) : null,
      marketCapUsd: best.marketCap ?? best.fdv ?? null,
      liquidityUsd: best.liquidity?.usd ?? null,
      volume24hUsd: best.volume?.h24 ?? null,
      volume5mUsd: best.volume?.m5 ?? null,
      txns5mBuys: best.txns?.m5?.buys ?? null,
      txns5mSells: best.txns?.m5?.sells ?? null,
      priceChange24hPct: best.priceChange?.h24 ?? null,
      priceChange5mPct: best.priceChange?.m5 ?? null,
      dexUrl: best.url ?? null,
      baseSymbol: best.baseToken?.symbol ?? null,
      baseName: best.baseToken?.name ?? null,
    };
  } catch {
    return null;
  }
}
