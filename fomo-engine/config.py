"""
Central configuration for the FOMO Engine.

All tunable parameters and secrets are loaded from environment variables (via a
local `.env` file, never committed to source control). Nothing in this module
ever prints, logs, or returns API secrets in a readable form outside of the
`Config` object itself.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load `.env` from the project root before anything else reads os.environ.
load_dotenv(Path(__file__).resolve().parent / ".env")


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


def _get_bool(name: str, default: bool) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _get_float(name: str, default: float) -> float:
    val = os.getenv(name)
    return float(val) if val not in (None, "") else default


def _get_int(name: str, default: int) -> int:
    val = os.getenv(name)
    return int(val) if val not in (None, "") else default


def _get_list(name: str, default: list[str]) -> list[str]:
    val = os.getenv(name)
    if not val:
        return default
    return [item.strip() for item in val.split(",") if item.strip()]


@dataclass(frozen=True)
class ExchangeCredentials:
    """
    Holds exchange API credentials in memory only. `repr`/`str` are overridden
    so secrets can never leak into logs, tracebacks, or debug output.
    """

    exchange_id: str
    api_key: str
    api_secret: str
    api_password: str
    use_sandbox: bool

    def __repr__(self) -> str:  # pragma: no cover - safety, not logic
        return f"ExchangeCredentials(exchange_id={self.exchange_id!r}, api_key=***REDACTED***)"

    __str__ = __repr__


@dataclass(frozen=True)
class StrategyConfig:
    volume_ma_period: int
    volume_spike_multiplier: float
    rsi_period: int
    rsi_breakout_threshold: float
    price_velocity_lookback: int
    price_velocity_threshold_pct: float


@dataclass(frozen=True)
class RiskConfig:
    max_position_pct: float
    max_open_positions: int
    max_daily_drawdown_pct: float
    trailing_stop_pct: float
    take_profit_pct: float
    max_slippage_pct: float
    min_reserve_quote_balance: float


@dataclass(frozen=True)
class Config:
    dry_run: bool
    credentials: ExchangeCredentials
    trading_pairs: list[str]
    timeframe: str
    poll_interval_seconds: int
    strategy: StrategyConfig
    risk: RiskConfig
    paper_wallet_quote_balance: float
    paper_wallet_quote_currency: str
    log_level: str
    log_file: str

    def validate(self) -> None:
        errors: list[str] = []

        if not self.dry_run:
            if not self.credentials.api_key or "your_api_key" in self.credentials.api_key.lower():
                errors.append("EXCHANGE_API_KEY is missing or still a placeholder (required for live trading).")
            if not self.credentials.api_secret or "your_api_secret" in self.credentials.api_secret.lower():
                errors.append("EXCHANGE_API_SECRET is missing or still a placeholder (required for live trading).")

        if not self.trading_pairs:
            errors.append("TRADING_PAIRS must contain at least one symbol.")

        if not (0 < self.risk.max_position_pct <= 100):
            errors.append("MAX_POSITION_PCT must be between 0 and 100.")

        if not (0 < self.risk.max_daily_drawdown_pct <= 100):
            errors.append("MAX_DAILY_DRAWDOWN_PCT must be between 0 and 100.")

        if self.risk.trailing_stop_pct <= 0:
            errors.append("TRAILING_STOP_PCT must be positive.")

        if self.risk.take_profit_pct <= 0:
            errors.append("TAKE_PROFIT_PCT must be positive.")

        if self.strategy.volume_spike_multiplier <= 1:
            errors.append("VOLUME_SPIKE_MULTIPLIER should be > 1 to represent a meaningful spike.")

        if self.risk.max_open_positions < 1:
            errors.append("MAX_OPEN_POSITIONS must be at least 1.")

        if errors:
            raise ConfigError("Invalid configuration:\n  - " + "\n  - ".join(errors))


def load_config() -> Config:
    """Build and validate a `Config` instance from the current environment."""

    credentials = ExchangeCredentials(
        exchange_id=os.getenv("EXCHANGE_ID", "binance").strip().lower(),
        api_key=os.getenv("EXCHANGE_API_KEY", ""),
        api_secret=os.getenv("EXCHANGE_API_SECRET", ""),
        api_password=os.getenv("EXCHANGE_API_PASSWORD", ""),
        use_sandbox=_get_bool("USE_EXCHANGE_SANDBOX", True),
    )

    strategy = StrategyConfig(
        volume_ma_period=_get_int("VOLUME_MA_PERIOD", 20),
        volume_spike_multiplier=_get_float("VOLUME_SPIKE_MULTIPLIER", 3.0),
        rsi_period=_get_int("RSI_PERIOD", 14),
        rsi_breakout_threshold=_get_float("RSI_BREAKOUT_THRESHOLD", 65.0),
        price_velocity_lookback=_get_int("PRICE_VELOCITY_LOOKBACK_CANDLES", 5),
        price_velocity_threshold_pct=_get_float("PRICE_VELOCITY_THRESHOLD_PCT", 2.0),
    )

    risk = RiskConfig(
        max_position_pct=_get_float("MAX_POSITION_PCT", 3.0),
        max_open_positions=_get_int("MAX_OPEN_POSITIONS", 3),
        max_daily_drawdown_pct=_get_float("MAX_DAILY_DRAWDOWN_PCT", 5.0),
        trailing_stop_pct=_get_float("TRAILING_STOP_PCT", 1.5),
        take_profit_pct=_get_float("TAKE_PROFIT_PCT", 3.0),
        max_slippage_pct=_get_float("MAX_SLIPPAGE_PCT", 0.5),
        min_reserve_quote_balance=_get_float("MIN_RESERVE_QUOTE_BALANCE", 100.0),
    )

    config = Config(
        dry_run=_get_bool("DRY_RUN", True),
        credentials=credentials,
        trading_pairs=_get_list("TRADING_PAIRS", ["BTC/USDT"]),
        timeframe=os.getenv("TIMEFRAME", "1m"),
        poll_interval_seconds=_get_int("POLL_INTERVAL_SECONDS", 15),
        strategy=strategy,
        risk=risk,
        paper_wallet_quote_balance=_get_float("PAPER_WALLET_QUOTE_BALANCE", 10000.0),
        paper_wallet_quote_currency=os.getenv("PAPER_WALLET_QUOTE_CURRENCY", "USDT"),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        log_file=os.getenv("LOG_FILE", "logs/fomo_engine.log"),
    )

    config.validate()
    return config
