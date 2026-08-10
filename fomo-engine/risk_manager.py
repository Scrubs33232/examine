"""
Risk management: position sizing, exit rules, and the daily drawdown circuit
breaker. This module never talks to the exchange directly - it only makes
decisions based on balances and prices it is given, so it can be unit tested
in isolation and so a bug here can never accidentally place an order.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from config import RiskConfig
from logger import get_logger

log = get_logger("risk_manager")


class ExitReason(Enum):
    TAKE_PROFIT = "take_profit"
    TRAILING_STOP = "trailing_stop"


@dataclass
class Position:
    symbol: str
    entry_price: float
    amount: float
    cost: float
    opened_at: datetime
    highest_price: float
    stop_price: float
    take_profit_price: float

    def update_trailing_stop(self, current_price: float, trailing_stop_pct: float) -> None:
        if current_price > self.highest_price:
            self.highest_price = current_price
            self.stop_price = self.highest_price * (1 - trailing_stop_pct / 100)

    def check_exit(self) -> ExitReason | None:
        # Evaluated by the caller against the latest price via `evaluate`.
        raise NotImplementedError

    def evaluate(self, current_price: float) -> ExitReason | None:
        if current_price >= self.take_profit_price:
            return ExitReason.TAKE_PROFIT
        if current_price <= self.stop_price:
            return ExitReason.TRAILING_STOP
        return None


class CircuitBreakerTripped(Exception):
    """Raised (informationally) when the daily drawdown limit halts trading."""


class RiskManager:
    def __init__(self, config: RiskConfig):
        self.config = config
        self.open_positions: dict[str, Position] = {}
        self._daily_baseline_balance: float | None = None
        self._daily_baseline_date: str | None = None
        self._halted = False
        self._halt_reason: str = ""

    # ------------------------------------------------------------------ #
    # Daily circuit breaker
    # ------------------------------------------------------------------ #
    def _today_key(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def observe_balance(self, current_total_balance: float) -> None:
        """Call once per loop iteration with the current mark-to-market wallet value."""
        today = self._today_key()
        if self._daily_baseline_date != today:
            self._daily_baseline_date = today
            self._daily_baseline_balance = current_total_balance
            self._halted = False
            self._halt_reason = ""
            log.info("New trading day (%s). Daily baseline balance set to %.2f", today, current_total_balance)
            return

        if self._daily_baseline_balance is None or self._daily_baseline_balance <= 0:
            return

        drawdown_pct = (self._daily_baseline_balance - current_total_balance) / self._daily_baseline_balance * 100
        if drawdown_pct >= self.config.max_daily_drawdown_pct and not self._halted:
            self._halted = True
            self._halt_reason = (
                f"Daily drawdown {drawdown_pct:.2f}% >= limit {self.config.max_daily_drawdown_pct}% "
                f"(baseline {self._daily_baseline_balance:.2f} -> current {current_total_balance:.2f})"
            )
            log.error("CIRCUIT BREAKER TRIPPED: %s. All new trading halted until next UTC day.", self._halt_reason)

    @property
    def is_halted(self) -> bool:
        return self._halted

    @property
    def halt_reason(self) -> str:
        return self._halt_reason

    # ------------------------------------------------------------------ #
    # Position sizing & entry gating
    # ------------------------------------------------------------------ #
    def calculate_position_size(self, total_balance: float, available_quote_balance: float) -> float:
        """Return the quote-currency amount to allocate to a new position, or 0 if none should be opened."""
        target = total_balance * (self.config.max_position_pct / 100)
        spendable = available_quote_balance - self.config.min_reserve_quote_balance
        return max(0.0, min(target, spendable))

    def can_open_position(self, symbol: str, quote_amount: float) -> tuple[bool, str]:
        if self._halted:
            return False, f"trading halted: {self._halt_reason}"
        if symbol in self.open_positions:
            return False, f"position already open for {symbol}"
        if len(self.open_positions) >= self.config.max_open_positions:
            return False, f"max open positions reached ({self.config.max_open_positions})"
        if quote_amount <= 0:
            return False, "calculated position size is zero (insufficient free/reserve balance)"
        return True, ""

    def register_position(self, symbol: str, entry_price: float, amount: float, cost: float) -> Position:
        position = Position(
            symbol=symbol,
            entry_price=entry_price,
            amount=amount,
            cost=cost,
            opened_at=datetime.now(timezone.utc),
            highest_price=entry_price,
            stop_price=entry_price * (1 - self.config.trailing_stop_pct / 100),
            take_profit_price=entry_price * (1 + self.config.take_profit_pct / 100),
        )
        self.open_positions[symbol] = position
        log.info(
            "Opened position %s: entry=%.6f amount=%.6f stop=%.6f take_profit=%.6f",
            symbol, entry_price, amount, position.stop_price, position.take_profit_price,
        )
        return position

    def close_position(self, symbol: str) -> Position | None:
        return self.open_positions.pop(symbol, None)

    # ------------------------------------------------------------------ #
    # Exit evaluation
    # ------------------------------------------------------------------ #
    def evaluate_exits(self, prices: dict[str, float]) -> list[tuple[str, ExitReason]]:
        """Given latest prices for open symbols, update trailing stops and return exits to execute."""
        exits: list[tuple[str, ExitReason]] = []
        for symbol, position in self.open_positions.items():
            price = prices.get(symbol)
            if price is None:
                continue
            position.update_trailing_stop(price, self.config.trailing_stop_pct)
            reason = position.evaluate(price)
            if reason is not None:
                log.info("Exit signal for %s: %s at price %.6f", symbol, reason.value, price)
                exits.append((symbol, reason))
        return exits
