"""
AVA Outfit Scoring & Optimization Engine — 7-Axis Outfit Ranking, Budget Optimization, and Item Swapping.
"""
import re
import uuid
from typing import Any, Dict, List, Optional

from app.services.ava.fashion_rules import FashionRulesEngine


class OutfitEngine:
    @staticmethod
    def score_outfit(
        outfit: Dict[str, Any],
        user_preferences: Dict[str, Any],
        target_occasion: str,
        target_budget: Optional[float] = None,
        target_platform: Optional[str] = None,
    ) -> float:
        items = outfit.get("items", [])
        if not items:
            return 0.0

        style = outfit.get("style", "casual").lower()
        style_dna = user_preferences.get("style_dna", {})
        style_score = style_dna.get(style, 0.5)

        # 1. Style Compatibility (30%)
        w_style = style_score * 0.30

        # 2. User Preference Match (20%)
        pref_colors = user_preferences.get("preferred_colors", [])
        disliked_items = user_preferences.get("disliked_items", [])
        pref_matches = 0
        total_checks = 0

        for item in items:
            title = item.get("title", "").lower()
            total_checks += 1
            if any(c in title for c in pref_colors):
                pref_matches += 1
            if any(d in title for d in disliked_items):
                pref_matches -= 1.5

        pref_score = max(0.0, min(1.0, (pref_matches / max(1, total_checks)) + 0.5))
        w_pref = pref_score * 0.20

        # 3. Occasion Appropriateness (15%)
        occ_scores = [
            FashionRulesEngine.evaluate_formality_match(target_occasion, item.get("category", "top"), item.get("title", ""))
            for item in items
        ]
        occ_score = sum(occ_scores) / max(1, len(occ_scores))
        w_occ = occ_score * 0.15

        # 4. Color Harmony (10%)
        color_score = 0.8
        if len(items) >= 2:
            c1 = items[0].get("title", "")
            c2 = items[1].get("title", "")
            color_score = FashionRulesEngine.evaluate_color_harmony(c1, c2)
        w_color = color_score * 0.10

        # 5. Fit Compatibility (10%)
        fit_score = 0.85
        w_fit = fit_score * 0.10

        # 6. Budget Compatibility (10%)
        total_price = float(outfit.get("total_price", 0.0))
        if target_budget:
            if total_price <= target_budget:
                budget_score = 1.0
            else:
                over_ratio = (total_price - target_budget) / target_budget
                budget_score = max(0.0, 1.0 - over_ratio)
        else:
            budget_score = 1.0
        w_budget = budget_score * 0.10

        # 7. Availability / Retailer Match (5%)
        platform_score = 1.0
        if target_platform:
            matches_platform = any(
                target_platform.lower() in (item.get("seller") or item.get("url") or "").lower()
                for item in items
            )
            platform_score = 1.0 if matches_platform else 0.4
        w_avail = platform_score * 0.05

        total_score = round((w_style + w_pref + w_occ + w_color + w_fit + w_budget + w_avail) * 100, 1)
        return total_score

    @staticmethod
    def rank_outfits(
        outfits: List[Dict[str, Any]],
        user_preferences: Dict[str, Any],
        target_occasion: str,
        target_budget: Optional[float] = None,
        target_platform: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        for o in outfits:
            score = OutfitEngine.score_outfit(o, user_preferences, target_occasion, target_budget, target_platform)
            o["score"] = score

        return sorted(outfits, key=lambda x: x.get("score", 0), reverse=True)

    @staticmethod
    async def make_cheaper(
        outfit: Dict[str, Any],
        tool_suite: Any,
        target_savings_percent: float = 0.30,
    ) -> Dict[str, Any]:
        items = list(outfit.get("items", []))
        if not items:
            return outfit

        original_total = float(outfit.get("total_price", 0.0))
        if original_total <= 0:
            return outfit

        # Identify most expensive item
        sorted_items = sorted(items, key=lambda x: float(x.get("price") or 0.0), reverse=True)
        expensive_item = sorted_items[0]
        expensive_price = float(expensive_item.get("price") or 0.0)

        # Target lower budget for expensive component
        cheaper_max = expensive_price * 0.55
        cheaper_candidates = await tool_suite.search_products(
            query=expensive_item.get("title"),
            max_price=cheaper_max,
            limit=5,
        )

        if cheaper_candidates:
            cheaper_replacement = cheaper_candidates[0]
            updated_items = []
            for item in items:
                if item == expensive_item:
                    updated_items.append(cheaper_replacement)
                else:
                    updated_items.append(item)
            
            new_total = round(sum(float(i.get("price") or 0.0) for i in updated_items), 2)
            savings = round(original_total - new_total, 2)

            clean_name = re.sub(r'^(Value Optimized\s*)+', '', outfit.get('name', 'Look'), flags=re.IGNORECASE).strip()
            return {
                "id": f"outfit_cheaper_{uuid.uuid4().hex[:6]}",
                "name": f"Value Optimized {clean_name}",
                "occasion": outfit.get("occasion"),
                "style": outfit.get("style"),
                "items": updated_items,
                "original_price": original_total,
                "total_price": new_total,
                "savings": max(0.0, savings),
                "reason": f"Optimized look for budget. Saved ₹{savings:.0f} by swapping expensive pieces.",
                "actions": ["TRY_ON", "SHOP", "SAVE"],
            }

        return outfit
