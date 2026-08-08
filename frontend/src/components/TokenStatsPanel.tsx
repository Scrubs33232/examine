"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { fetchDexScreenerData, type DexPairData } from "@/lib/dexscreener";
import { fetchPumpFunCoin, type PumpFunCoinData } from "@/lib/pumpfun";
import { fetchHolderConcentration, type HolderData } from "@/lib/holders";

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg tabular ${warn ? "text-bear" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

interface TokenStatsPanelProps {
  tokenAddress: string;
  // Optional — omitting it changes nothing about existing behavior.
  onData?: (data: { priceUsd: number | null; symbol: string | null }) => void;
}

export default function TokenStatsPanel({ tokenAddress, onData }: TokenStatsPanelProps) {
  const { connection } = useConnection();
  const [dex, setDex] = useState<DexPairData | null>(null);
  const [pump, setPump] = useState<PumpFunCoinData | null>(null);
  const [holders, setHolders] = useState<HolderData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenAddress) return;
    let cancelled = false;
    setLoading(true);
    setDex(null);
    setPump(null);
    setHolders(null);

    (async () => {
      const [dexData, pumpData] = await Promise.all([
        fetchDexScreenerData(tokenAddress),
        fetchPumpFunCoin(tokenAddress),
      ]);
      if (cancelled) return;
      setDex(dexData);
      setPump(pumpData);
      onData?.({ priceUsd: dexData?.priceUsd ?? null, symbol: dexData?.baseSymbol ?? null });

      const holderData = await fetchHolderConcentration(connection, tokenAddress, pumpData?.creatorAddress ?? null);
      if (cancelled) return;
      setHolders(holderData);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenAddress, connection]);

  if (!tokenAddress) return null;

  const marketCap = dex?.marketCapUsd ?? pump?.usdMarketCap ?? null;
  const top10Pct = holders?.top10HolderPct ?? null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Token Stats</h2>
        {loading && <span className="font-mono text-[10px] text-muted">loading…</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Market Cap" value={fmtUsd(marketCap)} />
        <Stat label="Liquidity" value={fmtUsd(dex?.liquidityUsd ?? null)} />
        <Stat label="24h Volume" value={fmtUsd(dex?.volume24hUsd ?? null)} />
        <Stat label="Top 10 Holders" value={fmtPct(top10Pct)} warn={top10Pct !== null && top10Pct > 30} />
        <Stat
          label="Dev Wallet"
          value={holders?.devWalletSolBalance !== null && holders?.devWalletSolBalance !== undefined ? `${holders.devWalletSolBalance.toFixed(2)} SOL` : "—"}
        />
        <Stat
          label="Bonding Curve"
          value={pump ? (pump.bondingCurveComplete ? "Migrated" : fmtPct(pump.bondingCurveProgressPct)) : "—"}
        />
      </div>

      {!dex && !pump && !loading && (
        <p className="mt-3 font-mono text-xs text-bear">
          No data found for this address — double-check the contract address, or it may be too new to be indexed yet.
        </p>
      )}

      {top10Pct !== null && top10Pct > 30 && (
        <p className="mt-3 font-mono text-xs text-bear">
          ⚠ Top 10 wallets hold {top10Pct.toFixed(0)}% of supply — high concentration risk.
        </p>
      )}
    </div>
  );
}
