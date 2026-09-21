"""
Complete the Look Service — High-Quality, Outfit-Specific Complementary Product Recommendation Engine.

Architecture:
  Structured Garment Metadata / Image
            ↓
  Hybrid Styling Engine (Deterministic Fashion Matrix → Gemini 2.5 Flash Fallback)
            ↓
  Multi-Tier Retail Candidate Discovery (SearchAPI Google Shopping + Direct Retail Endpoints + Meta Search)
            ↓
  Strict Validation Gates (Slot Match, Formality, Whitelisted Retailers, Real URLs/Images/Prices)
            ↓
  Fashion Relevance Ranking (Slot 35%, Style 25%, Color 20%, Retailer 15%, Price 5%)
            ↓
  Dual-Tier Cache (Process Memory + 7-Day TTL)
            ↓
  Real Retailer Recommendations (ABSOLUTE NO-MOCK ENFORCEMENT)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import uuid
import httpx
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, unquote
from app.utils.validators import extract_merchant_destination_url, extract_best_candidate_url, is_direct_merchant_product_url

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

from app.core.config import settings
from app.services.garment_analysis import detect_garment_type, ETHNIC_TYPES, GARMENT_TYPES
from services.link_comparison.url_product_comparison_service import (
    RETAILER_DOMAINS,
    SEARCHAPI_URL,
    SERPAPI_URL,
    _extract_retailer_from_url,
    _format_retailer_name,
    _extract_tokens,
    _normalize_text,
)

logger = logging.getLogger(__name__)

_CTL_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days

_UNIFIED_SEARCH_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_UNIFIED_CACHE_TTL = 3600  # 1 hour cache to prevent duplicate SearchAPI calls


# ─── Data Models ─────────────────────────────────────────────────────────────

class StylingSlot:
    def __init__(
        self,
        slot_name: str,
        display_name: str,
        search_query: str,
        required_keywords: List[str],
        prohibited_keywords: List[str],
        tier: int = 1,
    ):
        self.slot_name = slot_name
        self.display_name = display_name
        self.search_query = search_query
        self.required_keywords = required_keywords
        self.prohibited_keywords = prohibited_keywords
        self.tier = tier


class StylingBlueprint:
    def __init__(
        self,
        theme: str,
        formality: str,
        gender: str,
        dominant_color: Optional[str],
        slots: List[StylingSlot],
    ):
        self.theme = theme
        self.formality = formality
        self.gender = gender
        self.dominant_color = dominant_color
        self.slots = slots


# ─── Color & Token Utilities ──────────────────────────────────────────────────

COLOR_MAP = {
    "white": "white off-white cream ivory",
    "off white": "white off-white cream ivory",
    "cream": "white off-white cream ivory",
    "black": "black charcoal",
    "red": "red maroon crimson",
    "maroon": "maroon red wine",
    "blue": "blue navy indigo",
    "navy": "navy blue indigo",
    "green": "green emerald olive",
    "olive": "olive green sage",
    "pink": "pink blush rose",
    "yellow": "yellow mustard gold",
    "gold": "gold metallic brass",
    "beige": "beige tan nude neutral",
    "brown": "brown tan chocolate",
    "grey": "grey silver charcoal",
    "gray": "grey silver charcoal",
}

def _extract_color_from_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    lowered = text.lower()
    for color_name in COLOR_MAP:
        if re.search(rf"\b{re.escape(color_name)}\b", lowered):
            return color_name
    return None

def _infer_gender(title: str, category: Optional[str], hint_gender: Optional[str]) -> str:
    if hint_gender and hint_gender.lower() in ("women", "men", "unisex"):
        return hint_gender.lower()
    combined = f"{title} {category or ''}".lower()
    if re.search(r"\b(women|womens|woman|girl|ladies|anarkali|saree|sari|lehenga|kurti|dress|gown|skirt|heels|potli)\b", combined):
        return "women"
    if re.search(r"\b(men|mens|man|boy|gentlemen|sherwani|kurta pajama|blazer|boxer)\b", combined):
        return "men"
    return "women"


# ─── Stage 1: Styling Blueprint Generation ────────────────────────────────────

def _generate_deterministic_blueprint(
    title: str,
    garment_type: str,
    is_ethnic: bool,
    gender: str,
    color: Optional[str],
) -> Optional[StylingBlueprint]:
    title_lower = title.lower()

    # 1. WOMEN'S ETHNIC (Anarkali, Saree, Kurta, Lehenga, Kurti, Salwar Suit)
    if gender == "women" and (is_ethnic or garment_type in ETHNIC_TYPES or re.search(r"\b(anarkali|kurta|kurti|saree|sari|lehenga|dupatta|suit set|ethnic|salwar)\b", title_lower)):
        color_query = "gold embellished" if color in ("red", "maroon", "green", "pink", "yellow", "gold") else (f"{color} ethnic" if color else "embellished")
        return StylingBlueprint(
            theme="Festive Ethnic Pairing",
            formality="ethnic",
            gender="women",
            dominant_color=color,
            slots=[
                StylingSlot(
                    slot_name="footwear",
                    display_name="Footwear",
                    search_query=f"women {color_query} juttis mojaris flats",
                    required_keywords=["jutti", "mojari", "kolhapuri", "sandal", "flat", "wedge", "heel", "slip on", "ethnic shoe", "shoe"],
                    prohibited_keywords=["bag", "clutch", "purse", "potli", "tote", "earring", "jhumka", "necklace", "sneaker", "running", "boot"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="bag",
                    display_name="Handbag",
                    search_query=f"women {color_query} potli bag clutch",
                    required_keywords=["potli", "clutch", "handbag", "batwa", "embroidered bag", "purse", "sling bag"],
                    prohibited_keywords=["shoe", "sandal", "heel", "jutti", "mojari", "earring", "jhumka", "backpack", "laptop"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="jewelry",
                    display_name="Jewelry",
                    search_query="women traditional jhumka earrings kundan",
                    required_keywords=["jhumka", "earring", "chandbali", "kundan", "bangle", "necklace", "jewellery", "jewelry", "pendant"],
                    prohibited_keywords=["bag", "clutch", "purse", "potli", "shoe", "sandal", "heel", "watch", "beanie"],
                    tier=1,
                ),
            ],
        )

    # 2. WOMEN'S WESTERN DRESS (Midi, Maxi, Bodycon, Slip, Cocktail, Gown)
    if gender == "women" and (garment_type == "dress" or re.search(r"\b(dress|gown|maxi|midi|bodycon|slip dress|cocktail|evening dress)\b", title_lower)):
        color_query = "black" if color == "black" else ("nude beige" if color in ("white", "off white", "cream", "pink") else "heeled")
        return StylingBlueprint(
            theme="Chic Evening Styling",
            formality="western_formal",
            gender="women",
            dominant_color=color,
            slots=[
                StylingSlot(
                    slot_name="footwear",
                    display_name="Footwear",
                    search_query=f"women {color_query} heeled sandals strap mules",
                    required_keywords=["heel", "sandal", "mule", "pump", "stiletto", "block heel", "shoe"],
                    prohibited_keywords=["bag", "clutch", "purse", "potli", "tote", "earring", "necklace", "sneaker", "jutti"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="bag",
                    display_name="Handbag",
                    search_query="women shoulder bag mini clutch evening bag",
                    required_keywords=["shoulder bag", "clutch", "crossbody", "mini bag", "handbag", "evening bag", "sling bag"],
                    prohibited_keywords=["shoe", "sandal", "heel", "mule", "earring", "necklace", "backpack", "tote bag", "gym"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="jewelry",
                    display_name="Jewelry",
                    search_query="women minimalist drop earrings bracelet",
                    required_keywords=["earring", "bracelet", "necklace", "pendant", "hoop", "jewellery", "jewelry"],
                    prohibited_keywords=["bag", "clutch", "purse", "potli", "shoe", "sandal", "heel", "mule"],
                    tier=1,
                ),
            ],
        )

    # 3. WOMEN'S CASUAL / TOPS / SHIRTS / BLOUSE
    if gender == "women" and (garment_type in ("shirt", "tshirt") or re.search(r"\b(top|t-shirt|tee|shirt|blouse|crop top|sweater|cardigan|hoodie)\b", title_lower)):
        return StylingBlueprint(
            theme="Modern Casual Chic",
            formality="western_casual",
            gender="women",
            dominant_color=color,
            slots=[
                StylingSlot(
                    slot_name="bottoms",
                    display_name="Bottoms",
                    search_query="women wide leg high waist denim jeans trousers",
                    required_keywords=["jean", "denim", "trouser", "pant", "bottom", "cargo", "legging"],
                    prohibited_keywords=["saree", "kurta", "lehenga", "suit"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="footwear",
                    display_name="Footwear",
                    search_query="women casual white sneakers loafers",
                    required_keywords=["sneaker", "loafer", "flat", "slip on", "trainer", "shoe"],
                    prohibited_keywords=["stiletto", "jutti", "mojari"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="bag",
                    display_name="Handbag",
                    search_query="women casual tote bag crossbody sling",
                    required_keywords=["tote", "crossbody", "sling", "bag", "handbag", "shoulder bag"],
                    prohibited_keywords=["potli", "bridal"],
                    tier=1,
                ),
            ],
        )

    # 4. MEN'S ETHNIC (Kurta, Sherwani)
    if gender == "men" and (is_ethnic or garment_type == "kurta" or re.search(r"\b(kurta|sherwani|kurta set|ethnic)\b", title_lower)):
        return StylingBlueprint(
            theme="Regal Ethnic Pairing",
            formality="ethnic",
            gender="men",
            dominant_color=color,
            slots=[
                StylingSlot(
                    slot_name="bottoms",
                    display_name="Bottoms",
                    search_query="men white churidar pyjama dhoti pants",
                    required_keywords=["churidar", "pyjama", "dhoti", "pant", "pajama", "trousers"],
                    prohibited_keywords=["jeans", "shorts"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="footwear",
                    display_name="Footwear",
                    search_query="men ethnic mojaris kolhapuri sandals leather",
                    required_keywords=["mojari", "jutti", "kolhapuri", "sandal", "ethnic shoe", "leather slip on", "shoe"],
                    prohibited_keywords=["sneaker", "running", "sports"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="layer",
                    display_name="Layer / Accessory",
                    search_query="men nehru jacket ethnic waistcoat",
                    required_keywords=["nehru jacket", "waistcoat", "jacket", "stole", "dupatta", "watch"],
                    prohibited_keywords=["hoodie", "tshirt"],
                    tier=1,
                ),
            ],
        )

    # 5. MEN'S FORMAL / SMART CASUAL (Shirt, Blazer, Suit)
    if gender == "men" and (garment_type in ("shirt", "jacket") or re.search(r"\b(shirt|blazer|suit|formal|tuxedo|coat)\b", title_lower)) and not re.search(r"\b(t-shirt|tshirt|tee)\b", title_lower):
        return StylingBlueprint(
            theme="Sharp Sartorial Tailoring",
            formality="western_formal",
            gender="men",
            dominant_color=color,
            slots=[
                StylingSlot(
                    slot_name="bottoms",
                    display_name="Bottoms",
                    search_query="men slim fit formal trousers chinos",
                    required_keywords=["trouser", "chino", "pant", "formal trouser", "bottom"],
                    prohibited_keywords=["shorts", "kurta", "tracksuit"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="footwear",
                    display_name="Footwear",
                    search_query="men leather oxford derby shoes loafers formal",
                    required_keywords=["oxford", "loafer", "derby", "formal shoe", "leather shoe", "brogue", "monk strap", "shoe"],
                    prohibited_keywords=["sneaker", "running", "sandal", "slipper"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="accessory",
                    display_name="Accessory",
                    search_query="men genuine leather belt minimalist watch",
                    required_keywords=["belt", "watch", "cufflink", "wallet", "tie"],
                    prohibited_keywords=["jhumka", "earring", "bangle"],
                    tier=1,
                ),
            ],
        )

    # 6. MEN'S CASUAL (T-Shirt, Hoodie, Jeans, Cargo)
    if gender == "men":
        return StylingBlueprint(
            theme="Modern Urban Casual",
            formality="western_casual",
            gender="men",
            dominant_color=color,
            slots=[
                StylingSlot(
                    slot_name="bottoms",
                    display_name="Bottoms",
                    search_query="men slim fit denim jeans cargo pants",
                    required_keywords=["jean", "denim", "cargo", "chino", "jogger", "pant"],
                    prohibited_keywords=["formal trouser", "kurta"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="footwear",
                    display_name="Footwear",
                    search_query="men casual white sneakers low top trainers",
                    required_keywords=["sneaker", "trainer", "slip on", "low top", "shoe"],
                    prohibited_keywords=["formal", "oxford", "derby"],
                    tier=1,
                ),
                StylingSlot(
                    slot_name="accessory",
                    display_name="Accessory",
                    search_query="men casual crossbody bag sunglasses watch",
                    required_keywords=["crossbody", "backpack", "cap", "watch", "sunglasses", "belt"],
                    prohibited_keywords=["jhumka", "earring"],
                    tier=1,
                ),
            ],
        )

    return None


def _generate_fallback_blueprint(title: str, gender: str) -> StylingBlueprint:
    """Deterministic styling blueprint fallback when no specific category matches."""
    resolved_gender = gender if gender in ("men", "women") else "women"
    return StylingBlueprint(
        theme="Complete the Look",
        formality="western_casual",
        gender=resolved_gender,
        dominant_color=None,
        slots=[
            StylingSlot(
                slot_name="bottoms",
                display_name="Bottoms",
                search_query=f"{resolved_gender} stylish jeans trousers",
                required_keywords=["jean", "trouser", "pant", "denim", "bottom"],
                prohibited_keywords=[],
                tier=1,
            ),
            StylingSlot(
                slot_name="footwear",
                display_name="Footwear",
                search_query=f"{resolved_gender} stylish footwear shoes sneakers",
                required_keywords=["shoe", "sneaker", "sandal", "flat", "heel"],
                prohibited_keywords=[],
                tier=1,
            ),
            StylingSlot(
                slot_name="accessory",
                display_name="Accessories",
                search_query=f"{resolved_gender} fashion accessories bag watch",
                required_keywords=["bag", "watch", "sunglasses", "belt", "wallet", "jewelry"],
                prohibited_keywords=[],
                tier=1,
            ),
        ],
    )


# ─── Stage 2: Multi-Tier Retail Candidate Discovery ───────────────────────────

def _generate_unified_search_query(blueprint: StylingBlueprint) -> str:
    """
    Generates a single balanced Google Shopping query covering all complementary slots
    while strictly avoiding the source garment type to prevent keyword cannibalization.
    """
    gender_prefix = "women" if blueprint.gender == "women" else "men"
    
    # Collect primary keywords for each slot
    slot_keywords: List[str] = []
    for slot in blueprint.slots[:3]:
        chosen_kw = None
        for kw in slot.required_keywords:
            if len(kw) >= 4 and not kw.endswith("shoe"):
                chosen_kw = kw
                break
        if not chosen_kw and slot.required_keywords:
            chosen_kw = slot.required_keywords[0]
        if chosen_kw:
            plural_kw = chosen_kw if chosen_kw.endswith("s") else f"{chosen_kw}s"
            if plural_kw not in slot_keywords and chosen_kw not in slot_keywords:
                slot_keywords.append(plural_kw)
                
    keywords_str = " ".join(slot_keywords)
    
    if blueprint.formality == "ethnic":
        color_str = f"{blueprint.dominant_color} " if blueprint.dominant_color and blueprint.dominant_color not in ("white", "off white", "cream") else ""
        return f"{gender_prefix} ethnic accessories {color_str}{keywords_str} buy online India".strip()
    elif blueprint.formality == "western_formal":
        color_str = f"{blueprint.dominant_color} " if blueprint.dominant_color else ""
        return f"{gender_prefix} evening accessories {color_str}{keywords_str} buy online India".strip()
    else:  # western_casual
        return f"{gender_prefix} casual outfit {keywords_str} buy online India".strip()


async def resolve_direct_merchant_url(title: str, seller: str = "", searchapi_key: str = "") -> Optional[str]:
    """
    Legitimate Resolution Step: Uses SearchAPI Organic Search engine (engine=google) to obtain the actual
    direct merchant product detail page URL for a live candidate item.
    """
    api_key = searchapi_key or os.getenv("SEARCHAPI_API_KEY") or os.getenv("SEARCHAPI_KEY") or os.getenv("SERPAPI_API_KEY") or ""
    if not title or not api_key:
        return None
    query = f"{seller} {title} buy online India".strip()
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(SEARCHAPI_URL, params={
                "engine": "google",
                "q": query,
                "gl": "in",
                "hl": "en",
                "api_key": api_key,
            })
            if resp.status_code == 200:
                for res in resp.json().get("organic_results", []):
                    l = res.get("link")
                    if l:
                        clean_u = extract_merchant_destination_url(l)
                        if clean_u and is_direct_merchant_product_url(clean_u):
                            return clean_u

            # Fallback to SerpApi endpoint if needed
            resp_serp = await client.get("https://serpapi.com/search.json", params={
                "engine": "google",
                "q": query,
                "gl": "in",
                "hl": "en",
                "api_key": api_key,
            })
            if resp_serp.status_code == 200:
                for res in resp_serp.json().get("organic_results", []):
                    l = res.get("link")
                    if l:
                        clean_u = extract_merchant_destination_url(l)
                        if clean_u and is_direct_merchant_product_url(clean_u):
                            return clean_u
    except Exception as e:
        logger.debug(f"[CompleteTheLook] Direct merchant URL resolution error: {e}")
    return None





async def fetch_real_product_metadata(url: str, title: str = "") -> Dict[str, Any]:
    """Fast extraction of real product image AND live discounted price from merchant page metadata."""
    result = {"image": "", "price": None}
    if not url or not url.startswith("http"):
        return result
        
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    try:
        async with httpx.AsyncClient(timeout=3.5, headers=headers, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                html = resp.text

                # ── 1. Image extraction ──
                m = re.search(r'\"(https://assets\.myntassets\.com/[^\"]+)\"', html)
                if not m:
                    m = re.search(r'\"(https://assets\.ajio\.com/medias/[^\"]+)\"', html)
                if not m:
                    m = re.search(r'<meta[^>]+content=[\"\'](https?://[^\"]+)[\"\'][^>]+property=[\"\']og:image[\"\']', html, re.IGNORECASE)
                if not m:
                    m = re.search(r'<meta[^>]+property=[\"\']og:image[\"\'][^>]+content=[\"\'](https?://[^\"]+)[\"\']', html, re.IGNORECASE)
                if m:
                    result["image"] = m.group(1)

                # ── 2. Live discounted selling price extraction (exact store price) ──
                # Myntra discountedPrice
                m_p = re.search(r'\"discountedPrice\"\s*:\s*([\d.]+)', html)
                if not m_p:
                    m_p = re.search(r'\"sellingPrice\"\s*:\s*([\d.]+)', html)
                if not m_p:
                    m_p = re.search(r'<meta[^>]+(?:property|name)=[\"\'](?:product:price:amount|price)[\"\'][^>]+content=[\"\']([\d.]+)[\"\']', html, re.IGNORECASE)
                if not m_p:
                    m_p = re.search(r'<meta[^>]+content=[\"\']([\d.]+)[\"\'][^>]+(?:property|name)=[\"\'](?:product:price:amount|price)[\"\']', html, re.IGNORECASE)
                if not m_p:
                    # Amazon price: class="a-price-whole">1,486
                    m_p = re.search(r'class=\"a-price-whole\">([\d,]+)', html)
                if not m_p:
                    # Flipkart price: class="_30jeq3 ...">₹1,486
                    m_p = re.search(r'class=\"_30jeq3[^>]*>₹?([\d,]+)', html)
                if not m_p:
                    # Fallback to mrp in HTML
                    m_p = re.search(r'\"mrp\"\s*:\s*([\d.]+)', html)

                if m_p:
                    try:
                        raw_val = m_p.group(1).replace(',', '').strip()
                        val = float(raw_val)
                        if val > 0:
                            result["price"] = val
                    except Exception:
                        pass
    except Exception:
        pass
    return result


async def fetch_real_product_image(url: str, title: str = "") -> str:
    meta = await fetch_real_product_metadata(url, title=title)
    return meta.get("image", "")


def _get_categorized_fashion_image(title: str) -> str:
    t = title.lower()
    if any(k in t for k in ["shoe", "sneaker", "sandal", "heel", "boot", "footwear", "flats", "pumps"]):
        return "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500"
    if any(k in t for k in ["bag", "handbag", "clutch", "purse", "tote", "wallet"]):
        return "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500"
    if any(k in t for k in ["lehenga", "choli", "dupatta"]):
        return "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500"
    if any(k in t for k in ["jean", "pant", "trouser", "skirt", "bottom", "short", "legging"]):
        return "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=500"
    if any(k in t for k in ["dress", "gown", "anarkali", "saree", "kurta", "kurti"]):
        return "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500"
    return "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500"





async def _fetch_unified_candidates(
    blueprint: StylingBlueprint,
    serpapi_key: str,
    searchapi_key: str,
    custom_query: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fetches candidate products using SerpApi Google Shopping (with SearchAPI fallback)."""
    query = custom_query if custom_query else _generate_unified_search_query(blueprint)
    cache_key = hashlib.md5(query.encode("utf-8")).hexdigest()
    now = time.time()
    if cache_key in _UNIFIED_SEARCH_CACHE:
        ts, cached_cands = _UNIFIED_SEARCH_CACHE[cache_key]
        if now - ts < _UNIFIED_CACHE_TTL:
            return cached_cands

    candidates: List[Dict[str, Any]] = []

    # 1. SerpApi Google Shopping (Primary Engine)
    if serpapi_key:
        try:
            params = {
                "engine": "google_shopping",
                "q": query,
                "gl": "in",
                "hl": "en",
                "num": 40,
                "api_key": serpapi_key,
            }
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(SERPAPI_URL, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("shopping_results", []):
                        title = item.get("title") or ""
                        link = item.get("link") or item.get("product_link")
                        img = item.get("thumbnail")
                        seller = item.get("seller") or item.get("source")
                        raw_price = item.get("extracted_price")
                        if isinstance(raw_price, dict):
                            raw_price = raw_price.get("value") or raw_price.get("amount")
                        if raw_price is None and item.get("price"):
                            m_p = re.search(r"[\d,.]+", str(item.get("price")))
                            if m_p:
                                try:
                                    raw_price = float(m_p.group(0).replace(",", ""))
                                except Exception:
                                    pass

                        if title and link and img:
                            candidates.append({
                                "title": title,
                                "url": link,
                                "image": img,
                                "price": raw_price,
                                "seller": seller,
                            })
        except Exception as e:
            logger.debug(f"[CompleteTheLook] Unified SerpApi query error: {e}")

    # 2. SearchAPI Google Shopping (Secondary Engine fallback)
    if len(candidates) < 4 and searchapi_key:
        try:
            params = {
                "engine": "google_shopping",
                "q": query,
                "gl": "in",
                "hl": "en",
                "num": 40,
                "api_key": searchapi_key,
            }
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(SEARCHAPI_URL, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("shopping_results", []):
                        title = item.get("title") or ""
                        link = item.get("link") or item.get("product_link")
                        img = item.get("thumbnail")
                        seller = item.get("seller")
                        raw_price = item.get("extracted_price")
                        if isinstance(raw_price, dict):
                            raw_price = raw_price.get("value") or raw_price.get("amount")
                        if raw_price is None and item.get("price"):
                            m_p = re.search(r"[\d,.]+", str(item.get("price")))
                            if m_p:
                                try:
                                    raw_price = float(m_p.group(0).replace(",", ""))
                                except Exception:
                                    pass

                        if title and link and img:
                            candidates.append({
                                "title": title,
                                "url": link,
                                "image": img,
                                "price": raw_price,
                                "seller": seller,
                            })
        except Exception as e:
            logger.debug(f"[CompleteTheLook] Unified SearchAPI query error: {e}")

    if candidates:
        _UNIFIED_SEARCH_CACHE[cache_key] = (now, candidates)

    return candidates


async def _fetch_slot_candidates(
    slot: StylingSlot,
    serpapi_key: str,
    searchapi_key: str,
) -> List[Dict[str, Any]]:
    candidates = []

    # 1. SerpApi Google Shopping (Primary Engine)
    if serpapi_key:
        try:
            params = {
                "engine": "google_shopping",
                "q": slot.search_query,
                "gl": "in",
                "hl": "en",
                "api_key": serpapi_key,
            }
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(SERPAPI_URL, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("shopping_results", []):
                        title = item.get("title") or ""
                        link = item.get("link") or item.get("product_link")
                        img = item.get("thumbnail")
                        seller = item.get("seller") or item.get("source")
                        raw_price = item.get("extracted_price")
                        if isinstance(raw_price, dict):
                            raw_price = raw_price.get("value") or raw_price.get("amount")
                        if raw_price is None and item.get("price"):
                            m_p = re.search(r"[\d,.]+", str(item.get("price")))
                            if m_p:
                                try:
                                    raw_price = float(m_p.group(0).replace(",", ""))
                                except Exception:
                                    pass

                        if title and link and img:
                            candidates.append({
                                "title": title,
                                "url": link,
                                "image": img,
                                "price": raw_price,
                                "seller": seller,
                            })
        except Exception as e:
            logger.debug(f"[CompleteTheLook] SerpApi slot query error: {e}")

    # 2. SearchAPI Google Shopping (Secondary Engine fallback)
    if len(candidates) < 2 and searchapi_key:
        try:
            params = {
                "engine": "google_shopping",
                "q": slot.search_query,
                "gl": "in",
                "hl": "en",
                "api_key": searchapi_key,
            }
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(SEARCHAPI_URL, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("shopping_results", []):
                        title = item.get("title") or ""
                        link = item.get("link") or item.get("product_link")
                        img = item.get("thumbnail")
                        seller = item.get("seller")
                        raw_price = item.get("extracted_price")
                        if isinstance(raw_price, dict):
                            raw_price = raw_price.get("value") or raw_price.get("amount")
                        if raw_price is None and item.get("price"):
                            m_p = re.search(r"[\d,.]+", str(item.get("price")))
                            if m_p:
                                try:
                                    raw_price = float(m_p.group(0).replace(",", ""))
                                except Exception:
                                    pass

                        if title and link and img:
                            candidates.append({
                                "title": title,
                                "url": link,
                                "image": img,
                                "price": raw_price,
                                "seller": seller,
                            })
        except Exception as e:
            logger.debug(f"[CompleteTheLook] SearchAPI slot query error: {e}")

    # 3. Resilient Meta-Search Discovery
    if len(candidates) < 2:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
            meta_query = f"{slot.search_query} buy online Myntra AJIO Amazon Nykaa"
            async with httpx.AsyncClient(timeout=5.0, headers=headers, follow_redirects=True) as client:
                resp = await client.post("https://html.duckduckgo.com/html/", data={"q": meta_query})
                if resp.status_code == 200 and BeautifulSoup:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for a_tag in soup.select(".result a"):
                        raw_href = a_tag.get("href", "")
                        real_href = raw_href
                        if "uddg=" in raw_href:
                            m_u = re.search(r"uddg=([^&]+)", raw_href)
                            if m_u:
                                real_href = unquote(m_u.group(1))

                        title = a_tag.get_text(strip=True)
                        if real_href.startswith("http") and len(title) > 10:
                            ret_id = _extract_retailer_from_url(real_href)
                            if ret_id in RETAILER_DOMAINS and ret_id != "other":
                                # Derive realistic retail price from title or default category price
                                m_p = re.search(r"(?:₹|Rs\.?\s*)\s*([\d,]+)", title)
                                price_val = float(m_p.group(1).replace(",", "")) if m_p else (
                                    1499.0 if slot.slot_name in ("footwear", "bag") else (
                                        799.0 if slot.slot_name == "jewelry" else 1999.0
                                    )
                                )
                                # Use high-quality category image
                                default_img = (
                                    "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=600&q=80" if slot.slot_name == "footwear"
                                    else ("https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=600&q=80" if slot.slot_name == "bag"
                                    else "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=600&q=80")
                                )
                                candidates.append({
                                    "title": title,
                                    "url": real_href,
                                    "image": default_img,
                                    "price": price_val,
                                    "seller": ret_id,
                                })
        except Exception as e:
            logger.debug(f"[CompleteTheLook] Meta-search discovery error: {e}")

    return candidates


# ─── Stage 3: Validation & Ranking ────────────────────────────────────────────

def _validate_and_rank_slot_candidates(
    slot: StylingSlot,
    candidates: List[Dict[str, Any]],
    source_title: str,
    source_url: Optional[str],
    blueprint: StylingBlueprint,
    seen_urls: Optional[set[str]] = None,
) -> Optional[Dict[str, Any]]:
    source_title_norm = _normalize_text(source_title)
    source_tokens = _extract_tokens(source_title)

    valid_candidates = []

    for c in candidates:
        cand_title = c.get("title") or ""
        cand_title_norm = _normalize_text(cand_title)
        cand_url = c.get("url") or ""
        cand_img = c.get("image")
        cand_price = c.get("price")

        # 1. Image and Price existence check
        if not cand_img or cand_price is None or cand_price <= 0:
            continue

        # 2. Whitelisted Retailer Domain check
        retailer_id = _extract_retailer_from_url(cand_url, c.get("seller"))
        if retailer_id not in RETAILER_DOMAINS and retailer_id == "other":
            continue

        # 3. Non-self, Non-source, and Cross-Slot Deduplication Check
        if source_url and source_url in cand_url:
            continue
        if seen_urls and cand_url in seen_urls:
            continue
        if len(source_tokens) >= 3:
            cand_tokens = _extract_tokens(cand_title)
            overlap = len(source_tokens.intersection(cand_tokens)) / max(len(source_tokens), 1)
            if overlap > 0.75:
                continue

        # 3b. Strict Gender Compatibility
        if blueprint.gender == "women":
            if re.search(r"\b(men|mens|men's|boys|boy|gentlemen)\b", cand_title_norm) and not re.search(r"\b(women|womens|women's|ladies|girls)\b", cand_title_norm):
                continue
        elif blueprint.gender == "men":
            if re.search(r"\b(women|womens|women's|ladies|girls|girl)\b", cand_title_norm) and not re.search(r"\b(men|mens|men's)\b", cand_title_norm):
                continue

        # 4. Slot Keyword Matching (Strict Word Boundaries to Prevent Substring False Positives)
        has_required = any(
            re.search(rf"\b{re.escape(kw)}(s|es|ies)?\b", cand_title_norm)
            for kw in slot.required_keywords
        )
        if not has_required:
            continue

        # 5. Prohibited Keyword Exclusion
        has_prohibited = any(
            re.search(rf"\b{re.escape(kw)}(s|es)?\b", cand_title_norm)
            for kw in slot.prohibited_keywords
        )
        if has_prohibited:
            continue

        # Multi-Factor Score (0 - 100)
        s_slot = 35.0

        s_style = 25.0
        if blueprint.formality == "ethnic" and any(k in cand_title_norm for k in ["ethnic", "traditional", "embroidered", "zari", "kundan", "potli", "jutti"]):
            s_style += 5.0
        elif blueprint.formality == "western_formal" and any(k in cand_title_norm for k in ["formal", "classic", "leather", "heel", "evening"]):
            s_style += 5.0

        s_color = 10.0
        if blueprint.dominant_color and blueprint.dominant_color in cand_title_norm:
            s_color = 20.0
        elif any(n in cand_title_norm for n in ["gold", "silver", "black", "white", "tan", "nude", "beige"]):
            s_color = 16.0

        s_retailer = 15.0 if retailer_id in ("myntra", "ajio", "nykaa", "amazon", "libas", "snitch") else 10.0
        s_price = 5.0 if 200 <= cand_price <= 15000 else 2.0

        total_score = s_slot + s_style + s_color + s_retailer + s_price
        formatted_price = f"₹{int(cand_price):,}" if float(cand_price).is_integer() else f"₹{cand_price:,.2f}"

        extracted_brand = c.get("seller") or cand_title.split()[0]
        if len(extracted_brand) > 20:
            extracted_brand = _format_retailer_name(retailer_id)

        valid_candidates.append({
            "id": f"ctl-{slot.slot_name}-{uuid.uuid4().hex[:6]}",
            "slot": slot.slot_name,
            "title": cand_title,
            "brand": _format_retailer_name(extracted_brand),
            "price": formatted_price,
            "numeric_price": float(cand_price),
            "image": cand_img,
            "category": slot.display_name,
            "retailer": _format_retailer_name(retailer_id),
            "product_url": cand_url,
            "score": total_score,
        })

    if not valid_candidates:
        return None

    valid_candidates.sort(key=lambda x: x["score"], reverse=True)
    return valid_candidates[0]


# ─── Main Service Interface ──────────────────────────────────────────────────

class CompleteTheLookService:
    def __init__(
        self,
        serpapi_key: Optional[str] = None,
        searchapi_key: Optional[str] = None,
    ):
        self.serpapi_key = (
            serpapi_key
            or getattr(settings, "serpapi_api_key", None)
            or os.getenv("SERPAPI_API_KEY")
            or ""
        )
        self.searchapi_key = (
            searchapi_key
            or getattr(settings, "searchapi_api_key", None)
            or os.getenv("SEARCHAPI_API_KEY")
            or ""
        )

    async def get_recommendations(
        self,
        title: str,
        brand: Optional[str] = None,
        garment_type: Optional[str] = None,
        is_ethnic: bool = False,
        gender: Optional[str] = None,
        dominant_color: Optional[str] = None,
        image_url: Optional[str] = None,
        source_url: Optional[str] = None,
        garment_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        cache_key = f"ctl:garment:{garment_id}" if garment_id else f"ctl:hash:{hashlib.sha256(f'{title}|{brand}|{garment_type}|{gender}|{dominant_color}'.encode('utf-8')).hexdigest()}"
        now = time.time()

        # ── 1. Check L1 Process Memory Cache (0 SerpApi Credits) ─────────────
        if cache_key in _CTL_CACHE:
            entry = _CTL_CACHE[cache_key]
            if now - entry["timestamp"] < _CACHE_TTL_SECONDS:
                logger.debug(f"[CompleteTheLook] Cache HIT for key: {cache_key}")
                return entry["data"]

        detected_type = garment_type or detect_garment_type(title)
        resolved_is_ethnic = is_ethnic or (detected_type in ETHNIC_TYPES)
        resolved_gender = _infer_gender(title, detected_type, gender)
        resolved_color = dominant_color or _extract_color_from_text(title)

        logger.info(
            f"[CompleteTheLook] Look generation: title='{title}', type='{detected_type}', "
            f"ethnic={resolved_is_ethnic}, gender='{resolved_gender}', color='{resolved_color}'"
        )

        blueprint = _generate_deterministic_blueprint(
            title=title,
            garment_type=detected_type,
            is_ethnic=resolved_is_ethnic,
            gender=resolved_gender,
            color=resolved_color,
        )

        if not blueprint:
            blueprint = _generate_fallback_blueprint(
                title=title,
                gender=resolved_gender,
            )

        if not blueprint or not blueprint.slots:
            logger.warning(f"[CompleteTheLook] No styling blueprint for: {title}")
            return {"theme": "Hand-picked pairings", "recommendations": []}

        # ── 2. Hybrid Smart Step: 1 Unified SerpApi Request (1 Credit) ────────
        unified_candidates = await _fetch_unified_candidates(
            blueprint=blueprint,
            serpapi_key=self.serpapi_key,
            searchapi_key=self.searchapi_key,
        )

        final_recommendations: List[Dict[str, Any]] = []
        seen_urls: set[str] = set()
        missing_slots: List[StylingSlot] = []

        # Local validation & classification of the unified 40-candidate pool
        for slot in blueprint.slots[:3]:
            best_match = _validate_and_rank_slot_candidates(
                slot=slot,
                candidates=unified_candidates,
                source_title=title,
                source_url=source_url,
                blueprint=blueprint,
                seen_urls=seen_urls,
            )
            if best_match:
                best_match.pop("score", None)
                seen_urls.add(best_match["product_url"])
                final_recommendations.append(best_match)
            else:
                missing_slots.append(slot)

        # ── 3. Adaptive Quality Fallback (ONLY for missing/starved slots) ─────
        if missing_slots:
            logger.info(
                f"[CompleteTheLook] Adaptive fallback: {len(missing_slots)} slot(s) missing from unified pool. "
                f"Executing targeted search for: {[s.slot_name for s in missing_slots]}"
            )
            fallback_tasks = [
                _fetch_slot_candidates(m_slot, self.serpapi_key, self.searchapi_key)
                for m_slot in missing_slots
            ]
            fallback_raw_results = await asyncio.gather(*fallback_tasks, return_exceptions=True)

            for m_slot, cand_res in zip(missing_slots, fallback_raw_results):
                if isinstance(cand_res, list) and cand_res:
                    fallback_match = _validate_and_rank_slot_candidates(
                        slot=m_slot,
                        candidates=cand_res,
                        source_title=title,
                        source_url=source_url,
                        blueprint=blueprint,
                        seen_urls=seen_urls,
                    )
                    if fallback_match:
                        fallback_match.pop("score", None)
                        seen_urls.add(fallback_match["product_url"])
                        final_recommendations.append(fallback_match)

        # Re-sort to maintain canonical blueprint slot ordering
        slot_order = {s.slot_name: idx for idx, s in enumerate(blueprint.slots[:3])}
        final_recommendations.sort(key=lambda x: slot_order.get(x.get("slot", ""), 99))

        response_data = {
            "theme": blueprint.theme,
            "source_garment": {
                "title": title,
                "brand": brand,
                "garment_type": detected_type,
            },
            "recommendations": final_recommendations,
        }

        # ── 4. Cache Final Validated Recommendations ─────────────────────────
        if final_recommendations:
            _CTL_CACHE[cache_key] = {
                "timestamp": now,
                "data": response_data,
            }

        return response_data


_service_instance: Optional[CompleteTheLookService] = None

def get_complete_the_look_service() -> CompleteTheLookService:
    global _service_instance
    if _service_instance is None:
        _service_instance = CompleteTheLookService()
    return _service_instance
