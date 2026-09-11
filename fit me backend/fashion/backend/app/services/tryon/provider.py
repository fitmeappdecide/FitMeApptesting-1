from abc import ABC, abstractmethod
from typing import List, Literal, Mapping, Any
from pydantic import BaseModel

class TryOnResult(BaseModel):
    """Standardised result returned by any Try‑On provider.
    The API always expects a list of image URLs, even though the MVP returns exactly one.
    """
    image_urls: List[str]
    provider_name: str
    processing_time_seconds: float | None = None
    metadata: Mapping[str, Any] | None = None

class TryOnProvider(ABC):
    """Abstract interface for a Virtual Try‑On provider.
    Implementations must be async and return a :class:`TryOnResult`.
    """

    @abstractmethod
    async def generate_tryon(
        self,
        user_image_url: str,
        garment_image_url: str,
        *,
        garment_type: Literal["top", "bottom", "dress", "saree", "full_body", "shoes"] | None = None,
    ) -> TryOnResult:
        """Generate a try‑on image.
        Args:
            user_image_url: URL (file:// or http(s)://) pointing at the user picture.
            garment_image_url: URL (file:// or http(s)://) pointing at the product picture.
            garment_type: Optional hint about the garment category.
        Returns:
            A :class:`TryOnResult` containing at least one image URL.
        """
        raise NotImplementedError
