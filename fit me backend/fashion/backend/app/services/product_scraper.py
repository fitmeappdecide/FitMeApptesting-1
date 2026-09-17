import hashlib
import json
import logging
import os
import re
import urllib.parse
from typing import Any, Dict, List, Optional

import httpx
try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

from app.core.cache import cache_get_json, cache_set_json
from app.core.config import settings
from app.utils.validators import normalize_url

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]


def detect_platform(url: str) -> str:
    lowered = url.lower()
    for platform in ("myntra", "amazon", "meesho", "flipkart", "ajio", "zara", "asos", "bewakoof", "snapdeal", "hm", "nykaa", "tatacliq", "lifestyle", "westside"):
        if platform in lowered:
            return platform
    return "unknown"


def parse_price(text: Any) -> Optional[str]:
    if not text:
        return None
    match = re.search(r'[\d,]+(?:\.\d+)?', str(text))
    if match:
        return match.group(0).replace(",", "")
    return None


def detect_garment_type(title: str, url: str) -> str:
    combined = f"{title} {url}".lower()
    if any(k in combined for k in ["shoe", "shoes", "slipper", "slippers", "heel", "heels", "mule", "mules", "sandal", "sandals", "flat", "flats", "boot", "boots", "sneaker", "sneakers", "footwear"]):
        return "shoes"
    if any(k in combined for k in ["kurta", "kurti", "saree", "sari", "lehenga", "salwar", "anarkali", "sherwani"]):
        return "ethnic"
    if any(k in combined for k in ["dress", "gown", "frock", "midi", "maxi", "slip"]):
        return "dress"
    if any(k in combined for k in ["shirt", "tshirt", "t-shirt", "top", "blouse", "tee", "polo", "hoodie", "sweater"]):
        return "top"
    if any(k in combined for k in ["pant", "trouser", "jean", "palazzo", "legging", "skirt", "bottom", "shorts"]):
        return "bottom"
    if any(k in combined for k in ["blazer", "jacket", "coat", "suit"]):
        return "outerwear"
    return "apparel"


async def parse_myntra(url: str) -> Optional[dict]:
    clean_url = url.split()[0].strip() if " " in url else url.strip()
    style_match = re.search(r'/(\d{6,10})(?:/buy|\.html|/|$|\?)', clean_url) or re.search(r'(\d{6,10})', clean_url)
    style_id = style_match.group(1) if style_match else None
    
    headers = {
        "User-Agent": USER_AGENTS[0],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
    }
    
    if style_id:
        try:
            api_url = f"https://www.myntra.com/gateway/v2/product/{style_id}"
            async with httpx.AsyncClient(timeout=6.0, verify=False, follow_redirects=True, headers=headers) as client:
                resp = await client.get(api_url)
                if resp.status_code == 200:
                    data = resp.json()
                    style = data.get("style", {})
                    if style:
                        p_name = style.get("name") or "Myntra Fashion Garment"
                        p_brand = style.get("brand", {}).get("name") if isinstance(style.get("brand"), dict) else (style.get("brand") or "Myntra")
                        p_price = style.get("price", {}).get("discounted") or style.get("price", {}).get("mrp") or "1499"
                        media = style.get("media", {})
                        images = []
                        for album in media.get("albums", []):
                            for img in album.get("images", []):
                                if img.get("src"):
                                    images.append({"url": img["src"], "angle": "front"})
                        if images:
                            return {
                                "title": p_name,
                                "brand": p_brand,
                                "price": str(p_price),
                                "garment_type": detect_garment_type(p_name, clean_url),
                                "images": images,
                                "url": clean_url,
                                "platform": "myntra",
                            }
        except Exception:
            pass

    return None


async def parse_flipkart(url: str) -> Optional[dict]:
    clean_url = url.split()[0].strip() if " " in url else url.strip()
    headers = {
        "User-Agent": USER_AGENTS[0],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=False, follow_redirects=True, headers=headers) as client:
            resp = await client.get(clean_url)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                og_t = (soup.find("meta", property="og:title") or {}).get("content")
                og_img = (soup.find("meta", property="og:image") or {}).get("content")
                og_p = (soup.find("meta", property="product:price:amount") or {}).get("content")
                
                for s in soup.find_all("script", type="application/ld+json"):
                    try:
                        if s.string:
                            d = json.loads(s.string)
                            if isinstance(d, list):
                                d = d[0] if len(d) > 0 else {}
                            if d.get("@type") == "Product" or "image" in d:
                                f_title = d.get("name") or og_t
                                f_img = d.get("image")
                                if isinstance(f_img, list):
                                    f_img = f_img[0]
                                f_price = d.get("offers", {}).get("price") if isinstance(d.get("offers"), dict) else og_p
                                if f_img:
                                    return {
                                        "title": f_title or "Flipkart Fashion Garment",
                                        "brand": (d.get("brand", {}).get("name") if isinstance(d.get("brand"), dict) else d.get("brand")) or "Flipkart",
                                        "price": parse_price(f_price) or "899",
                                        "garment_type": detect_garment_type(f_title or "", clean_url),
                                        "images": [{"url": f_img, "angle": "front"}],
                                        "url": clean_url,
                                        "platform": "flipkart",
                                    }
                    except Exception:
                        continue
                if og_img:
                    return {
                        "title": og_t or "Flipkart Garment",
                        "brand": og_t.split()[0] if og_t else "Flipkart",
                        "price": parse_price(og_p) or "899",
                        "garment_type": detect_garment_type(og_t or "", clean_url),
                        "images": [{"url": og_img, "angle": "front"}],
                        "url": clean_url,
                        "platform": "flipkart",
                    }
    except Exception:
        pass
    return None


async def parse_amazon_direct(url: str) -> Optional[Dict[str, Any]]:
    # Extract ASIN from Amazon URL
    asin_match = re.search(r'/(?:dp|gp/product|d)/([A-Z0-9]{10})', url)
    if asin_match:
        asin = asin_match.group(1)
        # High-res Amazon product image CDN URL
        amazon_img = f"https://images-na.ssl-images-amazon.com/images/P/{asin}.01.LZZZZZZZ.jpg"
        
        parsed_title = urllib.parse.urlparse(url).path.split("/")[1].replace("-", " ").title() if "/" in url else "Amazon Fashion Garment"
        return {
            "title": parsed_title or "Amazon Fashion Garment",
            "brand": "Amazon Fashion",
            "price": "1499",
            "garment_type": detect_garment_type(parsed_title, url),
            "images": [{"url": amazon_img, "angle": "front"}],
            "url": url,
            "platform": "amazon",
        }
    return None


async def parse_zara(soup: BeautifulSoup, url: str) -> dict:
    title = ""
    images = []
    price = None

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            if script.string:
                data = json.loads(script.string)
                if isinstance(data, list):
                    data = data[0] if len(data) > 0 else {}
                if data.get("@type") in ("Product", "ItemPage") or "image" in data:
                    title = data.get("name", "")
                    img = data.get("image")
                    if isinstance(img, list):
                        images.extend([{"url": i, "angle": f"angle-{idx+1}"} for idx, i in enumerate(img) if isinstance(i, str)])
                    elif isinstance(img, str):
                        images.append({"url": img, "angle": "front"})
                    offers = data.get("offers", {})
                    if isinstance(offers, dict):
                        price = parse_price(offers.get("price"))
        except Exception:
            continue

    if not title:
        og_t = (soup.find("meta", property="og:title") or {}).get("content")
        title = og_t or (soup.title.string if soup.title else "Zara Fashion Apparel")

    if not images:
        for tag in soup.find_all(["meta", "img"]):
            content = tag.get("content") or tag.get("src") or tag.get("data-src")
            if content and "static.zara.net/photos" in content and any(ext in content.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"]):
                images.append({"url": content, "angle": "front"})
                break

    title = re.sub(r'\s*-\s*(ZARA|Zara).*$', '', str(title), flags=re.IGNORECASE).strip()
    return {
        "title": title or "Zara Apparel",
        "brand": "Zara",
        "price": price or "4990",
        "garment_type": detect_garment_type(title, url),
        "images": images,
        "url": url,
        "platform": "zara",
    }


async def parse_ajio(soup: BeautifulSoup, url: str) -> dict:
    og_title = (soup.find("meta", property="og:title") or {}).get("content")
    og_image = (soup.find("meta", property="og:image") or {}).get("content")
    og_price = (soup.find("meta", property="product:price:amount") or {}).get("content")

    title = og_title or (soup.title.string if soup.title else "Ajio Fashion Garment")
    title = re.sub(r'^(Buy|Shop)\s+', '', str(title), flags=re.IGNORECASE)
    title = re.sub(r'\s*\|\s*AJIO.*$', '', str(title), flags=re.IGNORECASE).strip()

    images = [{"url": og_image, "angle": "front"}] if og_image else []
    if not images:
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src")
            if src and "assets.ajio.com/medias" in src:
                images.append({"url": src, "angle": "front"})
                break

    return {
        "title": title or "Ajio Apparel",
        "brand": title.split()[0] if title else "Ajio",
        "price": parse_price(og_price) or "1199",
        "garment_type": detect_garment_type(title, url),
        "images": images,
        "url": url,
        "platform": "ajio",
    }


async def direct_http_scrape(url: str, platform: str) -> dict:
    clean_url = url.split()[0].strip() if " " in url else url.strip()
    clean_url = re.sub(r'[\r\n\t]', '', clean_url)
    parsed_u = urllib.parse.urlparse(clean_url)
    parsed_path = parsed_u.path.replace("/", " ").replace("-", " ").replace("_", " ").title().strip()

    headers = {
        "User-Agent": USER_AGENTS[0],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    }

    # Direct Shopify / Boutique JSON Endpoint Resolver (Rare Rabbit, Snitch, The House of Rare, etc.)
    if "/products/" in parsed_u.path:
        try:
            handle = parsed_u.path.split("/products/")[-1].split("/")[0].split("?")[0]
            if handle:
                json_url = f"{parsed_u.scheme}://{parsed_u.netloc}/products/{handle}.json"
                async with httpx.AsyncClient(timeout=8.0, verify=False, follow_redirects=True, headers=headers) as client:
                    resp = await client.get(json_url)
                    if resp.status_code == 200:
                        p_data = resp.json().get("product", {})
                        if p_data and p_data.get("images"):
                            p_imgs = [
                                {"url": img.get("src") if isinstance(img, dict) else str(img), "angle": "front"}
                                for img in p_data["images"]
                                if img
                            ]
                            p_price = p_data.get("variants", [{}])[0].get("price") if p_data.get("variants") else None
                            return {
                                "title": p_data.get("title") or "Fashion Garment",
                                "brand": p_data.get("vendor") or "Rare Rabbit",
                                "price": parse_price(str(p_price)) if p_price else "2499",
                                "garment_type": detect_garment_type(p_data.get("title", ""), clean_url),
                                "images": p_imgs,
                                "url": clean_url,
                                "platform": platform if platform != "unknown" else "Fashion Boutique",
                            }
        except Exception:
            pass

    html = ""
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=False, follow_redirects=True, headers=headers) as client:
            response = await client.get(clean_url)
            if response.status_code == 200:
                html = response.text
    except Exception:
        html = ""


    if html:
        soup = BeautifulSoup(html, "html.parser")
        if platform == "zara":
            res = await parse_zara(soup, url)
            if res.get("images"):
                return res
        elif platform == "ajio":
            res = await parse_ajio(soup, url)
            if res.get("images"):
                return res

        # Generic JSON-LD & OG Parsing
        og_title = (soup.find("meta", property="og:title") or {}).get("content") or (soup.find("meta", attrs={"name": "twitter:title"}) or {}).get("content")
        og_image = (soup.find("meta", property="og:image") or {}).get("content") or (soup.find("meta", attrs={"name": "twitter:image"}) or {}).get("content")
        og_price = (soup.find("meta", property="product:price:amount") or {}).get("content")
        
        schema_data = {}
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                if script.string:
                    parsed = json.loads(script.string)
                    if isinstance(parsed, list):
                        parsed = parsed[0] if len(parsed) > 0 else {}
                    if parsed.get("@type") in ("Product", "IndividualProduct", "ItemPage") or "offers" in parsed:
                        schema_data = parsed
                        break
            except Exception:
                continue

        title = og_title or schema_data.get("name") or (soup.title.string if soup.title else "")
        title = re.sub(r'^(Buy|Shop)\s+', '', str(title), flags=re.IGNORECASE)
        title = re.sub(r'\s*-\s*Buy\s+.*$', '', str(title), flags=re.IGNORECASE)
        title = re.sub(r'\s*\|\s*.*$', '', str(title), flags=re.IGNORECASE).strip()

        brand = schema_data.get("brand", {}).get("name") if isinstance(schema_data.get("brand"), dict) else schema_data.get("brand")
        if not brand and platform != "unknown":
            words = title.split()
            brand = words[0] if words else platform.title()
        elif not brand:
            brand = "Designer Collection"

        image_url = og_image
        if not image_url and schema_data.get("image"):
            img = schema_data.get("image")
            image_url = img[0] if isinstance(img, list) else (img.get("url") if isinstance(img, dict) else img)

        price = parse_price(og_price) or parse_price(schema_data.get("offers", {}).get("price") if isinstance(schema_data.get("offers"), dict) else None)
        images = [{"url": image_url, "angle": "front"}] if image_url else []

        if images:
            return {
                "title": title or "Fashion Garment",
                "brand": str(brand),
                "price": str(price) if price else "1899",
                "garment_type": detect_garment_type(title, url),
                "images": images,
                "url": url,
                "platform": platform,
            }

    # Intelligent slug fallback
    return {
        "title": parsed_path or f"{platform.title()} Fashion Garment",
        "brand": parsed_path.split()[0] if parsed_path else platform.title(),
        "price": "2199",
        "garment_type": detect_garment_type(parsed_path, url),
        "images": [],
        "url": url,
        "platform": platform,
    }




async def scrape_product(url: str) -> dict:
    normalised = normalize_url(url)
    cache_key = "product:" + hashlib.sha256(normalised.encode("utf-8")).hexdigest()
    cached = await cache_get_json(cache_key)
    if isinstance(cached, dict) and cached.get("images") and len(cached["images"]) > 0:
        return {**cached, "status": "fetched", "fallback_required": False}

    platform = detect_platform(normalised)
    product = None

    # 1. Try Scraper Service if configured
    if settings.scraper_service_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{settings.scraper_service_url}/scrape",
                    json={"url": normalised, "platform": platform}
                )
                if response.status_code == 200:
                    data = response.json()
                    product = data.get("product")
        except Exception:
            product = None

    # 2. Direct Specialized Platform Parsers
    if not product or not product.get("images"):
        if platform == "amazon":
            product = await parse_amazon_direct(normalised)
        elif platform == "myntra":
            product = await parse_myntra(normalised)
        elif platform == "flipkart":
            product = await parse_flipkart(normalised)

    # 3. Direct Resilient HTTP & JSON Scraper Engine
    if not product or not product.get("images"):
        product = await direct_http_scrape(normalised, platform)

    if product and product.get("images") and len(product["images"]) > 0 and product.get("status") != "failed":
        await cache_set_json(cache_key, product, 6 * 3600)
        return {"status": "fetched", "fallback_required": False, **product}

    return {"status": "failed", "fallback_required": True, "title": "Garment", "brand": "FitMe", "images": [], "url": normalised}
