"""
AVA Fashion Rule Engine — Consistency, Formality, Color Harmony, and Silhouette Pairing Rules.
"""
import re
from typing import Any, Dict, List, Optional, Tuple

from app.services.ava.fashion_knowledge import COLOR_HARMONY, OCCASIONS


class FashionRulesEngine:
    @staticmethod
    def evaluate_formality_match(occasion: str, garment_type: str, item_title: str) -> float:
        title_lower = item_title.lower()
        occ_key = (occasion or "casual").lower()
        occasion_info = OCCASIONS.get(occ_key, OCCASIONS["casual"])
        formality = occasion_info.get("formality", "western_casual")

        if formality == "ethnic":
            if any(k in title_lower for k in ["kurta", "kurti", "saree", "lehenga", "anarkali", "sherwani", "jutti", "dupatta", "ethnic"]):
                return 1.0
            if any(k in title_lower for k in ["tshirt", "t-shirt", "running shoes", "jeans"]):
                return 0.2
            return 0.6

        if formality == "western_formal":
            if any(k in title_lower for k in ["blazer", "suit", "oxford", "trousers", "shirt", "formal", "derby"]):
                return 1.0
            if any(k in title_lower for k in ["cargo", "jogger", "flip flops", "graphic tee"]):
                return 0.1
            return 0.7

        # western_casual
        if any(k in title_lower for k in ["sneakers", "jeans", "tshirt", "t-shirt", "hoodie", "casual", "chinos"]):
            return 1.0
        return 0.8

    @staticmethod
    def evaluate_color_harmony(color_a: Optional[str], color_b: Optional[str]) -> float:
        if not color_a or not color_b:
            return 0.7
        ca = color_a.lower().strip()
        cb = color_b.lower().strip()
        if ca == cb:
            return 0.9  # Monochrome
        harmonies = COLOR_HARMONY.get(ca, [])
        if cb in harmonies:
            return 1.0
        return 0.5

    @staticmethod
    def validate_outfit_completeness(items: List[Dict[str, Any]], occasion: str) -> Tuple[bool, List[str]]:
        categories = [item.get("category", "").lower() for item in items]
        has_top = any(c in ["top", "ethnic_top", "full_body", "outerwear"] for c in categories)
        has_bottom = any(c in ["bottom", "ethnic_bottom", "full_body"] for c in categories)
        has_footwear = any(c in ["footwear"] for c in categories)

        missing = []
        if not has_top:
            missing.append("Topwear")
        if not has_bottom:
            missing.append("Bottomwear")
        if not has_footwear:
            missing.append("Footwear")

        is_complete = has_top and has_bottom and has_footwear
        return is_complete, missing
