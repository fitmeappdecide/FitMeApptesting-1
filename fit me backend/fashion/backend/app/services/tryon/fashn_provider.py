import os
from .provider import TryOnProvider, TryOnResult

class FashnProvider(TryOnProvider):
    """Stub implementation for the Fashn virtual try‑on provider.
    The real integration will be added later.
    """

    def __init__(self) -> None:
        # Placeholder for any required configuration
        self.api_key = os.getenv("FASHN_API_KEY")

    async def generate_tryon(
        self,
        user_image_url: str,
        garment_image_url: str,
        *,
        garment_type: str | None = None,
    ) -> TryOnResult:
        raise NotImplementedError(
            "FashnProvider.generate_tryon not implemented – pending integration"
        )
