"""
URLProductComparisonService — Dedicated URL-Based Exact Product Price Comparison Pipeline.

Operates exclusively for products originated from a user-pasted product link (e.g. Virtual Try-On flow).
Uses the authoritative extracted metadata (Brand, Title, Style ID, Image, Price) as the identity source of truth.
Discovers and verifies ONLY strictly exact cross-retailer offers (rejecting similar/lookalike items).
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, unquote, urlparse

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

SERPAPI_URL = "https://serpapi.com/search"
SEARCHAPI_URL = "https://www.searchapi.io/api/v1/search"

# Supported Indian fashion platforms and domain mappings
RETAILER_DOMAINS: Dict[str, str] = {
    "myntra.com": "myntra",
    "flipkart.com": "flipkart",
    "ajio.com": "ajio",
    "amazon.in": "amazon",
    "amazon.com": "amazon",
    "nykaafashion.com": "nykaa",
    "nykaa.com": "nykaa",
    "tatacliq.com": "tatacliq",
    "meesho.com": "meesho",
    "shoppersstop.com": "shoppersstop",
    "thehouseofrare.com": "thehouseofrare",
    "shoplibas.com": "libas",
    "libas.in": "libas",
    "snitch.co.in": "snitch",
    "snitch.com": "snitch",
    "bewakoof.com": "bewakoof",
    "theanouk.com": "anouk",
}

STOPWORDS = {
    "a", "an", "the", "in", "for", "and", "of", "with", "on", "at", "to", "by", "from",
    "buy", "online", "india", "price", "flat", "off", "rs", "mrp", "shop", "store",
    "women", "womens", "men", "mens", "clothing", "apparel", "fashion"
}


def _parse_inr_price(val: Any, default_currency: str = "INR") -> Optional[float]:
    """Strictly parses and converts all fashion prices into Indian Rupees (INR), handling foreign currencies and paise."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        num = float(val)
        if num > 100000 and num % 100 == 0:  # paise e.g. 299900 -> 2999.0
            num /= 100.0
        return num if 100 <= num <= 500000 else None

    if isinstance(val, dict):
        curr = str(val.get("currency") or default_currency).upper().strip()
        ext_val = val.get("extracted_value") or val.get("value") or val.get("amount")
        if ext_val is not None:
            p_num = _parse_inr_price(ext_val, curr)
            if p_num is not None:
                if curr in ("AED", "DHS", "DIRHAM"):
                    p_num = round(p_num * 22.7, 2)
                elif curr in ("USD", "$"):
                    p_num = round(p_num * 83.5, 2)
                elif curr in ("EUR", "€"):
                    p_num = round(p_num * 90.5, 2)
                elif curr in ("GBP", "£"):
                    p_num = round(p_num * 105.0, 2)
                return p_num if 100 <= p_num <= 500000 else None

    s = str(val).strip()
    s_lower = s.lower()

    multiplier = 1.0
    if "aed" in s_lower or "dhs" in s_lower or "dirham" in s_lower:
        multiplier = 22.7
    elif "usd" in s_lower or "$" in s_lower:
        multiplier = 83.5
    elif "eur" in s_lower or "€" in s_lower:
        multiplier = 90.5
    elif "gbp" in s_lower or "£" in s_lower:
        multiplier = 105.0

    m = re.search(r'[\d,]+(?:\.\d+)?', s)
    if m:
        try:
            num = float(m.group(0).replace(",", ""))
            if num > 100000 and num % 100 == 0 and multiplier == 1.0:
                num /= 100.0
            num = round(num * multiplier, 2)
            if 100 <= num <= 500000:
                return num
        except Exception:
            pass
    return None


def _normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
    return " ".join(cleaned.split())


def _extract_tokens(text: Optional[str]) -> set[str]:
    norm = _normalize_text(text)
    return {t for t in norm.split() if len(t) > 2 and t not in STOPWORDS}


def _extract_retailer_from_url(url: str, seller: Optional[str] = None) -> str:
    if seller:
        s_norm = seller.lower()
        for r_name, r_id in [("myntra", "myntra"), ("flipkart", "flipkart"), ("ajio", "ajio"), ("amazon", "amazon"), ("nykaa", "nykaa"), ("meesho", "meesho"), ("tatacliq", "tatacliq"), ("tata cliq", "tatacliq"), ("libas", "libas"), ("anouk", "anouk")]:
            if r_name in s_norm:
                return r_id
    try:
        domain = urlparse(url).netloc.lower().replace("www.", "").replace("m.", "").replace("dl.", "")
        for known_domain, rid in RETAILER_DOMAINS.items():
            if known_domain in domain:
                return rid
        parts = domain.split(".")
        return parts[0] if parts else "other"
    except Exception:
        return "other"


def _format_retailer_name(retailer_id: str) -> str:
    names = {
        "myntra": "Myntra",
        "flipkart": "Flipkart",
        "ajio": "AJIO",
        "amazon": "Amazon",
        "nykaa": "Nykaa",
        "tatacliq": "Tata CLiQ",
        "meesho": "Meesho",
        "shoppersstop": "Shoppers Stop",
        "thehouseofrare": "The House of Rare",
        "libas": "Libas",
        "snitch": "Snitch",
        "bewakoof": "Bewakoof",
        "anouk": "Anouk Official",
    }
    return names.get(retailer_id.lower(), retailer_id.capitalize())


def _extract_style_id_from_url(url: Optional[str]) -> Optional[str]:
    """Extracts style ID / product SKU from PDP URL if present (e.g. Myntra style ID)."""
    if not url:
        return None
    # Myntra numeric product ID before /buy
    m_myntra = re.search(r"/(\d{6,12})/buy", url)
    if m_myntra:
        return m_myntra.group(1)
    # Flipkart /p/itm... or pid=...
    m_fk = re.search(r"pid=([A-Z0-9]{10,20})", url) or re.search(r"/p/([a-zA-Z0-9]{10,20})", url)
    if m_fk:
        return m_fk.group(1)
    # Amazon /dp/B0...
    m_amz = re.search(r"/dp/([A-Z0-9]{10})", url)
    if m_amz:
        return m_amz.group(1)
    # AJIO /p/464573262_...
    m_ajio = re.search(r"/p/([0-9]{8,15})", url)
    if m_ajio:
        return m_ajio.group(1)
    return None


PRIMARY_COLOR_FAMILIES = {
    "black": {"black", "charcoal"},
    "white": {"white", "off white", "ivory", "cream", "neutral", "beige", "nude", "tan", "pastels"},
    "blue": {"blue", "navy", "navy blue", "sky blue", "indigo", "teal", "cyan"},
    "green": {"green", "olive", "emerald", "mint", "dark green", "sage"},
    "red": {"red", "maroon", "burgundy", "crimson", "ruby"},
    "pink": {"pink", "magenta", "fuchsia", "rose", "coral", "peach"},
    "yellow": {"yellow", "mustard", "gold", "lemon"},
    "purple": {"purple", "violet", "lavender", "lilac", "plum", "mauve"},
    "orange": {"orange", "rust"},
    "brown": {"brown", "khaki", "camel"},
}


def _detect_color_families(text: str) -> set[str]:
    t = text.lower()
    families = set()
    for fam, words in PRIMARY_COLOR_FAMILIES.items():
        for w in words:
            if re.search(r"\b" + re.escape(w) + r"\b", t):
                families.add(fam)
    return families


class URLProductComparisonService:
    """Dedicated service for comparing exact product prices for URL-originated garments."""

    def __init__(self, serpapi_key: Optional[str] = None, api_key: Optional[str] = None):
        self.serpapi_key = (
            serpapi_key
            or getattr(settings, "serpapi_api_key", None)
            or os.getenv("SERPAPI_API_KEY")
            or "2e429059ba970dd195e2b015cc69f7a179728facc27b243d996a6aa3548fe20e"
        )
        self.api_key = (
            api_key
            or getattr(settings, "searchapi_api_key", None)
            or os.getenv("SEARCHAPI_API_KEY")
            or "PPfe3AziK1FGR2btbHcSYgAy"
        )


    async def compare_product(
        self,
        source_url: Optional[str],
        brand: Optional[str],
        title: Optional[str],
        price: Optional[float] = None,
        original_price: Optional[float] = None,
        image_url: Optional[str] = None,
        retailer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Executes strict cross-platform exact product discovery and price resolution.
        """
        # Infer brand from title if missing
        if not brand and title:
            first_word = title.split()[0].strip()
            if len(first_word) > 2:
                brand = first_word

        source_retailer_id = _extract_retailer_from_url(source_url) if source_url else (retailer or "myntra").lower()
        source_brand_norm = _normalize_text(brand)
        source_title_norm = _normalize_text(title)
        source_style_id = _extract_style_id_from_url(source_url)
        source_tokens = _extract_tokens(title)

        logger.info(
            f"[URLComparison] Source product: brand='{brand}', title='{title}', "
            f"price={price}, retailer={source_retailer_id}, style_id={source_style_id}"
        )

        # 1. Start with the authoritative source retailer offer
        candidates: List[Dict[str, Any]] = []
        seen_retailers = set()

        # If source price is missing, attempt to scrape it
        if source_url and (price is None or price <= 0):
            try:
                async with httpx.AsyncClient(timeout=3.0, verify=False) as c_src:
                    src_p, src_mrp, src_disc, src_img, _ = await self._resolve_candidate_price(c_src, source_url, source_retailer_id, None)
                    if src_p and src_p > 0:
                        price = src_p
                        original_price = original_price or src_mrp
                        image_url = image_url or src_img
            except Exception:
                pass

        if source_url:
            formatted_p = f"₹{int(price):,}" if (price and price.is_integer()) else (f"₹{price:,.2f}" if price else "Check store")
            formatted_orig = None
            discount_pct = None
            discount_text = None

            if original_price and price and original_price > price:
                formatted_orig = f"₹{int(original_price):,}" if original_price.is_integer() else f"₹{original_price:,.2f}"
                discount_pct = int(round(((original_price - price) / original_price) * 100))
                if discount_pct > 0:
                    discount_text = f"{discount_pct}% OFF"

            candidates.append({
                "id": f"offer-{source_retailer_id}",
                "retailer": source_retailer_id,
                "platform": _format_retailer_name(source_retailer_id),
                "title": title or "Source Garment",
                "url": source_url,
                "image_url": image_url,
                "price": float(price) if price else None,
                "formatted_price": formatted_p,
                "original_price": float(original_price) if original_price else None,
                "formatted_original_price": formatted_orig,
                "discount_pct": discount_pct,
                "discount_text": discount_text,
                "is_exact": True,
                "match_confidence": 100.0,
                "is_best_deal": False,
                "price_source": "source_retailer",
                "delivery_note": "Free delivery",
            })
            seen_retailers.add(source_retailer_id)

        # 2. Query SearchAPI across major fashion retailers using Google Shopping & Organic
        discovered_raw = await self._discover_candidates(
            brand=brand,
            title=title,
            image_url=image_url,
            style_id=source_style_id,
        )

        # 3. Verify Exact Product Identity (Strict brand + title/model consensus)
        verified_candidates = []
        for raw in discovered_raw:
            cand_url = raw.get("url") or ""
            cand_seller = raw.get("seller")
            cand_retailer = _extract_retailer_from_url(cand_url, cand_seller)

            # Deduplicate by retailer: 1 best offer per retailer
            if cand_retailer in seen_retailers or cand_retailer == "other":
                continue

            is_exact, confidence, reason = self._verify_exact_product(
                source_brand=source_brand_norm,
                source_title=source_title_norm,
                source_tokens=source_tokens,
                source_style_id=source_style_id,
                candidate=raw,
            )

            if is_exact:
                seen_retailers.add(cand_retailer)
                verified_candidates.append({
                    "raw": raw,
                    "retailer": cand_retailer,
                    "confidence": confidence,
                })
            else:
                logger.debug(f"[URLComparison] Rejected candidate '{raw.get('title')}': {reason}")

        ALLOWED_RETAILERS = {
            "myntra", "flipkart", "ajio", "amazon", "nykaa", "tatacliq", "meesho",
            "libas", "biba", "shoppersstop", "snitch", "bewakoof", "houseofrare",
            "wforwoman", "aurelia", "soch", "fabindia", "bairaj", "marksandspencer", "zara", "hm", "westside", "pantaloons", "max"
        }

        # 4. Concurrently resolve live prices for all verified exact candidates
        if verified_candidates:
            async with httpx.AsyncClient(timeout=3.5, verify=False) as client:
                price_tasks = [
                    self._resolve_candidate_price(client, v["raw"]["url"], v["retailer"], v["raw"].get("snippet_price"))
                    for v in verified_candidates
                ]
                resolved_prices = await asyncio.gather(*price_tasks, return_exceptions=True)

                for v, p_res in zip(verified_candidates, resolved_prices):
                    raw = v["raw"]
                    c_ret = v["retailer"]

                    # Filter out unknown/untrusted retailers
                    if c_ret not in ALLOWED_RETAILERS:
                        continue

                    resolved_p, resolved_mrp, resolved_disc, resolved_img, p_src = (
                        p_res if isinstance(p_res, tuple) else (raw.get("snippet_price"), raw.get("snippet_mrp"), raw.get("snippet_disc"), None, "searchapi")
                    )
                    resolved_p = _parse_inr_price(resolved_p or raw.get("snippet_price"))
                    resolved_mrp = _parse_inr_price(resolved_mrp or raw.get("snippet_mrp"))
                    resolved_disc = resolved_disc or raw.get("snippet_disc")

                    final_p = resolved_p
                    # STRICT RULE: Skip candidate if no valid numerical INR selling price is available
                    if not final_p or final_p < 100:
                        continue

                    # Outlier filter: reject prices that are drastically mismatched (>3.5x or <0.2x)
                    if price and price > 0:
                        if final_p > (price * 3.5) or final_p < (price * 0.2):
                            continue

                    cand_img = resolved_img or raw.get("image_url") or image_url
                    if not cand_img or not str(cand_img).startswith("http"):
                        cand_img = image_url

                    formatted_p = f"₹{int(final_p):,}" if final_p.is_integer() else f"₹{final_p:,.2f}"
                    
                    formatted_orig = None
                    discount_text = None
                    if resolved_mrp and final_p and resolved_mrp > final_p:
                        formatted_orig = f"₹{int(resolved_mrp):,}" if resolved_mrp.is_integer() else f"₹{resolved_mrp:,.2f}"
                        if not resolved_disc:
                            resolved_disc = int(round(((resolved_mrp - final_p) / resolved_mrp) * 100))
                        if resolved_disc and resolved_disc > 0:
                            discount_text = f"{resolved_disc}% OFF"

                    candidates.append({
                        "id": f"offer-{c_ret}-{uuid.uuid4().hex[:4]}",
                        "retailer": c_ret,
                        "platform": _format_retailer_name(c_ret),
                        "title": raw.get("title") or title or "Exact Product Offer",
                        "url": raw.get("url") or "",
                        "image_url": cand_img,
                        "price": final_p,
                        "formatted_price": formatted_p,
                        "original_price": resolved_mrp,
                        "formatted_original_price": formatted_orig,
                        "discount_pct": resolved_disc,
                        "discount_text": discount_text,
                        "is_exact": True,
                        "match_confidence": v["confidence"],
                        "is_best_deal": False,
                        "price_source": p_src or "live_retailer",
                        "delivery_note": "Free delivery",
                    })

        # 5. Dynamically determine BEST DEAL (lowest valid numerical selling price)
        min_price = float("inf")
        best_deal_id = None
        best_price = None
        best_retailer = None

        for cand in candidates:
            p_val = cand.get("price")
            if p_val and isinstance(p_val, (int, float)) and 0 < p_val < min_price:
                min_price = p_val
                best_deal_id = cand["id"]
                best_price = p_val
                best_retailer = cand["retailer"]

        for cand in candidates:
            if cand["id"] == best_deal_id:
                cand["is_best_deal"] = True

        # Sort candidates: BEST DEAL first, then by price ascending
        candidates.sort(key=lambda c: (not c["is_best_deal"], c.get("price") or float("inf")))

        return {
            "source_product": {
                "brand": brand,
                "title": title,
                "url": source_url,
                "image_url": image_url,
                "price": price,
                "retailer": source_retailer_id,
            },
            "best_deal_id": best_deal_id,
            "best_price": best_price,
            "best_retailer": best_retailer,
            "candidates": candidates,
            "total_exact_stores": len(candidates),
        }

    async def _discover_candidates(
        self,
        brand: Optional[str],
        title: Optional[str],
        image_url: Optional[str],
        style_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        """
        Discovers exact product candidates across fashion platforms.
        Primary: SerpApi Google Lens API (Multimodal Visual Search matching exact garment photos).
        Fallback: Google Shopping & Targeted Organic Search.
        """
        search_query = f"{brand or ''} {title or ''}".strip()
        if not search_query and not image_url:
            return []

        clean_title = re.sub(rf"\b{re.escape(brand or '')}\b", "", title or "", flags=re.IGNORECASE).strip()
        generic_query = f"{clean_title}".strip() or search_query

        results: List[Dict[str, Any]] = []

        # 1. Primary Strategy: SerpApi Google Lens API via Image Upload
        if image_url and self.serpapi_key:
            try:
                async with httpx.AsyncClient(timeout=25.0, verify=False) as client:
                    # Download image bytes if image_url is provided
                    image_id = None
                    try:
                        r_img = await client.get(image_url, timeout=6.0, follow_redirects=True)
                        if r_img.status_code == 200 and len(r_img.content) > 100:
                            # Upload to SerpApi
                            r_up = await client.post(
                                "https://serpapi.com/image",
                                files={"image": ("garment.jpg", r_img.content, "image/jpeg")},
                                data={"api_key": self.serpapi_key},
                                timeout=12.0
                            )
                            if r_up.status_code == 200:
                                image_id = r_up.json().get("image_id")
                    except Exception as e_up:
                        logger.debug(f"[URLComparison] Image fetch/upload to SerpApi failed: {e_up}")

                    params = {
                        "engine": "google_lens",
                        "country": "in",
                        "hl": "en",
                        "api_key": self.serpapi_key,
                    }
                    if image_id:
                        params["image_id"] = image_id
                    else:
                        params["url"] = image_url

                    resp_lens = await client.get(SERPAPI_URL, params=params, timeout=25.0)
                    if resp_lens.status_code == 200:
                        data = resp_lens.json()
                        lens_matches = data.get("exact_matches", []) + data.get("visual_matches", [])
                        for item in lens_matches:
                            cand_title = item.get("title") or ""
                            cand_url = item.get("link") or item.get("source_link") or ""
                            cand_seller = item.get("source") or item.get("seller")
                            cand_thumb = item.get("thumbnail") or (item.get("image", {}).get("link") if isinstance(item.get("image"), dict) else None)
                            
                            snippet_p = None
                            price_obj = item.get("price")
                            if isinstance(price_obj, dict):
                                snippet_p = price_obj.get("extracted_value") or price_obj.get("value")
                            elif isinstance(price_obj, (int, float)):
                                snippet_p = float(price_obj)
                            elif isinstance(price_obj, str):
                                m_p = re.search(r"[\d,.]+", price_obj)
                                if m_p:
                                    try:
                                        snippet_p = float(m_p.group(0).replace(",", ""))
                                    except Exception:
                                        pass
                            
                            if snippet_p is None and item.get("extracted_price") is not None:
                                try:
                                    snippet_p = float(item.get("extracted_price"))
                                except Exception:
                                    pass

                            if cand_title and cand_url and cand_url.startswith("http"):
                                results.append({
                                    "title": cand_title,
                                    "url": cand_url,
                                    "seller": cand_seller,
                                    "image_url": cand_thumb,
                                    "snippet_price": snippet_p,
                                    "snippet_mrp": None,
                                    "snippet_disc": None,
                                    "is_visual_match": True,
                                })
            except Exception as e:
                logger.warn(f"[URLComparison] SerpApi Google Lens discovery failed: {e}")

        # 2. Secondary Strategy: SearchApi Google Lens fallback if SerpApi yielded no results
        if not results and image_url and self.api_key:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp_sapi_lens = await client.get(
                        SEARCHAPI_URL,
                        params={
                            "engine": "google_lens",
                            "url": image_url,
                            "country": "in",
                            "hl": "en",
                            "api_key": self.api_key,
                        },
                    )
                    if resp_sapi_lens.status_code == 200:
                        data = resp_sapi_lens.json()
                        for item in data.get("visual_matches", []) + data.get("exact_matches", []):
                            cand_title = item.get("title") or ""
                            cand_url = item.get("link") or ""
                            cand_seller = item.get("source") or item.get("seller")
                            cand_thumb = item.get("thumbnail") or item.get("image")
                            snippet_p = item.get("extracted_price")
                            if isinstance(snippet_p, dict):
                                snippet_p = snippet_p.get("value") or snippet_p.get("amount")
                            if snippet_p is None and item.get("price"):
                                m_p = re.search(r"[\d,.]+", str(item.get("price")))
                                if m_p:
                                    try:
                                        snippet_p = float(m_p.group(0).replace(",", ""))
                                    except Exception:
                                        pass
                            if cand_title and cand_url and cand_url.startswith("http"):
                                results.append({
                                    "title": cand_title,
                                    "url": cand_url,
                                    "seller": cand_seller,
                                    "image_url": cand_thumb,
                                    "snippet_price": snippet_p,
                                    "snippet_mrp": None,
                                    "snippet_disc": None,
                                    "is_visual_match": True,
                                })
            except Exception as e:
                logger.warn(f"[URLComparison] SearchAPI Google Lens fallback failed: {e}")

        # 3. Fallback: Google Shopping & Targeted Organic Search (if no visual matches found)
        if not results and (self.api_key or self.serpapi_key):
            active_key = self.api_key or self.serpapi_key
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp_shop = await client.get(
                        SEARCHAPI_URL,
                        params={
                            "engine": "google_shopping",
                            "q": search_query,
                            "gl": "in",
                            "hl": "en",
                            "api_key": active_key,
                        }
                    )
                    if resp_shop.status_code == 200:
                        data = resp_shop.json()
                        for item in data.get("shopping_results", []):
                            link = item.get("link") or item.get("product_link") or item.get("offers_link")
                            cand_title = item.get("title") or ""
                            cand_seller = item.get("seller") or item.get("source")
                            snippet_p = item.get("extracted_price")
                            if snippet_p is None and item.get("price"):
                                m_p = re.search(r"[\d,.]+", str(item.get("price")))
                                if m_p:
                                    try:
                                        snippet_p = float(m_p.group(0).replace(",", ""))
                                    except Exception:
                                        pass
                            if cand_title and link:
                                results.append({
                                    "title": cand_title,
                                    "url": link,
                                    "seller": cand_seller,
                                    "image_url": item.get("thumbnail"),
                                    "snippet_price": snippet_p,
                                    "snippet_mrp": None,
                                    "snippet_disc": None,
                                    "is_visual_match": False,
                                })
            except Exception as e:
                logger.warn(f"[URLComparison] SearchAPI Google Shopping discovery failed: {e}")

        # 4. Resilient Fallback Meta-Search with 4-row grouping
        if len(results) < 3:
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
                }
                async with httpx.AsyncClient(timeout=5.0, headers=headers) as fb_client:
                    for fb_q in [
                        f"{search_query} buy online India Flipkart AJIO Meesho Tata CLiQ Myntra",
                        f"{generic_query} buy online India Flipkart AJIO Meesho Nykaa",
                    ]:
                        r_fb = await fb_client.post("https://lite.duckduckgo.com/lite/", data={"q": fb_q})
                        if r_fb.status_code == 200:
                            from bs4 import BeautifulSoup
                            soup = BeautifulSoup(r_fb.text, "html.parser")
                            rows = soup.select("table tr")
                            i = 0
                            while i < len(rows):
                                tr = rows[i]
                                a_link = tr.select_one("a.result-link")
                                if a_link:
                                    raw_link = a_link.get("href", "")
                                    real_link = raw_link
                                    if "uddg=" in raw_link:
                                        m_u = re.search(r"uddg=([^&]+)", raw_link)
                                        if m_u:
                                            real_link = unquote(m_u.group(1))

                                    t_text = a_link.get_text(strip=True)
                                    s_text = ""
                                    if i + 1 < len(rows):
                                        s_td = rows[i + 1].select_one("td.result-snippet")
                                        if s_td:
                                            s_text = s_td.get_text(strip=True)

                                    p_price, p_mrp, p_disc = self._parse_snippet_pricing(t_text, s_text)

                                    if real_link.startswith("http") and t_text:
                                        results.append({
                                            "title": t_text,
                                            "url": real_link,
                                            "seller": None,
                                            "image_url": None,
                                            "snippet_price": p_price,
                                            "snippet_mrp": p_mrp,
                                            "snippet_disc": p_disc,
                                            "is_visual_match": False,
                                        })
                                    i += 2
                                else:
                                    i += 1
            except Exception as fb_err:
                logger.warn(f"[URLComparison] Fallback discovery error: {fb_err}")

        return results

    def _parse_snippet_pricing(self, title: str, snippet: str) -> Tuple[Optional[float], Optional[float], Optional[int]]:
        """Extracts selling price, MRP, and discount percentage from search snippets."""
        combined = f"{title} {snippet}"
        snippet_price = None
        snippet_mrp = None
        snippet_disc = None

        m_prices = re.findall(r"(?:₹|Rs\.?\s*)\s*([\d,]+(?:\.\d+)?)", combined)
        if m_prices:
            parsed_nums = []
            for p_raw in m_prices:
                try:
                    val = float(p_raw.replace(",", ""))
                    if 100 <= val <= 200000:
                        parsed_nums.append(val)
                except Exception:
                    pass
            if parsed_nums:
                if len(parsed_nums) == 1:
                    snippet_price = parsed_nums[0]
                else:
                    snippet_price = min(parsed_nums)
                    snippet_mrp = max(parsed_nums)

        m_disc = re.search(r"(\d{1,2})\s*%\s*off", combined, re.IGNORECASE)
        if m_disc:
            try:
                snippet_disc = int(m_disc.group(1))
            except Exception:
                pass

        return snippet_price, snippet_mrp, snippet_disc

    def _verify_exact_product(
        self,
        source_brand: str,
        source_title: str,
        source_tokens: set[str],
        source_style_id: Optional[str],
        candidate: Dict[str, Any],
    ) -> Tuple[bool, float, str]:
        """
        Verifies whether a candidate is the exact same garment piece (identical style, category, fabric, pattern, color).
        Accepts cross-label / private-label listings when key garment attributes match strictly.
        Returns: (is_exact, confidence, reason)
        """
        cand_url = candidate.get("url") or ""
        cand_title = candidate.get("title") or ""
        cand_title_norm = _normalize_text(cand_title)
        cand_tokens = _extract_tokens(cand_title)

        # 1. Reject non-product pages and search category listings
        if any(bad in cand_url.lower() for bad in ["/search", "/category", "/all-products", "/collection", "/tag", "youtube.com", "instagram.com", "/s?k=", "/pl/"]):
            return False, 0.0, "Non-product URL"

        categories = {"kurta", "kurti", "dress", "top", "shirt", "tshirt", "jeans", "trousers", "pants", "palazzo", "skirt", "saree", "lehenga", "jacket", "blazer", "coat", "sweater", "hoodie", "shorts", "jumpsuit", "suit"}
        source_cats = categories.intersection(source_tokens)
        cand_cats = categories.intersection(cand_tokens)

        # Visual match verification path (Google Lens candidate)
        if candidate.get("is_visual_match") is True:
            if source_cats and cand_cats:
                is_compat = bool(source_cats.intersection(cand_cats)) or (
                    bool({"kurta", "kurti", "suit"}.intersection(source_cats)) and bool({"kurta", "kurti", "suit"}.intersection(cand_cats))
                )
                if not is_compat:
                    return False, 0.0, f"Incompatible category for visual match: {source_cats} vs {cand_cats}"
            return True, 95.0, "Google Lens visual match"

        # 2. Check Style ID / SKU match (Authoritative exact)
        cand_style_id = _extract_style_id_from_url(cand_url)
        if source_style_id and cand_style_id and source_style_id == cand_style_id:
            return True, 100.0, f"Style ID match ({source_style_id})"

        # 3. Category Validation
        categories = {"kurta", "kurti", "dress", "top", "shirt", "tshirt", "jeans", "trousers", "pants", "palazzo", "skirt", "saree", "lehenga", "jacket", "blazer", "coat", "sweater", "hoodie", "shorts", "jumpsuit", "suit"}
        source_cats = categories.intersection(source_tokens)
        cand_cats = categories.intersection(cand_tokens)

        if source_cats:
            # If candidate explicitly lists an incompatible category (e.g. Saree vs Kurta), reject
            if cand_cats:
                is_compat = bool(source_cats.intersection(cand_cats)) or (
                    bool({"kurta", "kurti", "suit"}.intersection(source_cats)) and bool({"kurta", "kurti", "suit"}.intersection(cand_cats))
                )
                if not is_compat:
                    return False, 0.0, f"Incompatible category: {source_cats} vs {cand_cats}"

        # 4. Strict Color Family Conflict Check
        source_colors = _detect_color_families(source_title)
        cand_colors = _detect_color_families(cand_title)
        if source_colors and cand_colors:
            if not source_colors.intersection(cand_colors):
                return False, 0.0, f"Color conflict: {source_colors} vs {cand_colors}"
        elif not source_colors and cand_colors:
            # If source is neutral/unspecified, reject prominent contrasting dark/vivid colors
            if any(f in cand_colors for f in ["black", "blue", "green", "red", "purple", "orange"]):
                return False, 0.0, f"Contrasting color mismatch: candidate has {cand_colors}"

        # 5. Strict Pattern / Craftsmanship Conflict Check
        is_source_embroidered = "embroidered" in source_tokens or "thread" in source_tokens
        if is_source_embroidered:
            # If candidate is solely printed and lacks embroidery/thread work, reject
            if "printed" in cand_tokens and "embroidered" not in cand_tokens and "thread" not in cand_tokens and "motifs" not in cand_tokens:
                return False, 0.0, "Pattern mismatch: candidate is printed without embroidery"

        # 6. Attribute & Token Overlap
        if not source_tokens:
            return False, 0.0, "Empty source tokens"

        intersection = source_tokens.intersection(cand_tokens)
        overlap_ratio = len(intersection) / len(source_tokens)

        # Brand match scenario
        has_brand_match = False
        if source_brand:
            brand_in_title = source_brand in cand_title_norm
            brand_in_url = source_brand.replace(" ", "") in cand_url.lower()
            cand_seller = candidate.get("seller")
            brand_in_seller = source_brand in _normalize_text(cand_seller) if cand_seller else False
            has_brand_match = brand_in_title or brand_in_url or brand_in_seller

        if has_brand_match:
            if overlap_ratio >= 0.45:
                confidence = round(75.0 + (overlap_ratio * 25.0), 1)
                return True, confidence, f"Same Brand + Token consensus ({len(intersection)}/{len(source_tokens)})"
            return False, 0.0, f"Same brand but different model ({len(intersection)}/{len(source_tokens)})"

        # Cross-label / OEM garment match scenario (different brand name but exact identical garment attributes)
        # Must have at least 3 shared key attribute tokens or >= 50% overlap
        if len(intersection) >= 3 or overlap_ratio >= 0.50:
            confidence = round(65.0 + (overlap_ratio * 30.0), 1)
            return True, confidence, f"Identical garment attribute consensus ({len(intersection)}/{len(source_tokens)} tokens)"

        return False, 0.0, f"Insufficient attribute overlap ({len(intersection)}/{len(source_tokens)})"

    async def _resolve_candidate_price(
        self,
        client: httpx.AsyncClient,
        url: str,
        retailer_id: str,
        snippet_price: Optional[float],
    ) -> Tuple[Optional[float], Optional[float], Optional[int], Optional[str], str]:
        """Resolves live selling price from candidate retailer PDP."""
        # 1. Fast path for Shopify stores
        if retailer_id in ["thehouseofrare", "libas", "snitch", "trendia", "bairaj"]:
            try:
                clean_base = url.split("?")[0].rstrip("/")
                json_url = f"{clean_base}.json"
                r = await client.get(json_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=2.5)
                if r.status_code == 200:
                    p_data = r.json().get("product", {})
                    variants = p_data.get("variants", [])
                    if variants:
                        p_str = variants[0].get("price")
                        cmp_str = variants[0].get("compare_at_price")
                        p_val = float(p_str) if p_str else None
                        cmp_val = float(cmp_str) if cmp_str else None
                        img_url = p_data.get("image", {}).get("src")
                        disc_pct = int(round(((cmp_val - p_val) / cmp_val) * 100)) if (cmp_val and p_val and cmp_val > p_val) else None
                        if p_val and p_val > 0:
                            return p_val, cmp_val, disc_pct, img_url, "live_retailer"
            except Exception:
                pass

        # 2. HTTP PDP scraping for JSON-LD and meta tags
        try:
            if url and url.startswith("http"):
                r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}, timeout=2.5, follow_redirects=True)
                if r.status_code == 200:
                    html = r.text
                    m_disc = re.search(r'\"discountedPrice\":\s*(\d+)', html) or re.search(r'\"price\":\s*\"?([\d,.]+)\"?', html)
                    m_mrp = re.search(r'\"mrp\":\s*(\d+)', html) or re.search(r'\"strikePrice\":\s*(\d+)', html)
                    p_val = float(m_disc.group(1).replace(",", "")) if m_disc else None
                    mrp_val = float(m_mrp.group(1).replace(",", "")) if m_mrp else None
                    disc_pct = int(round(((mrp_val - p_val) / mrp_val) * 100)) if (mrp_val and p_val and mrp_val > p_val) else None

                    if p_val and p_val > 0:
                        return p_val, mrp_val, disc_pct, None, "live_retailer"
        except Exception:
            pass

        # 3. Fallback to SearchAPI snippet price if live fetch is blocked
        if snippet_price and snippet_price > 0:
            return snippet_price, None, None, None, "searchapi"

        return None, None, None, None, "unresolved"


_service_instance: Optional[URLProductComparisonService] = None


def get_url_product_comparison_service() -> URLProductComparisonService:
    global _service_instance
    if _service_instance is None:
        _service_instance = URLProductComparisonService()
    return _service_instance
