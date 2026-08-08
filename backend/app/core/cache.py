"""Thin Redis cache wrapper. Callers must treat the cache as best-effort: if
Redis is unreachable (e.g. not running in local dev), reads/writes are
silently skipped rather than failing the request.
"""

import json

import redis.asyncio as redis

from app.core.config import get_settings

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(get_settings().redis_url, decode_responses=True, socket_connect_timeout=1)
    return _client


async def get_json(key: str) -> dict | None:
    try:
        raw = await _get_client().get(key)
    except Exception:
        return None
    return json.loads(raw) if raw else None


async def set_json(key: str, value: dict, ttl_seconds: int) -> None:
    try:
        await _get_client().set(key, json.dumps(value), ex=ttl_seconds)
    except Exception:
        pass
