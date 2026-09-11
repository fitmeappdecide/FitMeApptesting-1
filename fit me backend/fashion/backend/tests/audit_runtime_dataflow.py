"""
Live Data-Flow Audit Script for AVA API.
Executes Request 1 and Request 2 against POST /api/v1/ava/chat, capturing exact request/response JSON,
product-provider chains, platform constraints, and budget math verification.
"""
import json
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_audit_request_1_myntra_college():
    prompt = "Suggest me a college outfit from Myntra under ₹2500."
    print("\n" + "=" * 80)
    print(f"[AUDIT TEST 1] REQUEST: '{prompt}'")
    print("=" * 80)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        req_payload = {"message": prompt}
        print(f"[AVA UI] USER_MESSAGE: '{prompt}'")
        print(f"[AVA UI] CALLING_BACKEND: POST /api/v1/ava/chat")
        print(f"[AVA UI] REQUEST_BODY: {json.dumps(req_payload)}")

        res = await client.post("/api/v1/ava/chat", json=req_payload)
        print(f"[AVA UI] RESPONSE_STATUS: {res.status_code}")

        assert res.status_code == 200
        data = res.json()

        print("[AVA UI] RESPONSE_BODY:")
        print(json.dumps(data, indent=2))

        assert data["intent"] == "outfit_recommendation"
        assert len(data["outfits"]) > 0

        outfit = data["outfits"][0]
        items = outfit["items"]
        total_price = outfit["total_price"]

        print("\n--- PRODUCT PROVIDER CHAIN & ITEM VERIFICATION ---")
        item_prices = []
        for idx, item in enumerate(items, 1):
            title = item.get("title") or item.get("name")
            seller = item.get("seller") or item.get("retailer")
            price = item.get("price")
            url = item.get("url") or item.get("product_url")
            image = item.get("image") or item.get("image_url")

            print(f"Item {idx}:")
            print(f"  Title:    {title}")
            print(f"  Retailer: {seller}")
            print(f"  Price:    ₹{price}")
            print(f"  URL:      {url}")
            print(f"  Image:    {image}")

            assert seller and "myntra" in seller.lower(), f"Seller '{seller}' is not Myntra"
            assert url, "Product URL is missing"
            assert image, "Image URL is missing"
            item_prices.append(price)

        sum_calculated = sum(item_prices)
        print(f"\nBudget Math Verification:")
        print(f"  Sum of item prices: {' + '.join(f'₹{p}' for p in item_prices)} = ₹{sum_calculated}")
        print(f"  Reported Total Price: ₹{total_price}")
        print(f"  Budget Limit: ₹2500")

        assert total_price <= 2500.0, f"Total price ₹{total_price} exceeds budget ₹2500"
        assert sum_calculated <= 2500.0, f"Sum of items ₹{sum_calculated} exceeds budget ₹2500"
        print("✔ Request 1 Audit PASSED: Myntra Platform Constraint & Budget <= ₹2500 Verified!")


@pytest.mark.asyncio
async def test_audit_request_2_ajio_wedding():
    prompt = "Only AJIO. Give me an ethnic wedding outfit under ₹5000."
    print("\n" + "=" * 80)
    print(f"[AUDIT TEST 2] REQUEST: '{prompt}'")
    print("=" * 80)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        req_payload = {"message": prompt}
        print(f"[AVA UI] USER_MESSAGE: '{prompt}'")
        print(f"[AVA UI] CALLING_BACKEND: POST /api/v1/ava/chat")
        print(f"[AVA UI] REQUEST_BODY: {json.dumps(req_payload)}")

        res = await client.post("/api/v1/ava/chat", json=req_payload)
        print(f"[AVA UI] RESPONSE_STATUS: {res.status_code}")

        assert res.status_code == 200
        data = res.json()

        print("[AVA UI] RESPONSE_BODY:")
        print(json.dumps(data, indent=2))

        assert len(data["outfits"]) > 0

        outfit = data["outfits"][0]
        items = outfit["items"]
        total_price = outfit["total_price"]

        print("\n--- PRODUCT PROVIDER CHAIN & ITEM VERIFICATION ---")
        item_prices = []
        for idx, item in enumerate(items, 1):
            title = item.get("title") or item.get("name")
            seller = item.get("seller") or item.get("retailer")
            price = item.get("price")
            url = item.get("url") or item.get("product_url")
            image = item.get("image") or item.get("image_url")

            print(f"Item {idx}:")
            print(f"  Title:    {title}")
            print(f"  Retailer: {seller}")
            print(f"  Price:    ₹{price}")
            print(f"  URL:      {url}")
            print(f"  Image:    {image}")

            assert seller and "ajio" in seller.lower(), f"Seller '{seller}' is not AJIO"
            assert url, "Product URL is missing"
            assert image, "Image URL is missing"
            item_prices.append(price)

        sum_calculated = sum(item_prices)
        print(f"\nBudget Math Verification:")
        print(f"  Sum of item prices: {' + '.join(f'₹{p}' for p in item_prices)} = ₹{sum_calculated}")
        print(f"  Reported Total Price: ₹{total_price}")
        print(f"  Budget Limit: ₹5000")

        assert total_price <= 5000.0, f"Total price ₹{total_price} exceeds budget ₹5000"
        assert sum_calculated <= 5000.0, f"Sum of items ₹{sum_calculated} exceeds budget ₹5000"
        print("✔ Request 2 Audit PASSED: AJIO Platform Constraint & Budget <= ₹5000 Verified!")
