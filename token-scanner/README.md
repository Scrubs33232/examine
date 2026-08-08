# token-scanner

Read-only pump.fun monitoring and alerting tools. Nothing in this directory
trades, touches a wallet key, or has a code path capable of executing a
transaction — every module here fetches data or sends a notification, full
stop. You act on alerts manually, in your own wallet.

| File | What it does |
|---|---|
| `token_scanner.py` | Alerts on qualifying **new** pump.fun launches (WebSocket) |
| `data_feed.py` | Fetches trending **Movers** (REST poll, pump.fun + DexScreener) and exposes the new-token stream as a reusable generator |
| `evaluator.py` | Pure scoring: `is_qualified_mover()` — volume/bonding-curve/buy-sell-ratio/dev-holding checks |
| `position_watcher.py` | Alerts when a position **you** manually recorded hits a profit target or trailing stop |
| `config.py` | All thresholds and alert-channel settings |

## Setup

```bash
cd token-scanner
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Edit `config.py`:
- `MIN_DEV_BUY_SOL` / `MIN_BONDING_CURVE_SOL` — alert thresholds
- `DISCORD_WEBHOOK_URL` — optional, from a Discord channel's Integrations → Webhooks
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — optional, create a bot via [@BotFather](https://t.me/BotFather), then message your bot once and fetch your chat ID from `https://api.telegram.org/bot<TOKEN>/getUpdates`

Run:

```bash
python token_scanner.py
```

## Verified field mapping

Tested against the live feed on 2026-08-06. The one non-obvious gotcha:
`initialBuy` in PumpPortal's payload is the token amount received, **not**
SOL — the dev's actual SOL spend is in `solAmount`. This script uses
`solAmount`. If you ever see alerts with implausibly huge "SOL" amounts,
someone (possibly a future edit) swapped these back.

## Movers (`data_feed.py` + `evaluator.py`)

```python
import asyncio, aiohttp
import data_feed, evaluator

async def main():
    async with aiohttp.ClientSession() as session:
        for token in await data_feed.fetch_movers(session):
            result = evaluator.is_qualified_mover(token)
            if result.qualified:
                print(token["symbol"], "qualifies")

asyncio.run(main())
```

Only covers tokens that already have a DexScreener pair — tokens still
purely on the pump.fun bonding curve (not yet migrated to a DEX pool) won't
show up here. `dev_holding_pct` requires a real Solana RPC to work
reliably — see below.

## Position alerts (`position_watcher.py`)

```python
import asyncio
import position_watcher

position_watcher.add_position("<mint>", entry_price_usd=0.0000123)  # a trade you already made
asyncio.run(position_watcher.watch_positions())
```

Positions persist in `positions.json` between runs. `check_exit_conditions()`
is a pure function (prices in, an alert-or-None out) — it never calls
anything that could place an order.

## Get a real Solana RPC endpoint

The default `SOLANA_RPC_URL` (the public `api.mainnet-beta.solana.com`)
rate-limits fast — confirmed live that `getTokenLargestAccounts` (used for
dev-holding %) 429s well before other calls do. A free tier from
[Helius](https://helius.dev) or [QuickNode](https://quicknode.com) fixes
this; paste the URL into `config.py`.

## Notes

- pump.fun/PumpPortal don't publish stable versioned API docs, so message
  shapes can drift. If alerts stop firing, set `RAW_LOG = True` in
  `token_scanner.py` to print raw messages and check field names.
- Both `token_scanner.py` and `data_feed.py` auto-reconnect the WebSocket on
  drops.
- `evaluate_token()` (new-launch filter) and `is_qualified_mover()` (movers
  filter) are the functions to edit for different criteria.
