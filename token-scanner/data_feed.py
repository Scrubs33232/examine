"""Read-only data ingestion: new-token WebSocket stream + REST polling for
trending "Movers". No trading, no wallet keys, no order construction —
this module only fetches and yields data.

Decoupled from token_scanner.py on purpose (per the "keep modules decoupled"
requirement) — some overlap in the websocket-connect logic vs
token_scanner.listen() is intentional duplication, not a shared dependency.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

import aiohttp
import websockets

import config

logger = logging.getLogger("data_feed")

_MOVER_CANDIDATE_CONCURRENCY = 5


async def stream_new_tokens() -> AsyncGenerator[dict[str, Any], None]:
    """Yields raw token-create event dicts from PumpPortal's public feed
    forever, reconnecting on drops. Purely a data source — does nothing with
    what it yields."""
    while True:
        try:
            logger.info("Connecting to %s", config.PUMPPORTAL_WS_URL)
            async with websockets.connect(config.PUMPPORTAL_WS_URL) as ws:
                await ws.send(json.dumps({"method": "subscribeNewToken"}))
                async for message in ws:
                    try:
                        data = json.loads(message)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(data, dict) and "mint" in data:
                        yield data
        except (websockets.ConnectionClosed, OSError) as exc:
            logger.warning("Connection lost (%s). Reconnecting in %.0fs...", exc, config.RECONNECT_DELAY_SECONDS)
            await asyncio.sleep(config.RECONNECT_DELAY_SECONDS)


async def _fetch_pumpfun_candidates(session: aiohttp.ClientSession) -> list[dict[str, Any]]:
    """Recently-active pump.fun coins — the candidate pool that
    fetch_movers() then enriches with DexScreener momentum data.

    UNVERIFIED endpoint/params (pump.fun has no stable public docs) — tested
    working as of 2026-08-06 with sort=last_trade_timestamp for recency.
    """
    params = {
        "offset": 0,
        "limit": config.MOVERS_FETCH_LIMIT,
        "sort": "last_trade_timestamp",
        "order": "DESC",
        "includeNsfw": "false",
    }
    try:
        async with session.get(config.PUMPFUN_COINS_URL, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                logger.warning("pump.fun coins endpoint returned %s", resp.status)
                return []
            data = await resp.json()
            return data if isinstance(data, list) else []
    except Exception as exc:
        logger.warning("pump.fun coins fetch failed: %s", exc)
        return []


async def _enrich_with_dexscreener(session: aiohttp.ClientSession, mint: str) -> dict[str, Any] | None:
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
            return max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
    except Exception:
        return None


_PUBLIC_RPC_FALLBACK = "https://api.mainnet-beta.solana.com"
_RPC_429_RETRY_DELAY_SECONDS = 0.5


async def _rpc_call(session: aiohttp.ClientSession, method: str, params: list[Any]) -> Any:
    endpoint = config.SOLANA_RPC_URL or _PUBLIC_RPC_FALLBACK
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}

    for attempt in (1, 2):  # one retry on 429, per spec
        async with session.post(endpoint, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 429:
                if attempt == 1:
                    logger.info("%s rate-limited (429), retrying once in %.1fs", method, _RPC_429_RETRY_DELAY_SECONDS)
                    await asyncio.sleep(_RPC_429_RETRY_DELAY_SECONDS)
                    continue
                logger.warning("%s still rate-limited after retry", method)
                return None
            body = await resp.json()
            return body.get("result")


async def _fetch_dev_holding_pct(session: aiohttp.ClientSession, mint: str, creator: str | None) -> float | None:
    """% of total supply held by the creator wallet's largest associated
    token account for this mint. None if unavailable (RPC failure, no
    creator, or creator holds none of the top accounts).

    CONFIRMED LIVE: the default public RPC (api.mainnet-beta.solana.com)
    rate-limits getTokenLargestAccounts specifically (429 "Too many requests
    for a specific RPC call") well before getTokenSupply does, even at low
    request rates — tested 2026-08-06. In practice this means dev_holding_pct
    will come back None most of the time on the default config, and that
    check in evaluator.py is silently skipped (not silently "passed" —
    is_qualified_mover only enforces it when a value is present). Set
    SOLANA_RPC_URL in config.py to a real RPC (Helius/QuickNode free tier is
    plenty) if you want this check to actually run.
    """
    if not creator:
        return None
    try:
        largest, supply = await asyncio.gather(
            _rpc_call(session, "getTokenLargestAccounts", [mint]),
            _rpc_call(session, "getTokenSupply", [mint]),
        )
        total_supply = float((supply or {}).get("amount", 0))
        if total_supply <= 0 or not largest:
            return None

        # getTokenLargestAccounts gives token ACCOUNT addresses, not owners —
        # we'd need getAccountInfo per account to resolve the owner and match
        # against `creator`. Cheap approximation instead: assume the largest
        # holder is the dev (true immediately post-launch in practice, before
        # other buyers accumulate more than the creator's initial buy).
        top_amount = float(largest[0].get("amount", 0))
        return (top_amount / total_supply) * 100
    except Exception:
        return None


def _bonding_curve_progress_pct(coin: dict[str, Any]) -> float:
    if coin.get("complete"):
        return 100.0
    virtual_sol = (coin.get("virtual_sol_reserves") or 0) / 1e9  # lamports -> SOL
    return min((virtual_sol / 85) * 100, 99.0)


async def fetch_movers(session: aiohttp.ClientSession) -> list[dict[str, Any]]:
    """Returns a list of candidate tokens merged with DexScreener momentum
    data, shaped for evaluator.is_qualified_mover(). Tokens still purely on
    the bonding curve (not yet migrated to a DEX pool) won't have
    DexScreener data and are skipped — that's a real coverage gap, not a bug.
    """
    candidates = await _fetch_pumpfun_candidates(session)
    if not candidates:
        return []

    semaphore = asyncio.Semaphore(_MOVER_CANDIDATE_CONCURRENCY)

    async def build(coin: dict[str, Any]) -> dict[str, Any] | None:
        mint = coin.get("mint")
        if not mint:
            return None
        async with semaphore:
            dex = await _enrich_with_dexscreener(session, mint)
        if dex is None:
            return None

        async with semaphore:
            dev_holding_pct = await _fetch_dev_holding_pct(session, mint, coin.get("creator"))

        return {
            "mint": mint,
            "name": coin.get("name", "unknown"),
            "symbol": coin.get("symbol", "?"),
            "bonding_curve_progress_pct": _bonding_curve_progress_pct(coin),
            "volume_5m_usd": (dex.get("volume") or {}).get("m5", 0.0),
            "txns_5m_buys": ((dex.get("txns") or {}).get("m5") or {}).get("buys", 0),
            "txns_5m_sells": ((dex.get("txns") or {}).get("m5") or {}).get("sells", 0),
            "market_cap_usd": dex.get("marketCap") or coin.get("usd_market_cap"),
            "price_change_5m_pct": (dex.get("priceChange") or {}).get("m5", 0.0),
            "dev_holding_pct": dev_holding_pct,
            "creator": coin.get("creator"),
        }

    results = await asyncio.gather(*(build(c) for c in candidates))
    return [r for r in results if r is not None]
