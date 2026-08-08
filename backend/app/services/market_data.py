"""Fetches live market data from prediction market platforms.

Polymarket, Manifold, and PredictIt expose public read APIs, so those are
called directly. Kalshi's public API requires authentication for most
markets, so we fall back to best-effort HTML scraping there (and for any
platform whose API call fails).
"""

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup

from app.core import cache
from app.services.platform import ParsedUrl, detect_platform

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ExamineBot/0.1; +https://example.com)"}
_TIMEOUT = 10.0
_CACHE_TTL_SECONDS = 120  # odds move fast; keep this short


@dataclass
class MarketData:
    platform: str
    market_id: str | None
    question: str
    yes_probability: float
    no_probability: float
    volume: float | None = None
    liquidity: float | None = None
    close_date: str | None = None
    source: str = "api"  # "api" | "scrape" | "fallback"
    extra: dict = field(default_factory=dict)


class MarketExtractionError(Exception):
    pass


def _cache_key(url: str) -> str:
    return f"market:{hashlib.sha256(url.encode()).hexdigest()}"


async def fetch_market(url: str) -> MarketData:
    key = _cache_key(url)
    cached = await cache.get_json(key)
    if cached:
        return MarketData(**cached)

    parsed = detect_platform(url)

    fetchers = {
        "polymarket": _fetch_polymarket,
        "manifold": _fetch_manifold,
        "predictit": _fetch_predictit,
        "kalshi": _fetch_kalshi,
    }

    fetcher = fetchers.get(parsed.platform)
    result: MarketData | None = None
    if fetcher:
        try:
            result = await fetcher(parsed)
        except Exception:
            result = None  # fall through to generic scrape

    if result is None:
        result = await _fallback_scrape(url, parsed.platform)

    await cache.set_json(key, asdict(result), _CACHE_TTL_SECONDS)
    return result


def _polymarket_market_to_data(market: dict, *, event_title: str | None = None) -> MarketData:
    prices = market.get("outcomePrices")
    if isinstance(prices, str):
        prices = json.loads(prices)
    prices = [float(p) for p in (prices or [0.5, 0.5])]
    yes_prob = prices[0]
    no_prob = prices[1] if len(prices) > 1 else 1 - yes_prob

    question = market.get("question") or event_title or market.get("slug", "")
    # Multi-outcome events (e.g. "Fed Decision in September?") share one event
    # slug across several distinct yes/no contracts ("cut 25bps", "cut 50bps",
    # "no change", ...). Prefix with the event title so both the UI and the AI
    # know exactly which specific contract these odds describe, rather than
    # presenting a bare sub-question that reads as if it were the whole event.
    if event_title and event_title.strip().rstrip("?") not in question:
        question = f"{event_title.rstrip('?')} — {question}"

    return MarketData(
        platform="polymarket",
        market_id=market.get("conditionId") or market.get("slug"),
        question=question,
        yes_probability=min(max(yes_prob, 0.001), 0.999),
        no_probability=min(max(no_prob, 0.001), 0.999),
        volume=float(market["volume"]) if market.get("volume") else None,
        liquidity=float(market["liquidity"]) if market.get("liquidity") else None,
        close_date=market.get("endDate"),
    )


async def _fetch_polymarket(parsed: ParsedUrl) -> MarketData:
    if not parsed.slug_or_id:
        raise MarketExtractionError("no slug")

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        resp = await client.get(
            "https://gamma-api.polymarket.com/markets",
            params={"slug": parsed.slug_or_id},
        )
        resp.raise_for_status()
        data = resp.json()

        if data:
            return _polymarket_market_to_data(data[0])

        # No market has this exact slug — likely because the URL points at a
        # multi-outcome *event* (e.g. "Fed Decision in September?", which
        # bundles 5 separate yes/no contracts: cut 25bps, cut 50bps, no
        # change, hike 25bps, hike 50bps). The event slug never matches any
        # individual market slug in that case. Resolve the event instead and
        # pick its highest-volume contract, so the question and odds we hand
        # to the AI actually describe the same specific outcome — rather than
        # falling through to the generic HTML scrape below, which has no way
        # to know which of several unrelated percentages on the page is the
        # relevant one and previously produced confidently mismatched results.
        resp = await client.get(f"https://gamma-api.polymarket.com/events/slug/{parsed.slug_or_id}")
        if resp.status_code == 200:
            event = resp.json()
            markets = event.get("markets") or []
            if markets:
                best = max(markets, key=lambda m: float(m.get("volume") or 0))
                return _polymarket_market_to_data(best, event_title=event.get("title"))

    raise MarketExtractionError("market not found")


async def _fetch_manifold(parsed: ParsedUrl) -> MarketData:
    if not parsed.slug_or_id:
        raise MarketExtractionError("no slug")

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        resp = await client.get(f"https://api.manifold.markets/v0/slug/{parsed.slug_or_id}")
        resp.raise_for_status()
        market = resp.json()

    yes_prob = float(market.get("probability", 0.5))

    return MarketData(
        platform="manifold",
        market_id=market.get("id"),
        question=market.get("question", parsed.slug_or_id),
        yes_probability=yes_prob,
        no_probability=1 - yes_prob,
        volume=float(market["volume"]) if market.get("volume") else None,
        close_date=(
            datetime.fromtimestamp(market["closeTime"] / 1000, tz=timezone.utc).date().isoformat()
            if market.get("closeTime")
            else None
        ),
    )


async def _fetch_predictit(parsed: ParsedUrl) -> MarketData:
    if not parsed.slug_or_id:
        raise MarketExtractionError("no id")

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        resp = await client.get(f"https://www.predictit.org/api/marketdata/markets/{parsed.slug_or_id}")
        resp.raise_for_status()
        market = resp.json()

    contracts = market.get("contracts", [])
    if not contracts:
        raise MarketExtractionError("no contracts")

    # PredictIt markets are often multi-contract; treat the leading contract
    # as the "yes" side of a binary framing (does the top contract happen?).
    top = max(contracts, key=lambda c: c.get("lastTradePrice") or 0)
    yes_prob = float(top.get("lastTradePrice") or 0.5)

    return MarketData(
        platform="predictit",
        market_id=str(market.get("id")),
        question=f"{market.get('name')} — {top.get('name')}",
        yes_probability=yes_prob,
        no_probability=1 - yes_prob,
        close_date=market.get("timeStamp"),
        extra={"contracts": [c.get("name") for c in contracts]},
    )


_KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"  # unauthenticated, covers all categories despite the name


def _kalshi_market_to_data(market: dict) -> MarketData:
    # Prefer last traded price; fall back to the bid/ask midpoint if untraded.
    last_price = float(market.get("last_price_dollars") or 0)
    yes_bid = float(market.get("yes_bid_dollars") or 0)
    yes_ask = float(market.get("yes_ask_dollars") or 0)
    if last_price > 0:
        yes_prob = last_price
    elif yes_bid or yes_ask:
        yes_prob = (yes_bid + yes_ask) / 2 if (yes_bid and yes_ask) else (yes_bid or yes_ask)
    else:
        yes_prob = 0.5

    title = re.sub(r"\*\*(.*?)\*\*", r"\1", market.get("title") or market.get("ticker", ""))

    volume = market.get("volume_fp")
    liquidity = market.get("liquidity_dollars")

    return MarketData(
        platform="kalshi",
        market_id=market.get("ticker"),
        question=title,
        yes_probability=min(max(yes_prob, 0.001), 0.999),
        no_probability=1 - min(max(yes_prob, 0.001), 0.999),
        volume=float(volume) if volume else None,
        liquidity=float(liquidity) if liquidity else None,
        close_date=market.get("close_time"),
    )


async def _fetch_kalshi(parsed: ParsedUrl) -> MarketData:
    if not parsed.slug_or_id:
        raise MarketExtractionError("no ticker")

    path_parts = parsed.path_parts or []
    ticker_candidates = []
    if parsed.fragment:
        ticker_candidates.append(parsed.fragment.upper())
    ticker_candidates.append(parsed.slug_or_id.upper())

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        for ticker in ticker_candidates:
            resp = await client.get(f"{_KALSHI_API}/markets/{ticker}")
            if resp.status_code == 200:
                market = resp.json().get("market")
                if market:
                    return _kalshi_market_to_data(market)

        # Direct ticker guesses failed — the last path segment is usually a
        # human-readable slug, not a ticker. Try it as a series ticker instead
        # (e.g. /markets/kxhighny/... -> series "KXHIGHNY") and pick the
        # highest-volume open market in that series.
        series_candidate = path_parts[1] if len(path_parts) >= 2 and path_parts[0] == "markets" else None
        if series_candidate:
            resp = await client.get(
                f"{_KALSHI_API}/markets",
                params={"series_ticker": series_candidate.upper(), "status": "open", "limit": 50},
            )
            if resp.status_code == 200:
                markets = resp.json().get("markets", [])
                if markets:
                    best = max(markets, key=lambda m: float(m.get("volume_fp") or 0))
                    return _kalshi_market_to_data(best)

    raise MarketExtractionError("could not resolve a Kalshi market from this URL")


_BOT_CHECK_MARKERS = (
    "security checkpoint",
    "just a moment",
    "attention required",
    "checking your browser",
    "captcha",
    "access denied",
    "are you a robot",
)


async def _fallback_scrape(url: str, platform: str) -> MarketData:
    """Best-effort HTML scrape used when a platform's API is unavailable
    (e.g. an unrecognized platform/URL)."""
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    title_tag = soup.find("meta", property="og:title") or soup.find("title")
    question = title_tag.get("content") if title_tag and title_tag.has_attr("content") else None
    if not question:
        question = title_tag.text.strip() if title_tag else url

    if any(marker in question.lower() for marker in _BOT_CHECK_MARKERS):
        raise MarketExtractionError(
            f"{platform} blocks automated page access (got a bot-check page instead of market content)"
        )

    # Look for a percentage anywhere on the page as a rough odds proxy.
    match = re.search(r"(\d{1,3})\s?%", resp.text)
    yes_prob = min(max(int(match.group(1)) / 100, 0.01), 0.99) if match else 0.5

    return MarketData(
        platform=platform,
        market_id=None,
        question=question,
        yes_probability=yes_prob,
        no_probability=1 - yes_prob,
        source="scrape" if match else "fallback",
    )
