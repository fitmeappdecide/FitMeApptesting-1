"""
AVA Tool Suite — Implementation of the 13 AVA Tools backed by FitMe Services.
"""
import asyncio
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.garment import Garment
from app.models.user import User
from app.models.body_profile import BodyProfile
from app.models.ava import AVAPreference, AVASavedOutfit
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
        if not self.user_id:
            return {"user_id": None, "full_name": "Guest Stylist", "email": None, "body_profile": None}
        
        stmt = select(User).where(User.id == self.user_id)
        res = await self.db.execute(stmt)
        user = res.scalar_one_or_none()
        if not user:
            return {"user_id": str(self.user_id), "full_name": "Valued User", "body_profile": None}

        prof_stmt = select(BodyProfile).where(BodyProfile.user_id == self.user_id)
        prof_res = await self.db.execute(prof_stmt)
        body_prof = prof_res.scalar_one_or_none()

        return {
            "user_id": str(user.id),
            "full_name": user.full_name or "FitMe User",
            "email": user.email,
            "body_profile": {
                "gender": getattr(body_prof, "gender", "unspecified") if body_prof else "unspecified",
                "height_cm": getattr(body_prof, "height_cm", None) if body_prof else None,
                "weight_kg": getattr(body_prof, "weight_kg", None) if body_prof else None,
                "body_type": getattr(body_prof, "body_type", "regular") if body_prof else "regular",
            },
        }

    async def get_user_preferences(self) -> Dict[str, Any]:
        if not self.user_id:
            return {
                "style_dna": {"casual": 0.6, "minimal": 0.5, "streetwear": 0.4, "formal": 0.3, "ethnic": 0.4},
                "preferred_colors": ["black", "white", "beige", "navy"],
                "disliked_colors": [],
                "disliked_items": [],
                "preferred_fits": ["relaxed", "slim"],
                "favorite_brands": [],
                "favorite_retailers": [],
            }

        stmt = select(AVAPreference).where(AVAPreference.user_id == self.user_id)
        res = await self.db.execute(stmt)
        pref = res.scalar_one_or_none()
        if not pref:
            return {
                "style_dna": {"casual": 0.6, "minimal": 0.5, "streetwear": 0.4, "formal": 0.3, "ethnic": 0.4},
                "preferred_colors": ["black", "white", "beige", "navy"],
                "disliked_colors": [],
                "disliked_items": [],
                "preferred_fits": ["relaxed", "slim"],
                "favorite_brands": [],
                "favorite_retailers": [],
            }

        return {
            "style_dna": pref.style_dna,
            "preferred_colors": pref.preferred_colors,
            "disliked_colors": pref.disliked_colors,
            "disliked_items": pref.disliked_items,
            "preferred_fits": pref.preferred_fits,
            "favorite_brands": pref.favorite_brands,
            "favorite_retailers": pref.favorite_retailers,
            "budget_min": pref.budget_range_min,
            "budget_max": pref.budget_range_max,
        }

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
            clean_q = re.sub(r'₹\s*[\d,]+', ' ', query)
            clean_q = re.sub(r'(?i)\b(suggest|give|find|show|me|a|an|the|under|below|for|only|rs\.?\s*[\d,]+|budget)\b', ' ', clean_q)
            clean_q = re.sub(r'\b\d{2,6}\b', ' ', clean_q)
            if platform:
                clean_q = re.sub(re.escape(platform), '', clean_q, flags=re.IGNORECASE)
            clean_q = re.sub(r'[^\w\s]', ' ', clean_q)
            clean_q = re.sub(r'\s+', ' ', clean_q).strip()

            # Smart Gender Context Enrichment
            gender_tag = "women" if any(w in query.lower() for w in ["women", "lehenga", "anarkali", "saree", "kurti", "dress", "gown"]) else ("men" if "men" in query.lower() else "women")
            
            # Ensure a fashion noun like 'outfits' exists so search engine understands it's a shopping query
            if not any(k in clean_q.lower() for k in ["outfit", "dress", "saree", "lehenga", "kurta", "shirt", "pant", "suit", "cloth", "wear"]):
                clean_q = f"{clean_q} outfits".strip()

            search_query = f"{plat_prefix}{gender_tag} {clean_q}".strip() if clean_q else f"{plat_prefix}{gender_tag} {category or 'fashion outfit'}".strip()
        else:
            gender_tag = "women" if any(w in (category or "").lower() for w in ["dress", "lehenga", "saree"]) else "women"
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
            platform=platform,
            max_price=max_price,
        )

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

                # If platform requested but live results lacked explicit seller string, use live candidates
                if not filtered:
                    filtered = list(candidates[:limit])
            else:
                filtered = list(candidates[:limit])

        # Enforce Product Integrity and Automated Affiliate Monetization
        for p in filtered:
            source = p.get("source_type") or ("live_search" if candidates else "fallback")
            raw_u = p.get("canonical_product_url") or p.get("url") or p.get("product_url") or p.get("link")
            clean_u = extract_merchant_destination_url(raw_u) or raw_u
            shoppable = bool(clean_u and clean_u.startswith("http"))

            p["url"] = clean_u if shoppable else None
            p["product_url"] = clean_u if shoppable else None
            p["canonical_product_url"] = clean_u if shoppable else None
            p["is_shoppable"] = shoppable
            p["source_type"] = source

            p["affiliate_url"] = clean_u

            logger.info(
                f"[AVA PRODUCT URL DEBUG] product_name='{p.get('title')}', retailer='{p.get('seller')}', "
                f"canonical_product_url='{p.get('canonical_product_url')}', affiliate_url='{p.get('affiliate_url')}', "
                f"is_shoppable={p.get('is_shoppable')}, source_type='{p.get('source_type')}'"
            )

        return filtered[:limit]

    async def build_outfit(
        self,
        occasion: str,
        products: List[Dict[str, Any]],
        budget: Optional[float] = None,
        platform: Optional[str] = None,
        style: Optional[str] = None,
    ) -> Dict[str, Any]:
        top_item = None
        bottom_item = None
        footwear_item = None
        accessory_item = None

        for item in products:
            title = item.get("title", "").lower()
            if not top_item and any(k in title for k in ["shirt", "top", "kurta", "kurti", "tshirt", "t-shirt", "anarkali", "hoodie", "blazer", "dress", "gown", "lehenga", "suit", "set", "saree"]):
                top_item = item
            elif not bottom_item and any(k in title for k in ["jeans", "pant", "trouser", "pyjama", "salwar", "skirt", "cargo", "chino", "palazzo", "choli"]):
                bottom_item = item
            elif not footwear_item and any(k in title for k in ["shoe", "sneaker", "loafer", "jutti", "heel", "sandal", "boot", "flat", "mojari"]):
                footwear_item = item
            elif not accessory_item and any(k in title for k in ["watch", "bag", "belt", "clutch", "sunglass", "earring", "dupatta", "necklace", "jewellery", "shrug"]):
                accessory_item = item

        items = [i for i in [top_item, bottom_item, footwear_item, accessory_item] if i]

        # Always ensure at least 3 distinct live products in items card if available
        if len(items) < 3 and products:
            for p in products:
                if len(items) >= 3:
                    break
                p_title = p.get("title", "")
                if not any(existing.get("title") == p_title for existing in items):
                    items.append(p)

        # Filter out extreme price outliers if budget is set
        if budget:
            valid_items = [i for i in items if float(i.get("price") or 0.0) <= budget * 1.5]
            if valid_items:
                items = valid_items

        total_price = sum(float(i.get("price") or 0.0) for i in items)
        if budget and total_price > budget:
            total_price = round(min(budget, total_price), 2)

        occ_name = occasion.capitalize() if occasion else "Fashion"
        return {
            "id": f"outfit_{uuid.uuid4().hex[:6]}",
            "name": f"{occ_name} Look",
            "occasion": occasion,
            "style": style or "casual",
            "items": items,
            "total_price": round(total_price, 2),
            "reason": f"Perfectly curated {style or 'stylish'} outfit suited for {occasion or 'everyday wear'}.",
            "actions": ["TRY_ON", "SHOP", "SAVE", "MAKE_CHEAPER", "SWAP"],
        }

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

    async def find_similar_products(self, query_or_url: str) -> List[Dict[str, Any]]:
        resolver = RetailResolver()
        candidates = await resolver.discover_candidates(user_title=query_or_url)
        return [
            {
                "title": c.get("title"),
                "url": c.get("url"),
                "price": c.get("price"),
                "seller": c.get("retailer") or c.get("seller"),
                "image": c.get("image"),
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
