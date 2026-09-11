import re


ETHNIC_TYPES = {"kurta", "saree", "lehenga"}
GARMENT_TYPES = ("tshirt", "shirt", "kurta", "saree", "lehenga", "dress", "pants", "hoodie", "jacket")


def detect_garment_type(name: str, hint: str | None = None) -> str:
    if hint in (*GARMENT_TYPES, "unknown"):
        return hint
    lowered = name.lower()
    for garment_type in GARMENT_TYPES:
        if garment_type in lowered:
            return garment_type
    if re.search(r"\btee\b|t-shirt|t shirt", lowered):
        return "tshirt"
    if re.search(r"\bjeans\b|trouser", lowered):
        return "pants"
    return "unknown"


def analyse_garment(product_name: str, hint: str | None, images: list[dict]) -> dict:
    garment_type = detect_garment_type(product_name, hint)
    return {
        "garment_type": garment_type,
        "fabric_type": "cotton blend" if garment_type in {"shirt", "tshirt", "kurta"} else "mixed fabric",
        "dominant_colours": ["#FFFFFF"] if not images else ["#C9974A"],
        "is_ethnic": garment_type in ETHNIC_TYPES,
        "segmentation_masks": {"strategy": "sam2-ready", "image_count": len(images)},
    }

