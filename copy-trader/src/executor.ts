/** Builds, signs, and submits swap transactions.
 *
 * Raydium trades route through Jupiter v6 (aggregates Raydium and gives us a
 * battle-tested swap builder instead of hand-rolling AMM math). Pump.fun
 * bonding-curve trades go direct to the pump.fun program, since bonding
 * curves aren't always routed by aggregators, especially early in a token's
 * life — which is exactly when copy-trading them matters most.
 *
 * IMPORTANT — the pump.fun instruction layout below (program ID, account
 * list, instruction discriminators) is reconstructed from publicly
 * documented/reverse-engineered pump.fun program behavior. Pump.fun does not
 * publish an official versioned IDL, and the program has changed before.
 * VERIFY this against the current on-chain program (e.g. simulate first, or
 * test with a trivial amount) before trusting it with meaningful capital.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getMint,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { settingsStore } from "./settingsStore.js";
import type { SizedOrder, ExecutionResult } from "./types.js";
import { applySlippage } from "./calculator.js";

const JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_URL = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPFUN_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const PUMPFUN_FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const PUMPFUN_EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
// Anchor 8-byte instruction discriminators for "global:buy" / "global:sell".
// See file header — verify before relying on this with real funds.
const PUMPFUN_BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const PUMPFUN_SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fFyKAsJALfjZKqvLc",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
];

function pickJitoTipAccount(): PublicKey {
  return new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
}

function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value < 0n ? 0n : value);
  return buf;
}

export class Executor {
  constructor(private readonly connection: Connection, private readonly wallet: Keypair) {}

  async getPriorityFeeMicroLamports(): Promise<number> {
    try {
      const fees = await this.connection.getRecentPrioritizationFees();
      if (fees.length === 0) return 10_000;
      const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor((settingsStore.get().priorityFeePercentile / 100) * sorted.length));
      return Math.max(sorted[idx], 1_000);
    } catch (err) {
      console.warn("[executor] priority fee lookup failed, using floor:", (err as Error).message);
      return 10_000;
    }
  }

  /** Refuses to trade a mint whose authorities or liquidity pose an obvious
   * risk. This is a floor, not a substitute for real due diligence. */
  async checkExecutionGuards(mint: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const mintInfo = await getMint(this.connection, new PublicKey(mint));
      if (mintInfo.mintAuthority !== null) {
        return { ok: false, reason: "mint authority is not renounced — supply can be inflated after we buy" };
      }
      if (mintInfo.freezeAuthority !== null) {
        return { ok: false, reason: "freeze authority is set — our token account could be frozen after we buy" };
      }
    } catch (err) {
      return { ok: false, reason: `could not read mint info: ${(err as Error).message}` };
    }

    try {
      const settings = settingsStore.get();
      const probeLamports = BigInt(Math.round(settings.minLiquiditySol * 1e9));
      const quote = await this.jupiterQuote(SOL_MINT, mint, probeLamports, 100);
      if (!quote) {
        // No aggregator route is expected/normal for a brand-new pump.fun
        // bonding-curve token — don't treat that alone as disqualifying.
        return { ok: true };
      }
      const impact = Number(quote.priceImpactPct ?? 0);
      if (impact > settingsStore.maxPriceImpactFraction) {
        return {
          ok: false,
          reason: `price impact too high for a ${settings.minLiquiditySol} SOL probe (${(impact * 100).toFixed(1)}%) — thin liquidity`,
        };
      }
    } catch (err) {
      console.warn(`[executor] liquidity probe failed (continuing): ${(err as Error).message}`);
    }

    return { ok: true };
  }

  /** Current market value of a held token position, in lamports, via a
   * Jupiter sell-side quote — used by bot.ts's stop-loss/take-profit
   * monitor to compare against cost basis independent of the target
   * wallet's own behavior. Returns null (not zero) if no quote route
   * exists right now, e.g. a brand-new pump.fun bonding-curve token the
   * aggregator hasn't indexed yet — callers should treat that as "unknown
   * this tick" and re-check next tick, not as "worthless". */
  async getCurrentPositionValueLamports(mint: string, tokenRawAmount: bigint): Promise<bigint | null> {
    if (tokenRawAmount <= 0n) return 0n;
    const quote = await this.jupiterQuote(mint, SOL_MINT, tokenRawAmount, 100);
    if (!quote) return null;
    return BigInt(quote.outAmount);
  }

  private async jupiterQuote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<any | null> {
    const url = new URL(JUPITER_QUOTE_URL);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amount.toString());
    url.searchParams.set("slippageBps", slippageBps.toString());
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return res.json();
  }

  async executeOrder(order: SizedOrder): Promise<ExecutionResult> {
    const start = Date.now();
    const route = order.dex === "pumpfun" ? "pumpfun-direct" : "jupiter";
    const settings = settingsStore.get();
    const submittedVia = settings.jitoBlockEngineUrl ? "jito" : "rpc";

    if (settings.dryRun) {
      console.log(`[executor] DRY RUN — would execute:`, order);
      return { success: true, route, submittedVia, latencyMs: Date.now() - start };
    }

    try {
      const guard = await this.checkExecutionGuards(order.mint);
      if (!guard.ok) {
        console.warn(`[executor] guard blocked trade on ${order.mint}: ${guard.reason}`);
        return { success: false, error: guard.reason, route, submittedVia, latencyMs: Date.now() - start };
      }

      const tx = order.dex === "pumpfun" ? await this.buildPumpFunTx(order) : await this.buildJupiterTx(order);
      if (!tx) {
        return { success: false, error: "failed to build transaction (no route/quote)", route, submittedVia, latencyMs: Date.now() - start };
      }

      tx.sign([this.wallet]);

      const signature = settings.jitoBlockEngineUrl ? await this.sendViaJito(tx) : await this.sendViaRpc(tx);

      // Best-effort: read back what actually happened on-chain rather than
      // trusting the requested amounts — slippage, partial fills, and
      // pump.fun's exact-tokens-out semantics all mean actual != requested.
      // ledger.ts (P&L tracking) only ever trusts this, never the request.
      const actual = await this.getActualDelta(signature, order.mint).catch(() => null);

      return {
        success: true,
        signature,
        route,
        submittedVia,
        latencyMs: Date.now() - start,
        actualSolLamports: actual?.solLamports,
        actualTokenRawAmount: actual?.tokenRawAmount,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message, route, submittedVia, latencyMs: Date.now() - start };
    }
  }

  /** Diffs OUR OWN wallet's pre/post SOL and token balance for `mint` from
   * the confirmed transaction — same technique listener.ts uses to detect
   * target wallet trades, applied here to our own execution. Returns null
   * if the tx isn't found yet (e.g. a Jito bundle still landing) — callers
   * treat that as "actual amounts unknown", not as a fabricated zero. */
  private async getActualDelta(signature: string, mint: string): Promise<{ solLamports: bigint; tokenRawAmount: bigint } | null> {
    let tx = null;
    for (let attempt = 0; attempt < 6 && !tx; attempt++) {
      tx = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) await new Promise((r) => setTimeout(r, 500));
    }
    if (!tx || !tx.meta) return null;

    const message = tx.transaction.message as unknown as { staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[] };
    const keys = (message.staticAccountKeys ?? message.accountKeys ?? []).map((k) => k.toBase58());
    const walletIndex = keys.indexOf(this.wallet.publicKey.toBase58());
    if (walletIndex === -1) return null;

    const solDelta = BigInt(tx.meta.postBalances[walletIndex] - tx.meta.preBalances[walletIndex]);

    const ownerKey = this.wallet.publicKey.toBase58();
    type TokenBalanceEntry = { mint: string; owner?: string; uiTokenAmount: { amount: string } };
    const preTok = ((tx.meta.preTokenBalances ?? []) as TokenBalanceEntry[]).find((b) => b.owner === ownerKey && b.mint === mint);
    const postTok = ((tx.meta.postTokenBalances ?? []) as TokenBalanceEntry[]).find((b) => b.owner === ownerKey && b.mint === mint);
    const preRaw = BigInt(preTok?.uiTokenAmount.amount ?? "0");
    const postRaw = BigInt(postTok?.uiTokenAmount.amount ?? "0");
    const tokenDelta = postRaw > preRaw ? postRaw - preRaw : preRaw - postRaw;

    return {
      solLamports: solDelta < 0n ? -solDelta : solDelta,
      tokenRawAmount: tokenDelta,
    };
  }

  private async buildJupiterTx(order: SizedOrder): Promise<VersionedTransaction | null> {
    const inputMint = order.direction === "buy" ? SOL_MINT : order.mint;
    const outputMint = order.direction === "buy" ? order.mint : SOL_MINT;
    const amount = order.direction === "buy" ? order.solLamportsIn! : order.tokenRawAmountIn!;

    const quote = await this.jupiterQuote(inputMint, outputMint, amount, settingsStore.get().slippageBps);
    if (!quote) return null;

    const priorityFee = await this.getPriorityFeeMicroLamports();

    const res = await fetch(JUPITER_SWAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFee,
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap build failed: ${res.status} ${await res.text()}`);
    const { swapTransaction } = (await res.json()) as { swapTransaction: string };
    return VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  }

  private async buildPumpFunTx(order: SizedOrder): Promise<VersionedTransaction | null> {
    const mint = new PublicKey(order.mint);
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMPFUN_PROGRAM_ID
    );
    const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurve, true);
    const userAta = getAssociatedTokenAddressSync(mint, this.wallet.publicKey);

    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await this.getPriorityFeeMicroLamports() }),
    ];

    const keys = [
      { pubkey: PUMPFUN_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    if (order.direction === "buy") {
      const ataInfo = await this.connection.getAccountInfo(userAta);
      if (!ataInfo) {
        instructions.push(createAssociatedTokenAccountInstruction(this.wallet.publicKey, userAta, this.wallet.publicKey, mint));
      }

      // pump.fun's buy instruction is exact-tokens-out, capped-cost: we
      // request `amount` tokens and cap what we're willing to pay via
      // `maxSolCost`. We don't have a direct bonding-curve price read here,
      // so the expected token amount comes from a Jupiter quote (which does
      // route pump.fun curves) purely as a size estimate for the `amount`
      // field — the real spending cap enforced on-chain is maxSolCost.
      const slippageBps = settingsStore.get().slippageBps;
      const quote = await this.jupiterQuote(SOL_MINT, order.mint, order.solLamportsIn!, slippageBps);
      const expectedTokenOut = quote ? BigInt(quote.outAmount) : 0n;
      const maxSolCost = applySlippage(order.solLamportsIn!, slippageBps, "max");

      const data = Buffer.concat([PUMPFUN_BUY_DISCRIMINATOR, encodeU64LE(expectedTokenOut), encodeU64LE(maxSolCost)]);
      instructions.push(new TransactionInstruction({ programId: PUMPFUN_PROGRAM_ID, keys, data }));
    } else {
      const minSolOutput = await this.estimatePumpFunMinSellProceeds(order);
      const data = Buffer.concat([PUMPFUN_SELL_DISCRIMINATOR, encodeU64LE(order.tokenRawAmountIn!), encodeU64LE(minSolOutput)]);
      instructions.push(new TransactionInstruction({ programId: PUMPFUN_PROGRAM_ID, keys, data }));
    }

    if (settingsStore.get().jitoBlockEngineUrl) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: pickJitoTipAccount(),
          lamports: Number(settingsStore.jitoTipLamports),
        })
      );
    }

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    return new VersionedTransaction(message);
  }

  private async estimatePumpFunMinSellProceeds(order: SizedOrder): Promise<bigint> {
    // Best-effort via Jupiter quote purely to derive a sane minSolOutput
    // floor for slippage protection — execution still goes direct to the
    // pump.fun program above, this call is never itself submitted.
    const slippageBps = settingsStore.get().slippageBps;
    const quote = await this.jupiterQuote(order.mint, SOL_MINT, order.tokenRawAmountIn!, slippageBps);
    const expected = quote ? BigInt(quote.outAmount) : 0n;
    return applySlippage(expected, slippageBps, "min");
  }

  private async sendViaRpc(tx: VersionedTransaction): Promise<string> {
    const signature = await this.connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    await this.connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  private async sendViaJito(tx: VersionedTransaction): Promise<string> {
    const serialized = bs58.encode(tx.serialize());
    const res = await fetch(`${settingsStore.get().jitoBlockEngineUrl}/api/v1/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[serialized]] }),
    });
    if (!res.ok) throw new Error(`Jito bundle submission failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { error?: unknown };
    if (body.error) throw new Error(`Jito error: ${JSON.stringify(body.error)}`);
    // Bundle accepted for inclusion — this is the tx signature to watch for
    // landing confirmation (the bundle ID Jito returns is a separate thing).
    return bs58.encode(tx.signatures[0]);
  }
}
