"use client";

import type { PositionWithLive } from "@/hooks/usePositions";

export interface TxLogEntry {
  id: string;
  action: "buy" | "sell";
  mint: string;
  amount: number;
  txSig: string;
  at: number;
}

function fmtPrice(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(8)}`;
}

export default function PositionsTable({
  positions,
  onRemove,
  txLog,
}: {
  positions: PositionWithLive[];
  onRemove: (mint: string) => void;
  txLog: TxLogEntry[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">Tracked Positions</h2>
        {positions.length === 0 ? (
          <p className="font-mono text-xs text-muted">No positions tracked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="pb-2 pr-4 font-normal">Symbol</th>
                  <th className="pb-2 pr-4 font-normal">Entry</th>
                  <th className="pb-2 pr-4 font-normal">Current</th>
                  <th className="pb-2 pr-4 font-normal">PnL</th>
                  <th className="pb-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.mint} className="border-t border-border">
                    <td className="py-2 pr-4 text-foreground">{p.symbol}</td>
                    <td className="py-2 pr-4 tabular text-muted">{fmtPrice(p.entryPriceUsd)}</td>
                    <td className="py-2 pr-4 tabular text-muted">{fmtPrice(p.currentPriceUsd)}</td>
                    <td className={`py-2 pr-4 tabular ${p.pnlPct !== null && p.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>
                      {p.pnlPct !== null ? `${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => onRemove(p.mint)} className="text-muted hover:text-bear">
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">Transaction Log</h2>
        {txLog.length === 0 ? (
          <p className="font-mono text-xs text-muted">No trades executed this session yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {txLog.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs">
                <span className={tx.action === "buy" ? "text-bull" : "text-bear"}>
                  {tx.action.toUpperCase()} {tx.action === "buy" ? `${tx.amount} SOL` : `${tx.amount}%`}
                </span>
                <a
                  href={`https://solscan.io/tx/${tx.txSig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  view tx ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
