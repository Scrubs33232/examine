"""
CCXT exchange wrapper.

Responsibilities:
  * Own the single CCXT connection (REST, async).
  * Provide retrying, timeout-safe market data fetches.
  * Provide a `create_market_buy_order` / `create_market_sell_order` API that is
    IDENTICAL in shape whether DRY_RUN is on or off, so calling code never has
    to branch on the mode.
  * When DRY_RUN=True, no network call that could place an order is ever made;
    fills are simulated against a local paper wallet using live ticker prices.
  * Never log or raise exceptions containing the raw API secret.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import ccxt.async_support as ccxt

from config import Config
from logger import get_logger

log = get_logger("exchange")

# Errors that are transient and worth retrying with backoff.
RETRYABLE_ERRORS = (
    ccxt.NetworkError,
    ccxt.RequestTimeout,
    ccxt.ExchangeNotAvailable,
    ccxt.DDoSProtection,
)


class OrderRejected(Exception):
    """Raised when an order cannot be safely placed (balance, slippage, etc.)."""


@dataclass
class OrderResult:
    symbol: str
    side: str  # "buy" | "sell"
    amount: float  # base currency amount filled
    price: float  # average fill price (quote per base)
    cost: float  # amount * price, in quote currency
    order_id: str
    dry_run: bool
    timestamp: float = field(default_factory=time.time)


class PaperWallet:
    """A minimal simulated wallet used whenever DRY_RUN=True."""

    def __init__(self, quote_currency: str, quote_balance: float):
        self.quote_currency = quote_currency
        self.balances: dict[str, float] = {quote_currency: quote_balance}

    def get(self, currency: str) -> float:
        return self.balances.get(currency, 0.0)

    def apply_buy(self, base: str, quote: str, base_amount: float, quote_cost: float) -> None:
        self.balances[quote] = self.get(quote) - quote_cost
        self.balances[base] = self.get(base) + base_amount

    def apply_sell(self, base: str, quote: str, base_amount: float, quote_proceeds: float) -> None:
        self.balances[base] = self.get(base) - base_amount
        self.balances[quote] = self.get(quote) + quote_proceeds

    def total_quote_value(self, last_prices: dict[str, float]) -> float:
        """Rough mark-to-market value of the wallet in quote currency."""
        total = self.get(self.quote_currency)
        for currency, amount in self.balances.items():
            if currency == self.quote_currency or amount <= 0:
                continue
            symbol = f"{currency}/{self.quote_currency}"
            price = last_prices.get(symbol)
            if price:
                total += amount * price
        return total


async def _with_retry(coro_fn, *args, retries: int = 3, base_delay: float = 1.0, **kwargs):
    """
    Execute `coro_fn(*args, **kwargs)`, retrying transient network/rate-limit
    errors with exponential backoff. Authentication and validation errors are
    never retried since retrying them cannot succeed.
    """
    attempt = 0
    while True:
        try:
            return await coro_fn(*args, **kwargs)
        except ccxt.AuthenticationError as exc:
            # Invalid key/secret/signature - do not retry, do not leak details.
            log.error("Exchange authentication failed - check API key/secret configuration.")
            raise
        except ccxt.InsufficientFunds:
            raise
        except ccxt.InvalidOrder:
            raise
        except RETRYABLE_ERRORS as exc:
            attempt += 1
            if attempt > retries:
                log.error("Exceeded retry budget (%s attempts) for %s: %s", retries, coro_fn.__name__, exc)
                raise
            delay = base_delay * (2 ** (attempt - 1))
            log.warning(
                "Transient exchange error (%s), retrying in %.1fs [attempt %s/%s]: %s",
                type(exc).__name__, delay, attempt, retries, exc,
            )
            await asyncio.sleep(delay)
        except ccxt.RateLimitExceeded as exc:
            attempt += 1
            if attempt > retries:
                raise
            delay = max(base_delay * (2 ** (attempt - 1)), 2.0)
            log.warning("Rate limit hit, backing off %.1fs: %s", delay, exc)
            await asyncio.sleep(delay)


class ExchangeClient:
    def __init__(self, config: Config):
        self.config = config
        self.dry_run = config.dry_run
        self._exchange: ccxt.Exchange | None = None
        self.paper_wallet = PaperWallet(
            quote_currency=config.paper_wallet_quote_currency,
            quote_balance=config.paper_wallet_quote_balance,
        )
        self._last_prices: dict[str, float] = {}

    async def connect(self) -> None:
        creds = self.config.credentials
        exchange_class = getattr(ccxt, creds.exchange_id, None)
        if exchange_class is None:
            raise ValueError(f"Unknown CCXT exchange id: {creds.exchange_id!r}")

        options: dict[str, Any] = {
            "enableRateLimit": True,
            "timeout": 15_000,
        }
        # Only attach credentials when we might actually need to sign requests
        # (private endpoints for real balance checks). In DRY_RUN we still allow
        # connecting with credentials so operators can rehearse against sandbox
        # balances, but never place real orders.
        if creds.api_key:
            options["apiKey"] = creds.api_key
            options["secret"] = creds.api_secret
            if creds.api_password:
                options["password"] = creds.api_password

        self._exchange = exchange_class(options)

        if creds.use_sandbox and hasattr(self._exchange, "set_sandbox_mode"):
            try:
                self._exchange.set_sandbox_mode(True)
                log.info("Sandbox/testnet mode enabled for %s.", creds.exchange_id)
            except Exception:
                log.warning("Exchange %s does not support sandbox mode toggling.", creds.exchange_id)

        await _with_retry(self._exchange.load_markets)
        log.info(
            "Connected to %s (dry_run=%s, sandbox=%s).",
            creds.exchange_id, self.dry_run, creds.use_sandbox,
        )

    async def close(self) -> None:
        if self._exchange is not None:
            await self._exchange.close()

    async def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[list[float]]:
        assert self._exchange is not None, "call connect() first"
        candles = await _with_retry(self._exchange.fetch_ohlcv, symbol, timeframe=timeframe, limit=limit)
        return candles

    async def fetch_ticker_price(self, symbol: str) -> float:
        assert self._exchange is not None, "call connect() first"
        ticker = await _with_retry(self._exchange.fetch_ticker, symbol)
        price = float(ticker["last"])
        self._last_prices[symbol] = price
        return price

    async def fetch_quote_balance(self) -> float:
        """Total available balance denominated in the paper/quote currency."""
        if self.dry_run:
            return self.paper_wallet.get(self.config.paper_wallet_quote_currency)

        assert self._exchange is not None, "call connect() first"
        balance = await _with_retry(self._exchange.fetch_balance)
        free = balance.get("free", {})
        return float(free.get(self.config.paper_wallet_quote_currency, 0.0))

    async def create_market_buy_order(
        self, symbol: str, quote_amount: float, reference_price: float
    ) -> OrderResult:
        """
        Spend `quote_amount` of quote currency buying `symbol` at market.
        `reference_price` is the price the signal was generated at; used for
        slippage protection. Real orders always re-check the live price and
        available balance before submitting.
        """
        base, quote = symbol.split("/")

        if self.dry_run:
            live_price = await self.fetch_ticker_price(symbol)
            self._check_slippage(reference_price, live_price)
            base_amount = quote_amount / live_price
            self.paper_wallet.apply_buy(base, quote, base_amount, quote_amount)
            log.info(
                "[DRY_RUN] Simulated BUY %.6f %s (~%.2f %s) @ %.6f",
                base_amount, base, quote_amount, quote, live_price,
            )
            return OrderResult(
                symbol=symbol, side="buy", amount=base_amount, price=live_price,
                cost=quote_amount, order_id=f"dryrun-{int(time.time() * 1000)}", dry_run=True,
            )

        assert self._exchange is not None, "call connect() first"
        live_price = await self.fetch_ticker_price(symbol)
        self._check_slippage(reference_price, live_price)

        available = await self.fetch_quote_balance()
        if available < quote_amount:
            raise OrderRejected(
                f"Insufficient {quote} balance for buy: need {quote_amount:.2f}, have {available:.2f}"
            )

        base_amount = quote_amount / live_price
        try:
            order = await _with_retry(self._exchange.create_market_buy_order, symbol, base_amount)
        except ccxt.InsufficientFunds as exc:
            raise OrderRejected(f"Exchange rejected order for insufficient funds: {exc}") from exc
        except ccxt.InvalidOrder as exc:
            raise OrderRejected(f"Exchange rejected invalid order: {exc}") from exc

        filled = float(order.get("filled") or base_amount)
        avg_price = float(order.get("average") or live_price)
        cost = float(order.get("cost") or filled * avg_price)
        log.info("LIVE BUY filled %.6f %s @ %.6f (order id %s)", filled, base, avg_price, order.get("id"))
        return OrderResult(
            symbol=symbol, side="buy", amount=filled, price=avg_price,
            cost=cost, order_id=str(order.get("id")), dry_run=False,
        )

    async def create_market_sell_order(self, symbol: str, base_amount: float) -> OrderResult:
        base, quote = symbol.split("/")

        if self.dry_run:
            live_price = await self.fetch_ticker_price(symbol)
            proceeds = base_amount * live_price
            self.paper_wallet.apply_sell(base, quote, base_amount, proceeds)
            log.info("[DRY_RUN] Simulated SELL %.6f %s (~%.2f %s) @ %.6f", base_amount, base, proceeds, quote, live_price)
            return OrderResult(
                symbol=symbol, side="sell", amount=base_amount, price=live_price,
                cost=proceeds, order_id=f"dryrun-{int(time.time() * 1000)}", dry_run=True,
            )

        assert self._exchange is not None, "call connect() first"
        try:
            order = await _with_retry(self._exchange.create_market_sell_order, symbol, base_amount)
        except ccxt.InsufficientFunds as exc:
            raise OrderRejected(f"Exchange rejected sell for insufficient funds: {exc}") from exc
        except ccxt.InvalidOrder as exc:
            raise OrderRejected(f"Exchange rejected invalid order: {exc}") from exc

        filled = float(order.get("filled") or base_amount)
        avg_price = float(order.get("average") or 0.0)
        cost = float(order.get("cost") or filled * avg_price)
        log.info("LIVE SELL filled %.6f %s @ %.6f (order id %s)", filled, base, avg_price, order.get("id"))
        return OrderResult(
            symbol=symbol, side="sell", amount=filled, price=avg_price,
            cost=cost, order_id=str(order.get("id")), dry_run=False,
        )

    def _check_slippage(self, reference_price: float, live_price: float) -> None:
        if reference_price <= 0:
            return
        drift_pct = abs(live_price - reference_price) / reference_price * 100
        if drift_pct > self.config.risk.max_slippage_pct:
            raise OrderRejected(
                f"Price moved {drift_pct:.2f}% since signal (limit {self.config.risk.max_slippage_pct}%); "
                f"reference={reference_price:.6f} live={live_price:.6f}"
            )
