"use client";

import { useState } from "react";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import TokenStatsPanel from "@/components/TokenStatsPanel";
import TradingPanel from "@/components/TradingPanel";

export default function TradePage() {
  const [input, setInput] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");

  return (
    <main className="min-h-screen bg-grid px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" className="font-mono text-xs text-muted hover:text-foreground">
            ← Examine
          </Link>
          <WalletMultiButton />
        </div>

        <h1 className="mb-1 text-xl font-semibold text-foreground">Solana Token Trading</h1>
        <p className="mb-6 font-mono text-xs text-muted">
          Non-custodial — your wallet extension signs every transaction. Nothing trades automatically.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTokenAddress(input.trim());
          }}
          className="mb-6 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Solana token contract address (CA)"
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl border border-border bg-surface-raised px-4 py-3 font-mono text-sm text-foreground hover:bg-surface"
          >
            Load
          </button>
        </form>

        {tokenAddress && (
          <div className="space-y-6">
            <TokenStatsPanel tokenAddress={tokenAddress} />
            <TradingPanel tokenAddress={tokenAddress} />
          </div>
        )}
      </div>
    </main>
  );
}
