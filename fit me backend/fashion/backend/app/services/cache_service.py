import hashlib

from app.core.cache import cache_get_json, cache_set_json


def exact_tryon_key(garment_id: str, cluster_key: str) -> str:
    return "tryon:exact:" + hashlib.sha256(f"{garment_id}:{cluster_key}".encode("utf-8")).hexdigest()


def cluster_tryon_key(garment_id: str, cluster_key: str) -> str:
    return "tryon:cluster:" + hashlib.sha256(f"{garment_id}:{cluster_key}".encode("utf-8")).hexdigest()


async def find_tryon_cache(garment_id: str, cluster_key: str) -> tuple[str, list[str] | None]:
    exact = await cache_get_json(exact_tryon_key(garment_id, cluster_key))
    if isinstance(exact, list):
        return "exact", exact
    cluster = await cache_get_json(cluster_tryon_key(garment_id, cluster_key))
    if isinstance(cluster, list):
        return "cluster", cluster
    return "full", None


async def store_tryon_cache(garment_id: str, cluster_key: str, urls: list[str]) -> None:
    await cache_set_json(exact_tryon_key(garment_id, cluster_key), urls, 24 * 3600)
    await cache_set_json(cluster_tryon_key(garment_id, cluster_key), urls, 3600)

