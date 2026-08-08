"use client";

import { useState } from "react";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import TradingViewWidget from "@/components/TradingViewWidget";
import TokenStatsPanel from "@/components/TokenStatsPanel";
import TradingPanel, { type TradeConfirmation } from "@/components/TradingPanel";
import MoversFeed from "@/components/dashboard/MoversFeed";
import Watchlist from "@/components/dashboard/Watchlist";
import XFeedPanel from "@/components/dashboard/XFeedPanel";
import AlertSettingsPanel from "@/components/dashboard/AlertSettingsPanel";
import PositionsTable, { type TxLogEntry } from "@/components/dashboard/PositionsTable";
import AlertBanner, { type BannerAlert } from "@/components/dashboard/AlertBanner";
import { usePositions, type AlertThresholds } from "@/hooks/usePositions";
import { playChime } from "@/lib/alertSound";
import { notifyExitAlert } from "@/lib/desktopAlerts";

const DEFAULT_SYMBOL = "BINANCE:SOLUSDT";

export default function DashboardPage() {
  const [input, setInput] = useState("");
  const [selectedMint, setSelectedMint] = useState("");
  const [liveData, setLiveData] = useState<{ priceUsd: number | null; symbol: string | null }>({ priceUsd: null, symbol: null });
  const [thresholds, setThresholds] = useState<AlertThresholds>({ takeProfitPct: 25, stopLossPct: 10 });
  const [banner, setBanner] = useState<BannerAlert | null>(null);
  const [txLog, setTxLog] = useState<TxLogEntry[]>([]);

  const { positions, addPosition, removePosition } = usePositions(thresholds, (position, alert) => {
    setBanner({ id: crypto.randomUUID(), symbol: position.symbol, reason: alert.reason, message: alert.message });
    playChime();
    notifyExitAlert(position.symbol, alert.message);
  });

  function handleTradeConfirmed(confirmation: TradeConfirmation) {
    setTxLog((prev) => [
      { id: crypto.randomUUID(), action: confirmation.action, mint: confirmation.mint, amount: confirmation.amount, txSig: confirmation.txSig, at: Date.now() },
      ...prev,
    ]);
    if (confirmation.action === "buy" && liveData.priceUsd) {
      addPosition(confirmation.mint, liveData.symbol ?? confirmation.mint.slice(0, 6), liveData.priceUsd);
    }
  }

  const chartSymbol = selectedMint ? undefined : DEFAULT_SYMBOL;

  return (
    <main className="min-h-screen bg-grid px-4 py-4">
      <AlertBanner alert={banner} onDismiss={() => setBanner(null)} />

      <div className="mx-auto max-w-[1600px]">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" className="font-mono text-xs text-muted hover:text-foreground">
            ← Examine
          </Link>
          <h1 className="font-mono text-xs uppercase tracking-widest text-muted">Dashboard — manual, wallet-confirmed trading</h1>
          <WalletMultiButton />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSelectedMint(input.trim());
          }}
          className="mb-4 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Solana token contract address (CA)"
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <button type="submit" className="rounded-xl border border-border bg-surface-raised px-4 py-2.5 font-mono text-sm text-foreground hover:bg-surface">
            Load
          </button>
        </form>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_340px]">
          {/* Left column */}
          <div className="space-y-4">
            <Watchlist current={selectedMint} onSelect={setSelectedMint} />
            <MoversFeed onSelect={setSelectedMint} />
          </div>

          {/* Center column */}
          <div className="space-y-4">
            <div className="h-[480px] overflow-hidden rounded-2xl border border-border bg-surface">
              <TradingViewWidget symbol={chartSymbol ?? DEFAULT_SYMBOL} />
            </div>
            <XFeedPanel />
            {selectedMint && <TokenStatsPanel tokenAddress={selectedMint} onData={setLiveData} />}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {selectedMint ? (
              <TradingPanel tokenAddress={selectedMint} onTradeConfirmed={handleTradeConfirmed} />
            ) : (
              <div className="rounded-2xl border border-border bg-surface p-5 font-mono text-xs text-muted">
                Load a token above to trade.
              </div>
            )}
            <AlertSettingsPanel
              thresholds={thresholds}
              onChange={setThresholds}
              currentMint={selectedMint}
              currentSymbol={liveData.symbol ?? ""}
              currentPriceUsd={liveData.priceUsd}
              onAddPosition={addPosition}
            />
          </div>
        </div>

        <div className="mt-4">
          <PositionsTable positions={positions} onRemove={removePosition} txLog={txLog} />
        </div>
      </div>
    </main>
  );
}
