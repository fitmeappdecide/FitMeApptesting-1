import io
import uuid
import pytest
from PIL import Image

from app.services.storage_service import (
    optimize_image,
    optimize_user_photo,
    optimize_tryon_result,
    create_thumbnail,
    get_thumbnail_url_for_result,
)
from app.schemas.tryon import TryOnHistoryItem


def test_optimize_user_photo_resizes_large_image():
    # Simulate a large 3024x4032 12MP phone photo
    img = Image.new("RGB", (3024, 4032), (180, 120, 90))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    raw_bytes = buf.getvalue()

    opt_bytes, mime = optimize_user_photo(raw_bytes, max_dim=1200, quality=85)
    
    assert len(opt_bytes) < len(raw_bytes)
    assert mime in ("image/webp", "image/jpeg")

    dec = Image.open(io.BytesIO(opt_bytes))
    assert max(dec.size) <= 1200
    assert dec.size == (900, 1200)


def test_optimize_user_photo_preserves_small_image_dimensions():
    # Small image should not be enlarged
    img = Image.new("RGB", (600, 800), (200, 150, 100))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()

    opt_bytes, mime = optimize_user_photo(raw_bytes, max_dim=1200, quality=85)
    dec = Image.open(io.BytesIO(opt_bytes))
    assert dec.size == (600, 800)


def test_optimize_tryon_result_and_thumbnail_dimensions():
    # Simulated 1440x1920 Vertex AI output PNG
    img = Image.new("RGB", (1440, 1920), (50, 100, 150))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_png = buf.getvalue()

    # Canonical optimization
    can_bytes, can_mime = optimize_tryon_result(raw_png, max_dim=1200, quality=88)
    assert can_mime in ("image/webp", "image/jpeg")
    can_img = Image.open(io.BytesIO(can_bytes))
    assert max(can_img.size) <= 1200
    assert can_img.size == (900, 1200)

    # Thumbnail optimization
    thumb_bytes, thumb_mime = create_thumbnail(raw_png, target_width=400, quality=80)
    assert thumb_mime in ("image/webp", "image/jpeg")
    thumb_img = Image.open(io.BytesIO(thumb_bytes))
    assert thumb_img.size[0] == 400
    assert thumb_img.size[1] == 533


def test_thumbnail_url_resolution_and_backward_compatibility():
    # New Try-On result with WebP extension
    canonical_url = "https://project.supabase.co/storage/v1/object/public/fitme-storage/tryon_results/abc-123.webp"
    thumb_url = get_thumbnail_url_for_result(canonical_url)
    assert thumb_url == "https://project.supabase.co/storage/v1/object/public/fitme-storage/tryon_results/thumb_abc-123.webp"

    # Historical Try-On result with PNG extension -> falls back cleanly to original URL
    historical_url = "https://project.supabase.co/storage/v1/object/public/fitme-storage/tryon_results/historical-456.png"
    hist_thumb = get_thumbnail_url_for_result(historical_url)
    assert hist_thumb == historical_url

    # Non-tryon or empty URL
    assert get_thumbnail_url_for_result("") == ""
    assert get_thumbnail_url_for_result("https://example.com/other.jpg") == "https://example.com/other.jpg"


def test_tryon_history_schema_backward_compatibility():
    item = TryOnHistoryItem(
        id=uuid.uuid4(),
        garment_id=uuid.uuid4(),
        status="completed",
        result_image_urls=["https://project.supabase.co/storage/v1/object/public/fitme-storage/tryon_results/abc.webp"],
        thumbnail_url="https://project.supabase.co/storage/v1/object/public/fitme-storage/tryon_results/thumb_abc.webp",
        created_at="2026-08-28T12:00:00Z",
    )
    assert item.thumbnail_url is not None
    assert "thumb_" in item.thumbnail_url

    # Legacy item without thumbnail_url should deserialize cleanly
    legacy_item = TryOnHistoryItem(
        id=uuid.uuid4(),
        garment_id=uuid.uuid4(),
        status="completed",
        result_image_urls=["https://project.supabase.co/storage/v1/object/public/fitme-storage/tryon_results/legacy.png"],
        created_at="2026-08-28T12:00:00Z",
    )
    assert legacy_item.thumbnail_url is None
    assert len(legacy_item.result_image_urls) == 1
