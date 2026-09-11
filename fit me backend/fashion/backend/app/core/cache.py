import json
import logging
from typing import Any

from redis.asyncio import Redis

from app.core.config import settings

logger = logging.getLogger(__name__)

redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
_memory_cache: dict[str, Any] = {}


async def cache_get_json(key: str) -> dict[str, Any] | list[Any] | None:
    try:
        value = await redis_client.get(key)
        if value is None:
            return _memory_cache.get(key)
        return json.loads(value)
    except Exception:
        return _memory_cache.get(key)


async def cache_set_json(key: str, value: dict[str, Any] | list[Any], ttl_seconds: int) -> None:
    _memory_cache[key] = value
    try:
        await redis_client.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception:
        pass


async def cache_delete(key: str) -> None:
    _memory_cache.pop(key, None)
    try:
        await redis_client.delete(key)
    except Exception:
        pass


