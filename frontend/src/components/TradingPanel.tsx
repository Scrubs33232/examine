"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";

// Integrates with PumpPortal's public "Local Transaction API"
// (https://pumpportal.fun/trading-api at time of writing). PumpPortal builds
// an UNSIGNED transaction server-side from these params; the wallet signs it
// locally and we submit it ourselves — PumpPortal never sees a private key.
//
// UNVERIFIED: pump.fun/PumpPortal don't have stable versioned docs, and this
// endpoint's exact param names/shapes have changed before. Test with a small
// amount first, and re-check https://pumpportal.fun/trading-api/local before
// relying on this in size.
const PUMPPORTAL_TRADE_LOCAL = "https://pumpportal.fun/api/trade-local";

type ToastStatus = "pending" | "confirmed" | "failed";

interface Toast {
  id: string;
  status: ToastStatus;
  message: string;
  txSig?: string;
}

const BUY_PRESETS_SOL = [0.1, 0.5, 1];
const SELL_PRESETS_PCT = [25, 50, 100];

export interface TradeConfirmation {
  action: "buy" | "sell";
  mint: string;
  amount: number; // SOL for buy, % for sell
  txSig: string;
}

interface TradingPanelProps {
  tokenAddress: string;
  // Optional — omitting it changes nothing about existing behavior. Lets a
  // parent (e.g. the dashboard) log/react to a trade that already confirmed
  // on-chain. Never called before user + wallet have both approved it.
  onTradeConfirmed?: (confirmation: TradeConfirmation) => void;
}

export default function TradingPanel({ tokenAddress, onTradeConfirmed }: TradingPanelProps) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [customBuySol, setCustomBuySol] = useState("");
  const [slippagePct, setSlippagePct] = useState("2");
  const [priorityFeeLamports, setPriorityFeeLamports] = useState("500000");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(toast: Toast) {
    setToasts((t) => [toast, ...t].slice(0, 5));
  }

  function updateToast(id: string, patch: Partial<Toast>) {
    setToasts((t) => t.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)));
  }

  async function executeTrade(action: "buy" | "sell", amount: number, denominatedInSol: boolean) {
    if (!connected || !publicKey || !signTransaction) {
      pushToast({ id: crypto.randomUUID(), status: "failed", message: "Connect your wallet first." });
      return;
    }
    if (!tokenAddress) {
      pushToast({ id: crypto.randomUUID(), status: "failed", message: "Enter a token contract address first." });
      return;
    }

    const toastId = crypto.randomUUID();
    pushToast({ id: toastId, status: "pending", message: `Building ${action} transaction…` });
    setBusy(true);

    try {
      const priorityFeeSol = Number(priorityFeeLamports) / 1e9;

      const res = await fetch(PUMPPORTAL_TRADE_LOCAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          action,
          mint: tokenAddress,
          amount: denominatedInSol ? amount : `${amount}%`,
          denominatedInSol: String(denominatedInSol),
          slippage: Number(slippagePct),
          priorityFee: priorityFeeSol,
          pool: "auto",
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`PumpPortal error: ${text}`);
      }

      const txBytes = new Uint8Array(await res.arrayBuffer());
      const transaction = VersionedTransaction.deserialize(txBytes);

      updateToast(toastId, { message: "Waiting for wallet approval…" });
      const signed = await signTransaction(transaction);

      updateToast(toastId, { message: "Submitting to network…" });
      const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });

      updateToast(toastId, { message: "Confirming…", txSig: signature });
      const confirmation = await connection.confirmTransaction(signature, "confirmed");

      if (confirmation.value.err) {
        updateToast(toastId, { status: "failed", message: "Transaction failed on-chain.", txSig: signature });
      } else {
        updateToast(toastId, { status: "confirmed", message: `${action === "buy" ? "Bought" : "Sold"} successfully.`, txSig: signature });
        onTradeConfirmed?.({ action, mint: tokenAddress, amount, txSig: signature });
      }
    } catch (err) {
      updateToast(toastId, {
        status: "failed",
        message: err instanceof Error ? err.message : "Trade failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted">Trade</h2>

      <div className="mb-4 rounded-xl border border-bear-dim bg-bear-bg p-3 font-mono text-[11px] text-bear">
        Meme coins are extremely high risk — most go to zero. Every trade here requires your explicit
        click and a signature you approve in your wallet. Nothing executes automatically. Not
        financial advice.
      </div>

      <div className="mb-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted">Buy</div>
        <div className="flex flex-wrap gap-2">
          {BUY_PRESETS_SOL.map((sol) => (
            <button
              key={sol}
              disabled={busy || !tokenAddress}
              onClick={() => executeTrade("buy", sol, true)}
              className="rounded-lg border border-bull-dim bg-bull-bg px-3 py-2 font-mono text-xs text-bull transition enabled:hover:shadow-glow disabled:opacity-40"
            >
              {sol} SOL
            </button>
          ))}
          <input
            value={customBuySol}
            onChange={(e) => setCustomBuySol(e.target.value)}
            placeholder="Custom SOL"
            className="w-24 rounded-lg border border-border bg-surface-raised px-2 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
          />
          <button
            disabled={busy || !tokenAddress || !customBuySol}
            onClick={() => executeTrade("buy", Number(customBuySol), true)}
            className="rounded-lg border border-bull-dim bg-bull-bg px-3 py-2 font-mono text-xs text-bull transition enabled:hover:shadow-glow disabled:opacity-40"
          >
            Buy
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted">Sell</div>
        <div className="flex flex-wrap gap-2">
          {SELL_PRESETS_PCT.map((pct) => (
            <button
              key={pct}
              disabled={busy || !tokenAddress}
              onClick={() => executeTrade("sell", pct, false)}
              className="rounded-lg border border-bear-dim bg-bear-bg px-3 py-2 font-mono text-xs text-bear transition enabled:hover:shadow-glow-bear disabled:opacity-40"
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted">Slippage %</span>
          <input
            value={slippagePct}
            onChange={(e) => setSlippagePct(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted">Priority Fee (lamports)</span>
          <input
            value={priorityFeeLamports}
            onChange={(e) => setPriorityFeeLamports(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
          />
        </label>
      </div>

      {!connected && (
        <p className="mt-4 font-mono text-xs text-muted">Connect your wallet above to enable trading.</p>
      )}

      <div className="mt-4 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg border px-3 py-2 font-mono text-xs ${
              t.status === "confirmed"
                ? "border-bull-dim bg-bull-bg text-bull"
                : t.status === "failed"
                  ? "border-bear-dim bg-bear-bg text-bear"
                  : "border-border bg-surface-raised text-muted"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span>{t.message}</span>
              {t.txSig && (
                <a
                  href={`https://solscan.io/tx/${t.txSig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 underline"
                >
                  view tx ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
