"""Manual position price-alerting. NOT an execution engine.

You tell this module what you bought and at what price (nothing here ever
buys anything). It polls the current price and sends you a notification —
console + optional Discord/Telegram, same channels as token_scanner.py —
when your profit target or trailing-stop level is hit. You then go sell it
yourself, manually, in your own wallet. There is no function anywhere in
this file that constructs, signs, or broadcasts a transaction.

Usage:
    import position_watcher
    position_watcher.add_position("So11111...mint...", entry_price_usd=0.0000123)
    asyncio.run(position_watcher.watch_positions())
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp
from colorama import Fore, Style, just_fix_windows_console

import config

just_fix_windows_console()
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("position_watcher")

_POSITIONS_FILE = Path(__file__).parent / "positions.json"


@dataclass
class ExitAlert:
    reason: str  # "profit_target" | "trailing_stop"
    message: str


def _load_positions() -> dict[str, float]:
    positions = dict(config.WATCHED_POSITIONS)
    if _POSITIONS_FILE.exists():
        try:
            positions.update(json.loads(_POSITIONS_FILE.read_text()))
        except (json.JSONDecodeError, OSError):
            pass
    return positions


def _save_positions(positions: dict[str, float]) -> None:
    try:
        _POSITIONS_FILE.write_text(json.dumps(positions, indent=2))
    except OSError as exc:
        logger.warning("Could not persist positions.json: %s", exc)


def add_position(mint: str, entry_price_usd: float) -> None:
    """Explicit, manual call — you record a trade you already made yourself."""
    positions = _load_positions()
    positions[mint] = entry_price_usd
    _save_positions(positions)
    logger.info("Watching %s at entry price $%.8f", mint, entry_price_usd)


def remove_position(mint: str) -> None:
    positions = _load_positions()
    positions.pop(mint, None)
    _save_positions(positions)


async def _fetch_price_usd(session: aiohttp.ClientSession, mint: str) -> float | None:
    try:
        async with session.get(
            f"https://api.dexscreener.com/latest/dex/tokens/{mint}", timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            pairs = data.get("pairs") or []
            if not pairs:
                return None
            best = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
            price = best.get("priceUsd")
            return float(price) if price else None
    except Exception:
        return None


def check_exit_conditions(
    entry_price: float,
    current_price: float,
    peak_price: float,
    profit_target_pct: float = config.DEFAULT_PROFIT_TARGET_PCT,
    trailing_stop_pct: float = config.DEFAULT_TRAILING_STOP_PCT,
) -> ExitAlert | None:
    """Pure function: given prices, returns an ExitAlert to show you, or
    None. This never calls out to anything — the caller decides what to do
    with the alert, which in this module is always "print/notify"."""
    if entry_price <= 0:
        return None

    change_from_entry_pct = ((current_price - entry_price) / entry_price) * 100
    if change_from_entry_pct >= profit_target_pct:
        return ExitAlert(
            reason="profit_target",
            message=f"up {change_from_entry_pct:.1f}% from entry (target {profit_target_pct:.0f}%)",
        )

    if peak_price > entry_price:
        drawdown_from_peak_pct = ((peak_price - current_price) / peak_price) * 100
        if drawdown_from_peak_pct >= trailing_stop_pct:
            return ExitAlert(
                reason="trailing_stop",
                message=f"down {drawdown_from_peak_pct:.1f}% from peak ${peak_price:.8f} (stop {trailing_stop_pct:.0f}%)",
            )

    return None


def _print_alert(mint: str, current_price: float, alert: ExitAlert) -> None:
    color = Fore.GREEN if alert.reason == "profit_target" else Fore.YELLOW
    print(
        f"\n{color}{Style.BRIGHT}[POSITION ALERT — {alert.reason.upper()}]{Style.RESET_ALL}\n"
        f"  mint:          {mint}\n"
        f"  current price: ${current_price:.8f}\n"
        f"  {alert.message}\n"
        f"  This is a NOTIFICATION ONLY — nothing was bought or sold automatically."
    )


async def _send_discord_alert(session: aiohttp.ClientSession, mint: str, current_price: float, alert: ExitAlert) -> None:
    if not config.DISCORD_WEBHOOK_URL:
        return
    embed = {
        "title": f"Position alert: {alert.reason.replace('_', ' ')}",
        "description": f"`{mint}`\n{alert.message}\nCurrent price: ${current_price:.8f}",
        "color": 0x22E0A0 if alert.reason == "profit_target" else 0xF5A623,
    }
    try:
        await session.post(config.DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=aiohttp.ClientTimeout(total=10))
    except Exception as exc:
        logger.warning("Discord webhook failed: %s", exc)


async def watch_positions() -> None:
    peaks: dict[str, float] = {}
    alerted_this_session: set[tuple[str, str]] = set()  # (mint, reason) - avoid alert spam every poll

    async with aiohttp.ClientSession() as session:
        while True:
            positions = _load_positions()
            if not positions:
                logger.info("No positions being watched. Add one with position_watcher.add_position(mint, entry_price).")

            for mint, entry_price in positions.items():
                price = await _fetch_price_usd(session, mint)
                if price is None:
                    continue

                peaks[mint] = max(peaks.get(mint, entry_price), price)
                alert = check_exit_conditions(entry_price, price, peaks[mint])

                if alert and (mint, alert.reason) not in alerted_this_session:
                    _print_alert(mint, price, alert)
                    await _send_discord_alert(session, mint, price, alert)
                    alerted_this_session.add((mint, alert.reason))

            await asyncio.sleep(config.POSITION_POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    print(f"{Fore.GREEN}{Style.BRIGHT}position_watcher.py — alert-only. Never buys or sells anything.{Style.RESET_ALL}")
    try:
        asyncio.run(watch_positions())
    except KeyboardInterrupt:
        print("\nStopped.")
