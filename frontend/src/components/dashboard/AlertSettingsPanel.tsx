"use client";

import { useEffect, useState } from "react";
import type { AlertThresholds } from "@/hooks/usePositions";
import { desktopAlertsEnabled, disableDesktopAlerts, enableDesktopAlerts, isNotificationSupported } from "@/lib/desktopAlerts";

export default function AlertSettingsPanel({
  thresholds,
  onChange,
  currentMint,
  currentSymbol,
  currentPriceUsd,
  onAddPosition,
}: {
  thresholds: AlertThresholds;
  onChange: (t: AlertThresholds) => void;
  currentMint: string;
  currentSymbol: string;
  currentPriceUsd: number | null;
  onAddPosition: (mint: string, symbol: string, entryPriceUsd: number) => void;
}) {
  const [manualEntryPrice, setManualEntryPrice] = useState("");
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [desktopSupported, setDesktopSupported] = useState(false);

  useEffect(() => {
    setDesktopSupported(isNotificationSupported());
    setDesktopEnabled(desktopAlertsEnabled());
  }, []);

  async function toggleDesktopAlerts() {
    if (desktopEnabled) {
      disableDesktopAlerts();
      setDesktopEnabled(false);
      return;
    }
    const granted = await enableDesktopAlerts();
    setDesktopEnabled(granted);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Alert Settings</h2>
      <p className="mb-4 font-mono text-[10px] text-muted">
        These are notifications only — they highlight the sell button and chime when hit. Nothing sells automatically.
      </p>

      <div className="space-y-4">
        <label className="block">
          <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
            <span>Take-Profit Target</span>
            <span className="text-bull">{thresholds.takeProfitPct}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={200}
            step={5}
            value={thresholds.takeProfitPct}
            onChange={(e) => onChange({ ...thresholds, takeProfitPct: Number(e.target.value) })}
            className="w-full accent-bull"
          />
        </label>

        <label className="block">
          <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
            <span>Stop-Loss Target</span>
            <span className="text-bear">{thresholds.stopLossPct}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={90}
            step={5}
            value={thresholds.stopLossPct}
            onChange={(e) => onChange({ ...thresholds, stopLossPct: Number(e.target.value) })}
            className="w-full accent-bear"
          />
        </label>
      </div>

      {desktopSupported && (
        <div className="mt-5 border-t border-border pt-4">
          <button
            onClick={toggleDesktopAlerts}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 font-mono text-xs transition ${
              desktopEnabled
                ? "border-bull/40 bg-bull/10 text-bull hover:bg-bull/20"
                : "border-border bg-surface-raised text-muted hover:text-foreground"
            }`}
          >
            <span>Desktop notifications</span>
            <span>{desktopEnabled ? "ON — fires even in background tabs" : "OFF"}</span>
          </button>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted">Track a position</div>
        {currentMint ? (
          <div className="space-y-2">
            <button
              disabled={!currentPriceUsd}
              onClick={() => currentPriceUsd && onAddPosition(currentMint, currentSymbol, currentPriceUsd)}
              className="w-full rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 font-mono text-xs text-accent transition enabled:hover:bg-accent/20 disabled:opacity-40"
            >
              Track {currentSymbol || "current token"} at market (${currentPriceUsd?.toFixed(8) ?? "—"})
            </button>
            <div className="flex gap-2">
              <input
                value={manualEntryPrice}
                onChange={(e) => setManualEntryPrice(e.target.value)}
                placeholder="or enter your own entry price"
                className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
              />
              <button
                disabled={!manualEntryPrice}
                onClick={() => {
                  onAddPosition(currentMint, currentSymbol, Number(manualEntryPrice));
                  setManualEntryPrice("");
                }}
                className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <p className="font-mono text-xs text-muted">Load a token above to track a position.</p>
        )}
      </div>
    </div>
  );
}
