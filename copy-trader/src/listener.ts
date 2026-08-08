/** Watches target wallets for Pump.fun / Raydium swaps via a raw
 * logsSubscribe websocket, with manual reconnect/backoff (the Connection
 * class's built-in subscription handling doesn't expose reconnect control).
 *
 * Detection strategy: rather than decoding each DEX's specific instruction
 * layout (which differs per-DEX and changes over time), we fetch the full
 * transaction once a watched wallet is mentioned in a program-matching log,
 * then diff the target wallet's pre/post SOL and SPL token balances from
 * the transaction metadata. This is DEX-agnostic and far more robust than
 * instruction parsing for *detection* — direction and amounts fall out of
 * the balance deltas directly. (Building our own swap still requires
 * knowing each DEX's instruction format — that lives in executor.ts.)
 */
import WebSocket from "ws";
import { Connection, PublicKey } from "@solana/web3.js";
import { EventEmitter } from "node:events";
import { config } from "./config.js";
import type { Dex, TargetTradeEvent } from "./types.js";

const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const RAYDIUM_AMM_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

const DEX_PROGRAM_IDS: Record<string, Dex> = {
  [PUMPFUN_PROGRAM_ID]: "pumpfun",
  [RAYDIUM_AMM_V4_PROGRAM_ID]: "raydium",
  [RAYDIUM_CPMM_PROGRAM_ID]: "raydium",
};

interface TokenBalanceEntry {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export class TargetWalletListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private readonly httpConnection: Connection;
  private closedByUser = false;

  constructor(private readonly targetWallets: string[]) {
    super();
    if (targetWallets.length === 0) throw new Error("TargetWalletListener requires at least one wallet");
    this.httpConnection = new Connection(config.rpcHttpUrl, "confirmed");
  }

  start(): void {
    this.closedByUser = false;
    this.connect();
  }

  stop(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(config.rpcWsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      console.log(`[listener] connected — subscribing to ${this.targetWallets.length} wallet(s)`);
      this.targetWallets.forEach((wallet, i) => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: i + 1,
            method: "logsSubscribe",
            params: [{ mentions: [wallet] }, { commitment: "confirmed" }],
          })
        );
      });
    });

    ws.on("message", (raw) => {
      try {
        this.handleMessage(raw.toString());
      } catch (err) {
        console.error("[listener] error handling message:", (err as Error).message);
      }
    });

    ws.on("close", () => {
      if (this.closedByUser) return;
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[listener] websocket error:", (err as Error).message);
      // 'close' fires after 'error' in the ws lib, so reconnect is scheduled there.
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delayMs = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    console.warn(`[listener] disconnected — reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(() => this.connect(), delayMs);
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw);

    if (msg.method !== "logsNotification") return; // subscription ack or unrelated message

    const value = msg.params?.result?.value;
    if (!value) return;
    const { signature, err, logs } = value as { signature: string; err: unknown; logs: string[] };
    if (!signature || err) return; // skip failed txs

    const mentionsDex = logs?.some((line) => Object.keys(DEX_PROGRAM_IDS).some((programId) => line.includes(programId)));
    if (!mentionsDex) return;

    this.resolveTradeFromSignature(signature).catch((err) => {
      console.error(`[listener] failed to resolve trade for ${signature}:`, (err as Error).message ?? err);
    });
  }

  private async resolveTradeFromSignature(signature: string): Promise<void> {
    // logsNotification can fire just before the tx is fetchable on some
    // RPCs — poll briefly rather than failing on the first miss.
    let tx = null;
    for (let attempt = 0; attempt < 5 && !tx; attempt++) {
      tx = await this.httpConnection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) await new Promise((r) => setTimeout(r, 400));
    }
    if (!tx || !tx.meta || tx.meta.err) return;

    // Known limitation: for transactions that reference program IDs only via
    // an address lookup table (not as a static account key), this won't see
    // them. Most pump.fun bonding-curve trades and simple Raydium swaps use
    // static keys, so this covers the common case.
    const message = tx.transaction.message as unknown as { staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[] };
    const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
    const keyStrings = staticKeys.map((k) => k.toBase58());

    const matchedDex = keyStrings.map((id) => DEX_PROGRAM_IDS[id]).find(Boolean);
    if (!matchedDex) return;

    for (const targetWallet of this.targetWallets) {
      const walletIndex = keyStrings.indexOf(targetWallet);
      if (walletIndex === -1) continue;
      const event = this.diffBalances(tx.meta, walletIndex, targetWallet, matchedDex, signature, tx.slot);
      if (event) this.emit("trade", event);
    }
  }

  private diffBalances(
    meta: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>["meta"],
    walletIndex: number,
    targetWallet: string,
    dex: Dex,
    signature: string,
    slot: number
  ): TargetTradeEvent | null {
    if (!meta) return null;

    const solDeltaLamports = BigInt(meta.postBalances[walletIndex] - meta.preBalances[walletIndex]);

    const preTok = ((meta.preTokenBalances ?? []) as TokenBalanceEntry[]).filter((b) => b.owner === targetWallet);
    const postTok = ((meta.postTokenBalances ?? []) as TokenBalanceEntry[]).filter((b) => b.owner === targetWallet);

    // The traded mint is whichever one has the largest balance delta for
    // this wallet — works regardless of which DEX/instruction shape was used.
    let bestMint: string | null = null;
    let bestPreRaw = 0n;
    let bestPostRaw = 0n;
    let bestDecimals = 0;
    let bestDelta = -1n;

    const mints = new Set<string>([...preTok.map((b) => b.mint), ...postTok.map((b) => b.mint)]);
    for (const mint of mints) {
      const pre = preTok.find((b) => b.mint === mint);
      const post = postTok.find((b) => b.mint === mint);
      const preRaw = BigInt(pre?.uiTokenAmount.amount ?? "0");
      const postRaw = BigInt(post?.uiTokenAmount.amount ?? "0");
      const decimals = pre?.uiTokenAmount.decimals ?? post?.uiTokenAmount.decimals ?? 0;
      const delta = postRaw > preRaw ? postRaw - preRaw : preRaw - postRaw;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestMint = mint;
        bestPreRaw = preRaw;
        bestPostRaw = postRaw;
        bestDecimals = decimals;
      }
    }

    if (!bestMint || bestDelta === 0n) return null;

    const direction: "buy" | "sell" = bestPostRaw > bestPreRaw ? "buy" : "sell";
    const tokenRawAmount = direction === "buy" ? bestPostRaw - bestPreRaw : bestPreRaw - bestPostRaw;
    const sellFractionOfHoldings = direction === "sell" && bestPreRaw > 0n ? Number(tokenRawAmount) / Number(bestPreRaw) : null;

    return {
      signature,
      slot,
      dex,
      direction,
      mint: bestMint,
      sourceWallet: targetWallet,
      solLamports: solDeltaLamports < 0n ? -solDeltaLamports : solDeltaLamports,
      tokenRawAmount,
      tokenDecimals: bestDecimals,
      sellFractionOfHoldings,
      detectedAt: Date.now(),
    };
  }
}
