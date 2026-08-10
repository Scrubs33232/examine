"""
FOMO Engine - main asynchronous event loop.

Continuously polls configured pairs for OHLCV data, evaluates the FOMO
breakout strategy, manages open-position exits (trailing stop / take profit),
and enforces risk limits (position sizing, max open positions, daily drawdown
circuit breaker) before any order is placed.

Run with:
    python main.py

Safe by default: DRY_RUN=true in `.env` means every "order" is simulated
against a local paper wallet and NO network call that could move real funds
is ever made.
"""

from __future__ import annotations

import asyncio
import signal
import sys
from dataclasses import asdict

from config import Config, ConfigError, load_config
from exchange import ExchangeClient, OrderRejected
from logger import get_logger, setup_logging
from risk_manager import ExitReason, RiskManager
from strategy import detect_fomo_signal

log = get_logger("main")


class FomoEngine:
    def __init__(self, config: Config):
        self.config = config
        self.exchange = ExchangeClient(config)
        self.risk = RiskManager(config.risk)
        self._shutdown_event = asyncio.Event()
        self._iteration = 0
        self._signals_seen = 0
        self._trades_executed = 0

    async def start(self) -> None:
        self._log_startup_banner()
        await self.exchange.connect()
        try:
            await self._run_loop()
        finally:
            await self.exchange.close()
            self._log_shutdown_summary()

    def request_shutdown(self) -> None:
        log.info("Shutdown requested, finishing current iteration...")
        self._shutdown_event.set()

    async def _run_loop(self) -> None:
        while not self._shutdown_event.is_set():
            self._iteration += 1
            started = asyncio.get_event_loop().time()
            try:
                await self._run_iteration()
            except Exception:
                # A single bad iteration should never crash the whole engine;
                # log with full traceback and keep the loop alive.
                log.exception("Unhandled error during iteration %s", self._iteration)

            elapsed = asyncio.get_event_loop().time() - started
            remaining = max(0.0, self.config.poll_interval_seconds - elapsed)
            try:
                await asyncio.wait_for(self._shutdown_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                pass  # normal case: time for the next poll

    async def _run_iteration(self) -> None:
        total_balance = await self._estimate_total_balance()
        self.risk.observe_balance(total_balance)

        if self.risk.is_halted:
            log.warning("Trading halted (%s). Skipping new entries this iteration.", self.risk.halt_reason)

        latest_prices: dict[str, float] = {}
        for symbol in self.config.trading_pairs:
            try:
                price = await self.exchange.fetch_ticker_price(symbol)
                latest_prices[symbol] = price
            except Exception:
                log.exception("Failed to fetch ticker for %s; skipping this pair this iteration.", symbol)

        await self._manage_exits(latest_prices)

        if not self.risk.is_halted:
            await self._scan_for_entries(total_balance)

        log.info(
            "Iteration %s complete. open_positions=%s balance=%.2f signals_seen=%s trades=%s",
            self._iteration, len(self.risk.open_positions), total_balance,
            self._signals_seen, self._trades_executed,
        )

    async def _estimate_total_balance(self) -> float:
        quote_balance = await self.exchange.fetch_quote_balance()
        positions_value = 0.0
        for pos in self.risk.open_positions.values():
            positions_value += pos.amount * (await self._safe_price(pos.symbol))
        return quote_balance + positions_value

    async def _safe_price(self, symbol: str) -> float:
        try:
            return await self.exchange.fetch_ticker_price(symbol)
        except Exception:
            log.warning("Could not refresh price for %s during balance estimate.", symbol)
            return 0.0

    async def _manage_exits(self, latest_prices: dict[str, float]) -> None:
        exits = self.risk.evaluate_exits(latest_prices)
        for symbol, reason in exits:
            position = self.risk.open_positions.get(symbol)
            if position is None:
                continue
            try:
                result = await self.exchange.create_market_sell_order(symbol, position.amount)
                self.risk.close_position(symbol)
                self._trades_executed += 1
                pnl = result.cost - position.cost
                log.info(
                    "Closed %s via %s: sold %.6f @ %.6f, proceeds=%.2f pnl=%.2f",
                    symbol, reason.value, result.amount, result.price, result.cost, pnl,
                )
            except OrderRejected as exc:
                log.error("Exit order for %s rejected, will retry next iteration: %s", symbol, exc)
            except Exception:
                log.exception("Unexpected error closing position %s", symbol)

    async def _scan_for_entries(self, total_balance: float) -> None:
        for symbol in self.config.trading_pairs:
            try:
                candles = await self.exchange.fetch_ohlcv(
                    symbol, self.config.timeframe,
                    limit=max(
                        self.config.strategy.volume_ma_period,
                        self.config.strategy.rsi_period,
                        self.config.strategy.price_velocity_lookback,
                    ) + 5,
                )
            except Exception:
                log.exception("Failed to fetch OHLCV for %s; skipping.", symbol)
                continue

            signal = detect_fomo_signal(symbol, candles, self.config.strategy)
            if not signal.triggered:
                continue

            self._signals_seen += 1
            await self._attempt_entry(symbol, signal, total_balance)

    async def _attempt_entry(self, symbol: str, signal, total_balance: float) -> None:
        available = await self.exchange.fetch_quote_balance()
        quote_amount = self.risk.calculate_position_size(total_balance, available)
        allowed, reason = self.risk.can_open_position(symbol, quote_amount)
        if not allowed:
            log.info("Signal on %s not acted on: %s", symbol, reason)
            return

        try:
            result = await self.exchange.create_market_buy_order(symbol, quote_amount, signal.price)
        except OrderRejected as exc:
            log.warning("Entry order for %s rejected: %s", symbol, exc)
            return
        except Exception:
            log.exception("Unexpected error placing entry order for %s", symbol)
            return

        self.risk.register_position(symbol, result.price, result.amount, result.cost)
        self._trades_executed += 1

    def _log_startup_banner(self) -> None:
        mode = "DRY RUN (paper trading)" if self.config.dry_run else "LIVE TRADING - REAL FUNDS AT RISK"
        log.info("=" * 70)
        log.info("FOMO Engine starting | mode=%s | exchange=%s", mode, self.config.credentials.exchange_id)
        log.info("Pairs: %s | timeframe=%s | poll=%ss",
                  ", ".join(self.config.trading_pairs), self.config.timeframe, self.config.poll_interval_seconds)
        log.info(
            "Risk: max_position=%.1f%% max_open=%s daily_drawdown_limit=%.1f%% "
            "trailing_stop=%.1f%% take_profit=%.1f%%",
            self.config.risk.max_position_pct, self.config.risk.max_open_positions,
            self.config.risk.max_daily_drawdown_pct, self.config.risk.trailing_stop_pct,
            self.config.risk.take_profit_pct,
        )
        if not self.config.dry_run:
            log.warning("DRY_RUN is FALSE. This engine WILL place real orders with real funds.")
        log.info("=" * 70)

    def _log_shutdown_summary(self) -> None:
        log.info(
            "FOMO Engine stopped. iterations=%s signals_seen=%s trades_executed=%s open_positions=%s",
            self._iteration, self._signals_seen, self._trades_executed, len(self.risk.open_positions),
        )


async def _amain() -> None:
    try:
        config = load_config()
    except ConfigError as exc:
        print(f"Configuration error:\n{exc}", file=sys.stderr)
        sys.exit(1)

    setup_logging(config.log_level, config.log_file)

    engine = FomoEngine(config)

    loop = asyncio.get_running_loop()
    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, engine.request_shutdown)
        await engine.start()
    else:
        # add_signal_handler is unavailable on Windows event loops; fall back
        # to catching KeyboardInterrupt around the run.
        try:
            await engine.start()
        except KeyboardInterrupt:
            engine.request_shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(_amain())
    except KeyboardInterrupt:
        pass
