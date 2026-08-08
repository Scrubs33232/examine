"use client";

import { useCallback, useEffect, useState } from "react";
import { getSettings, updateSettings, CopyTraderApiError, type CopyTraderSettings } from "@/lib/copyTraderApi";

function NumberField({
  label,
  value,
  onChange,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step={step ?? "any"}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
        />
        {suffix && <span className="font-mono text-[10px] text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

export default function CopyTraderSettingsPanel() {
  const [settings, setSettings] = useState<CopyTraderSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => setError("Couldn't load settings from the bot."));
  }, []);

  const patch = useCallback((p: Partial<CopyTraderSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev));
    setSavedAt(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    if (settings.dryRun === false) {
      const confirmed = window.confirm(
        "Saving with Dry Run off means the bot executes real trades with real SOL. Continue?"
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof CopyTraderApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (error && !settings) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
        <p className="font-mono text-xs text-bear">{error}</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
        <p className="font-mono text-xs text-muted">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-1 font-mono text-xs uppercase tracking-widest text-muted">Copy Trading Settings</h2>
      <p className="mb-4 font-mono text-[10px] text-muted">
        Takes effect on the next detected trade — no restart needed. Everything below stays local to the bot;
        nothing here is a secret.
      </p>

      <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
        <div>
          <div className="font-mono text-xs text-foreground">Dry Run</div>
          <div className="font-mono text-[10px] text-muted">Off = the bot executes real trades with real SOL.</div>
        </div>
        <button
          onClick={() => patch({ dryRun: !settings.dryRun })}
          className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
            settings.dryRun ? "border-accent/40 bg-accent/10 text-accent" : "border-bear-dim bg-bear-bg text-bear"
          }`}
        >
          {settings.dryRun ? "Dry run" : "Live"}
        </button>
      </div>

      <div className="mb-4">
        <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
          <span>Buy size — % of spendable balance</span>
          <span className="text-bull">{settings.buyPortfolioPercent}%</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          value={settings.buyPortfolioPercent}
          onChange={(e) => patch({ buyPortfolioPercent: Number(e.target.value) })}
          className="w-full accent-bull"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumberField label="Buy cap" value={settings.buySolCap} onChange={(v) => patch({ buySolCap: v })} step={0.01} suffix="SOL" />
        <NumberField label="Fee buffer" value={settings.feeBufferSol} onChange={(v) => patch({ feeBufferSol: v })} step={0.01} suffix="SOL" />
        <NumberField label="Slippage" value={settings.slippageBps} onChange={(v) => patch({ slippageBps: v })} step={10} suffix="bps" />
        <NumberField
          label="Min liquidity probe"
          value={settings.minLiquiditySol}
          onChange={(v) => patch({ minLiquiditySol: v })}
          step={0.5}
          suffix="SOL"
        />
        <NumberField
          label="Max price impact"
          value={settings.maxPriceImpactPct}
          onChange={(v) => patch({ maxPriceImpactPct: v })}
          step={1}
          suffix="%"
        />
        <NumberField
          label="Wallet balance warning"
          value={settings.maxSafeWalletSol}
          onChange={(v) => patch({ maxSafeWalletSol: v })}
          step={0.5}
          suffix="SOL"
        />
        <NumberField
          label="Priority fee percentile"
          value={settings.priorityFeePercentile}
          onChange={(v) => patch({ priorityFeePercentile: v })}
          step={5}
          suffix="pct"
        />
        <NumberField label="Jito tip" value={settings.jitoTipSol} onChange={(v) => patch({ jitoTipSol: v })} step={0.0001} suffix="SOL" />
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted">
          Jito block engine URL (blank = submit via RPC directly)
        </span>
        <input
          value={settings.jitoBlockEngineUrl}
          onChange={(e) => patch({ jitoBlockEngineUrl: e.target.value })}
          placeholder="https://mainnet.block-engine.jito.wtf"
          className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
        />
      </label>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-foreground">Prioritize wallets that make you the most</div>
            <div className="font-mono text-[10px] text-muted">
              Scales buy size up for target wallets with a stronger realized track record, down for weaker
              ones. See the Performance panel below for what each wallet is currently scored at.
            </div>
          </div>
          <button
            onClick={() => patch({ walletPriorityEnabled: !settings.walletPriorityEnabled })}
            className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
              settings.walletPriorityEnabled ? "border-bull-dim bg-bull-bg text-bull" : "border-border bg-surface-raised text-muted"
            }`}
          >
            {settings.walletPriorityEnabled ? "On" : "Off"}
          </button>
        </div>

        {settings.walletPriorityEnabled && (
          <div className="grid grid-cols-3 gap-3">
            <NumberField
              label="Min closed trades"
              value={settings.walletPriorityMinTrades}
              onChange={(v) => patch({ walletPriorityMinTrades: v })}
              step={1}
            />
            <NumberField
              label="Min multiplier"
              value={settings.walletPriorityMinMultiplier}
              onChange={(v) => patch({ walletPriorityMinMultiplier: v })}
              step={0.1}
              suffix="×"
            />
            <NumberField
              label="Max multiplier"
              value={settings.walletPriorityMaxMultiplier}
              onChange={(v) => patch({ walletPriorityMaxMultiplier: v })}
              step={0.1}
              suffix="×"
            />
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-foreground">Stop-loss</div>
            <div className="font-mono text-[10px] text-muted">
              Auto-sells a position once it&apos;s down this much from cost basis — independent of whether
              the target wallet has sold. Checked roughly every 15s against a live quote, only while running.
            </div>
          </div>
          <button
            onClick={() => patch({ stopLossEnabled: !settings.stopLossEnabled })}
            className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
              settings.stopLossEnabled ? "border-bear-dim bg-bear-bg text-bear" : "border-border bg-surface-raised text-muted"
            }`}
          >
            {settings.stopLossEnabled ? "On" : "Off"}
          </button>
        </div>
        {settings.stopLossEnabled && (
          <div className="max-w-[10rem]">
            <NumberField
              label="Stop-loss threshold"
              value={settings.stopLossPct}
              onChange={(v) => patch({ stopLossPct: v })}
              step={1}
              suffix="%"
            />
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-foreground">Take-profit</div>
            <div className="font-mono text-[10px] text-muted">
              Auto-sells a position once it&apos;s up this much from cost basis — same independent check as
              stop-loss, so gains lock in even if the target keeps holding.
            </div>
          </div>
          <button
            onClick={() => patch({ takeProfitEnabled: !settings.takeProfitEnabled })}
            className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
              settings.takeProfitEnabled ? "border-bull-dim bg-bull-bg text-bull" : "border-border bg-surface-raised text-muted"
            }`}
          >
            {settings.takeProfitEnabled ? "On" : "Off"}
          </button>
        </div>
        {settings.takeProfitEnabled && (
          <div className="max-w-[10rem]">
            <NumberField
              label="Take-profit threshold"
              value={settings.takeProfitPct}
              onChange={(v) => patch({ takeProfitPct: v })}
              step={5}
              suffix="%"
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 font-mono text-xs text-accent transition enabled:hover:bg-accent/20 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
        {savedAt && <span className="font-mono text-[10px] text-bull">Saved</span>}
        {error && <span className="font-mono text-[10px] text-bear">{error}</span>}
      </div>
    </div>
  );
}
