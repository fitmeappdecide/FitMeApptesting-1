import re
from fastapi import UploadFile

JPEG_MAGIC_PREFIX = b"\xff\xd8\xff"
PNG_MAGIC_PREFIX = b"\x89PNG"
WEBP_MAGIC_PREFIX = b"RIFF"
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass


def is_valid_image_bytes(data: bytes) -> bool:
    if data.startswith(JPEG_MAGIC_PREFIX) or data.startswith(PNG_MAGIC_PREFIX):
        return True
    if data.startswith(WEBP_MAGIC_PREFIX) and len(data) >= 12 and data[8:12] == b"WEBP":
        return True
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12].lower()
        if brand in HEIC_BRANDS:
            return True
        for offset in range(12, min(len(data), 36), 4):
            if data[offset : offset + 4].lower() in HEIC_BRANDS:
                return True
    return False


async def validate_image_upload(file: UploadFile) -> bytes:
    data = await file.read()
    await file.seek(0)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Image exceeds 10MB limit.")
    if not is_valid_image_bytes(data):
        raise ValueError("Only JPEG, PNG, WebP, and HEIC images with valid magic bytes are accepted.")
    return data


def normalize_url(url: str) -> str:
    if not url:
        return ""
    url_match = re.search(r'https?://[^\s<>"]+', url)
    if url_match:
        url = url_match.group(0)
    return url.strip().split("#", 1)[0].rstrip("/")


from urllib.parse import parse_qs, unquote, urlparse

DISALLOWED_SEARCH_DOMAINS = [
    "google.com", "google.co.in", "google.co", "googleshopping.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "yandex.com",
    "searchapi.io", "serpapi.com", "pinterest.com", "facebook.com", "instagram.com"
]


def extract_merchant_destination_url(url: str | None) -> str | None:
    """Unwraps Google/Bing search redirects, Urlgeni wrappers, and affiliate links into direct merchant destination URLs."""
    if not url or not isinstance(url, str):
        return None
    u = url.strip()

    # 1. Check embedded direct merchant URL inside wrappers (e.g. amzn.urlgeni.us/https://www.amazon.in/...)
    embedded_match = re.search(r'https?://(?:www\.)?(amazon\.in|myntra\.com|ajio\.com|flipkart\.com|nykaafashion\.com|tatacliq\.com|westside\.com|zara\.com|hm\.com)/[^\s"<>\'\\]+', u, re.IGNORECASE)
    if embedded_match:
        extracted = embedded_match.group(0)
        try:
            if len(urlparse(extracted).path.strip("/")) > 0:
                return extracted
        except Exception:
            pass

    # Unwrap Google redirect links (e.g. google.com/url?q=https://... or url=https://... or adurl=https://...)
    if ("google." in u.lower() or "googleco." in u.lower()) and "/url" in u.lower():
        try:
            parsed = urlparse(u)
            qs = parse_qs(parsed.query)
            for key in ["q", "url", "adurl", "target", "dest"]:
                if key in qs and qs[key]:
                    val = unquote(qs[key][0])
                    if val.startswith("http") and "google." not in val.lower():
                        return val
        except Exception:
            pass

    # Unwrap Bing redirect links
    if "bing.com/aclick" in u.lower() or "bing.com/search" in u.lower() or "bing.com/url" in u.lower():
        try:
            parsed = urlparse(u)
            qs = parse_qs(parsed.query)
            for key in ["rdr", "u", "url", "dest"]:
                if key in qs and qs[key]:
                    val = unquote(qs[key][0])
                    if val.startswith("http") and "bing.com" not in val.lower():
                        return val
        except Exception:
            pass

    return u


def extract_best_candidate_url(item: dict) -> str | None:
    """Extracts and unwraps the best direct merchant URL from a search result item."""
    if not isinstance(item, dict):
        return None

    # 1. Try explicit direct merchant fields
    for field in ["direct_link", "merchant_link", "landing_page", "store_url", "canonical_product_url"]:
        val = item.get(field)
        if val and isinstance(val, str) and val.startswith("http"):
            unwrapped = extract_merchant_destination_url(val)
            if unwrapped and is_direct_merchant_product_url(unwrapped):
                return unwrapped

    # 2. Try offers / stores array if available
    offers = item.get("offers") or item.get("stores") or []
    if isinstance(offers, list):
        for offer in offers:
            if isinstance(offer, dict):
                o_link = offer.get("link") or offer.get("url")
                if o_link and isinstance(o_link, str):
                    unwrapped = extract_merchant_destination_url(o_link)
                    if unwrapped and is_direct_merchant_product_url(unwrapped):
                        return unwrapped

    # 3. Fallback to raw link / product_link / url field and unwrap
    for field in ["link", "product_url", "url", "offers_link", "source_url"]:
        val = item.get(field)
        if val and isinstance(val, str) and val.startswith("http"):
            unwrapped = extract_merchant_destination_url(val)
            if unwrapped and is_direct_merchant_product_url(unwrapped):
                return unwrapped

    return None


def is_direct_merchant_product_url(url: str | None) -> bool:
    """Returns True ONLY if URL is a genuine merchant product detail page rather than a search/aggregator page or homepage."""
    if not url or not isinstance(url, str):
        return False
    u = url.strip()
    u_lower = u.lower()

    try:
        parsed = urlparse(u)
        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]

        if any(d in netloc for d in DISALLOWED_SEARCH_DOMAINS):
            return False

        path = parsed.path.lower()
        if path in ("", "/", "/index.html", "/index.php"):
            return False  # Reject homepage

        if "/search" in path or "search?" in u_lower:
            # Allow Myntra / AJIO if direct product signature present
            if "myntra.com" in netloc and ("/buy" in path or bool(re.search(r"/\d+/?$", path))):
                return True
            if "ajio.com" in netloc and "/p/" in path:
                return True
            return False

        # Specific Merchant Product URL signatures
        if "myntra.com" in netloc:
            return bool("/buy" in path or bool(re.search(r"/\d+/?$", path)) or "/p/" in path or "/v/" in path)
        if "ajio.com" in netloc:
            return bool("/p/" in path or "/g/" in path or bool(re.search(r"/\d+/?$", path)))
        if "amazon." in netloc:
            return bool("/dp/" in path or "/gp/product/" in path or "/d/" in path or "asin=" in parsed.query)
        if "flipkart.com" in netloc:
            return bool("/p/" in path or "pid=" in parsed.query or "/dl/p/" in path)
        # Known supplemental merchants with product-style paths
        SUPPLEMENTAL_MERCHANTS = [
            "tatacliq.com", "nykaafashion.com", "westside.com",
            "lifestylestores.com", "manyavar.com", "pantaloons.com",
            "fabindia.com", "zara.com", "hm.com", "limeroad.com",
        ]
        for merchant in SUPPLEMENTAL_MERCHANTS:
            if merchant in netloc:
                return bool(
                    "/p/" in path or "/products/" in path or "/product/" in path
                    or "-p-" in path or ".html" in path
                    or re.search(r"/[a-z0-9-]{4,}/\d+", path)
                )

        # Reject everything else (unknown domains, redirect wrappers, aggregators)
        return False
    except Exception:
        return False




