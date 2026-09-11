"""
AVA Style DNA Engine — User Style Profile & Preferences Vector.
"""
from typing import Any, Dict, List, Optional


class StyleDNAEngine:
    DEFAULT_STYLE_DNA = {
        "casual": 0.60,
        "minimal": 0.50,
        "streetwear": 0.40,
        "formal": 0.30,
        "ethnic": 0.40,
    }

    @staticmethod
    def compute_style_dna(
        current_dna: Optional[Dict[str, float]] = None,
        liked_styles: Optional[List[str]] = None,
        disliked_styles: Optional[List[str]] = None,
        saved_outfits: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, float]:
        dna = dict(current_dna or StyleDNAEngine.DEFAULT_STYLE_DNA)

        if liked_styles:
            for s in liked_styles:
                key = s.lower()
                if key in dna:
                    dna[key] = min(1.0, round(dna[key] + 0.1, 2))

        if disliked_styles:
            for s in disliked_styles:
                key = s.lower()
                if key in dna:
                    dna[key] = max(0.0, round(dna[key] - 0.15, 2))

        if saved_outfits:
            for outfit in saved_outfits:
                style = outfit.get("style", "").lower()
                if style in dna:
                    dna[style] = min(1.0, round(dna[style] + 0.05, 2))

        return dna
