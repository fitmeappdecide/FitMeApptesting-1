"""
Real API Integration Test Suite for POST /api/v1/ava/chat.
Executes Prompts A through J directly against the FastAPI AVA Router.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_live_ava_api_prompts_a_to_j(override_deps_for_tests):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Test A: "Suggest me an outfit for college."
        res_a = await client.post("/api/v1/ava/chat", json={"message": "Suggest me an outfit for college."})
        assert res_a.status_code == 200
        data_a = res_a.json()
        assert data_a["intent"] == "outfit_recommendation"
        assert len(data_a["outfits"]) > 0

        # Test B: "Suggest me an ethnic wedding outfit under ₹5000."
        res_b = await client.post("/api/v1/ava/chat", json={"message": "Suggest me an ethnic wedding outfit under ₹5000."})
        assert res_b.status_code == 200
        data_b = res_b.json()
        assert data_b["outfits"][0]["total_price"] <= 5000.0

        # Test C: "Suggest me a college outfit from Myntra under ₹2500."
        res_c = await client.post("/api/v1/ava/chat", json={"message": "Suggest me a college outfit from Myntra under ₹2500."})
        assert res_c.status_code == 200
        data_c = res_c.json()
        assert data_c["outfits"][0]["total_price"] <= 2500.0

        # Test D: "Suggest me a wedding outfit only from AJIO under ₹5000."
        res_d = await client.post("/api/v1/ava/chat", json={"message": "Suggest me a wedding outfit only from AJIO under ₹5000."})
        assert res_d.status_code == 200
        data_d = res_d.json()
        for item in data_d["outfits"][0]["items"]:
            assert "ajio" in (item.get("seller") or "").lower() or "ajio" in (item.get("url") or "").lower()

        # Test E: "Find this outfit under ₹3000."
        res_e = await client.post("/api/v1/ava/chat", json={"message": "Find this outfit under ₹3000."})
        assert res_e.status_code == 200

        # Test F: "Make the first outfit cheaper."
        res_f = await client.post("/api/v1/ava/chat", json={"message": "Make the first outfit cheaper.", "selected_outfit": data_c["outfits"][0]})
        assert res_f.status_code == 200
        data_f = res_f.json()
        assert data_f["intent"] == "make_cheaper"

        # Test G: "Change the shoes."
        res_g = await client.post("/api/v1/ava/chat", json={"message": "Change the shoes.", "selected_outfit": data_c["outfits"][0]})
        assert res_g.status_code == 200
        data_g = res_g.json()
        assert data_g["intent"] == "swap_item"

        # Test H: "Where is this outfit cheapest?"
        res_h = await client.post("/api/v1/ava/chat", json={"message": "Where is this outfit cheapest?", "selected_outfit": data_c["outfits"][0]})
        assert res_h.status_code == 200
        data_h = res_h.json()
        assert data_h["intent"] == "price_comparison"

        # Test I: "Try the first outfit on me."
        res_i = await client.post("/api/v1/ava/chat", json={"message": "Try the first outfit on me.", "selected_outfit": data_c["outfits"][0]})
        assert res_i.status_code == 200
        data_i = res_i.json()
        assert data_i["intent"] == "try_on"

        # Test J: "Complete my look using this kurta."
        res_j = await client.post("/api/v1/ava/chat", json={"message": "Complete my look using this kurta."})
        assert res_j.status_code == 200
        data_j = res_j.json()
        assert len(data_j["outfits"]) > 0
