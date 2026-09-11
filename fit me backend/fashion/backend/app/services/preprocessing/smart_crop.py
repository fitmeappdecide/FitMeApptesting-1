from dataclasses import dataclass
from typing import Optional, Tuple
from PIL import Image, ImageOps

from app.services.preprocessing.person_detector import PersonBox


@dataclass
class CropBox:
    """Crop bounding box in both pixel and normalized coordinates."""
    # Pixel coordinates
    px_x1: int
    px_y1: int
    px_x2: int
    px_y2: int
    # Normalized coordinates [0.0, 1.0]
    norm_x1: float
    norm_y1: float
    norm_x2: float
    norm_y2: float

    @property
    def width(self) -> int:
        return max(1, self.px_x2 - self.px_x1)

    @property
    def height(self) -> int:
        return max(1, self.px_y2 - self.px_y1)

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height


DEFAULT_TARGET_ASPECT_RATIO = 0.75  # 3:4 portrait aspect ratio


def calculate_smart_crop_box(
    image_width: int,
    image_height: int,
    person: PersonBox,
    *,
    top_pad_ratio: float = 0.12,
    bottom_pad_ratio: float = 0.08,
    side_pad_ratio: float = 0.35,
    min_aspect_ratio: float = 0.45,
    target_aspect_ratio: Optional[float] = DEFAULT_TARGET_ASPECT_RATIO,
) -> CropBox:
    """Calculates an intelligent, location-aware crop box centered around the detected person.
    
    Guarantees:
    - Never uses a fixed center crop; strictly anchors on the detected person coordinates.
    - Preserves head/hair via top padding.
    - Preserves feet/shoes via bottom padding.
    - Preserves shoulders, elbows, and arms via generous side padding.
    - Ensures natural lateral framing (minimum aspect ratio ~0.45-0.50) without pencil-thin crops.
    - Never stretches or distorts pixel geometry.
    - Safely clamps within [0, 0, image_width, image_height].
    """
    W = image_width
    H = image_height

    # 1. Convert normalized person box to pixel coordinates
    p_x1 = int(round(person.xmin * W))
    p_y1 = int(round(person.ymin * H))
    p_x2 = int(round(person.xmax * W))
    p_y2 = int(round(person.ymax * H))

    p_w = max(1, p_x2 - p_x1)
    p_h = max(1, p_y2 - p_y1)
    p_cx = (p_x1 + p_x2) / 2.0

    # 2. Compute proportional padding based on person dimensions
    pad_top = int(round(p_h * top_pad_ratio))
    pad_bottom = int(round(p_h * bottom_pad_ratio))
    pad_side = int(round(p_w * side_pad_ratio))

    # Initial vertical extent
    raw_y1 = p_y1 - pad_top
    raw_y2 = p_y2 + pad_bottom
    target_h = raw_y2 - raw_y1

    # Initial horizontal extent centered around person
    raw_x1 = p_x1 - pad_side
    raw_x2 = p_x2 + pad_side
    target_w = raw_x2 - raw_x1

    # 3. Ensure comfortable lateral width (min_aspect_ratio) so arms & shoulders have natural room
    if min_aspect_ratio is not None and min_aspect_ratio > 0:
        desired_min_w = int(round(target_h * min_aspect_ratio))
        if target_w < desired_min_w:
            w_diff = desired_min_w - target_w
            raw_x1 -= int(round(w_diff / 2.0))
            raw_x2 += int(round(w_diff / 2.0))
            target_w = raw_x2 - raw_x1

    # 4. Optional target aspect ratio balancing if explicitly specified
    if target_aspect_ratio is not None and target_aspect_ratio > 0:
        desired_w = int(round(target_h * target_aspect_ratio))
        if desired_w > target_w:
            w_diff = desired_w - target_w
            raw_x1 -= int(round(w_diff / 2.0))
            raw_x2 += int(round(w_diff / 2.0))
        desired_h = int(round(target_w / target_aspect_ratio))
        if desired_h > target_h:
            h_diff = desired_h - target_h
            raw_y1 -= int(round(h_diff / 2.0))
            raw_y2 += int(round(h_diff / 2.0))

    crop_w = raw_x2 - raw_x1
    crop_h = raw_y2 - raw_y1

    # 5. Location-aware clamping & shifting to preserve full crop window within image bounds
    # Horizontal positioning:
    if crop_w >= W:
        final_x1 = 0
        final_x2 = W
    else:
        if raw_x1 < 0:
            # Person is on the left edge
            final_x1 = 0
            final_x2 = min(W, crop_w)
        elif raw_x2 > W:
            # Person is on the right edge
            final_x2 = W
            final_x1 = max(0, W - crop_w)
        else:
            final_x1 = raw_x1
            final_x2 = raw_x2

    # Vertical positioning:
    if crop_h >= H:
        final_y1 = 0
        final_y2 = H
    else:
        if raw_y1 < 0:
            # Person is near top edge
            final_y1 = 0
            final_y2 = min(H, crop_h)
        elif raw_y2 > H:
            # Person is near bottom edge
            final_y2 = H
            final_y1 = max(0, H - crop_h)
        else:
            final_y1 = raw_y1
            final_y2 = raw_y2

    # Final safety bounds
    final_x1 = max(0, min(W - 1, int(final_x1)))
    final_y1 = max(0, min(H - 1, int(final_y1)))
    final_x2 = max(final_x1 + 1, min(W, int(final_x2)))
    final_y2 = max(final_y1 + 1, min(H, int(final_y2)))

    return CropBox(
        px_x1=final_x1,
        px_y1=final_y1,
        px_x2=final_x2,
        px_y2=final_y2,
        norm_x1=final_x1 / W,
        norm_y1=final_y1 / H,
        norm_x2=final_x2 / W,
        norm_y2=final_y2 / H,
    )


def apply_smart_crop(
    image: Image.Image,
    person: PersonBox,
    *,
    top_pad_ratio: float = 0.12,
    bottom_pad_ratio: float = 0.08,
    side_pad_ratio: float = 0.35,
    min_aspect_ratio: float = 0.45,
    target_aspect_ratio: Optional[float] = None,
) -> Tuple[Image.Image, CropBox]:
    """Applies a lossless bounding crop to the image, centered on the detected person."""
    img_oriented = ImageOps.exif_transpose(image)
    w, h = img_oriented.size

    crop_box = calculate_smart_crop_box(
        image_width=w,
        image_height=h,
        person=person,
        top_pad_ratio=top_pad_ratio,
        bottom_pad_ratio=bottom_pad_ratio,
        side_pad_ratio=side_pad_ratio,
        min_aspect_ratio=min_aspect_ratio,
        target_aspect_ratio=target_aspect_ratio,
    )

    cropped_img = img_oriented.crop((crop_box.px_x1, crop_box.px_y1, crop_box.px_x2, crop_box.px_y2))
    return cropped_img, crop_box
