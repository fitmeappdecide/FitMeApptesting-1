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

    @staticmethod
    def analyze_color_season(
        fitzpatrick: Optional[int] = None,
        hex_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Derives user's Color Season & optimal color palette from skin tone data.
        Fitzpatrick Scale:
          1-2: Fair / Light (Cool Summer / Bright Spring)
          3-4: Medium / Olive / Wheatish (Warm Autumn / Rich Spring)
          5-6: Deep / Rich Tan / Dusky (Deep Autumn / Deep Winter)
        """
        score = fitzpatrick or 4  # Default to wheatish/medium tone

        if score in (1, 2):
            return {
                "season": "Cool Summer",
                "undertone": "Cool / Rose",
                "best_colors": ["powder blue", "lavender", "emerald green", "rose pink", "charcoal grey", "navy blue"],
                "avoid_colors": ["neon orange", "mustard yellow", "warm olive"],
                "accent_metals": ["Silver", "Platinum", "White Gold"],
                "stylist_rationale": "Soft jewel tones and cool pastels accentuate your porcelain undertones without washing out your complexion.",
            }
        elif score in (3, 4):
            return {
                "season": "Warm Autumn",
                "undertone": "Warm / Golden Olive",
                "best_colors": ["emerald green", "maroon", "rust orange", "mustard gold", "deep teal", "warm beige", "navy blue"],
                "avoid_colors": ["stark chalk white", "icy pastels"],
                "accent_metals": ["Yellow Gold", "Antique Brass", "Rose Gold"],
                "stylist_rationale": "Earthy jewel tones like emerald, rust, and warm gold harmoniously illuminate your warm olive undertone.",
            }
        else:
            return {
                "season": "Deep Winter",
                "undertone": "Deep / Neutral Rich",
                "best_colors": ["royal blue", "ruby red", "metallic gold", "deep wine", "bottle green", "midnight black", "magenta"],
                "avoid_colors": ["washed-out beige", "pale beige", "muted taupe"],
                "accent_metals": ["Polished Gold", "Bronze", "Kundan Gold"],
                "stylist_rationale": "High-contrast, saturated regal hues like ruby, royal blue, and antique gold create a radiant, regal presence.",
            }

    @staticmethod
    def analyze_body_silhouette(
        height_cm: Optional[float] = None,
        chest_cm: Optional[float] = None,
        waist_cm: Optional[float] = None,
        hips_cm: Optional[float] = None,
        body_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Computes body shape silhouette and tailored styling advice based on 3D scan & measurements.
        """
        shape = "Balanced Silhouette"
        flattering_cuts = ["A-line cuts", "Structured shoulders", "Cinched waist"]
        silhouette_note = "A versatile, balanced silhouette that accommodates tailored and fluid silhouettes effortlessly."

        if chest_cm and waist_cm and hips_cm:
            waist_hip_ratio = waist_cm / hips_cm if hips_cm > 0 else 0.8
            chest_hip_diff = abs(chest_cm - hips_cm)

            if waist_hip_ratio <= 0.78 and chest_hip_diff <= 8.0:
                shape = "Hourglass"
                flattering_cuts = ["Fitted waistlines", "Wrap dresses", "Belted blazers", "Flared lehengas", "V-neck tops"]
                silhouette_note = "Highlights your natural waist contour while maintaining elegant shoulder-to-hip symmetry."
            elif hips_cm > chest_cm + 5.0 and waist_hip_ratio <= 0.82:
                shape = "Pear (Triangle)"
                flattering_cuts = ["A-line lehengas", "Statement embroidered necklines", "Structured shoulder pads", "Empire waists"]
                silhouette_note = "Draws focus upward with intricate upper detailing while creating a graceful, flowing lower drape."
            elif chest_cm > hips_cm + 5.0:
                shape = "Inverted Triangle"
                flattering_cuts = ["Flared skirts", "Wide-leg trousers", "Soft V-necks", "Peplum blouses"]
                silhouette_note = "Adds visual volume to the lower half to balance structured upper proportions beautifully."
        elif body_type:
            b_lower = body_type.lower()
            if "athletic" in b_lower:
                shape = "Athletic Frame"
                flattering_cuts = ["Tailored waistlines", "Draped fabrics", "Pleated skirts", "Structured collar suits"]
                silhouette_note = "Creates soft dimensional curves with tailored draping and waist accents."
            elif "plus" in b_lower:
                shape = "Full Curvature"
                flattering_cuts = ["Empire waist cuts", "Vertical line motifs", "Elongated dupattas", "Structured A-line"]
                silhouette_note = "Maximizes vertical lines and comfortable, regal tailoring for confident elegance."

        height_category = "Regular"
        if height_cm:
            if height_cm < 160:
                height_category = "Petite"
                flattering_cuts.append("High-waisted bottoms to elongate legs")
            elif height_cm > 175:
                height_category = "Tall"
                flattering_cuts.append("Floor-length maxis and sweeping silhouettes")

        return {
            "silhouette": shape,
            "height_category": height_category,
            "flattering_cuts": flattering_cuts,
            "stylist_note": silhouette_note,
        }
