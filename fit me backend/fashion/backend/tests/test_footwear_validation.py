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
async def test_vertex_provider_rejects_shoes():
    provider = VertexProvider()
    with pytest.raises(RuntimeError, match="Footwear try-on"):
        await provider.generate_tryon(
            user_image_url="http://example.com/user.jpg",
            garment_image_url="http://example.com/shoe.jpg",
            garment_type="shoes",
        )
