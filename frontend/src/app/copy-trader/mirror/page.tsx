"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { subscribeToMirrorSignals, type MirrorSignalMessage } from "@/lib/copyTraderApi";
import { executeMirrorSignal, type MirrorPrefs, type MirrorResult } from "@/lib/mirrorExecutor";

const PREFS_STORAGE_KEY = "examine_mirror_prefs_v1";

const DEFAULT_PREFS: MirrorPrefs = {
  buyPortfolioPercent: 10,
  buySolCap: 0.5,
  feeBufferSol: 0.03,
  slippageBps: 200,
};

interface LogEntry {
  id: string;
  at: number;
  signal: MirrorSignalMessage;
  result?: MirrorResult;
}

function loadPrefs(): MirrorPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: MirrorPrefs): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — non-fatal, just won't persist across reloads
  }
}

export default function MirrorPage() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [prefs, setPrefs] = useState<MirrorPrefs>(DEFAULT_PREFS);
  const [mirroring, setMirroring] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const mirroringRef = useRef(mirroring);
  mirroringRef.current = mirroring;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const updatePrefs = useCallback((patch: Partial<MirrorPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToMirrorSignals(
      (signal) => {
        const entryId = signal.id;
        setLog((prev) => [{ id: entryId, at: Date.now(), signal }, ...prev].slice(0, 100));

        if (!mirroringRef.current) {
          setLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, result: { status: "skipped", reason: "mirroring is off" } } : e)));
          return;
        }
        if (!walletRef.current.connected) {
          setLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, result: { status: "skipped", reason: "wallet not connected" } } : e)));
          return;
        }

        executeMirrorSignal(signal, walletRef.current, connection, prefsRef.current).then((result) => {
          setLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, result } : e)));
        });
      },
      setWsConnected
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const statusColor = useMemo(() => {
    if (!wsConnected) return "bg-muted";
    return mirroring ? "bg-bull" : "bg-accent";
  }, [wsConnected, mirroring]);

  return (
    <main className="min-h-screen bg-grid px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/copy-trader" className="mb-6 inline-block font-mono text-xs text-muted hover:text-foreground">
          ← Copy Trader
        </Link>

        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Mirror Trade</h1>
          <WalletMultiButton />
        </div>
        <p className="mb-6 max-w-lg font-mono text-xs text-muted">
          Non-custodial — your connected wallet signs every trade itself. This site never sees, stores, or
          asks for your private key. Every mirrored trade shows a wallet approval prompt; nothing sends
          without it.
        </p>

        <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Sizing</h2>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
              {!wsConnected ? "connecting…" : mirroring ? "mirroring live" : "signals paused"}
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
                <span>Buy size — % of spendable balance</span>
                <span className="text-bull">{prefs.buyPortfolioPercent}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={prefs.buyPortfolioPercent}
                onChange={(e) => updatePrefs({ buyPortfolioPercent: Number(e.target.value) })}
                className="w-full accent-bull"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted">Buy cap (SOL)</span>
                <input
                  value={prefs.buySolCap}
                  onChange={(e) => updatePrefs({ buySolCap: Number(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted">Slippage (bps)</span>
                <input
                  value={prefs.slippageBps}
                  onChange={(e) => updatePrefs({ slippageBps: Number(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
                />
              </label>
            </div>
          </div>

          <button
            onClick={() => setMirroring((m) => !m)}
            disabled={!wallet.connected}
            className={`mt-5 w-full rounded-xl border px-4 py-2 font-mono text-xs transition disabled:opacity-40 ${
              mirroring
                ? "border-bear-dim bg-bear-bg text-bear enabled:hover:bg-bear-dim/40"
                : "border-bull-dim bg-bull-bg text-bull enabled:hover:bg-bull-dim/40"
            }`}
          >
            {mirroring ? "Stop Mirroring" : "Start Mirroring"}
          </button>
          {!wallet.connected && <p className="mt-2 font-mono text-[10px] text-muted">Connect your wallet above first.</p>}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Signal Activity</h2>
          {log.length === 0 ? (
            <p className="font-mono text-xs text-muted">No signals received yet.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto font-mono text-xs">
              {log.map((entry) => (
                <li key={entry.id} className="border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground">
                      {entry.signal.direction.toUpperCase()} on {entry.signal.dex} —{" "}
                      {entry.signal.mint.slice(0, 4)}…{entry.signal.mint.slice(-4)}
                    </span>
                    <span
                      className={
                        entry.result?.status === "submitted"
                          ? "text-bull"
                          : entry.result?.status === "failed"
                            ? "text-bear"
                            : "text-muted"
                      }
                    >
                      {entry.result?.status ?? "processing…"}
                    </span>
                  </div>
                  {entry.result?.reason && <div className="mt-0.5 text-muted">{entry.result.reason}</div>}
                  {entry.result?.txSig && (
                    <a
                      href={`https://solscan.io/tx/${entry.result.txSig}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-block text-accent underline"
                    >
                      view tx ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
