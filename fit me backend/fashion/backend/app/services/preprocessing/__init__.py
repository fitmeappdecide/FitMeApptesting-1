"""
FitMe Virtual Try-On Input Preprocessing Package.

Provides local person detection and intelligent smart cropping for Virtual Try-On.
Ensures that background-heavy / small-person photos are reframed around the actual person
while 100% preserving already-well-framed user photos.
"""
from app.services.preprocessing.person_detector import (
    LocalPersonDetector,
    PersonBox,
    DetectionResult,
    detector,
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
from app.services.preprocessing.garment_preprocessor import (
    GarmentPreprocessor,
    garment_preprocessor,
)

__all__ = [
    "LocalPersonDetector",
    "PersonBox",
    "DetectionResult",
    "detector",
    "CropBox",
    "calculate_smart_crop_box",
    "apply_smart_crop",
    "PreprocessReport",
    "preprocess_user_image",
    "DEFAULT_OCCUPANCY_THRESHOLD",
    "GarmentPreprocessor",
    "garment_preprocessor",
]
