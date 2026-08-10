# FOMO Engine

A modular momentum/breakout trading bot that quantifies "FOMO" into a
multi-indicator signal (volume spike + RSI breakout + price velocity) and
executes it under strict, configurable risk controls.

**Ships with `DRY_RUN=true` by default.** In dry-run mode the engine trades
against a local simulated wallet using real live prices — no order that could
touch real funds is ever sent to the exchange.

## Project layout

```
fomo-engine/
├── config.py        # env loading, validation, all tunable parameters
├── exchange.py       # CCXT wrapper: market data, safe order placement, paper wallet
├── strategy.py        # FOMO breakout signal detection (volume/RSI/velocity)
├── risk_manager.py    # position sizing, trailing stop/take-profit, drawdown breaker
├── logger.py           # secret-redacting logging setup
├── main.py              # async event loop tying it all together
├── requirements.txt
├── .env.example
└── .gitignore
```

## Setup

```bash
cd fomo-engine
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # then edit .env with your exchange + parameters
```

Edit `.env`:
- Leave `DRY_RUN=true` while testing. Real credentials are only required when `DRY_RUN=false`.
- Set `EXCHANGE_ID` to any CCXT-supported exchange id (`binance`, `kraken`, `coinbase`, `kucoin`, ...).
- `USE_EXCHANGE_SANDBOX=true` targets the exchange's testnet/sandbox where supported.

## Run

```bash
python main.py
```

Logs stream to stdout and to `logs/fomo_engine.log` (rotating, 5MB x 5 backups).
API keys/secrets are redacted from every log line automatically.

## Strategy

A breakout signal fires only when **all three** conditions are true on the
latest closed candle for a pair:

| Trigger | Condition |
|---|---|
| Volume spike | `volume > SMA(volume, VOLUME_MA_PERIOD) * VOLUME_SPIKE_MULTIPLIER` |
| Momentum | `RSI(RSI_PERIOD) > RSI_BREAKOUT_THRESHOLD` |
| Price velocity | `% change over PRICE_VELOCITY_LOOKBACK_CANDLES > PRICE_VELOCITY_THRESHOLD_PCT` |

Requiring all three (rather than any one) filters out illiquid single-candle
noise that would otherwise generate false positives.

## Risk controls

- **Position sizing** — each new position is capped at `MAX_POSITION_PCT` of
  total wallet value, and never dips into the `MIN_RESERVE_QUOTE_BALANCE`.
- **Max concurrent positions** — `MAX_OPEN_POSITIONS`.
- **Daily circuit breaker** — if mark-to-market wallet value drops more than
  `MAX_DAILY_DRAWDOWN_PCT` versus the balance recorded at the start of the UTC
  day, all new entries halt until the next UTC day. Existing exit orders
  (stop-loss/take-profit) still process normally.
- **Trailing stop-loss** — `TRAILING_STOP_PCT` below the highest price seen
  since entry.
- **Take-profit** — hard exit at `TAKE_PROFIT_PCT` above entry.
- **Slippage protection** — an order is rejected if the live price has moved
  more than `MAX_SLIPPAGE_PCT` from the price the signal was generated at.
- **Balance checks** — live orders re-verify available balance immediately
  before submission.

## Going live

Going live is entirely your decision and your responsibility — this project
does not do it for you. When you're ready:

1. Validate extensively in `DRY_RUN=true` mode and/or on the exchange's sandbox
   (`USE_EXCHANGE_SANDBOX=true`).
2. Use an API key scoped to **trading only** (no withdrawal permission) on the
   exchange.
3. Set `DRY_RUN=false` and fill in real `EXCHANGE_API_KEY` / `EXCHANGE_API_SECRET`.
4. Start with small values for `MAX_POSITION_PCT` and `PAPER_WALLET_QUOTE_BALANCE`-scale
   capital before scaling up.

This is not financial advice and carries real risk of loss. Momentum/breakout
strategies are particularly exposed to whipsaws and exchange latency — test
thoroughly.
