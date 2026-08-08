import "dotenv/config";

if (!process.env.RPC_HTTPS_URL) {
  console.error(`
copy-trader isn't configured yet — no .env file found (or it's missing values).

Quick setup, from inside copy-trader/:
  1. cp .env.example .env
  2. npm run generate-encryption-key        # paste the output into .env as WALLET_ENCRYPTION_KEY
  3. npm run encrypt-key -- <path-to-your-raw-keypair.json>
  4. Fill in RPC_HTTPS_URL / RPC_WSS_URL (a premium provider — Helius/Triton/QuickNode, not public RPC)
  5. npm run dev

See README.md for the full walkthrough. The website's Copy Trader page can't reach anything until
this process is actually running — it's a separate local process, not something the website starts.
`);
  process.exit(1);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. See .env.example.`);
  return v;
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number, got "${v}"`);
  return n;
}

function boolFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

export const config = {
  rpcHttpUrl: required("RPC_HTTPS_URL"),
  rpcWsUrl: required("RPC_WSS_URL"),

  /** Comma-separated wallet addresses to mirror, used once to seed
   * target-wallets.json on first boot. After that, the JSON file (managed
   * via the control API / website UI) is the source of truth — see
   * targetWalletStore.ts. */
  targetWalletsSeed: (process.env.TARGET_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  targetWalletsPath: process.env.TARGET_WALLETS_PATH || "./target-wallets.json",
  ledgerPath: process.env.LEDGER_PATH || "./ledger.json",

  /** Trading-parameter env vars below (DRY_RUN, BUY_SOL_CAP, SLIPPAGE_BPS,
   * etc.) are used only to seed settings.json on first boot — after that,
   * the website's Copy Trader settings panel is the source of truth. See
   * settingsStore.ts. Edit .env only to change the seed for a fresh setup. */
  settingsPath: process.env.SETTINGS_PATH || "./settings.json",

  encryptionKeyHex: required("WALLET_ENCRYPTION_KEY"),
  encryptedKeyPath: process.env.ENCRYPTED_KEY_PATH || "./bot-wallet.enc.json",
  /** Optional sanity check: if set, refuse to start if the decrypted keypair
   * doesn't match this pubkey — guards against loading the wrong key file. */
  expectedBotPubkey: process.env.BOT_WALLET_PUBKEY || null,

  /** If true, trades are sized and logged but never sent on-chain. Off by
   * default per explicit configuration — this bot executes real trades. */
  dryRun: boolFlag("DRY_RUN", false),

  buySolCapLamports: BigInt(Math.round(optionalNumber("BUY_SOL_CAP", 0.5) * 1e9)),
  buyPortfolioPercent: optionalNumber("BUY_PORTFOLIO_PERCENT", 10) / 100,
  feeBufferLamports: BigInt(Math.round(optionalNumber("FEE_BUFFER_SOL", 0.03) * 1e9)),

  slippageBps: optionalNumber("SLIPPAGE_BPS", 200),
  minLiquiditySol: optionalNumber("MIN_LIQUIDITY_SOL", 5),
  maxPriceImpactPct: optionalNumber("MAX_PRICE_IMPACT_PCT", 15) / 100,

  maxSafeWalletSol: optionalNumber("MAX_SAFE_WALLET_SOL", 2),

  jitoBlockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL || "",
  jitoTipLamports: BigInt(Math.round(optionalNumber("JITO_TIP_SOL", 0.0002) * 1e9)),

  priorityFeePercentile: optionalNumber("PRIORITY_FEE_PERCENTILE", 75),

  /** Local control API (status/start/stop/live event stream) for the website's Copy Trader page. */
  apiPort: optionalNumber("API_PORT", 8787),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  /** Start watching/executing as soon as the process boots, same as before
   * the control API existed. Set false to boot idle and require an explicit
   * POST /api/start (e.g. from the website's Start button). */
  autoStart: boolFlag("AUTO_START", true),
};

if (config.buyPortfolioPercent < 0 || config.buyPortfolioPercent > 1) {
  throw new Error("BUY_PORTFOLIO_PERCENT must be between 0 and 100");
}
if (config.slippageBps < 0 || config.slippageBps > 5000) {
  throw new Error("SLIPPAGE_BPS looks wrong (expected something like 100-300 for 1-3%)");
}
