"""Read-only pump.fun new-token scanner and alerter.

Connects to PumpPortal's public data WebSocket, evaluates each new token
launch against configurable thresholds, and sends alerts (console + optional
Discord/Telegram) for anything that passes. Strictly informational: this
file contains no wallet keys, no trading API calls, and no transaction
signing — it never places or is capable of placing a trade. You decide what
to do with each alert, manually, in your own wallet.

VERIFIED 2026-08-06: connected to the live feed and confirmed the message
shape below against real "create" events — mint/symbol/name/uri, dev spend
in `solAmount` (SOL), NOT `initialBuy` (that field is token units, not SOL —
an easy mistake, worth double-checking if you ever see suspiciously huge
"SOL" amounts), and `vSolInBondingCurve` for bonding-curve depth. pump.fun
doesn't publish stable versioned docs though, so this can still drift over
time — if alerts stop firing or fields show as "unknown"/0, set RAW_LOG=True
below to inspect a live raw message and adjust `parse_token_event`.

Run: python token_scanner.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import aiohttp
import websockets
from colorama import Fore, Style, just_fix_windows_console

# Token names are arbitrary user-supplied UTF-8 (emoji, accents, etc.) — avoid
# UnicodeEncodeError / mangled output on Windows consoles defaulting to cp1252.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

import config

just_fix_windows_console()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("token_scanner")

RAW_LOG = False  # set True to print every raw websocket message for debugging


@dataclass
class TokenEvent:
    mint: str
    symbol: str
    name: str
    initial_buy_sol: float
    bonding_curve_sol: float
    uri: str
    raw: dict[str, Any]

    @property
    def dexscreener_url(self) -> str:
        return f"https://dexscreener.com/solana/{self.mint}"

    @property
    def pumpfun_url(self) -> str:
        return f"https://pump.fun/{self.mint}"

    @property
    def solscan_url(self) -> str:
        return f"https://solscan.io/token/{self.mint}"


def parse_token_event(data: dict[str, Any]) -> TokenEvent | None:
    mint = data.get("mint")
    if not mint:
        return None

    def _float(key: str) -> float:
        try:
            return float(data.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    return TokenEvent(
        mint=mint,
        symbol=data.get("symbol", "?"),
        name=data.get("name", "unknown"),
        initial_buy_sol=_float("solAmount"),  # "initialBuy" is token units, not SOL — verified against live feed
        bonding_curve_sol=_float("vSolInBondingCurve"),
        uri=data.get("uri", ""),
        raw=data,
    )


def evaluate_token(token: TokenEvent) -> bool:
    """Returns True if this token passes every configured threshold.
    Edit/extend this function to change what triggers an alert."""
    if token.initial_buy_sol < config.MIN_DEV_BUY_SOL:
        return False
    if token.bonding_curve_sol < config.MIN_BONDING_CURVE_SOL:
        return False
    return True


class SeenCache:
    """Bounded dedupe set so we don't re-alert on the same mint, without
    growing memory forever on a long-running process."""

    def __init__(self, max_size: int) -> None:
        self._max_size = max_size
        self._order: deque[str] = deque()
        self._set: set[str] = set()

    def seen_before(self, mint: str) -> bool:
        return mint in self._set

    def mark_seen(self, mint: str) -> None:
        if mint in self._set:
            return
        self._set.add(mint)
        self._order.append(mint)
        if len(self._order) > self._max_size:
            oldest = self._order.popleft()
            self._set.discard(oldest)


def print_console_alert(token: TokenEvent) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(
        f"\n{Fore.GREEN}{Style.BRIGHT}[{ts}] NEW TOKEN MATCH: "
        f"{token.name} ({token.symbol}){Style.RESET_ALL}\n"
        f"  mint:            {token.mint}\n"
        f"  dev initial buy: {token.initial_buy_sol:.3f} SOL\n"
        f"  bonding curve:   {token.bonding_curve_sol:.3f} SOL\n"
        f"  {Fore.CYAN}DexScreener: {token.dexscreener_url}{Style.RESET_ALL}\n"
        f"  {Fore.CYAN}Pump.fun:    {token.pumpfun_url}{Style.RESET_ALL}\n"
        f"  {Fore.CYAN}Solscan:     {token.solscan_url}{Style.RESET_ALL}"
    )


async def send_discord_alert(session: aiohttp.ClientSession, token: TokenEvent) -> None:
    if not config.DISCORD_WEBHOOK_URL:
        return
    embed = {
        "title": f"New token: {token.name} ({token.symbol})",
        "description": f"`{token.mint}`",
        "color": 0x22E0A0,
        "fields": [
            {"name": "Dev initial buy", "value": f"{token.initial_buy_sol:.3f} SOL", "inline": True},
            {"name": "Bonding curve", "value": f"{token.bonding_curve_sol:.3f} SOL", "inline": True},
            {
                "name": "Links",
                "value": f"[DexScreener]({token.dexscreener_url}) · [Pump.fun]({token.pumpfun_url}) · [Solscan]({token.solscan_url})",
            },
        ],
    }
    try:
        async with session.post(config.DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status >= 300:
                logger.warning("Discord webhook returned %s", resp.status)
    except Exception as exc:
        logger.warning("Discord webhook failed: %s", exc)


async def send_telegram_alert(session: aiohttp.ClientSession, token: TokenEvent) -> None:
    if not config.TELEGRAM_BOT_TOKEN or not config.TELEGRAM_CHAT_ID:
        return
    text = (
        f"*New token:* {token.name} ({token.symbol})\n"
        f"`{token.mint}`\n"
        f"Dev buy: {token.initial_buy_sol:.3f} SOL · Bonding curve: {token.bonding_curve_sol:.3f} SOL\n"
        f"[DexScreener]({token.dexscreener_url}) · [Pump.fun]({token.pumpfun_url}) · [Solscan]({token.solscan_url})"
    )
    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": config.TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
    }
    try:
        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status >= 300:
                logger.warning("Telegram webhook returned %s", resp.status)
    except Exception as exc:
        logger.warning("Telegram webhook failed: %s", exc)


async def handle_token_event(session: aiohttp.ClientSession, cache: SeenCache, data: dict[str, Any]) -> None:
    token = parse_token_event(data)
    if token is None:
        return
    if cache.seen_before(token.mint):
        return
    cache.mark_seen(token.mint)

    if not evaluate_token(token):
        return

    print_console_alert(token)
    await asyncio.gather(
        send_discord_alert(session, token),
        send_telegram_alert(session, token),
    )


async def listen() -> None:
    cache = SeenCache(config.MAX_SEEN_CACHE)

    async with aiohttp.ClientSession() as session:
        while True:
            try:
                logger.info("Connecting to %s", config.PUMPPORTAL_WS_URL)
                async with websockets.connect(config.PUMPPORTAL_WS_URL) as ws:
                    await ws.send(json.dumps({"method": "subscribeNewToken"}))
                    logger.info("Subscribed to new token events. Waiting for launches...")

                    async for message in ws:
                        if RAW_LOG:
                            print(message)
                        try:
                            data = json.loads(message)
                        except json.JSONDecodeError:
                            continue

                        # PumpPortal sends non-token control/status messages too;
                        # only handle payloads that look like a token event.
                        if isinstance(data, dict) and "mint" in data:
                            await handle_token_event(session, cache, data)

            except (websockets.ConnectionClosed, OSError) as exc:
                logger.warning("Connection lost (%s). Reconnecting in %.0fs...", exc, config.RECONNECT_DELAY_SECONDS)
                await asyncio.sleep(config.RECONNECT_DELAY_SECONDS)


def main() -> None:
    print(f"{Fore.GREEN}{Style.BRIGHT}token_scanner.py — read-only monitor. No trading, no wallet keys.{Style.RESET_ALL}")
    print(f"Filters: dev buy >= {config.MIN_DEV_BUY_SOL} SOL, bonding curve >= {config.MIN_BONDING_CURVE_SOL} SOL\n")
    try:
        asyncio.run(listen())
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
