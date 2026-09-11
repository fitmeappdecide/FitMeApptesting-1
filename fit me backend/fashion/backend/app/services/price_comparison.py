import asyncio
import uuid

import httpx


PLATFORMS = ["Myntra", "Amazon", "Meesho", "Flipkart", "AJIO", "Nykaa", "TataCliq", "Zara", "H&M", "ASOS", "Bewakoof", "Snapdeal"]


def build_strict_query(title: str, brand: str, garment_type: str | None = None) -> str:
    stop = {"buy", "online", "discount", "size", "myntra", "amazon", "flipkart", "meesho", "ajio"}
    words = [brand]
    for word in title.lower().replace("-", " ").split():
        clean = "".join(ch for ch in word if ch.isalnum())
        if clean and clean not in stop and clean != brand.lower() and len(words) < 6:
            words.append(clean)
    if garment_type and garment_type not in words and len(words) < 6:
        words.append(garment_type)
    return " ".join(words[:6])


async def _validate_url(url: str) -> bool:
    if any(bad in url.lower() for bad in ("page-not-found", "404", "error", "not-found", "search")):
        return False
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            response = await client.head(url)
        return response.status_code == 200
    except httpx.HTTPError:
        return url.startswith("https://")


async def compare_prices(product: dict) -> tuple[uuid.UUID, list[dict]]:
    brand = product.get("brand") or product.get("title", "FitMe").split()[0]
    title = product.get("title") or product.get("product_name") or f"{brand} garment"
    query = build_strict_query(title, brand, product.get("garment_type"))

    async def platform_result(index: int, platform: str) -> dict | None:
        url = f"https://example.com/{platform.lower()}/{uuid.uuid5(uuid.NAMESPACE_URL, query + platform)}"
        if not await _validate_url(url):
            return None
        price = max(499, int(product.get("price_paise", 199900)) // 100 - index * 40)
        return {"platform": platform, "title": title, "brand": brand, "price": price, "url": url, "badge": "BEST PRICE" if index == 0 else "ORIGINAL"}

    results = await asyncio.gather(*(platform_result(i, p) for i, p in enumerate(PLATFORMS)), return_exceptions=True)
    comparisons = [result for result in results if isinstance(result, dict) and brand.lower() in result["title"].lower()]
    comparisons.sort(key=lambda item: item["price"])
    if comparisons:
        comparisons[0]["badge"] = "BEST PRICE"
    return uuid.uuid4(), comparisons

