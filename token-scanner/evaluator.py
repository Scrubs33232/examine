"""Pure scoring/filter functions over data already fetched by data_feed.py.
No I/O in this file — it just decides whether something is worth alerting on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import config


@dataclass
class MoverEvaluation:
    qualified: bool
    reasons: list[str]  # which checks failed, for logging/debugging


def is_qualified_mover(token_data: dict[str, Any]) -> MoverEvaluation:
    reasons: list[str] = []

    volume_5m = token_data.get("volume_5m_usd") or 0
    if volume_5m < config.MIN_5M_VOLUME_SOL:
        reasons.append(f"5m volume ${volume_5m:.0f} < ${config.MIN_5M_VOLUME_SOL:.0f}")

    bonding_progress = token_data.get("bonding_curve_progress_pct") or 0
    if bonding_progress < config.MIN_BONDING_CURVE_PROGRESS_PCT:
        reasons.append(f"bonding curve {bonding_progress:.0f}% < {config.MIN_BONDING_CURVE_PROGRESS_PCT:.0f}%")

    buys = token_data.get("txns_5m_buys") or 0
    sells = token_data.get("txns_5m_sells") or 0
    buy_sell_ratio = buys / sells if sells > 0 else float("inf") if buys > 0 else 0.0
    if buy_sell_ratio < config.MIN_BUY_SELL_RATIO:
        reasons.append(f"buy/sell ratio {buy_sell_ratio:.2f} < {config.MIN_BUY_SELL_RATIO:.2f}")

    dev_holding_pct = token_data.get("dev_holding_pct")
    if dev_holding_pct is not None and dev_holding_pct > config.MAX_DEV_HOLDING_PCT:
        reasons.append(f"dev holding {dev_holding_pct:.1f}% > {config.MAX_DEV_HOLDING_PCT:.1f}%")

    return MoverEvaluation(qualified=len(reasons) == 0, reasons=reasons)
