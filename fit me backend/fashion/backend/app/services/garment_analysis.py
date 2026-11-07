import re


ETHNIC_TYPES = {"kurta", "saree", "lehenga"}
FOOTWEAR_KEYWORDS = {
    "shoes", "shoe", "slipper", "slippers", "heel", "heels", "mule", "mules", "sandal", "sandals",
    "flats", "flat", "sneaker", "sneakers", "boot", "boots", "footwear", "clog", "clogs", "loafer", "loafers"
}
GARMENT_TYPES = (
    "tshirt", "shirt", "kurta", "saree", "lehenga", "dress", "pants", "hoodie", "jacket", "shoes"
)


def detect_garment_type(name: str, hint: str | None = None) -> str:
    if hint:
        h_lowered = hint.lower().strip()
        if h_lowered in FOOTWEAR_KEYWORDS:
            return "shoes"
        if h_lowered in (*GARMENT_TYPES, "unknown"):
            return h_lowered

    lowered = name.lower()
    if any(k in lowered for k in FOOTWEAR_KEYWORDS):
        return "shoes"

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

