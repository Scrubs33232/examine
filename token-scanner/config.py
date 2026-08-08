"""Configuration for token_scanner.py. No trading keys, wallet keys, or
execution endpoints belong in this file — this tool only reads a public data
feed and sends notifications.
"""

# --- PumpPortal public data feed ---
PUMPPORTAL_WS_URL: str = "wss://pumpportal.fun/api/data"

# --- Filter thresholds ---
MIN_DEV_BUY_SOL: float = 0.5
MIN_BONDING_CURVE_SOL: float = 1.0

# --- Alert channels (leave blank to disable that channel) ---
DISCORD_WEBHOOK_URL: str = ""

TELEGRAM_BOT_TOKEN: str = ""
TELEGRAM_CHAT_ID: str = ""

# --- Behavior ---
RECONNECT_DELAY_SECONDS: float = 5.0
MAX_SEEN_CACHE: int = 5000  # bounds memory for a long-running process

# --- Movers polling (data_feed.py) ---
PUMPFUN_COINS_URL: str = "https://frontend-api-v3.pump.fun/coins"  # unverified, see data_feed.py
MOVERS_POLL_INTERVAL_SECONDS: float = 30.0
MOVERS_FETCH_LIMIT: int = 50
# Custom Solana RPC endpoint. CONFIRMED LIVE (2026-08-06): the public RPC
# 429s on getTokenLargestAccounts specifically (used for dev-holding %) well
# before other calls hit limits. Get a free API key from https://helius.dev
# or https://quicknode.com and paste the full URL below; leave blank to fall
# back to the public RPC (data_feed.py handles the fallback).
# Example: SOLANA_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY"
SOLANA_RPC_URL: str = ""

# --- Mover qualification thresholds (evaluator.py) ---
MIN_5M_VOLUME_SOL: float = 5.0
MIN_BONDING_CURVE_PROGRESS_PCT: float = 20.0
MIN_BUY_SELL_RATIO: float = 1.2  # buys / sells over the recent window
MAX_DEV_HOLDING_PCT: float = 10.0

# --- Manual position watcher (position_watcher.py) ---
# Read-only price alerts on positions YOU tell it about — it never buys or
# sells anything itself. See WATCHED_POSITIONS below.
POSITION_POLL_INTERVAL_SECONDS: float = 15.0
DEFAULT_PROFIT_TARGET_PCT: float = 25.0  # alert once price is this far above entry
DEFAULT_TRAILING_STOP_PCT: float = 10.0  # alert if price falls this far from its post-entry peak

# {mint_address: entry_price_usd} — add positions you've actually bought,
# manually, here (or via position_watcher.add_position at runtime).
WATCHED_POSITIONS: dict[str, float] = {}
