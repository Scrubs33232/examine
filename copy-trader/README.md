# copy-trader

Mirrors a target Solana wallet's Pump.fun/Raydium buys and sells, sized
proportionally to the bot's own wallet, and executes them automatically —
**no per-trade confirmation.** Read the whole "Before you run this with real
money" section before funding the bot wallet.

## How it works

1. **`listener.ts`** subscribes to the target wallet(s) via a raw
   `logsSubscribe` websocket with manual reconnect/backoff. When a watched
   wallet's transaction mentions the Pump.fun or Raydium program, it fetches
   the full transaction and diffs the target's pre/post SOL and token
   balances to determine direction, mint, and size — this works regardless
   of which DEX or instruction shape produced the trade, rather than trying
   to decode each one.
2. **`calculator.ts`** turns that into a sized order for the bot's own
   wallet: buys spend `min(BUY_PORTFOLIO_PERCENT% of spendable balance,
   BUY_SOL_CAP)`; sells sell the *same fraction* of the bot's token balance
   that the target sold of theirs.
3. **`executor.ts`** builds the swap (Jupiter v6 for Raydium-routed trades,
   direct pump.fun bonding-curve instructions otherwise), attaches a
   priority fee from `getRecentPrioritizationFees`, runs execution guards
   (mint/freeze authority, liquidity/price-impact probe), and submits — via
   a Jito bundle if `JITO_BLOCK_ENGINE_URL` is set, otherwise directly to
   your RPC.
4. **`security.ts`** handles AES-256-GCM key encryption at rest and a
   startup balance-guard warning.
5. **`bot.ts`** wraps 1–4 in a start/stop-able controller with a structured,
   in-memory event log (trade detections, sizing decisions, execution
   results) that both the terminal and the control API read from. While
   running, it also polls open positions roughly every 15s for independent
   **stop-loss / take-profit** — mirroring a target's own sells (via
   `calculator.ts`) is the *only* other exit path, so a target that holds
   long-term, goes quiet, or a token that rugs while they're still holding
   would otherwise never get exited. Off by default; enable and set
   thresholds from the website's Copy Trader settings panel.
6. **`api.ts`** — a small unauthenticated local HTTP + SSE server
   (`GET /api/status`, `GET /api/trades`, `POST /api/start`, `POST
   /api/stop`, `GET /api/stream`) that backs the website's **Copy Trader**
   page (`/copy-trader` in the frontend). Not authenticated, same as the
   rest of this app's local dev servers — don't expose `API_PORT` beyond
   localhost without adding auth first, since `/api/start` puts real funds
   at risk.
7. **`index.ts`** wires it all together and boots the API server.

## Before you run this with real money

- **There is no per-trade confirmation.** Once running live, a parsing bug,
  a bad target trade, a rugged mint, or an RPC hiccup can lose money with no
  human in the loop. Fund the bot wallet with only what you're fully
  prepared to lose — that's what `MAX_SAFE_WALLET_SOL` warns about, not a
  hard cap.
- **The pump.fun instruction layout in `executor.ts` needs verification.**
  Pump.fun doesn't publish an official versioned IDL, and the program has
  changed before. The program ID, account list, and instruction
  discriminators here are reconstructed from public documentation — test
  with a trivial amount (e.g. `BUY_SOL_CAP=0.01`) before trusting it with
  anything larger, and re-verify if pump.fun ships a program upgrade.
- **Copy-trading a target doesn't guarantee similar results.** You'll always
  be at least one confirmation behind the target's fill, sizing is
  proportional not identical, and thin bonding-curve liquidity means your
  slippage can differ meaningfully from theirs.
- **Public RPC is not sufficient for this.** `logsSubscribe` on public
  endpoints drops under load and rate-limits. Use a premium provider
  (Helius, Triton, QuickNode, ...) for both `RPC_HTTPS_URL` and
  `RPC_WSS_URL`.
- **Start with `DRY_RUN=true`** even though it isn't the default, to confirm
  the listener is correctly detecting and sizing trades against real target
  activity before any capital is at risk. It logs exactly what it would have
  executed without sending anything on-chain.

## Setup

```bash
cd copy-trader
npm install
cp .env.example .env
```

1. Generate an encryption key and paste it into `.env` as `WALLET_ENCRYPTION_KEY`:
   ```bash
   npm run generate-encryption-key
   ```
2. Create (or reuse) a **dedicated burner wallet** for the bot — do not point
   this at a wallet holding meaningful funds. `solana-keygen new -o
   bot-wallet-raw.json` if you need a new one.
3. Encrypt it:
   ```bash
   npm run encrypt-key -- ./bot-wallet-raw.json
   ```
   This writes the encrypted key to `ENCRYPTED_KEY_PATH` (default
   `./bot-wallet.enc.json`, gitignored). Delete or archive
   `bot-wallet-raw.json` afterward — it's the one unencrypted key file in
   this whole system.
4. Fill in `.env`: `RPC_HTTPS_URL`, `RPC_WSS_URL`, `TARGET_WALLETS`,
   `BOT_WALLET_PUBKEY` (the bot wallet's own address, as a load-safety
   check), and review the sizing/risk bounds.
5. Fund the bot wallet with a small amount of SOL.
6. Run it:
   ```bash
   npm run dev
   ```
   This starts the bot (per `AUTO_START`) and the control API on `API_PORT`
   (default `8787`). Open the frontend's **Copy Trader** page
   (`http://localhost:3000/copy-trader`) to watch status and the live trade
   feed, and to start/stop it.

## Config reference

See `.env.example` for the full list. The ones that matter most:

| Var | What it controls |
|---|---|
| `DRY_RUN` | `true` = log sized trades without sending them. Defaults to `false`. |
| `BUY_SOL_CAP` / `BUY_PORTFOLIO_PERCENT` | Buy sizing: whichever is smaller of a fixed SOL cap or a % of spendable balance. |
| `SLIPPAGE_BPS` | Slippage bound applied to every swap (200 = 2%). |
| `MIN_LIQUIDITY_SOL` / `MAX_PRICE_IMPACT_PCT` | Execution guard: refuses a trade if a probe swap of this size would move price more than this. |
| `MAX_SAFE_WALLET_SOL` | Startup warning threshold — not a hard block. |
| `JITO_BLOCK_ENGINE_URL` | Set to submit via Jito bundles instead of your RPC directly. |
| Stop-loss / take-profit | UI-managed only (no `.env` var) — off by default. Independently exits a position on % loss/gain vs. cost basis, checked every ~15s while the bot is running. See the website's settings panel. |

## What this doesn't do

- No web UI or database — console-logged only, matching the requested
  deliverable. `index.ts` is a reasonable place to add persistence if you
  want a trade history.
- No multi-wallet fund pooling or custody of anyone else's keys — this is
  built for a single operator running their own bot wallet.
- No backtesting harness. Validate target-wallet selection and sizing
  parameters in `DRY_RUN` mode against real live activity before going live.
