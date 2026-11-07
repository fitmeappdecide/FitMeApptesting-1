import pytest
from app.api.tryon import _detect_garment_type
from app.models.garment import Garment
from app.services.tryon.vertex_provider import VertexProvider

def test_detect_garment_type_footwear():
    # Test slippers, shoes, heels, boots, sandals
    for item_name in ["slipper", "wedge pumps", "leather shoes", "high heels", "ankle boots", "sandals"]:
        g = Garment(garment_type="unknown", product_name=item_name)
        detected = _detect_garment_type(g)
        assert detected == "shoes", f"Expected 'shoes' for '{item_name}', got '{detected}'"

@pytest.mark.asyncio
async def test_vertex_provider_accepts_shoes(monkeypatch):
    import io
    from PIL import Image
    from unittest.mock import MagicMock
    import app.services.tryon.vertex_provider as vp_module

    provider = VertexProvider()

    # Generate synthetic minimal PNGs
    def _create_png(w=100, h=100):
        img = Image.new("RGB", (w, h), color=(200, 200, 200))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    user_bytes = _create_png(400, 600)
    shoe_bytes = _create_png(200, 200)

    monkeypatch.setattr(vp_module, "download_user_photo", lambda path: user_bytes)
    monkeypatch.setattr(vp_module, "upload_image_to_storage", lambda *args, **kwargs: "tryon_results/test_shoes.webp")

    class MockResponse:
        content = shoe_bytes
        def raise_for_status(self):
            pass

    class MockAsyncClient:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url):
            return MockResponse()

    monkeypatch.setattr(vp_module.httpx, "AsyncClient", lambda *args, **kwargs: MockAsyncClient())

    # Mock Vertex AI client
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.generated_images = [MagicMock(image=MagicMock(image_bytes=user_bytes))]
    mock_client.models.recontext_image.return_value = mock_resp
    provider.client = mock_client

    result = await provider.generate_tryon(
        user_image_url="user-photos/test/user.jpg",
        garment_image_url="http://example.com/shoe.jpg",
        garment_type="shoes",
    )

    assert result is not None
    assert len(result.image_urls) == 1
    assert "tryon_results" in result.image_urls[0]
    assert provider.client.models.recontext_image.called
