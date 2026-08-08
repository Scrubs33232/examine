import re
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass
class ParsedUrl:
    platform: str  # polymarket | kalshi | predictit | manifold | unknown
    slug_or_id: str | None
    path_parts: list[str] | None = None
    fragment: str | None = None


_PLATFORM_HOSTS = {
    "polymarket.com": "polymarket",
    "www.polymarket.com": "polymarket",
    "kalshi.com": "kalshi",
    "www.kalshi.com": "kalshi",
    "predictit.org": "predictit",
    "www.predictit.org": "predictit",
    "manifold.markets": "manifold",
    "www.manifold.markets": "manifold",
}


def detect_platform(url: str) -> ParsedUrl:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc.lower()
    platform = _PLATFORM_HOSTS.get(host, "unknown")
    path = parsed.path.strip("/")

    if platform == "polymarket":
        # /event/<slug> or /market/<slug>
        parts = path.split("/")
        slug = parts[-1] if parts else None
        return ParsedUrl(platform, slug)

    if platform == "manifold":
        # /<username>/<slug>
        parts = path.split("/")
        slug = parts[-1] if parts else None
        return ParsedUrl(platform, slug)

    if platform == "predictit":
        # /markets/detail/<id>/<slug>
        match = re.search(r"/markets/detail/(\d+)", path)
        return ParsedUrl(platform, match.group(1) if match else None)

    if platform == "kalshi":
        # /markets/<series>/<event-slug>#<ticker> or /markets/<series>/<event-slug>/<ticker>
        parts = [p for p in path.split("/") if p]
        slug = parts[-1] if parts else None
        return ParsedUrl(platform, slug, path_parts=parts, fragment=parsed.fragment or None)

    return ParsedUrl("unknown", None)
