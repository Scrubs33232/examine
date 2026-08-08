// Client-side execution for the non-custodial mirror-trading flow. Builds
// each swap from a broadcast signal and requests a signature from the
// user's own connected wallet extension — the private key never leaves the
// extension, and this code never touches it. Reuses the same two
// battle-tested paths already used by TradingPanel.tsx: PumpPortal's
// "trade-local" endpoint for pump.fun (server builds an UNSIGNED tx from
// public params only), and Jupiter v6 for Raydium-routed swaps.
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";

// UNVERIFIED: see TradingPanel.tsx — pump.fun/PumpPortal don't publish
// stable versioned docs for this endpoint.
const PUMPPORTAL_TRADE_LOCAL = "https://pumpportal.fun/api/trade-local";
const JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_URL = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_PRIORITY_FEE_LAMPORTS = 500_000;

export interface MirrorSignal {
  id: string;
  at: number;
  direction: "buy" | "sell";
  dex: "pumpfun" | "raydium";
  mint: string;
  sellFractionOfHoldings: number | null;
  sourceSignature: string;
}

export interface MirrorPrefs {
  buyPortfolioPercent: number; // 0-100
  buySolCap: number; // SOL
  feeBufferSol: number;
  slippageBps: number;
}

export interface MirrorResult {
  status: "submitted" | "skipped" | "failed";
  reason?: string;
  txSig?: string;
}

async function getSolBalanceSol(connection: Connection, pubkey: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(pubkey, "confirmed");
  return lamports / 1e9;
}

async function getTokenBalanceRaw(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return BigInt(0); // no token account yet == zero balance, not an error
  }
}

function computeBuySol(balanceSol: number, prefs: MirrorPrefs): number {
  const spendable = balanceSol - prefs.feeBufferSol;
  if (spendable <= 0) return 0;
  const byPercent = spendable * (prefs.buyPortfolioPercent / 100);
  return Math.min(byPercent, prefs.buySolCap, spendable);
}

export async function executeMirrorSignal(
  signal: MirrorSignal,
  wallet: WalletContextState,
  connection: Connection,
  prefs: MirrorPrefs
): Promise<MirrorResult> {
  if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
    return { status: "skipped", reason: "wallet not connected" };
  }
  const { publicKey, signTransaction } = wallet;

  try {
    let transaction: VersionedTransaction;

    if (signal.direction === "buy") {
      const balanceSol = await getSolBalanceSol(connection, publicKey);
      const solAmount = computeBuySol(balanceSol, prefs);
      if (solAmount < 0.001) {
        return { status: "skipped", reason: `sized buy too small (balance ${balanceSol.toFixed(4)} SOL)` };
      }
      transaction = await buildTransaction(signal, publicKey, prefs.slippageBps, { kind: "buy", solAmount });
    } else {
      if (signal.sellFractionOfHoldings === null) {
        return { status: "skipped", reason: "no sell-fraction basis from the source trade" };
      }
      const tokenBalance = await getTokenBalanceRaw(connection, publicKey, new PublicKey(signal.mint));
      if (tokenBalance <= BigInt(0)) {
        return { status: "skipped", reason: "no balance of this token to sell" };
      }
      const sellPercent = signal.sellFractionOfHoldings * 100;
      transaction = await buildTransaction(signal, publicKey, prefs.slippageBps, { kind: "sell", sellPercent, tokenBalance });
    }

    const signed = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      return { status: "failed", reason: "transaction failed on-chain", txSig: signature };
    }
    return { status: "submitted", txSig: signature };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "trade failed" };
  }
}

type Side = { kind: "buy"; solAmount: number } | { kind: "sell"; sellPercent: number; tokenBalance: bigint };

async function buildTransaction(
  signal: MirrorSignal,
  publicKey: PublicKey,
  slippageBps: number,
  side: Side
): Promise<VersionedTransaction> {
  if (signal.dex === "pumpfun") {
    const res = await fetch(PUMPPORTAL_TRADE_LOCAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKey.toBase58(),
        action: signal.direction,
        mint: signal.mint,
        amount: side.kind === "buy" ? side.solAmount : `${side.sellPercent.toFixed(2)}%`,
        denominatedInSol: String(side.kind === "buy"),
        slippage: slippageBps / 100,
        priorityFee: DEFAULT_PRIORITY_FEE_LAMPORTS / 1e9,
        pool: "auto",
      }),
    });
    if (!res.ok) throw new Error(`PumpPortal error: ${await res.text().catch(() => res.statusText)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return VersionedTransaction.deserialize(bytes);
  }

  // Raydium — route through Jupiter v6.
  const inputMint = signal.direction === "buy" ? SOL_MINT : signal.mint;
  const outputMint = signal.direction === "buy" ? signal.mint : SOL_MINT;
  const amountRaw =
    side.kind === "buy"
      ? BigInt(Math.round(side.solAmount * 1e9)).toString()
      : ((side.tokenBalance * BigInt(Math.round(side.sellPercent * 100))) / BigInt(10_000)).toString();

  const quoteUrl = new URL(JUPITER_QUOTE_URL);
  quoteUrl.searchParams.set("inputMint", inputMint);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", amountRaw);
  quoteUrl.searchParams.set("slippageBps", String(slippageBps));
  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) throw new Error("Jupiter quote failed — no route for this mint");
  const quote = await quoteRes.json();

  const swapRes = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: DEFAULT_PRIORITY_FEE_LAMPORTS,
    }),
  });
  if (!swapRes.ok) throw new Error("Jupiter swap build failed");
  const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };
  return VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
}
