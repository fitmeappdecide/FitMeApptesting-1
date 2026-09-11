import os
from .provider import TryOnProvider, TryOnResult
from .vertex_provider import VertexProvider
from .fashn_provider import FashnProvider

_providers: dict[str, TryOnProvider] = {}

def get_tryon_provider() -> TryOnProvider:
    """Factory that returns the active persistent Try‑On provider
    for the current process. Reuses singletons to enable HTTP connection pooling.
    """
    provider_name = os.getenv("TRYON_PROVIDER", "vertex").lower()
    if provider_name not in _providers:
        if provider_name == "vertex":
            _providers[provider_name] = VertexProvider()
        elif provider_name == "fashn":
            _providers[provider_name] = FashnProvider()
        else:
            raise ValueError(f"Unsupported TRYON_PROVIDER: {provider_name}")
    return _providers[provider_name]
