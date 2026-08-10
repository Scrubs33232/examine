"""
FOMO / momentum breakout detection.

Turns raw OHLCV candles into a boolean trade signal by requiring ALL of:
  1. Volume spike   - current candle volume > N-period volume SMA * multiplier.
  2. RSI breakout   - RSI(period) > threshold (overbought / strong momentum).
  3. Price velocity - % price change over the last X candles exceeds threshold.

Multi-indicator confirmation (rather than any single trigger) is deliberate:
it filters out illiquid noise spikes that satisfy only one condition.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import StrategyConfig
from logger import get_logger

log = get_logger("strategy")

OHLCV_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]


@dataclass
class FomoSignal:
    symbol: str
    triggered: bool
    price: float
    timestamp: int
    volume: float
    volume_ma: float
    volume_ratio: float
    rsi: float
    price_change_pct: float
    reason: str = ""


def candles_to_frame(candles: list[list[float]]) -> pd.DataFrame:
    df = pd.DataFrame(candles, columns=OHLCV_COLUMNS)
    return df


def compute_rsi(close: pd.Series, period: int) -> pd.Series:
    """Wilder's RSI."""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    # Where avg_loss is 0 and avg_gain > 0, RSI is 100 (pure uptrend).
    rsi = rsi.where(avg_loss != 0, 100.0)
    return rsi


def detect_fomo_signal(symbol: str, candles: list[list[float]], cfg: StrategyConfig) -> FomoSignal:
    """
    Evaluate the latest CLOSED candle against the FOMO criteria.

    `candles` must be sorted oldest -> newest, as returned by CCXT `fetch_ohlcv`.
    We evaluate on the second-to-last row when the exchange includes the
    still-forming current candle; callers pass however many candles they trust
    to be closed. This function itself just looks at the last row provided.
    """
    min_len = max(cfg.volume_ma_period, cfg.rsi_period, cfg.price_velocity_lookback) + 1
    if len(candles) < min_len:
        return FomoSignal(
            symbol=symbol, triggered=False, price=0.0, timestamp=0,
            volume=0.0, volume_ma=0.0, volume_ratio=0.0, rsi=0.0,
            price_change_pct=0.0, reason=f"insufficient candle history ({len(candles)}/{min_len})",
        )

    df = candles_to_frame(candles)
    df["volume_ma"] = df["volume"].rolling(window=cfg.volume_ma_period).mean()
    df["rsi"] = compute_rsi(df["close"], cfg.rsi_period)

    last = df.iloc[-1]
    lookback_close = df["close"].iloc[-(cfg.price_velocity_lookback + 1)]
    price_change_pct = (last["close"] - lookback_close) / lookback_close * 100 if lookback_close else 0.0

    volume_ratio = last["volume"] / last["volume_ma"] if last["volume_ma"] else 0.0

    volume_spike = volume_ratio > cfg.volume_spike_multiplier
    rsi_breakout = last["rsi"] > cfg.rsi_breakout_threshold
    velocity_breakout = price_change_pct > cfg.price_velocity_threshold_pct

    triggered = bool(volume_spike and rsi_breakout and velocity_breakout)

    reasons = []
    if not volume_spike:
        reasons.append(f"volume_ratio {volume_ratio:.2f}x <= {cfg.volume_spike_multiplier}x")
    if not rsi_breakout:
        reasons.append(f"rsi {last['rsi']:.1f} <= {cfg.rsi_breakout_threshold}")
    if not velocity_breakout:
        reasons.append(f"price_change {price_change_pct:.2f}% <= {cfg.price_velocity_threshold_pct}%")
    reason = "all criteria met" if triggered else "; ".join(reasons)

    signal = FomoSignal(
        symbol=symbol,
        triggered=triggered,
        price=float(last["close"]),
        timestamp=int(last["timestamp"]),
        volume=float(last["volume"]),
        volume_ma=float(last["volume_ma"]),
        volume_ratio=float(volume_ratio),
        rsi=float(last["rsi"]),
        price_change_pct=float(price_change_pct),
        reason=reason,
    )

    if triggered:
        log.info(
            "FOMO signal on %s: price=%.6f vol_ratio=%.2fx rsi=%.1f price_chg=%.2f%%",
            symbol, signal.price, signal.volume_ratio, signal.rsi, signal.price_change_pct,
        )
    else:
        log.debug("No signal on %s (%s)", symbol, reason)

    return signal
