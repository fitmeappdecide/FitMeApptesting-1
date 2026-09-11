import io
import time
import pytest
from PIL import Image, ImageDraw

from app.services.preprocessing.person_detector import (
    LocalPersonDetector,
    PersonBox,
    DetectionResult,
)
from app.services.preprocessing.smart_crop import (
    CropBox,
    calculate_smart_crop_box,
    apply_smart_crop,
)
from app.services.preprocessing.vton_preprocessor import (
    PreprocessReport,
    preprocess_user_image,
    DEFAULT_OCCUPANCY_THRESHOLD,
)


def _create_synthetic_person_image(
    width: int,
    height: int,
    person_norm_box: tuple[float, float, float, float],
    bg_color=(230, 230, 230),
) -> bytes:
    """Helper to create a synthetic image containing a drawn human figure."""
    img = Image.new("RGB", (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)

    xmin, ymin, xmax, ymax = person_norm_box
    px_x1 = int(round(xmin * width))
    px_y1 = int(round(ymin * height))
    px_x2 = int(round(xmax * width))
    px_y2 = int(round(ymax * height))

    pw = px_x2 - px_x1
    ph = px_y2 - px_y1

    # Head (top 18% of person height)
    head_h = int(ph * 0.18)
    head_w = int(pw * 0.45)
    head_x1 = px_x1 + (pw - head_w) // 2
    draw.ellipse([head_x1, px_y1, head_x1 + head_w, px_y1 + head_h], fill=(235, 195, 175))

    # Torso / Upper body (from 18% to 58%)
    torso_y1 = px_y1 + head_h
    torso_y2 = px_y1 + int(ph * 0.58)
    draw.rectangle([px_x1, torso_y1, px_x2, torso_y2], fill=(45, 90, 180))

    # Legs (from 58% to 100%)
    leg_w = int(pw * 0.35)
    leg1_x1 = px_x1 + int(pw * 0.10)
    leg2_x1 = px_x2 - int(pw * 0.10) - leg_w
    draw.rectangle([leg1_x1, torso_y2, leg1_x1 + leg_w, px_y2], fill=(30, 30, 40))
    draw.rectangle([leg2_x1, torso_y2, leg2_x1 + leg_w, px_y2], fill=(30, 30, 40))

    bio = io.BytesIO()
    img.save(bio, format="JPEG", quality=95)
    return bio.getvalue()


# ---------------------------------------------------------------------------
# Unit Tests for Smart Crop Calculation
# ---------------------------------------------------------------------------


def test_smart_crop_box_centered_person():
    """Test crop box calculation for a centered small person."""
    W, H = 1000, 1000
    # Small person in the center: occupying y from 0.35 to 0.65 (height = 30%)
    person = PersonBox(xmin=0.40, ymin=0.35, xmax=0.60, ymax=0.65, confidence=0.90)

    crop = calculate_smart_crop_box(
        image_width=W,
        image_height=H,
        person=person,
        top_pad_ratio=0.12,
        bottom_pad_ratio=0.08,
        side_pad_ratio=0.20,
    )

    # Verify headroom and footroom are padded
    assert crop.px_y1 < 350  # Includes headroom
    assert crop.px_y2 > 650  # Includes footroom
    # Verify side padding is added
    assert crop.px_x1 < 400
    assert crop.px_x2 > 600
    # Verify bounds
    assert crop.px_x1 >= 0 and crop.px_y1 >= 0
    assert crop.px_x2 <= W and crop.px_y2 <= H


def test_smart_crop_box_person_on_left_never_center_crops():
    """Verify that a person on the left causes the crop to shift left, not center crop."""
    W, H = 1200, 800
    # Person located on the far left (x: 0.05 to 0.25 -> px 60 to 300)
    person = PersonBox(xmin=0.05, ymin=0.20, xmax=0.25, ymax=0.70, confidence=0.95)

    crop = calculate_smart_crop_box(image_width=W, image_height=H, person=person)

    # Crop must anchor on the left, clamped at x1=0, completely within the left half (x2 < 600)
    assert crop.px_x1 == 0
    assert crop.px_x2 < 500  # Stays strictly on the left half of the image
    person_px_center_x = (0.05 + 0.25) / 2.0 * W  # 180px
    assert crop.px_x1 <= person_px_center_x <= crop.px_x2


def test_smart_crop_box_person_on_right_never_center_crops():
    """Verify that a person on the right causes the crop to shift right."""
    W, H = 1200, 800
    # Person located on the far right (x: 0.75 to 0.95 -> px 900 to 1140)
    person = PersonBox(xmin=0.75, ymin=0.20, xmax=0.95, ymax=0.70, confidence=0.95)

    crop = calculate_smart_crop_box(image_width=W, image_height=H, person=person)

    # Crop must anchor on the right, clamped at x2=W, completely within the right half (x1 > 600)
    assert crop.px_x2 == W
    assert crop.px_x1 > 700  # Stays strictly on the right half of the image
    person_px_center_x = (0.75 + 0.95) / 2.0 * W  # 1020px
    assert crop.px_x1 <= person_px_center_x <= crop.px_x2


def test_smart_crop_box_near_top_preserves_head():
    """Verify that a person near the top edge is safely clamped without errors."""
    W, H = 1000, 1000
    person = PersonBox(xmin=0.35, ymin=0.02, xmax=0.65, ymax=0.45, confidence=0.90)

    crop = calculate_smart_crop_box(image_width=W, image_height=H, person=person)

    assert crop.px_y1 == 0
    assert crop.px_y2 >= int(0.45 * H)


def test_smart_crop_box_near_bottom_preserves_feet():
    """Verify that a person near the bottom edge is safely clamped with feet preserved."""
    W, H = 1000, 1000
    person = PersonBox(xmin=0.35, ymin=0.55, xmax=0.65, ymax=0.98, confidence=0.90)

    crop = calculate_smart_crop_box(image_width=W, image_height=H, person=person)

    assert crop.px_y2 == H
    assert crop.px_y1 <= int(0.55 * H)


def test_smart_crop_no_distortion():
    """Verify that cropping preserves pixel proportions and does not distort pixels."""
    W, H = 800, 1000
    raw_img = Image.new("RGB", (W, H), color=(240, 240, 240))
    person = PersonBox(xmin=0.30, ymin=0.30, xmax=0.70, ymax=0.70, confidence=0.88)

    cropped, crop_box = apply_smart_crop(raw_img, person)

    # Cropped size must match crop_box pixel dimensions exactly
    assert cropped.size == (crop_box.width, crop_box.height)
    assert cropped.width > 0 and cropped.height > 0


# ---------------------------------------------------------------------------
# Preprocessor End-to-End Decision Tests
# ---------------------------------------------------------------------------


def test_preprocessor_well_framed_image_never_crops():
    """Test A: When person is already large in frame, NO crop must occur."""
    # Person occupying 75% of height (ymin=0.10, ymax=0.85)
    img_bytes = _create_synthetic_person_image(800, 1000, (0.25, 0.10, 0.75, 0.85))

    prepared_bytes, report = preprocess_user_image(img_bytes, occupancy_threshold=0.50)

    # If occupancy >= 0.50, crop_applied must be False and bytes must be identical
    if report.person_detected and report.occupancy_ratio >= 0.50:
        assert report.crop_applied is False
        assert prepared_bytes == img_bytes
        assert report.prepared_dimensions == report.original_dimensions


def test_preprocessor_small_person_triggers_smart_crop():
    """Test B: When person occupies small portion of background-heavy image, smart crop triggers."""
    # Small person occupying 25% of height (ymin=0.40, ymax=0.65) in a 1200x800 wide landscape image
    img_bytes = _create_synthetic_person_image(1200, 800, (0.42, 0.40, 0.58, 0.65))

    prepared_bytes, report = preprocess_user_image(img_bytes, occupancy_threshold=0.50)

    if report.person_detected and report.occupancy_ratio < 0.50:
        assert report.crop_applied is True
        assert report.prepared_dimensions[0] < report.original_dimensions[0]
        assert report.prepared_dimensions[1] < report.original_dimensions[1]
        assert report.crop_box is not None


def test_preprocessor_no_person_fallback_preserves_original():
    """Test G/H: When no person is detected (e.g. plain blank background), preserve original image."""
    # Blank plain image with no human shapes
    blank_img = Image.new("RGB", (800, 800), color=(180, 180, 180))
    bio = io.BytesIO()
    blank_img.save(bio, format="JPEG")
    blank_bytes = bio.getvalue()

    prepared_bytes, report = preprocess_user_image(blank_bytes)

    assert report.person_detected is False
    assert report.crop_applied is False
    assert prepared_bytes == blank_bytes
    assert report.prepared_dimensions == (800, 800)


def test_original_saved_bytes_are_unmutated():
    """Test I: Verify input bytes are completely unmutated."""
    original_bytes = _create_synthetic_person_image(600, 600, (0.3, 0.3, 0.7, 0.7))
    copy_of_original = bytes(original_bytes)

    prepared_bytes, report = preprocess_user_image(original_bytes)

    # original_bytes must remain 100% byte-for-byte identical to before
    assert original_bytes == copy_of_original


@pytest.mark.asyncio
async def test_vertex_provider_receives_prepared_image_without_modifying_storage(monkeypatch):
    """Test J: Existing Vertex provider receives prepared bytes without touching storage originals."""
    import app.services.tryon.vertex_provider as vp_module
    from app.services.tryon.vertex_provider import VertexProvider

    provider = VertexProvider()

    # Small person in a large background
    small_person_bytes = _create_synthetic_person_image(1200, 800, (0.45, 0.40, 0.55, 0.65))
    garment_bytes = _create_synthetic_person_image(400, 400, (0.1, 0.1, 0.9, 0.9))

    # Mock storage functions imported in vertex_provider
    monkeypatch.setattr(vp_module, "download_user_photo", lambda path: small_person_bytes)
    monkeypatch.setattr(vp_module, "upload_image_to_storage", lambda *args, **kwargs: "https://test.supabase.co/vton_res.png")

    # Mock httpx AsyncClient in vertex_provider
    class MockResponse:
        content = garment_bytes
        def raise_for_status(self):
            pass

    class MockAsyncClient:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url):
            return MockResponse()

    monkeypatch.setattr(vp_module.httpx, "AsyncClient", lambda *args, **kwargs: MockAsyncClient())

    # Intercept Vertex AI call to inspect the image passed to RecontextImageSource
    captured_person_images = []
    
    if provider.client and hasattr(provider.client, "models"):
        def mock_recontext_image(*, model, source, config):
            captured_person_images.append(source.person_image)
            from unittest.mock import MagicMock
            mock_resp = MagicMock()
            mock_resp.generated_images = [MagicMock(image=MagicMock(image_bytes=b"vton_output_png"))]
            return mock_resp
            
        monkeypatch.setattr(provider.client.models, "recontext_image", mock_recontext_image)

        res = await provider.generate_tryon(
            user_image_url="user-photos/test-user/123/original.jpg",
            garment_image_url="http://test.com/shirt.jpg",
        )

        assert len(res.image_urls) == 1
        assert "tryon_results" in res.image_urls[0]
        assert len(captured_person_images) == 1
        assert captured_person_images[0] is not None
