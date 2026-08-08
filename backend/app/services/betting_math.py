"""Pure math for edge/EV/Kelly sizing. Kept separate from the AI call so the
arithmetic is deterministic and testable rather than trusted to model output.
"""

from dataclasses import dataclass

_MIN_EDGE_PP = 3.0  # minimum edge, in percentage points, before we recommend a side
_KELLY_SAFETY_FACTOR = 0.5  # half-Kelly, scaled further by model confidence


@dataclass
class BetMetrics:
    edge_pct: float  # percentage points, on the recommended side
    expected_value: float  # fractional return per $1 staked, on the recommended side
    kelly_fraction: float  # fraction of bankroll, already confidence/safety scaled
    recommendation: str  # "yes" | "no" | "pass"


def compute_bet_metrics(p_true: float, p_market: float, confidence: float) -> BetMetrics:
    p_true = min(max(p_true, 0.001), 0.999)
    p_market = min(max(p_market, 0.001), 0.999)

    yes_edge_pp = (p_true - p_market) * 100
    no_edge_pp = ((1 - p_true) - (1 - p_market)) * 100

    if yes_edge_pp >= no_edge_pp:
        side, edge_pp = "yes", yes_edge_pp
        ev = p_true / p_market - 1
        raw_kelly = (p_true - p_market) / (1 - p_market)
    else:
        side, edge_pp = "no", no_edge_pp
        ev = (1 - p_true) / (1 - p_market) - 1
        raw_kelly = (p_market - p_true) / p_market

    if edge_pp < _MIN_EDGE_PP:
        return BetMetrics(edge_pct=round(edge_pp, 2), expected_value=round(ev, 4), kelly_fraction=0.0, recommendation="pass")

    kelly = max(raw_kelly, 0.0) * _KELLY_SAFETY_FACTOR * confidence

    return BetMetrics(
        edge_pct=round(edge_pp, 2),
        expected_value=round(ev, 4),
        kelly_fraction=round(min(kelly, 1.0), 4),
        recommendation=side,
    )
