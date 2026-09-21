import os
import uuid
from typing import Optional

from supabase import create_client, Client as SupabaseClient

from app.core.config import settings
from app.utils.encryption import decrypt_text


def build_encrypted_storage_ref(prefix: str, filename: str) -> str:
    """Generate a deterministic storage reference.
    Returns a path like "scans/<uuid>-<safe_name>" which will be used as the
    key inside the Supabase storage bucket.
    """
    safe_name = filename.replace("/", "_").replace("\\", "_")
    return f"{prefix}/{uuid.uuid4()}-{safe_name}"


def cdn_url_for_private_ref(private_ref: str) -> str:
    """Generate a URL for a storage reference in Supabase Storage.
    For private references (tryon_results, scans, user_photos, pi_scans), delegates to signed URL.
    For public/catalog assets, returns public CDN URL.
    """
    if (
        any(private_ref.startswith(p) for p in ("tryon_results/", "scans/", "user_photos/", "pi_scans/", "garments/"))
        or "/tryon_results/" in private_ref
        or "/pi_scans/" in private_ref
    ):
        signed = create_signed_photo_url(private_ref)
        if signed:
            return signed

    bucket = settings.supabase_storage_bucket
    clean_ref = private_ref
    if clean_ref.startswith(f"{bucket}/"):
        clean_ref = clean_ref[len(bucket) + 1 :]
    return f"{settings.supabase_url}/storage/v1/object/public/{bucket}/{clean_ref}"



LOCAL_STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage"))
os.makedirs(LOCAL_STORAGE_DIR, exist_ok=True)

def _get_supabase_client() -> SupabaseClient:
    """Create a Supabase client using configured URL and service key.
    This function is lightweight and can be called repeatedly; the client
    internally caches the session.
    """
    if not settings.supabase_url:
        raise ValueError("Supabase URL is not configured.")
    return create_client(settings.supabase_url, settings.supabase_service_key)


def upload_image_to_storage(image_bytes: bytes, storage_path: str) -> None:
    """Upload raw image bytes to Supabase Storage.
    Args:
        image_bytes: The binary content of the image.
        storage_path: The object key inside the bucket (e.g. "tryon_results/<uuid>-file.jpg").
    """
    if not settings.supabase_url or not settings.supabase_service_key:
        raise ValueError("Supabase production URL and service_role key must be configured.")

    client = _get_supabase_client()
    bucket_name = settings.supabase_storage_bucket
    bucket = client.storage.from_(bucket_name)

    clean_path = storage_path
    if clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    mime_type = "image/jpeg"
    if storage_path.lower().endswith(".png"):
        mime_type = "image/png"
    elif storage_path.lower().endswith(".webp"):
        mime_type = "image/webp"
    elif storage_path.lower().endswith(".gif"):
        mime_type = "image/gif"
    
    bucket.upload(
        path=clean_path,
        file=image_bytes,
        file_options={"content-type": mime_type, "x-upsert": "true", "cacheControl": "31536000"}
    )

def download_image_from_storage(storage_path: str) -> bytes:
    """Download image bytes from Supabase Storage given its object key.
    Returns the raw bytes of the stored image.
    """
    if not settings.supabase_url or not settings.supabase_service_key:
        raise ValueError("Supabase production URL and service_role key must be configured.")

    client = _get_supabase_client()
    bucket_name = settings.supabase_storage_bucket
    bucket = client.storage.from_(bucket_name)

    clean_path = storage_path
    if clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    return bucket.download(clean_path)


def extract_storage_path(ref: str) -> str:
    """Strip any scheme (e.g. s3://) and return the relative path used in Supabase.
    Example: "s3://fitme-private/scans/abc.jpg" -> "scans/abc.jpg"
    """
    if "://" in ref:
        parts = ref.split('://', 1)[1].split('/', 1)
        return parts[1] if len(parts) > 1 else ''
    return ref


def retrieve_image_bytes_from_encrypted_ref(encrypted_ref: str) -> bytes:
    """Given an encrypted or plain storage reference, decrypt (if needed) and download."""
    if not encrypted_ref:
        return b""
    try:
        raw_ref = decrypt_text(encrypted_ref)
    except Exception:
        raw_ref = encrypted_ref
    storage_path = extract_storage_path(raw_ref)
    return download_user_photo(storage_path)


def is_user_uploaded_garment(garment: Any) -> bool:
    """Conservatively returns True ONLY if the garment is a private user-uploaded garment.
    Returns False for all retailer/global catalog products, brand products, and ambiguous cases.
    """
    if not garment:
        return False

    # 1. Any brand assignment means it is a B2B brand catalog product
    if getattr(garment, "brand_id", None) is not None:
        return False

    # 2. Any real retailer / product URL means it is a shared catalog product
    p_url = (getattr(garment, "product_url", None) or "").strip().lower()
    s_url = (getattr(garment, "scraped_from_url", None) or "").strip().lower()
    if p_url and not p_url.startswith("http://example.com"):
        return False
    if s_url and not s_url.startswith("http://example.com"):
        return False

    # 3. Must have at least one image pointing strictly to Supabase Storage garments/ folder
    images = getattr(garment, "images", None)
    if not images or not isinstance(images, list):
        return False

    has_supabase_garment_storage = False
    for img in images:
        raw_url = img.get("url", "") if isinstance(img, dict) else str(img) if img else ""
        if not raw_url:
            continue
        # If image belongs to an external retailer CDN domain, it is a retailer catalog product
        if any(dom in raw_url.lower() for dom in ("myntassets.com", "media-amazon.com", "ajio.com", "flipkart", "zara", "hm.com")):
            return False
        # Check for Supabase storage path in garments/
        if "/garments/" in raw_url or raw_url.startswith("garments/"):
            has_supabase_garment_storage = True

    return has_supabase_garment_storage


def get_garment_storage_paths(garment: Any) -> list[str]:
    """Extracts all storage paths/URLs from a garment's images JSON array."""
    if not garment:
        return []
    images = getattr(garment, "images", None)
    if not images or not isinstance(images, list):
        return []

    extracted: list[str] = []
    for img in images:
        if isinstance(img, dict) and img.get("url"):
            extracted.append(str(img["url"]).strip())
        elif isinstance(img, str) and img.strip():
            extracted.append(img.strip())

    return extracted


def delete_images_from_storage(storage_paths_or_urls: list[str]) -> None:
    """Safely delete tryon output images and their companion thumbnails from Supabase Storage.
    Only deletes objects that reside within the configured bucket under tryon_results/
    to prevent any accidental deletion of scans, garments, or user assets.
    """
    if not settings.supabase_url or not settings.supabase_service_key or not storage_paths_or_urls:
        return

    bucket_name = settings.supabase_storage_bucket
    public_prefix = f"/storage/v1/object/public/{bucket_name}/"
    sign_prefix = f"/storage/v1/object/sign/{bucket_name}/"
    clean_keys: list[str] = []

    for path_or_url in storage_paths_or_urls:
        if not path_or_url or not isinstance(path_or_url, str):
            continue
        # Skip data URIs or non-storage URLs
        if path_or_url.startswith("data:"):
            continue

        clean = path_or_url.split("?")[0].split("#")[0].strip()
        if public_prefix in clean:
            clean = clean.split(public_prefix, 1)[1]
        elif sign_prefix in clean:
            clean = clean.split(sign_prefix, 1)[1]
        elif "/storage/v1/object/public/" in clean:
            clean = clean.split("/storage/v1/object/public/", 1)[1]
            if clean.startswith(f"{bucket_name}/"):
                clean = clean[len(bucket_name) + 1 :]
        elif clean.startswith(f"{bucket_name}/"):
            clean = clean[len(bucket_name) + 1 :]

        # Safety guard: only delete tryon_results objects
        if clean.startswith("tryon_results/") and not clean.startswith("tryon_results/.."):
            if clean not in clean_keys:
                clean_keys.append(clean)
            # Companion thumbnail auto-inclusion
            filename = clean[len("tryon_results/") :]
            if not filename.startswith("thumb_") and (filename.endswith(".webp") or filename.endswith(".jpg") or filename.endswith(".png")):
                thumb_key = f"tryon_results/thumb_{filename}"
                if thumb_key not in clean_keys:
                    clean_keys.append(thumb_key)

    if not clean_keys:
        return

    try:
        client = _get_supabase_client()
        bucket = client.storage.from_(bucket_name)
        bucket.remove(clean_keys)
    except Exception as exc:
        print(f"Notice: Supabase Storage cleanup warning ({exc})")


def delete_storage_objects_batched(storage_paths_or_urls: list[str] | set[str], batch_size: int = 50) -> int:
    """Safely and efficiently delete a collection of user storage assets in batches.
    Handles user photos (user_photos/), body scans (scans/), try-on outputs (tryon_results/ + thumbs),
    and user garments (garments/).
    
    Strict safety invariants:
    - Normalizes URLs, query params, hash fragments, and bucket prefixes.
    - Automatically includes companion thumbnails for try-on outputs.
    - Chunks requests into manageable batches (default 50) to prevent request body/header overflow.
    - Gracefully handles missing files, returning total processed key count.
    - Zero credentials exposed in error logs.
    """
    if not settings.supabase_url or not settings.supabase_service_key or not storage_paths_or_urls:
        return 0

    bucket_name = settings.supabase_storage_bucket
    public_prefix = f"/storage/v1/object/public/{bucket_name}/"
    sign_prefix = f"/storage/v1/object/sign/{bucket_name}/"
    allowed_prefixes = ("user_photos/", "scans/", "tryon_results/", "garments/")
    
    clean_keys: list[str] = []

    for path_or_url in storage_paths_or_urls:
        if not path_or_url or not isinstance(path_or_url, str) or path_or_url.startswith("data:"):
            continue

        clean = path_or_url.split("?")[0].split("#")[0].strip()
        if public_prefix in clean:
            clean = clean.split(public_prefix, 1)[1]
        elif sign_prefix in clean:
            clean = clean.split(sign_prefix, 1)[1]
        elif "/storage/v1/object/public/" in clean:
            clean = clean.split("/storage/v1/object/public/", 1)[1]
            if clean.startswith(f"{bucket_name}/"):
                clean = clean[len(bucket_name) + 1 :]
        elif clean.startswith(f"{bucket_name}/"):
            clean = clean[len(bucket_name) + 1 :]

        # Normalize relative path if it contains subfolder prefixes
        for prefix in allowed_prefixes:
            if f"/{prefix}" in clean and not clean.startswith(prefix):
                clean = prefix + clean.split(f"/{prefix}", 1)[1]
                break

        # Safety check: must start with an allowed prefix and contain no traversal
        if any(clean.startswith(p) for p in allowed_prefixes) and not clean.startswith("..") and "/.." not in clean:
            if clean not in clean_keys:
                clean_keys.append(clean)
            
            # Companion thumbnail auto-inclusion for tryon_results
            if clean.startswith("tryon_results/"):
                filename = clean[len("tryon_results/") :]
                if not filename.startswith("thumb_") and (filename.endswith(".webp") or filename.endswith(".jpg") or filename.endswith(".png")):
                    thumb_key = f"tryon_results/thumb_{filename}"
                    if thumb_key not in clean_keys:
                        clean_keys.append(thumb_key)

    if not clean_keys:
        return 0

    deleted_count = 0
    try:
        client = _get_supabase_client()
        bucket = client.storage.from_(bucket_name)
        for i in range(0, len(clean_keys), batch_size):
            batch = clean_keys[i : i + batch_size]
            try:
                bucket.remove(batch)
                deleted_count += len(batch)
            except Exception as batch_exc:
                print(f"Notice: Supabase Storage batch deletion warning for {len(batch)} items: {batch_exc}")
    except Exception as exc:
        print(f"Notice: Supabase client initialization error during batch storage removal: {exc}")

    return deleted_count


def delete_garment_images_from_storage(storage_paths_or_urls: list[str]) -> None:
    """Safely delete user-uploaded garment images from Supabase Storage.
    STRICT SAFETY INVARIANT: Only deletes objects residing within the configured bucket
    under 'garments/' to prevent any deletion of tryon_results, scans, user_photos,
    or external retailer assets.
    """
    if not settings.supabase_url or not settings.supabase_service_key or not storage_paths_or_urls:
        return

    bucket_name = settings.supabase_storage_bucket
    public_prefix = f"/storage/v1/object/public/{bucket_name}/"
    sign_prefix = f"/storage/v1/object/sign/{bucket_name}/"
    clean_keys: list[str] = []

    for path_or_url in storage_paths_or_urls:
        if not path_or_url or not isinstance(path_or_url, str) or path_or_url.startswith("data:"):
            continue

        clean = path_or_url.split("?")[0].split("#")[0].strip()
        if public_prefix in clean:
            clean = clean.split(public_prefix, 1)[1]
        elif sign_prefix in clean:
            clean = clean.split(sign_prefix, 1)[1]
        elif "/storage/v1/object/public/" in clean:
            clean = clean.split("/storage/v1/object/public/", 1)[1]
            if clean.startswith(f"{bucket_name}/"):
                clean = clean[len(bucket_name) + 1 :]
        elif clean.startswith(f"{bucket_name}/"):
            clean = clean[len(bucket_name) + 1 :]

        # Normalize relative path if it contains /garments/
        if "/garments/" in clean and not clean.startswith("garments/"):
            clean = "garments/" + clean.split("/garments/", 1)[1]

        # Strict safety guard: Only delete objects under garments/ and reject path traversal
        if clean.startswith("garments/") and not clean.startswith("garments/..") and len(clean) > len("garments/"):
            if clean not in clean_keys:
                clean_keys.append(clean)

    if not clean_keys:
        return

    try:
        client = _get_supabase_client()
        bucket = client.storage.from_(bucket_name)
        bucket.remove(clean_keys)
    except Exception as exc:
        print(f"Notice: Supabase garment storage cleanup warning ({exc})")



def upload_user_photo(image_bytes: bytes, storage_path: str, mime_type: str = "image/jpeg") -> None:
    """Upload user saved photo bytes to Supabase storage bucket."""
    if not settings.supabase_url or not settings.supabase_service_key:
        raise ValueError("Supabase production URL and service_role key must be configured.")

    client = _get_supabase_client()
    bucket_name = settings.supabase_storage_bucket
    bucket = client.storage.from_(bucket_name)

    clean_path = storage_path
    if clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    bucket.upload(
        path=clean_path,
        file=image_bytes,
        file_options={"content-type": mime_type, "x-upsert": "true", "cacheControl": "31536000"},
    )


def delete_user_photo(storage_path: str) -> None:
    """Delete a user saved photo from Supabase Storage."""
    if not settings.supabase_url or not settings.supabase_service_key or not storage_path:
        return

    bucket_name = settings.supabase_storage_bucket
    clean_path = storage_path
    if clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    try:
        client = _get_supabase_client()
        bucket = client.storage.from_(bucket_name)
        bucket.remove([clean_path])
    except Exception as exc:
        print(f"Notice: Supabase user photo cleanup warning ({exc})")


def download_user_photo(storage_path: str) -> bytes:
    """Download user photo bytes from Supabase storage bucket."""
    if not settings.supabase_url or not settings.supabase_service_key:
        raise ValueError("Supabase production URL and service_role key must be configured.")

    bucket_name = settings.supabase_storage_bucket
    client = _get_supabase_client()
    bucket = client.storage.from_(bucket_name)

    clean_path = storage_path
    if clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    return bucket.download(clean_path)


import io
import time
from PIL import Image, ImageOps

_signed_url_cache: dict[str, tuple[str, float]] = {}

DEFAULT_USER_PHOTO_MAX_DIM = 1200
DEFAULT_USER_PHOTO_QUALITY = 85

DEFAULT_TRYON_RESULT_MAX_DIM = 1200
DEFAULT_TRYON_RESULT_QUALITY = 85

DEFAULT_THUMBNAIL_WIDTH = 400
DEFAULT_THUMBNAIL_QUALITY = 80


def optimize_image(
    image_bytes: bytes,
    *,
    max_dim: Optional[int] = None,
    target_width: Optional[int] = None,
    quality: int = 85,
    format_preference: str = "WEBP",
) -> tuple[bytes, str]:
    """Optimizes raw image bytes using Pillow with EXIF normalization and Lanczos scaling.

    Returns:
        tuple of (optimized_bytes, mime_type) e.g. (bytes, "image/webp") or fallback (bytes, "image/jpeg").
    """
    if not image_bytes:
        return image_bytes, "image/jpeg"

    try:
        raw_img = Image.open(io.BytesIO(image_bytes))
        # Correct orientation based on EXIF tag
        img = ImageOps.exif_transpose(raw_img)
        if img is None:
            img = raw_img

        # Convert palette/alpha modes to RGB for clean compression
        if img.mode in ("RGBA", "LA", "P"):
            if img.mode in ("RGBA", "LA"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            else:
                img = img.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")

        orig_w, orig_h = img.size

        # Downsample if exceeds max_dim
        if max_dim and max(orig_w, orig_h) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        elif target_width and orig_w > target_width:
            target_h = max(1, int(target_width * orig_h / orig_w))
            img = img.resize((target_width, target_h), Image.Resampling.LANCZOS)

        # 1. Primary: Encode to WebP
        if format_preference.upper() == "WEBP":
            try:
                buf = io.BytesIO()
                img.save(buf, format="WEBP", quality=quality, method=6)
                return buf.getvalue(), "image/webp"
            except Exception as webp_err:
                print(f"Notice: WebP encoding fallback ({webp_err}), using JPEG")

        # 2. Secondary / Fallback: High-Quality Progressive JPEG
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        return buf.getvalue(), "image/jpeg"

    except Exception as exc:
        print(f"Notice: Image optimization fallback to raw bytes ({exc})")
        return image_bytes, "image/jpeg"


def optimize_user_photo(
    image_bytes: bytes,
    max_dim: int = DEFAULT_USER_PHOTO_MAX_DIM,
    quality: int = DEFAULT_USER_PHOTO_QUALITY,
) -> tuple[bytes, str]:
    """Optimizes a user photo for body reference storage (max 1200px, WebP q85)."""
    return optimize_image(image_bytes, max_dim=max_dim, quality=quality, format_preference="WEBP")


def optimize_tryon_result(
    image_bytes: bytes,
    max_dim: int = DEFAULT_TRYON_RESULT_MAX_DIM,
    quality: int = DEFAULT_TRYON_RESULT_QUALITY,
) -> tuple[bytes, str]:
    """Optimizes a raw Vertex AI Try-On output into the canonical result (max 1200px, WebP q85)."""
    return optimize_image(image_bytes, max_dim=max_dim, quality=quality, format_preference="WEBP")


def create_thumbnail(
    image_bytes: bytes,
    target_width: int = DEFAULT_THUMBNAIL_WIDTH,
    quality: int = DEFAULT_THUMBNAIL_QUALITY,
) -> tuple[bytes, str]:
    """Generates a lightweight masonry card thumbnail (400px width, WebP q80)."""
    return optimize_image(image_bytes, target_width=target_width, quality=quality, format_preference="WEBP")


def create_signed_photo_url(storage_path: str, expires_in: int = 7200) -> str:
    """Generate a time-limited signed URL for a private user photo/result from storage with in-memory caching."""
    if not settings.supabase_url or not settings.supabase_service_key or not storage_path:
        return ""

    now = time.time()
    if storage_path in _signed_url_cache:
        cached_url, exp_time = _signed_url_cache[storage_path]
        if exp_time - now > 600:
            return cached_url

    bucket_name = settings.supabase_storage_bucket
    clean_path = storage_path
    public_prefix = f"/storage/v1/object/public/{bucket_name}/"
    if public_prefix in clean_path:
        clean_path = clean_path.split(public_prefix, 1)[1]
    elif f"/{bucket_name}/" in clean_path:
        clean_path = clean_path.split(f"/{bucket_name}/", 1)[1]
    elif clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    clean_path = clean_path.split("?")[0]

    try:
        client = _get_supabase_client()
        bucket = client.storage.from_(bucket_name)
        res = bucket.create_signed_url(clean_path, expires_in)
        signed = ""
        if isinstance(res, dict):
            signed = res.get("signedURL") or res.get("signedUrl") or res.get("signed_url") or res.get("url") or res.get("path") or ""
        elif isinstance(res, str):
            signed = res
        if signed:
            if signed.startswith("/"):
                signed = f"{settings.supabase_url}/storage/v1{signed}"
            _signed_url_cache[storage_path] = (signed, now + expires_in)
            return signed
        return ""
    except Exception as exc:
        print(f"Notice: Could not create signed URL for {storage_path}: {exc}")
        # Strictly no public fallback for private user assets
        return ""


def sign_if_private(url_or_ref: str, expires_in: int = 7200) -> str:
    """If the URL or reference refers to a private Supabase object (tryon_results/, scans/, user_photos/),
    return a signed time-limited URL.
    Product/catalog images, external CDN URLs, and data: URIs are preserved untouched.
    """
    if not url_or_ref or not isinstance(url_or_ref, str):
        return ""
    if url_or_ref.startswith("data:"):
        return url_or_ref

    bucket_name = settings.supabase_storage_bucket
    public_prefix = f"/storage/v1/object/public/{bucket_name}/"
    sign_prefix = f"/storage/v1/object/sign/{bucket_name}/"

    is_private = False
    clean_path = url_or_ref

    if public_prefix in clean_path:
        clean_path = clean_path.split(public_prefix, 1)[1]
        is_private = True
    elif sign_prefix in clean_path:
        clean_path = clean_path.split(sign_prefix, 1)[1]
        is_private = True
    elif f"/{bucket_name}/" in clean_path:
        clean_path = clean_path.split(f"/{bucket_name}/", 1)[1]
        is_private = True
    elif (
        clean_path.startswith("tryon_results/")
        or clean_path.startswith("scans/")
        or clean_path.startswith("user_photos/")
        or clean_path.startswith("garments/")
        or clean_path.startswith("pi_scans/")
    ):
        is_private = True
    elif clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]
        is_private = True

    # Strip existing query params (e.g. old ?token=...)
    clean_path = clean_path.split("?")[0]

    # Strip leading bucket name if present
    if clean_path.startswith(f"{bucket_name}/"):
        clean_path = clean_path[len(bucket_name) + 1 :]

    if is_private:
        signed = create_signed_photo_url(clean_path, expires_in=expires_in)
        if signed:
            return signed

    # Non-private or external catalog/merchant image (e.g. Amazon, Myntra, external CDN)
    return url_or_ref


def get_thumbnail_url_for_result(result_url: str) -> str:
    """Returns the thumbnail URL for a Try-On result, or falls back to result_url."""
    if not result_url:
        return ""
    if "/tryon_results/" in result_url:
        parts = result_url.rsplit("/tryon_results/", 1)
        filename = parts[1].split("?")[0]
        if not filename.startswith("thumb_") and (filename.endswith(".webp") or filename.endswith(".jpg")):
            thumb_path = f"tryon_results/thumb_{filename}"
            signed_thumb = create_signed_photo_url(thumb_path)
            if signed_thumb:
                return signed_thumb
            return f"{parts[0]}/tryon_results/thumb_{filename}"
    elif result_url.startswith("tryon_results/"):
        filename = result_url[len("tryon_results/") :].split("?")[0]
        if not filename.startswith("thumb_") and (filename.endswith(".webp") or filename.endswith(".jpg")):
            thumb_path = f"tryon_results/thumb_{filename}"
            signed_thumb = create_signed_photo_url(thumb_path)
            if signed_thumb:
                return signed_thumb
            return thumb_path
    return sign_if_private(result_url)








