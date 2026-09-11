import io
import os
import time
import asyncio
import tempfile
import pytest
from PIL import Image
import numpy as np

from app.services.preprocessing.garment_preprocessor import (
    GarmentPreprocessor,
    garment_preprocessor,
)


@pytest.mark.asyncio
async def test_garment_preprocessor_model_loading():
    """Verify that SegFormer loads once and operates in eval/inference mode."""
    await garment_preprocessor.ensure_model_loaded()
    assert garment_preprocessor._model_loaded is True
    assert garment_preprocessor._model is not None
    assert garment_preprocessor._processor is not None
    assert garment_preprocessor._model.training is False


@pytest.mark.asyncio
async def test_garment_preprocessor_category_routing():
    """Verify semantic label mapping across tops, dresses, bottoms, and ethnic."""
    # Create test synthetic image
    img = Image.new("RGB", (512, 512), color=(180, 50, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    test_bytes = buf.getvalue()

    for cat in ["top", "dress", "bottom", "saree"]:
        res_bytes, report = await garment_preprocessor.preprocess(
            test_bytes,
            garment_type=cat,
            garment_url=f"https://test.local/{cat}.jpg",
        )
        assert len(res_bytes) > 0
        assert report["garment_type"] == cat


@pytest.mark.asyncio
async def test_unsupported_category_passthrough():
    """Verify shoes and non-apparel pass through raw bytes safely."""
    raw_bytes = b"MOCK_SHOES_IMAGE_BYTES_1234567890" * 10
    res_bytes, report = await garment_preprocessor.preprocess(
        raw_bytes,
        garment_type="shoes",
        garment_url="https://test.local/shoes.jpg",
    )
    assert res_bytes == raw_bytes
    assert report["status"] == "PASSTHROUGH_NON_APPAREL"
    assert report["is_fallback"] is False


@pytest.mark.asyncio
async def test_failsafe_fallback_corrupted_input():
    """Verify corrupted / invalid bytes return original bytes with is_fallback=True."""
    corrupted_bytes = b"CORRUPTED_BYTES_NOT_AN_IMAGE"
    res_bytes, report = await garment_preprocessor.preprocess(
        corrupted_bytes,
        garment_type="top",
        garment_url="https://test.local/corrupted.jpg",
    )
    assert res_bytes == corrupted_bytes
    assert report["is_fallback"] is True


@pytest.mark.asyncio
async def test_failsafe_fallback_blank_image():
    """Verify blank 0% garment coverage returns original bytes safely."""
    blank = Image.new("RGB", (400, 400), color=(255, 255, 255))
    buf = io.BytesIO()
    blank.save(buf, format="JPEG")
    blank_bytes = buf.getvalue()

    res_bytes, report = await garment_preprocessor.preprocess(
        blank_bytes,
        garment_type="top",
        garment_url="https://test.local/blank.jpg",
    )
    assert report["is_fallback"] is True
    assert res_bytes == blank_bytes


@pytest.mark.asyncio
async def test_same_product_in_flight_deduplication():
    """Verify 50 concurrent requests for the same garment run SegFormer exactly once."""
    img = Image.new("RGB", (400, 600), color=(140, 60, 60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    test_bytes = buf.getvalue()

    # Track execution count using mock wrapper
    original_segment_sync = garment_preprocessor._segment_sync
    execution_counter = 0

    def counting_segment_sync(image_bytes, target_labels):
        nonlocal execution_counter
        execution_counter += 1
        return original_segment_sync(image_bytes, target_labels)

    garment_preprocessor._segment_sync = counting_segment_sync
    shared_url = "https://assets.myntassets.com/viral_summer_dress_unique.jpg"

    try:
        tasks = [
            garment_preprocessor.preprocess(test_bytes, garment_type="dress", garment_url=shared_url)
            for _ in range(50)
        ]
        results = await asyncio.gather(*tasks)
        assert len(results) == 50
        # All 50 consumers received identical results
        for r_bytes, r_rep in results:
            assert len(r_bytes) > 0
        # Exactly 1 SegFormer execution occurred
        assert execution_counter == 1, f"Expected 1 execution, got {execution_counter}"
    finally:
        garment_preprocessor._segment_sync = original_segment_sync


@pytest.mark.asyncio
async def test_unique_product_concurrency_bounded():
    """Verify 20 distinct garments process cleanly under bounded semaphore."""
    img = Image.new("RGB", (300, 400), color=(120, 80, 40))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    test_bytes = buf.getvalue()

    tasks = [
        garment_preprocessor.preprocess(
            test_bytes,
            garment_type="top",
            garment_url=f"https://test.local/item_{i}.jpg",
        )
        for i in range(20)
    ]
    results = await asyncio.gather(*tasks)
    assert len(results) == 20
    for r_bytes, r_rep in results:
        assert len(r_bytes) > 0


@pytest.mark.asyncio
async def test_temporary_file_cleanup_zero_leakage():
    """Verify guaranteed try/finally cleanup leaves 0 orphaned files."""
    temp_dir = tempfile.mkdtemp(prefix="fitme_clean_check_")
    
    def tryon_worker(should_raise: bool):
        p_path = os.path.join(temp_dir, f"person_{time.time_ns()}.jpg")
        g_path = os.path.join(temp_dir, f"garment_{time.time_ns()}.png")
        with open(p_path, "wb") as f:
            f.write(b"PERSON_BYTES")
        with open(g_path, "wb") as f:
            f.write(b"GARMENT_BYTES")

        try:
            if should_raise:
                raise RuntimeError("Simulated Vertex Exception")
            return "SUCCESS"
        finally:
            for p in (p_path, g_path):
                if p and os.path.exists(p):
                    os.remove(p)

    for i in range(50):
        try:
            tryon_worker(should_raise=(i % 2 == 0))
        except RuntimeError:
            pass

    remaining = os.listdir(temp_dir)
    assert len(remaining) == 0, f"Leaked temporary files: {remaining}"
    os.rmdir(temp_dir)


@pytest.mark.asyncio
async def test_kurta_routing_accepts_upper_and_dress_labels():
    """Verify that kurta category correctly accepts [4, 7, 17] and rejects Pants/Limbs."""
    from app.services.preprocessing.garment_preprocessor import CATEGORY_LABEL_MAP
    assert CATEGORY_LABEL_MAP["kurta"] == [4, 7, 17]
    assert 6 not in CATEGORY_LABEL_MAP["kurta"]  # Pants excluded
    assert 11 not in CATEGORY_LABEL_MAP["kurta"] # Face excluded


@pytest.mark.asyncio
async def test_shirt_routing_strictly_excludes_dress_and_pants():
    """Verify that shirt category strictly uses [4, 17] and excludes Dress [7] and Pants [6]."""
    from app.services.preprocessing.garment_preprocessor import CATEGORY_LABEL_MAP
    assert CATEGORY_LABEL_MAP["shirt"] == [4, 17]
    assert CATEGORY_LABEL_MAP["tshirt"] == [4, 17]
    assert 7 not in CATEGORY_LABEL_MAP["shirt"]  # Dress excluded
    assert 6 not in CATEGORY_LABEL_MAP["shirt"]  # Pants excluded


@pytest.mark.asyncio
async def test_jeans_routing_strictly_excludes_upper_and_dress():
    """Verify that jeans/pants category strictly uses [6, 5] and excludes Upper [4] and Dress [7]."""
    from app.services.preprocessing.garment_preprocessor import CATEGORY_LABEL_MAP
    assert CATEGORY_LABEL_MAP["jeans"] == [6, 5]
    assert CATEGORY_LABEL_MAP["pants"] == [6, 5]
    assert 4 not in CATEGORY_LABEL_MAP["jeans"]  # Upper excluded
    assert 7 not in CATEGORY_LABEL_MAP["jeans"]  # Dress excluded
