"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  addTargetWallet,
  getRecentEvents,
  getStatus,
  removeTargetWallet,
  startBot,
  stopBot,
  subscribeToEvents,
  CopyTraderApiError,
  type BotEvent,
  type BotStatusSnapshot,
} from "@/lib/copyTraderApi";
import CopyTraderSettingsPanel from "@/components/CopyTraderSettingsPanel";
import CopyTraderPerformancePanel from "@/components/CopyTraderPerformancePanel";
import CopyTraderPositionsPanel from "@/components/CopyTraderPositionsPanel";

const STATUS_POLL_MS = 5000;

const EVENT_COLOR: Record<BotEvent["kind"], string> = {
  "trade-detected": "text-accent",
  sizing: "text-muted",
  execution: "text-bull",
  info: "text-muted",
  error: "text-bear",
};

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export default function CopyTraderPage() {
  const [status, setStatus] = useState<BotStatusSnapshot | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newWallet, setNewWallet] = useState("");
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const refreshStatus = useCallback(async () => {
    try {
      const snapshot = await getStatus();
      setStatus(snapshot);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    getRecentEvents(50)
      .then((evts) => {
        evts.forEach((e) => seenIds.current.add(e.id));
        setEvents(evts);
      })
      .catch(() => {});

    const interval = setInterval(refreshStatus, STATUS_POLL_MS);
    const unsubscribe = subscribeToEvents(
      (event) => {
        if (seenIds.current.has(event.id)) return;
        seenIds.current.add(event.id);
        setEvents((prev) => [event, ...prev].slice(0, 200));
        refreshStatus();
      },
      setStreamConnected
    );

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [refreshStatus]);

  const handleStart = useCallback(async () => {
    if (!status) return;
    if (!status.dryRun) {
      const confirmed = window.confirm(
        "This bot is in LIVE mode — starting it will execute real trades with real SOL, with no per-trade confirmation. Continue?"
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await startBot();
      await refreshStatus();
    } catch (err) {
      setActionError(err instanceof CopyTraderApiError ? err.message : "Failed to start the bot.");
    } finally {
      setBusy(false);
    }
  }, [status, refreshStatus]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await stopBot();
      await refreshStatus();
    } catch {
      setActionError("Failed to stop the bot.");
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  const handleAddWallet = useCallback(async () => {
    const address = newWallet.trim();
    if (!address) return;
    setWalletBusy(true);
    setWalletError(null);
    try {
      await addTargetWallet(address);
      setNewWallet("");
      await refreshStatus();
    } catch (err) {
      setWalletError(err instanceof CopyTraderApiError ? err.message : "Failed to add wallet.");
    } finally {
      setWalletBusy(false);
    }
  }, [newWallet, refreshStatus]);

  const handleRemoveWallet = useCallback(
    async (address: string) => {
      setWalletBusy(true);
      setWalletError(null);
      try {
        await removeTargetWallet(address);
        await refreshStatus();
      } catch {
        setWalletError("Failed to remove wallet.");
      } finally {
        setWalletBusy(false);
      }
    },
    [refreshStatus]
  );

  return (
    <main className="min-h-screen bg-grid px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="mb-6 inline-block font-mono text-xs text-muted hover:text-foreground">
          ← Examine
        </Link>

        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Copy Trader</h1>
          {status && (
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
                status.dryRun ? "border-accent/40 bg-accent/10 text-accent" : "border-bear-dim bg-bear-bg text-bear"
              }`}
            >
              {status.dryRun ? "Dry run" : "Live — real funds"}
            </span>
          )}
        </div>
        <p className="mb-3 font-mono text-xs text-muted">
          Mirrors target wallets&apos; Pump.fun/Raydium trades. No per-trade confirmation once running —
          see the bot&apos;s README before going live.
        </p>

        <Link
          href="/copy-trader/mirror"
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 font-mono text-xs text-accent hover:bg-accent/10"
        >
          Want to mirror these trades with your own wallet instead? →
        </Link>

        <details className="mb-6 rounded-xl border border-border bg-surface-raised px-4 py-3">
          <summary className="cursor-pointer font-mono text-xs text-muted hover:text-foreground">
            Why can&apos;t I paste my wallet&apos;s private key here?
          </summary>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
            A private key isn&apos;t like a password — if it ever crosses a network request or lands in a
            server log, whatever&apos;s in that wallet is gone permanently, with no reset. So this page
            never asks for one. Instead, the bot encrypts your key locally (on whatever machine runs it) via{" "}
            <code className="text-foreground">npm run encrypt-key</code>, and this website only ever talks
            to the bot&apos;s local API — which knows the wallet&apos;s public address, never the key
            itself. See <code className="text-foreground">copy-trader/README.md</code> for setup.
          </p>
        </details>

        {unreachable && (
          <div className="mb-6 rounded-xl border border-bear-dim bg-bear-bg px-4 py-3 font-mono text-xs text-bear">
            Couldn&apos;t reach the copy-trader control API. Make sure it&apos;s running:{" "}
            <code className="text-foreground">cd copy-trader && npm run dev</code>
          </div>
        )}

        {status && (
          <>
            <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Status</h2>
                <span className="flex items-center gap-1.5 font-mono text-xs text-foreground">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status.status === "running" ? "animate-pulse-soft bg-bull" : status.status === "error" ? "bg-bear" : "bg-muted"
                    }`}
                  />
                  {status.status}
                  {status.status === "running" && status.startedAt && (
                    <span className="text-muted">since {timeAgo(status.startedAt)}</span>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 font-mono text-xs sm:grid-cols-3">
                <div>
                  <div className="text-muted">Wallet</div>
                  <div className="mt-1 text-foreground">{status.walletPubkey}</div>
                </div>
                <div>
                  <div className="text-muted">Balance</div>
                  <div className="mt-1 text-foreground">{status.walletBalanceSol?.toFixed(4) ?? "—"} SOL</div>
                </div>
                <div>
                  <div className="text-muted">Watching</div>
                  <div className="mt-1 text-foreground">{status.targetWallets.length} wallet(s)</div>
                </div>
                <div>
                  <div className="text-muted">Buy sizing</div>
                  <div className="mt-1 text-foreground">
                    {status.buyPortfolioPercent.toFixed(0)}%, cap {status.buySolCap} SOL
                  </div>
                </div>
                <div>
                  <div className="text-muted">Slippage</div>
                  <div className="mt-1 text-foreground">{(status.slippageBps / 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-muted">Jito relay</div>
                  <div className="mt-1 text-foreground">{status.jitoEnabled ? "on" : "off"}</div>
                </div>
              </div>

              {status.lastError && (
                <div className="mt-4 rounded-lg border border-bear-dim bg-bear-bg px-3 py-2 font-mono text-[10px] text-bear">
                  {status.lastError}
                </div>
              )}

              <div className="mt-5 flex gap-2">
                {status.status === "running" ? (
                  <button
                    onClick={handleStop}
                    disabled={busy}
                    className="rounded-xl border border-bear-dim bg-bear-bg px-4 py-2 font-mono text-xs text-bear transition enabled:hover:bg-bear-dim/40 disabled:opacity-40"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={busy}
                    className="rounded-xl border border-bull-dim bg-bull-bg px-4 py-2 font-mono text-xs text-bull transition enabled:hover:bg-bull-dim/40 disabled:opacity-40"
                  >
                    Start
                  </button>
                )}
              </div>
              {actionError && <p className="mt-2 font-mono text-[10px] text-bear">{actionError}</p>}
            </div>

            <CopyTraderPerformancePanel />

            <CopyTraderPositionsPanel />

            <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-1 font-mono text-xs uppercase tracking-widest text-muted">Target Wallets</h2>
              <p className="mb-4 font-mono text-[10px] text-muted">
                Public addresses to mirror — add as many as you want to watch.
              </p>

              <div className="mb-3 flex gap-2">
                <input
                  value={newWallet}
                  onChange={(e) => setNewWallet(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddWallet()}
                  placeholder="Solana wallet address to copy-trade"
                  className="flex-1 rounded-xl border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
                />
                <button
                  onClick={handleAddWallet}
                  disabled={walletBusy || !newWallet.trim()}
                  className="rounded-xl border border-border bg-surface-raised px-4 py-2 font-mono text-xs text-foreground transition enabled:hover:bg-surface disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {walletError && <p className="mb-3 font-mono text-[10px] text-bear">{walletError}</p>}

              {status.targetWallets.length === 0 ? (
                <p className="font-mono text-xs text-muted">No wallets watched yet — add one above.</p>
              ) : (
                <ul className="space-y-2">
                  {status.targetWallets.map((address) => (
                    <li
                      key={address}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-foreground"
                    >
                      <span>
                        {address.slice(0, 6)}…{address.slice(-6)}
                      </span>
                      <button
                        onClick={() => handleRemoveWallet(address)}
                        disabled={walletBusy}
                        className="text-muted transition hover:text-bear disabled:opacity-40"
                        aria-label={`Remove ${address}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <CopyTraderSettingsPanel />
          </>
        )}

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Live Activity</h2>
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${streamConnected ? "bg-bull" : "bg-muted"}`} />
              {streamConnected ? "live" : "polling"}
            </span>
          </div>

          {events.length === 0 ? (
            <p className="font-mono text-xs text-muted">No activity yet.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto font-mono text-xs">
              {events.map((event) => (
                <li key={event.id} className="flex items-start gap-3 border-b border-border pb-2 last:border-0">
                  <span className="whitespace-nowrap text-muted">{timeAgo(event.at)}</span>
                  <span className={EVENT_COLOR[event.kind]}>{event.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
