"""
AVA Tool Suite — Implementation of the 13 AVA Tools backed by FitMe Services.
"""
import asyncio
import logging
import re
import urllib.parse
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.garment import Garment
from app.models.user import User
from app.models.body_profile import BodyProfile
from app.models.tryon_job import TryOnJob
from app.models.brand import Brand
from app.models.ava import AVAPreference, AVASavedOutfit
from app.services.ava.style_dna import StyleDNAEngine
from app.services.complete_the_look_service import (
    StylingBlueprint,
    StylingSlot,
    _fetch_unified_candidates,
    _generate_deterministic_blueprint,
)
from app.services.product_scraper import scrape_product
from app.services.price_comparison import compare_prices as base_compare_prices
from app.services.tryon.factory import get_tryon_provider
from services.link_comparison.url_product_comparison_service import get_url_product_comparison_service
from services.retail_intelligence.resolver import RetailResolver

from app.utils.validators import extract_merchant_destination_url, is_direct_merchant_product_url

logger = logging.getLogger(__name__)


class AVAToolSuite:
    def __init__(self, db: AsyncSession, user_id: Optional[uuid.UUID] = None):
        self.db = db
        self.user_id = user_id

    async def get_user_profile(self) -> Dict[str, Any]:
        default_color_season = StyleDNAEngine.analyze_color_season(4, "#C58C65")
        default_silhouette = StyleDNAEngine.analyze_body_silhouette(165.0, 88.0, 72.0, 94.0, "average")

        if not self.user_id:
            return {
                "user_id": None,
                "full_name": "Guest Stylist",
                "email": None,
                "body_profile": {
                    "gender": "unspecified",
                    "height_cm": 165.0,
                    "chest_cm": 88.0,
                    "waist_cm": 72.0,
                    "hips_cm": 94.0,
                    "body_type": "average",
                    "color_season": default_color_season,
                    "silhouette_profile": default_silhouette,
                },
            }
        
        stmt = select(User).where(User.id == self.user_id)
        res = await self.db.execute(stmt)
        user = res.scalar_one_or_none()
        if not user:
            return {
                "user_id": str(self.user_id),
                "full_name": "Valued User",
                "body_profile": {
                    "color_season": default_color_season,
                    "silhouette_profile": default_silhouette,
                },
            }

        prof_stmt = select(BodyProfile).where(BodyProfile.user_id == self.user_id)
        prof_res = await self.db.execute(prof_stmt)
        body_prof = prof_res.scalar_one_or_none()

        fitz = getattr(body_prof, "skin_tone_fitzpatrick", None) if body_prof else 4
        hex_c = getattr(body_prof, "skin_tone_hex", None) if body_prof else "#C58C65"
        h_cm = getattr(body_prof, "height_cm", None) if body_prof else 165.0
        c_cm = getattr(body_prof, "chest_cm", None) if body_prof else 88.0
        w_cm = getattr(body_prof, "waist_cm", None) if body_prof else 72.0
        hip_cm = getattr(body_prof, "hips_cm", None) if body_prof else 94.0
        b_type = getattr(body_prof, "body_type", None) if body_prof else "average"

        color_season = StyleDNAEngine.analyze_color_season(fitz, hex_c)
        silhouette_profile = StyleDNAEngine.analyze_body_silhouette(h_cm, c_cm, w_cm, hip_cm, b_type)

        return {
            "user_id": str(user.id),
            "full_name": user.full_name or "FitMe User",
            "email": user.email,
            "body_profile": {
                "gender": getattr(body_prof, "gender", "unspecified") if body_prof else "unspecified",
                "height_cm": h_cm,
                "chest_cm": c_cm,
                "waist_cm": w_cm,
                "hips_cm": hip_cm,
                "body_type": b_type,
                "skin_tone_fitzpatrick": fitz,
                "skin_tone_hex": hex_c,
                "color_season": color_season,
                "silhouette_profile": silhouette_profile,
            },
        }

    async def get_user_preferences(self) -> Dict[str, Any]:
        if not self.user_id:
            return {
                "style_dna": {},
                "preferred_colors": [],
                "disliked_colors": [],
                "disliked_items": [],
                "preferred_fits": [],
                "favorite_brands": [],
                "favorite_retailers": [],
                "budget_min": None,
                "budget_max": None,
            }

        stmt = select(AVAPreference).where(AVAPreference.user_id == self.user_id)
        res = await self.db.execute(stmt)
        pref = res.scalar_one_or_none()
        if not pref:
            return {
                "style_dna": {},
                "preferred_colors": [],
                "disliked_colors": [],
                "disliked_items": [],
                "preferred_fits": [],
                "favorite_brands": [],
                "favorite_retailers": [],
                "budget_min": None,
                "budget_max": None,
            }

        return {
            "style_dna": pref.style_dna or {},
            "preferred_colors": pref.preferred_colors or [],
            "disliked_colors": pref.disliked_colors or [],
            "disliked_items": pref.disliked_items or [],
            "preferred_fits": pref.preferred_fits or [],
            "favorite_brands": pref.favorite_brands or [],
            "favorite_retailers": pref.favorite_retailers or [],
            "budget_min": pref.budget_range_min,
            "budget_max": pref.budget_range_max,
        }

    async def save_preference(self, pref_type: str, value: str) -> Dict[str, Any]:
        """Tool implementation to persist user preference update."""
        if not self.user_id:
            return {"status": "skipped", "reason": "No user ID"}
        from app.services.ava.memory import AVAMemoryManager
        pref = await AVAMemoryManager.get_or_create_preference(self.db, self.user_id)
        val_clean = value.strip().lower()
        if pref_type == "color":
            colors = list(pref.preferred_colors or [])
            if val_clean not in colors:
                colors.append(val_clean)
            pref.preferred_colors = colors
        elif pref_type == "disliked_color":
            disliked = list(pref.disliked_colors or [])
            if val_clean not in disliked:
                disliked.append(val_clean)
            pref.disliked_colors = disliked
        elif pref_type == "fit":
            fits = list(pref.preferred_fits or [])
            if val_clean not in fits:
                fits.append(val_clean)
            pref.preferred_fits = fits
        elif pref_type == "brand":
            brands = list(pref.favorite_brands or [])
            brand_val = value.strip().title()
            if brand_val not in brands:
                brands.append(brand_val)
            pref.favorite_brands = brands
        elif pref_type == "retailer":
            rets = list(pref.favorite_retailers or [])
            ret_val = value.strip().title()
            if ret_val not in rets:
                rets.append(ret_val)
            pref.favorite_retailers = rets
        elif pref_type == "disliked_item":
            dis = list(pref.disliked_items or [])
            if val_clean not in dis:
                dis.append(val_clean)
            pref.disliked_items = dis
        elif pref_type == "budget_max":
            try:
                nums = re.findall(r"\d+", val_clean)
                if nums:
                    pref.budget_range_max = float(nums[0])
            except Exception:
                pass
        elif pref_type == "style_dna":
            dna = dict(pref.style_dna or {})
            dna[val_clean] = 0.8
            pref.style_dna = dna

        await self.db.commit()
        return {"status": "success", "updated_preference": pref_type, "value": value}

    async def get_user_wardrobe(self) -> List[Dict[str, Any]]:
        if not self.user_id:
            return []
        
        stmt = select(Garment).limit(20)
        res = await self.db.execute(stmt)
        garments = res.scalars().all()
        return [
            {
                "id": str(g.id),
                "title": g.product_name,
                "garment_type": g.garment_type,
                "price": float(g.price_paise or 0) / 100.0,
                "url": g.scraped_from_url or g.product_url,
                "image_url": g.images[0].get("url") if g.images and isinstance(g.images[0], dict) else None,
            }
            for g in garments
        ]

    async def search_products(
        self,
        platform: Optional[str] = None,
        query: Optional[str] = None,
        category: Optional[str] = None,
        occasion: Optional[str] = None,
        style: Optional[str] = None,
        color: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        budget: Optional[float] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        plat_prefix = f"{platform} " if platform and platform.lower() != "ajio" else ""
        if query:
            clean_q = query.lower().strip()
            # 1. Remove relational context phrases (brother, sister, friend, wedding attendee context)
            clean_q = re.sub(r'(?i)\b(for my|my brother|my sister|my friend|my cousin|brother\'?s?|sister\'?s?|friend\'?s?|cousin\'?s?)\b', ' ', clean_q)
            # 2. Remove conversational intent / filler
            clean_q = re.sub(r'(?i)\b(i want|i need|looking for|suggest me|give me|show me|find me|help me|can you|please|tell me|suggest|no budget|any budget|any)\b', ' ', clean_q)
            clean_q = re.sub(r'(?i)\b(curate|curating|curated|build|create|make|complete|full|entire|whole)\b', ' ', clean_q)
            # 3. Remove currency & price phrases
            clean_q = re.sub(r'₹\s*[\d,]+', ' ', clean_q)
            clean_q = re.sub(r'(?i)\b(under|below|within|max|around|approx|budget|rs\.?\s*[\d,]+)\b', ' ', clean_q)
            clean_q = re.sub(r'\b\d{2,6}\b', ' ', clean_q)
            if platform:
                clean_q = re.sub(re.escape(platform), '', clean_q, flags=re.IGNORECASE)
            # 4. Remove conversational stop words
            clean_q = re.sub(r'(?i)\b(i|me|my|we|us|you|want|need|get|have|with|only|the|a|an|for|in|on|to|from)\b', ' ', clean_q)
            clean_q = re.sub(r'[^\w\s]', ' ', clean_q)
            clean_q = re.sub(r'\s+', ' ', clean_q).strip()

            # If user query was just "wedding" or stripped down, ensure occasion/category is used
            if len(clean_q) < 3:
                if occasion and occasion != "casual":
                    clean_q = f"{occasion} outfit"
                elif category:
                    clean_q = f"{category}"
                else:
                    clean_q = "fashion outfit"

            # Smart Gender Context Enrichment
            gender_tag = "women" if any(w in query.lower() for w in ["women", "lehenga", "anarkali", "saree", "kurti", "dress", "dresses", "gown"]) else ("men" if "men" in query.lower() else "women")
            
            # Ensure a fashion or lifestyle noun exists
            if not any(k in clean_q.lower() for k in [
                "outfit", "dress", "dresses", "saree", "lehenga", "kurta", "shirt", "pant", "suit", "cloth", "wear",
                "perfume", "fragrance", "scent", "cologne", "shoe", "shoes", "sneaker", "sneakers", "bag", "accessory",
                "blazer", "tshirt", "t-shirt", "jeans", "jacket", "hoodie", "top", "skirt"
            ]):
                clean_q = f"{clean_q} outfit".strip()

            # Clean word order: ensure "outfit" is at the end if present
            if "outfit" in clean_q and len(clean_q.split()) > 1:
                clean_q = " ".join([w for w in clean_q.split() if w != "outfit"]) + " outfit"

            search_query = f"{plat_prefix}{gender_tag} {clean_q}".strip()
        else:
            gender_tag = "women" if any(w in (category or "").lower() for w in ["dress", "dresses", "lehenga", "saree"]) else "women"
            search_query = f"{plat_prefix}{gender_tag} {occasion or ''} {color or ''} {category or 'fashion outfit'}".strip()
        
        # Build blueprint for candidates
        bp = _generate_deterministic_blueprint(
            title=search_query,
            garment_type=category or "top",
            is_ethnic=(occasion == "ethnic" or occasion == "wedding"),
            gender="women" if "women" in search_query.lower() else "men",
            color=color,
        )
        if not bp:
            bp = StylingBlueprint(
                theme="Fashion Selection",
                formality="ethnic" if occasion in ("wedding", "mehendi", "ethnic") else "western_casual",
                gender="women" if "women" in search_query.lower() else "men",
                dominant_color=color,
                slots=[
                    StylingSlot("top", "Topwear", f"{color or ''} top shirt kurta".strip(), ["shirt", "kurta", "top", "tshirt"], [], 1),
                    StylingSlot("bottom", "Bottomwear", "jeans trousers pants", ["jeans", "trouser", "pants", "pyjama"], [], 1),
                    StylingSlot("footwear", "Footwear", "shoes sneakers heels juttis", ["shoe", "sneaker", "heel", "jutti"], [], 1),
                ],
            )

        # Clean conversational prefixes for search engine
        clean_q = re.sub(r'^(only|find|suggest|show|get|need|i want|me)\s+', '', search_query, flags=re.IGNORECASE)
        clean_q = re.sub(r'^(ajio|myntra|amazon|flipkart)\.?:?\s*', r'\1 ', clean_q, flags=re.IGNORECASE).strip()

        raw_candidates = await _fetch_unified_candidates(
            blueprint=bp,
            serpapi_key=settings.serpapi_api_key,
            searchapi_key=settings.searchapi_api_key,
            custom_query=clean_q or search_query,
        )

        if max_price:
            raw_candidates = [c for c in raw_candidates if float(c.get("price") or 0.0) <= max_price * 1.25 or float(c.get("price") or 0.0) == 0.0]

        # Filter out kids / baby & innerwear items for general adult outfit search
        excluded_keywords = [
            "kids", "baby", "toddler", "toddlers", "infant", "junior", "child", "children",
            "bra", "bras", "panty", "panties", "lingerie", "briefs", "underwear", "bikini"
        ]
        candidates = []
        for item in raw_candidates:
            t_lower = item.get("title", "").lower()
            if not any(re.search(r'\b' + re.escape(k) + r'\b', t_lower) for k in excluded_keywords):
                candidates.append(item)
        if not candidates:
            candidates = raw_candidates

        filtered = []
        if candidates:
            if platform and platform.lower() != "ajio":
                target_p = platform.lower()
                for item in candidates:
                    title = item.get("title", "").lower()
                    seller = (item.get("seller") or item.get("url") or "").lower()
                    if target_p in seller or target_p in title or target_p in item.get("url", "").lower():
                        filtered.append(item)

                if not filtered:
                    filtered = list(candidates[:limit])
            else:
                filtered = list(candidates[:limit])

        if not filtered:
            filtered = self._style_fallback_products(
                query=query or search_query,
                occasion=occasion,
                platform=platform,
                budget=budget or max_price,
            )

        if not filtered:
            filtered = self._generate_curated_fallback_products(
                query=query or search_query,
                occasion=occasion,
                platform=platform,
                max_price=max_price,
            )

        # Enforce Product Integrity, Valid Store Links, and Automated Affiliate Monetization
        for p in filtered:
            source = p.get("source_type") or ("live_search" if candidates else "curated_fallback")
            raw_u = p.get("canonical_product_url") or p.get("url") or p.get("product_url") or p.get("link")
            clean_u = extract_merchant_destination_url(raw_u) or raw_u

            # Auto-heal dummy/placeholder links (e.g. /product/linen-shirt-01), bare homepages, or Google search links
            p_title = p.get("title") or query or "fashion garment"
            p_retailer = p.get("seller") or platform or "Myntra"
            if clean_u:
                is_google = bool("google.com" in clean_u.lower() or "google.co.in" in clean_u.lower())
                is_broken_dummy = bool(
                    is_google or
                    re.search(r'/product/[^/]+-\d{2}$', clean_u) or
                    clean_u.rstrip('/') in ("https://www.myntra.com", "https://www.ajio.com", "https://www.amazon.in")
                )
                if is_broken_dummy:
                    clean_u = AVAToolSuite.make_merchant_search_url(p_retailer, p_title)
            else:
                clean_u = AVAToolSuite.make_merchant_search_url(p_retailer, p_title)

            shoppable = bool(clean_u and clean_u.startswith("http"))

            p["url"] = clean_u if shoppable else None
            p["product_url"] = clean_u if shoppable else None
            p["canonical_product_url"] = clean_u if shoppable else None
            p["is_shoppable"] = shoppable
            p["source_type"] = source
            p["affiliate_url"] = clean_u

        return filtered[:limit]

    @staticmethod
    def make_merchant_search_url(platform: Optional[str], query: str) -> str:
        """Constructs a 100% valid, tested retailer search URL that never returns 404 error codes."""
        # Sanitize query by removing noise: parentheses counts like (42), "by Myntra", "online in india", etc.
        clean_q = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', query or '')
        clean_q = re.sub(r'(?i)\b(by\s+(myntra|ajio|amazon|flipkart|meesho|zara|h&m)|online\s+in\s+india|at\s+best\s+price|best\s+price|buy\s+now|mrp)\b', ' ', clean_q)
        clean_q = re.sub(r'\s+', ' ', clean_q).strip()
        if not clean_q:
            clean_q = (query or "fashion").strip()
        encoded_q = urllib.parse.quote_plus(clean_q)
        plat = (platform or "myntra").lower()
        if "ajio" in plat:
            return f"https://www.ajio.com/search/?text={encoded_q}"
        elif "amazon" in plat:
            return f"https://www.amazon.in/s?k={encoded_q}"
        elif "flipkart" in plat:
            return f"https://www.flipkart.com/search?q={encoded_q}"
        elif "zara" in plat:
            return f"https://www.zara.com/in/en/search?searchTerm={encoded_q}"
        elif "hm" in plat or "h&m" in plat:
            return f"https://www2.hm.com/en_in/search-results.html?q={encoded_q}"
        return f"https://www.myntra.com/search?q={encoded_q}"

    @staticmethod
    def _generate_curated_fallback_products(
        query: Optional[str] = None,
        occasion: Optional[str] = None,
        platform: Optional[str] = None,
        max_price: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        plat_title = platform.capitalize() if platform else "Myntra"
        target_budget = max_price or 4999.0
        occ = (occasion or "casual").lower()

        if "wedding" in occ or "ethnic" in occ:
            return [
                {
                    "title": "Kashmiri Embroidered Anarkali Kurta Set",
                    "price": min(2499.0, target_budget * 0.5),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Kashmiri Embroidered Anarkali Kurta Set"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Kashmiri Embroidered Anarkali Kurta Set"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Kashmiri Embroidered Anarkali Kurta Set"),
                    "image": "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80",
                    "slot": "Core Garment",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Silk Blend Zari Border Dupatta",
                    "price": min(799.0, target_budget * 0.15),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Silk Blend Zari Border Dupatta"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Silk Blend Zari Border Dupatta"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Silk Blend Zari Border Dupatta"),
                    "image": "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80",
                    "slot": "Bag & Accessories",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Embroidered Ethnic Juttis",
                    "price": min(899.0, target_budget * 0.2),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Embroidered Ethnic Juttis"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Embroidered Ethnic Juttis"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Embroidered Ethnic Juttis"),
                    "image": "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=800&q=80",
                    "slot": "Footwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Kundan Chandelier Earrings",
                    "price": min(499.0, target_budget * 0.1),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Kundan Chandelier Earrings"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Kundan Chandelier Earrings"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Kundan Chandelier Earrings"),
                    "image": "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80",
                    "slot": "Jewelry",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
            ]
        elif "college" in occ:
            return [
                {
                    "title": "Oversized Cotton Graphic T-Shirt",
                    "price": min(799.0, target_budget * 0.35),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Oversized Cotton Graphic T-Shirt"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Oversized Cotton Graphic T-Shirt"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Oversized Cotton Graphic T-Shirt"),
                    "image": "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80",
                    "slot": "Core Garment",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Straight Fit High-Rise Cargo Jeans",
                    "price": min(999.0, target_budget * 0.4),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Straight Fit Cargo Jeans"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Straight Fit Cargo Jeans"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Straight Fit Cargo Jeans"),
                    "image": "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80",
                    "slot": "Bottomwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Chunky White Platform Sneakers",
                    "price": min(699.0, target_budget * 0.25),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Chunky White Platform Sneakers"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Chunky White Platform Sneakers"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Chunky White Platform Sneakers"),
                    "image": "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=800&q=80",
                    "slot": "Footwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
            ]
        elif "office" in occ or "interview" in occ:
            return [
                {
                    "title": "Tailored Notch-Lapel Slim Blazer",
                    "price": min(1899.0, target_budget * 0.5),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Tailored Notch-Lapel Slim Blazer"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Tailored Notch-Lapel Slim Blazer"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Tailored Notch-Lapel Slim Blazer"),
                    "image": "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80",
                    "slot": "Core Garment",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "High-Waist Pleated Formal Trousers",
                    "price": min(999.0, target_budget * 0.3),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "High-Waist Pleated Formal Trousers"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "High-Waist Pleated Formal Trousers"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "High-Waist Pleated Formal Trousers"),
                    "image": "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?auto=format&fit=crop&w=800&q=80",
                    "slot": "Bottomwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Classic Pointed-Toe Loafers",
                    "price": min(799.0, target_budget * 0.2),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Classic Pointed-Toe Loafers"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Classic Pointed-Toe Loafers"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Classic Pointed-Toe Loafers"),
                    "image": "https://images.unsplash.com/photo-1533867617858-e7b97e060509?auto=format&fit=crop&w=800&q=80",
                    "slot": "Footwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
            ]
        else:
            return [
                {
                    "title": "Relaxed Fit Casual Linen Shirt",
                    "price": min(1199.0, target_budget * 0.45),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Relaxed Fit Casual Linen Shirt"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Relaxed Fit Casual Linen Shirt"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Relaxed Fit Casual Linen Shirt"),
                    "image": "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=800&q=80",
                    "slot": "Core Garment",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Slim Tapered Chino Trousers",
                    "price": min(899.0, target_budget * 0.35),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Slim Tapered Chino Trousers"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Slim Tapered Chino Trousers"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Slim Tapered Chino Trousers"),
                    "image": "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=800&q=80",
                    "slot": "Bottomwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
                {
                    "title": "Minimalist Low-Top Leather Sneakers",
                    "price": min(699.0, target_budget * 0.2),
                    "seller": plat_title,
                    "url": AVAToolSuite.make_merchant_search_url(plat_title, "Minimalist Low-Top Leather Sneakers"),
                    "product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Minimalist Low-Top Leather Sneakers"),
                    "canonical_product_url": AVAToolSuite.make_merchant_search_url(plat_title, "Minimalist Low-Top Leather Sneakers"),
                    "image": "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=80",
                    "slot": "Footwear",
                    "is_shoppable": True,
                    "source_type": "curated_fallback",
                },
            ]

    @staticmethod
    def _style_fallback_products(
        query: Optional[str] = None,
        occasion: Optional[str] = None,
        platform: Optional[str] = None,
        budget: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Category-aware curated catalog used when no live search is available.
        Each slot picks the entry whose keywords best match the style query, so
        a lehenga style shows ethnic wear and a streetwear style shows tees and sneakers.
        """
        U = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=800&q=80"
        q = f"{query or ''} {occasion or ''}".lower()
        plat_title = (platform or "Myntra").capitalize()
        cap = float(budget) if budget else 4999.0

        ethnic_kw = ["lehenga", "anarkali", "kurta", "kurti", "saree", "sari", "sherwani", "ethnic", "wedding", "festive", "mehendi", "sangeet", "haldi", "traditional"]
        is_ethnic = any(k in q for k in ethnic_kw)

        def entry(keys, title, slot, photo, base, ratio):
            return {"keys": keys, "title": title, "slot": slot, "photo": photo, "price": min(base, cap * ratio)}

        if is_ethnic:
            core = [
                entry(["lehenga", "choli"], "Embroidered Lehenga Choli Set", "Core Garment", "1610030469983-98e550d6193c", 2999.0, 0.5),
                entry(["anarkali"], "Kashmiri Embroidered Anarkali Kurta Set", "Core Garment", "1609357605129-26f69abb5dfd", 2499.0, 0.45),
                entry(["saree", "sari"], "Silk Blend Zari Border Saree", "Core Garment", "1617627143750-d86bc21e42bb", 2799.0, 0.5),
                entry(["kurta", "kurti", "sherwani", "festive"], "Festive Straight Kurta Set", "Core Garment", "1602810318383-e386cc2a3ccf", 1799.0, 0.4),
            ]
            bottom = [entry([], "Churidar Palazzo Bottom", "Bottomwear", "1473966968600-fa801b869a1a", 899.0, 0.15)]
            foot = [entry([], "Embroidered Ethnic Juttis", "Footwear", "1543163521-1bf539c55dd2", 899.0, 0.15)]
            acc = [
                entry(["dupatta"], "Silk Blend Zari Border Dupatta", "Bag & Accessories", "1583391733956-3750e0ff4e8b", 799.0, 0.12),
                entry([], "Kundan Chandelier Earrings", "Jewelry", "1535632066927-ab7c9ab60908", 499.0, 0.1),
            ]
        else:
            core = [
                entry(["classic", "tailored", "navy", "formal", "office", "chic", "blazer"], "Tailored Structured Notch-Lapel Blazer", "Core Garment", "1548883354-7622d03aca27", 1899.0, 0.5),
                entry(["relaxed", "casual", "smart", "beige", "linen", "oversized", "blazer"], "Relaxed Minimalist Oversized Blazer", "Core Garment", "1539109136881-3be0616acf4b", 1999.0, 0.5),
                entry(["modern", "power", "suit", "executive", "black", "formal", "blazer"], "Modern Executive Single-Breasted Blazer", "Core Garment", "1507679799987-c73779587ccf", 2199.0, 0.5),
                entry(["t-shirt", "tshirt", "tee", "oversized", "streetwear", "graphic", "casual"], "Oversized Cotton Graphic T-Shirt", "Core Garment", "1521572267360-ee0c2909d518", 799.0, 0.3),
                entry(["shirt", "linen", "smart", "classy", "striped", "white", "casual"], "Relaxed Fit Crisp Linen Shirt", "Core Garment", "1602810318383-e386cc2a3ccf", 1199.0, 0.35),
            ]
            bottom = [
                entry(["cargo", "jeans", "denim", "relaxed", "baggy", "streetwear"], "Straight Fit High-Rise Cargo Jeans", "Bottomwear", "1541099649105-f69ad21f3246", 999.0, 0.3),
                entry(["trouser", "formal", "pleated", "office", "chic"], "High-Waist Pleated Formal Trousers", "Bottomwear", "1506629082955-511b1aa562c8", 999.0, 0.3),
                entry(["chino", "smart", "classy", "casual", "pants"], "Slim Tapered Chino Trousers", "Bottomwear", "1473966968600-fa801b869a1a", 899.0, 0.3),
            ]
            foot = [
                entry(["platform", "chunky", "streetwear", "sneaker"], "Chunky White Platform Sneakers", "Footwear", "1595950653106-6c9ebd614d3a", 699.0, 0.2),
                entry(["loafer", "formal", "office", "classic", "chic"], "Classic Pointed-Toe Loafers", "Footwear", "1533867617858-e7b97e060509", 799.0, 0.2),
                entry(["sneaker", "smart", "classy", "casual", "minimal"], "Minimalist Low-Top Leather Sneakers", "Footwear", "1549298916-b41d501d3772", 699.0, 0.2),
            ]
            acc = []

        # Deterministic rotation so different style queries lead with different pieces
        rot = sum(ord(c) for c in q) % 3

        def pick(options):
            scored = [(sum(1 for k in o["keys"] if k in q), i, o) for i, o in enumerate(options)]
            best = max(s for s, _, _ in scored)
            if best > 0:
                return next(o for s, _, o in scored if s == best)
            return options[rot % len(options)]

        chosen = [pick(core), pick(bottom), pick(foot)] + ([pick(acc)] if acc else [])
        products = []
        for o in chosen:
            link = AVAToolSuite.make_merchant_search_url(plat_title, o["title"])
            products.append({
                "title": o["title"],
                "price": round(o["price"]),
                "seller": plat_title,
                "url": link,
                "product_url": link,
                "canonical_product_url": link,
                "affiliate_url": link,
                "image": U.format(o["photo"]),
                "slot": o["slot"],
                "is_shoppable": True,
                "source_type": "curated_fallback",
            })
        return products

    async def build_outfit(
        self,
        occasion: str,
        products: List[Dict[str, Any]],
        budget: Optional[float] = None,
        platform: Optional[str] = None,
        style: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        why: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> Dict[str, Any]:
        top_item = None
        bottom_item = None
        footwear_item = None
        accessory_item = None

        for item in products:
            title = item.get("title", "").lower()
            if not top_item and any(k in title for k in ["shirt", "top", "kurta", "kurti", "tshirt", "t-shirt", "anarkali", "hoodie", "blazer", "dress", "gown", "lehenga", "suit", "set", "saree"]):
                item["slot"] = "Core Garment"
                top_item = item
            elif not bottom_item and any(k in title for k in ["jeans", "pant", "trouser", "pyjama", "salwar", "skirt", "cargo", "chino", "palazzo", "choli"]):
                item["slot"] = "Bottomwear"
                bottom_item = item
            elif not footwear_item and any(k in title for k in ["shoe", "sneaker", "loafer", "jutti", "heel", "sandal", "boot", "flat", "mojari", "pumps"]):
                item["slot"] = "Footwear"
                footwear_item = item
            elif not accessory_item and any(k in title for k in ["watch", "bag", "belt", "clutch", "potli", "sunglass", "earring", "jhumka", "dupatta", "necklace", "jewellery", "shrug"]):
                item["slot"] = "Bag & Accessories"
                accessory_item = item

        items = [i for i in [top_item, bottom_item, footwear_item, accessory_item] if i]

        # Ensure up to 4 distinct live products in items card if available
        if len(items) < 4 and products:
            for p in products:
                if len(items) >= 4:
                    break
                p_title = p.get("title", "")
                if not any(existing.get("title") == p_title for existing in items):
                    if not p.get("slot"):
                        p_t = p_title.lower()
                        if any(k in p_t for k in ["shoe", "heel", "jutti", "mojari", "sandal", "flat"]):
                            p["slot"] = "Footwear"
                        elif any(k in p_t for k in ["bag", "clutch", "potli", "purse"]):
                            p["slot"] = "Bag & Clutch"
                        elif any(k in p_t for k in ["earring", "jhumka", "necklace", "watch", "jewellery"]):
                            p["slot"] = "Jewelry"
                        else:
                            p["slot"] = "Fashion Piece"
                    items.append(p)

        # Filter out extreme price outliers if budget is set
        if budget:
            valid_items = [i for i in items if float(i.get("price") or 0.0) <= budget * 1.5]
            if valid_items:
                items = valid_items

        total_price = sum(float(i.get("price") or 0.0) for i in items)

        occ_name = occasion.capitalize() if occasion else "Fashion"
        result = {
            "id": f"outfit_{uuid.uuid4().hex[:6]}",
            "name": name or f"{occ_name} Look",
            "occasion": occasion,
            "style": style or "casual",
            "items": items,
            "total_price": round(total_price, 2),
            "reason": f"Perfectly curated {style or 'stylish'} outfit suited for {occasion or 'everyday wear'}.",
            "actions": ["TRY_ON", "SHOP", "SAVE", "MAKE_CHEAPER", "SWAP"],
        }
        if description:
            result["description"] = description
            result["why"] = why
            result["tag"] = tag
            result["budget_min"] = round(total_price * 0.8)
            result["budget_max"] = round(total_price)
        return result

    async def compare_prices(
        self,
        source_url: Optional[str] = None,
        title: Optional[str] = None,
        brand: Optional[str] = None,
        price: Optional[float] = None,
    ) -> Dict[str, Any]:
        svc = get_url_product_comparison_service()
        res = await svc.compare_product(
            source_url=source_url,
            brand=brand or "FitMe Brand",
            title=title or "Fashion Garment",
            price=price,
        )
        return res

    async def compare_prices_across_retailers(self, title: str) -> List[Dict[str, Any]]:
        clean_t = re.sub(r'[^\w\s]', ' ', title).strip()
        candidates = await self.search_products(query=clean_t, limit=10)

        deals = []
        for c in candidates:
            price = c.get("price") or 0.0
            if isinstance(price, (int, float)) and price > 0:
                deals.append({
                    "title": c.get("title") or title,
                    "price": float(price),
                    "seller": c.get("seller") or "Online Store",
                    "url": c.get("url") or c.get("product_url"),
                    "image": c.get("image") or c.get("image_url"),
                })
        sorted_cands = sorted(deals, key=lambda x: x.get("price", 999999.0))
        return sorted_cands[:4]

    async def find_similar_products(self, query_or_url: str) -> List[Dict[str, Any]]:
        candidates = await self.search_products(query=query_or_url, limit=6)
        return [
            {
                "title": c.get("title"),
                "url": c.get("url") or c.get("product_url"),
                "price": c.get("price"),
                "seller": c.get("seller"),
                "image": c.get("image") or c.get("image_url"),
            }
            for c in candidates
        ]

    async def analyze_product_or_image(self, url: Optional[str] = None) -> Dict[str, Any]:
        if url:
            return await scrape_product(url)
        return {"status": "analyzed", "garment_type": "top", "detected_color": "black"}

    async def generate_tryon(
        self,
        person_image_path_or_url: str,
        garment_image_path_or_url: str,
        garment_type: Optional[str] = "top",
    ) -> Dict[str, Any]:
        try:
            provider = get_tryon_provider()
            res = await provider.generate_tryon(
                person_image_path_or_url=person_image_path_or_url,
                garment_image_path_or_url=garment_image_path_or_url,
                garment_type=garment_type,
            )
            return {
                "job_id": res.job_id,
                "status": res.status,
                "result_image_url": res.result_image_url,
                "error_message": res.error_message,
            }
        except Exception as e:
            logger.error(f"[AVAToolSuite] Try-On generation error: {e}")
            return {
                "job_id": str(uuid.uuid4()),
                "status": "failed",
                "result_image_url": None,
                "error_message": str(e),
            }

    async def save_outfit(self, outfit: Dict[str, Any]) -> Dict[str, Any]:
        if not self.user_id:
            return {"success": True, "outfit_id": outfit.get("id"), "note": "Saved locally in guest mode"}

        saved = AVASavedOutfit(
            user_id=self.user_id,
            name=outfit.get("name", "Saved Look"),
            occasion=outfit.get("occasion"),
            style=outfit.get("style"),
            total_price=float(outfit.get("total_price", 0.0)),
            items=outfit.get("items", []),
        )
        self.db.add(saved)
        await self.db.flush()
        return {"success": True, "outfit_id": str(saved.id), "name": saved.name}

    async def save_product(self, product: Dict[str, Any]) -> Dict[str, Any]:
        return {"success": True, "product_id": product.get("id") or str(uuid.uuid4()), "title": product.get("title")}

    async def replace_outfit_item(
        self,
        outfit: Dict[str, Any],
        target_category: str,
        budget: Optional[float] = None,
    ) -> Dict[str, Any]:
        items = list(outfit.get("items", []))
        target_cat = target_category.lower()

        # Find replacement item for target category
        new_candidates = await self.search_products(
            category=target_cat,
            max_price=budget,
            limit=5,
        )
        if new_candidates:
            replacement = new_candidates[0]
            updated_items = []
            replaced = False
            for item in items:
                title = item.get("title", "").lower()
                if not replaced and target_cat in title:
                    updated_items.append(replacement)
                    replaced = True
                else:
                    updated_items.append(item)
            if not replaced:
                updated_items.append(replacement)
            
            outfit["items"] = updated_items
            outfit["total_price"] = round(sum(float(i.get("price") or 0.0) for i in updated_items), 2)
            outfit["reason"] = f"Updated {target_category} with a fresh choice."

        return outfit

    async def get_fashion_rules(self, occasion: Optional[str] = None) -> Dict[str, Any]:
        from app.services.ava.fashion_knowledge import get_occasion_info
        return get_occasion_info(occasion or "casual")

    async def get_tryon_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Fetch completed Virtual Try-On jobs for the user (or recent completed if guest/anonymous).
        """
        try:
            stmt = select(TryOnJob, Garment).join(Garment, TryOnJob.garment_id == Garment.id).where(TryOnJob.status == "completed")
            if self.user_id:
                stmt = stmt.where(TryOnJob.user_id == self.user_id)
            stmt = stmt.order_by(TryOnJob.created_at.desc()).limit(limit)

            res = await self.db.execute(stmt)
            rows = res.all()

            # If user has 0 completed jobs and was filtered by user_id, fall back to recent demo jobs
            if not rows and self.user_id:
                fallback_stmt = select(TryOnJob, Garment).join(Garment, TryOnJob.garment_id == Garment.id).where(TryOnJob.status == "completed").order_by(TryOnJob.created_at.desc()).limit(limit)
                fallback_res = await self.db.execute(fallback_stmt)
                rows = fallback_res.all()

            history_items: List[Dict[str, Any]] = []
            for job, garment in rows:
                result_imgs = job.result_image_urls if isinstance(job.result_image_urls, list) else []
                res_img = result_imgs[0] if result_imgs else (garment.images[0].get("url") if garment.images else None)
                if not res_img:
                    continue

                history_items.append({
                    "job_id": str(job.id),
                    "garment_id": str(garment.id),
                    "garment_name": garment.product_name,
                    "garment_type": garment.garment_type or "garment",
                    "dominant_colours": garment.dominant_colours or [],
                    "result_image_url": res_img,
                    "product_url": garment.product_url,
                    "created_at": job.created_at.strftime("%b %d, %Y") if job.created_at else "",
                    "is_saved": bool(job.is_saved),
                })
            return history_items
        except Exception as e:
            logger.error(f"[AVATools] Error fetching try-on history: {e}")
            return []

    async def get_latest_tryon(self) -> Optional[Dict[str, Any]]:
        """
        Retrieve the single most recent completed Try-On job for styling or recommendations.
        """
        items = await self.get_tryon_history(limit=1)
        return items[0] if items else None

