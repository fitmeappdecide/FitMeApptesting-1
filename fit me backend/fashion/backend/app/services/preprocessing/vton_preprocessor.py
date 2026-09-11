import io
import time
from dataclasses import dataclass
from typing import Optional, Tuple
from PIL import Image, ImageOps

from app.services.preprocessing.person_detector import LocalPersonDetector, PersonBox, detector
from app.services.preprocessing.smart_crop import CropBox, apply_smart_crop


@dataclass
class PreprocessReport:
    person_detected: bool
    person_count: int
    occupancy_ratio: float
    crop_applied: bool
    original_dimensions: Tuple[int, int]
    prepared_dimensions: Tuple[int, int]
    crop_box: Optional[Tuple[int, int, int, int]] = None
    detection_time_ms: float = 0.0
    total_time_ms: float = 0.0
    notes: str = ""


# Configurable default threshold (empirically determined optimal threshold for portrait framing & facial clarity)
DEFAULT_OCCUPANCY_THRESHOLD = 0.68
DEFAULT_TARGET_ASPECT_RATIO = 0.75  # 3:4 portrait aspect ratio


def preprocess_user_image(
    image_bytes: bytes,
    *,
    occupancy_threshold: float = DEFAULT_OCCUPANCY_THRESHOLD,
    top_pad_ratio: float = 0.12,
    bottom_pad_ratio: float = 0.08,
    side_pad_ratio: float = 0.35,
    min_aspect_ratio: float = 0.45,
    target_aspect_ratio: Optional[float] = DEFAULT_TARGET_ASPECT_RATIO,
) -> Tuple[bytes, PreprocessReport]:
    """Preprocesses a user photo for Virtual Try-On.
    
    Behavior:
    1. Detects person coordinates using local person detector.
    2. Measures vertical occupancy (person_height / image_height).
    3. If person is sufficiently large (occupancy >= threshold):
       -> Returns original image bytes UNTOUCHED (zero cropping, zero alteration).
    4. If person is too small (occupancy < threshold):
       -> Applies location-aware smart crop with breathing room.
    5. If no person is detected:
       -> Safely returns original image bytes without arbitrary cropping.
    """
    t0 = time.perf_counter()
    
    if not image_bytes:
        return image_bytes, PreprocessReport(
            person_detected=False,
            person_count=0,
            occupancy_ratio=0.0,
            crop_applied=False,
            original_dimensions=(0, 0),
            prepared_dimensions=(0, 0),
            notes="Empty image bytes provided",
        )

    try:
        raw_img = Image.open(io.BytesIO(image_bytes))
        # Ensure EXIF orientation is corrected for inspection
        img_oriented = ImageOps.exif_transpose(raw_img)
        orig_w, orig_h = img_oriented.size
    except Exception as e:
        print(f"⚠️ [VTON PREPROCESS] Failed to open image with PIL ({e}) -> passing original bytes.")
        return image_bytes, PreprocessReport(
            person_detected=False,
            person_count=0,
            occupancy_ratio=0.0,
            crop_applied=False,
            original_dimensions=(0, 0),
            prepared_dimensions=(0, 0),
            notes=f"Image open error: {e}",
        )

    # 1. Detect person
    detection = detector.detect(img_oriented)
    det_ms = detection.inference_time_ms

    # 2. Handle no person detected
    if not detection.detected or detection.primary_person is None:
        total_ms = (time.perf_counter() - t0) * 1000.0
        print(f"ℹ️ [VTON PREPROCESS] No person detected ({det_ms:.1f}ms) -> KEEP ORIGINAL (no arbitrary crop).")
        return image_bytes, PreprocessReport(
            person_detected=False,
            person_count=0,
            occupancy_ratio=0.0,
            crop_applied=False,
            original_dimensions=(orig_w, orig_h),
            prepared_dimensions=(orig_w, orig_h),
            detection_time_ms=det_ms,
            total_time_ms=total_ms,
            notes="No person detected; original preserved",
        )

    primary = detection.primary_person
    # Vertical occupancy = height of detected person relative to total image height
    occupancy = primary.height

    # 3. Decision Gate: Is person already large enough?
    if occupancy >= occupancy_threshold:
        total_ms = (time.perf_counter() - t0) * 1000.0
        print(
            f"✅ [VTON PREPROCESS] Well-framed subject: occupancy={occupancy:.1%} "
            f"(threshold={occupancy_threshold:.1%}) in {det_ms:.1f}ms -> KEEP ORIGINAL."
        )
        return image_bytes, PreprocessReport(
            person_detected=True,
            person_count=detection.person_count,
            occupancy_ratio=occupancy,
            crop_applied=False,
            original_dimensions=(orig_w, orig_h),
            prepared_dimensions=(orig_w, orig_h),
            detection_time_ms=det_ms,
            total_time_ms=total_ms,
            notes=f"Occupancy {occupancy:.1%} >= threshold {occupancy_threshold:.1%}; original preserved",
        )

    # 4. Small person detected: Trigger location-aware Smart Crop
    print(
        f"✂️ [VTON PREPROCESS] Small subject detected: occupancy={occupancy:.1%} "
        f"< threshold={occupancy_threshold:.1%}. Applying smart crop centered on person..."
    )
    cropped_img, crop_box = apply_smart_crop(
        img_oriented,
        primary,
        top_pad_ratio=top_pad_ratio,
        bottom_pad_ratio=bottom_pad_ratio,
        side_pad_ratio=side_pad_ratio,
        min_aspect_ratio=min_aspect_ratio,
        target_aspect_ratio=target_aspect_ratio,
    )

    new_w, new_h = cropped_img.size

    # 5. Export cropped image to bytes
    out_io = io.BytesIO()
    # Preserve format if PNG, otherwise use high-quality JPEG
    fmt = raw_img.format if raw_img.format in ("PNG", "WEBP") else "JPEG"
    if fmt == "JPEG" and cropped_img.mode in ("RGBA", "P"):
        cropped_img = cropped_img.convert("RGB")
    cropped_img.save(out_io, format=fmt, quality=95, optimize=True)
    prepared_bytes = out_io.getvalue()

    total_ms = (time.perf_counter() - t0) * 1000.0
    print(
        f"✨ [VTON PREPROCESS] Smart crop complete: {orig_w}x{orig_h} -> {new_w}x{new_h} "
        f"(crop box: x=[{crop_box.px_x1},{crop_box.px_x2}], y=[{crop_box.px_y1},{crop_box.px_y2}]) "
        f"in {total_ms:.1f}ms."
    )

    return prepared_bytes, PreprocessReport(
        person_detected=True,
        person_count=detection.person_count,
        occupancy_ratio=occupancy,
        crop_applied=True,
        original_dimensions=(orig_w, orig_h),
        prepared_dimensions=(new_w, new_h),
        crop_box=(crop_box.px_x1, crop_box.px_y1, crop_box.px_x2, crop_box.px_y2),
        detection_time_ms=det_ms,
        total_time_ms=total_ms,
        notes=f"Smart cropped from {orig_w}x{orig_h} to {new_w}x{new_h} (occupancy={occupancy:.1%})",
    )
