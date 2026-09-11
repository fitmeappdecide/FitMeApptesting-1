"""
AVA Fashion Knowledge Layer — Occasions, Styles, Garments, and Color Compatibility Matrix.
"""
from typing import Any, Dict, List, Optional

OCCASIONS: Dict[str, Dict[str, Any]] = {
    "college": {
        "display_name": "College / Campus",
        "default_style": "casual",
        "formality": "western_casual",
        "recommended_slots": ["top", "bottom", "footwear", "accessory"],
        "keywords": ["college", "campus", "class", "university", "lecture"],
        "typical_budget": 2500,
    },
    "wedding": {
        "display_name": "Wedding / Marriage",
        "default_style": "ethnic",
        "formality": "ethnic",
        "recommended_slots": ["ethnic_top", "ethnic_bottom", "footwear", "accessory"],
        "keywords": ["wedding", "shaadi", "marriage", "reception", "baraat"],
        "typical_budget": 8000,
    },
    "mehendi": {
        "display_name": "Mehendi / Haldi",
        "default_style": "ethnic",
        "formality": "ethnic",
        "recommended_slots": ["ethnic_top", "ethnic_bottom", "footwear", "accessory"],
        "keywords": ["mehendi", "mehndi", "haldi", "sangeet"],
        "typical_budget": 5000,
    },
    "sangeet": {
        "display_name": "Sangeet / Cocktails",
        "default_style": "ethnic",
        "formality": "ethnic",
        "recommended_slots": ["ethnic_top", "ethnic_bottom", "footwear", "accessory"],
        "keywords": ["sangeet", "cocktail", "sangeet party"],
        "typical_budget": 6000,
    },
    "office": {
        "display_name": "Office / Workwear",
        "default_style": "smart casual",
        "formality": "western_formal",
        "recommended_slots": ["top", "bottom", "footwear", "accessory"],
        "keywords": ["office", "work", "desk", "corporate", "business"],
        "typical_budget": 4000,
    },
    "interview": {
        "display_name": "Job Interview",
        "default_style": "formal",
        "formality": "western_formal",
        "recommended_slots": ["top", "bottom", "outerwear", "footwear", "accessory"],
        "keywords": ["interview", "presentation", "meeting", "formal meeting"],
        "typical_budget": 4500,
    },
    "party": {
        "display_name": "Night Out / Party",
        "default_style": "trendy",
        "formality": "western_casual",
        "recommended_slots": ["top", "bottom", "footwear", "accessory"],
        "keywords": ["party", "clubbing", "nightout", "dinner party", "celebration"],
        "typical_budget": 3500,
    },
    "date": {
        "display_name": "Date Night / Romantic Outing",
        "default_style": "smart casual",
        "formality": "western_casual",
        "recommended_slots": ["top", "bottom", "footwear", "accessory"],
        "keywords": ["date", "dinner date", "coffee date", "romantic"],
        "typical_budget": 3500,
    },
    "casual": {
        "display_name": "Everyday Casual",
        "default_style": "casual",
        "formality": "western_casual",
        "recommended_slots": ["top", "bottom", "footwear"],
        "keywords": ["casual", "everyday", "hangout", "chilling", "weekend"],
        "typical_budget": 2000,
    },
    "travel": {
        "display_name": "Travel / Airport Look",
        "default_style": "relaxed",
        "formality": "western_casual",
        "recommended_slots": ["top", "bottom", "footwear", "accessory"],
        "keywords": ["travel", "flight", "airport", "vacation", "trip", "road trip"],
        "typical_budget": 3000,
    },
    "ethnic": {
        "display_name": "Festive Ethnic",
        "default_style": "ethnic",
        "formality": "ethnic",
        "recommended_slots": ["ethnic_top", "ethnic_bottom", "footwear", "accessory"],
        "keywords": ["ethnic", "diwali", "puja", "pooja", "kurta", "saree", "traditional"],
        "typical_budget": 4500,
    },
}

COLOR_HARMONY: Dict[str, List[str]] = {
    "white": ["black", "navy", "beige", "olive", "blue", "maroon", "grey"],
    "black": ["white", "beige", "red", "grey", "silver", "gold", "olive", "navy"],
    "beige": ["white", "black", "navy", "brown", "olive", "maroon"],
    "navy": ["white", "beige", "grey", "pink", "brown", "tan"],
    "olive": ["black", "beige", "white", "mustard", "tan"],
    "red": ["black", "white", "beige", "gold"],
    "maroon": ["beige", "white", "gold", "black"],
    "blue": ["white", "beige", "tan", "grey"],
    "pink": ["white", "navy", "grey", "gold"],
    "yellow": ["navy", "black", "white", "maroon"],
    "gold": ["red", "maroon", "green", "black", "white"],
}

GARMENT_SLOTS: Dict[str, Dict[str, Any]] = {
    "top": {"name": "Topwear", "categories": ["t-shirt", "shirt", "blouse", "top", "hoodie", "sweater", "polo"]},
    "bottom": {"name": "Bottomwear", "categories": ["jeans", "trousers", "chinos", "cargos", "shorts", "skirt", "joggers"]},
    "outerwear": {"name": "Outerwear", "categories": ["jacket", "blazer", "coat", "cardigan", "shrug"]},
    "ethnic_top": {"name": "Ethnic Top", "categories": ["kurta", "kurti", "anarkali", "sherwani", "nehru jacket"]},
    "ethnic_bottom": {"name": "Ethnic Bottom", "categories": ["pyjama", "salwar", "churidar", "palazzo", "dhoti"]},
    "full_body": {"name": "Full Outfit", "categories": ["saree", "lehenga", "gown", "dress", "suit set", "jumpsuit"]},
    "footwear": {"name": "Footwear", "categories": ["sneakers", "loafers", "oxfords", "heels", "flats", "juttis", "boots", "sandals"]},
    "accessory": {"name": "Accessory", "categories": ["watch", "bag", "backpack", "clutch", "belt", "sunglasses", "jewellery", "earrings"]},
}


def get_occasion_info(occasion: str) -> Dict[str, Any]:
    key = occasion.lower().strip()
    for o_key, o_info in OCCASIONS.items():
        if o_key == key or key in o_info["keywords"]:
            return o_info
    return OCCASIONS["casual"]
