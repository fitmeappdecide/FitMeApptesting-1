import os
import io
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple
from PIL import Image, ImageOps


@dataclass
class PersonBox:
    """Bounding box in normalized coordinates [0.0, 1.0]."""
    xmin: float
    ymin: float
    xmax: float
    ymax: float
    confidence: float

    @property
    def width(self) -> float:
        return max(0.0, self.xmax - self.xmin)

    @property
    def height(self) -> float:
        return max(0.0, self.ymax - self.ymin)

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def center_x(self) -> float:
        return (self.xmin + self.xmax) / 2.0

    @property
    def center_y(self) -> float:
        return (self.ymin + self.ymax) / 2.0


@dataclass
class DetectionResult:
    detected: bool
    person_count: int
    primary_person: Optional[PersonBox]
    all_persons: List[PersonBox]
    inference_time_ms: float
    image_width: int
    image_height: int


class LocalPersonDetector:
    """Singleton wrapper around local YOLO person detector."""
    _instance: Optional["LocalPersonDetector"] = None
    _model = None

    def __new__(cls) -> "LocalPersonDetector":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _get_model(self):
        if self._model is None:
            try:
                from ultralytics import YOLO
                t0 = time.perf_counter()
                curr_dir = os.path.abspath(os.path.dirname(__file__))
                candidates = [
                    os.path.join(curr_dir, "..", "..", "..", "yolov8n.pt"),
                    os.path.join(curr_dir, "..", "..", "yolov8n.pt"),
                    os.path.join(os.getcwd(), "fit me backend", "fashion", "backend", "yolov8n.pt"),
                    os.path.join(os.getcwd(), "yolov8n.pt"),
                ]
                model_target = "yolov8n.pt"
                for cand in candidates:
                    norm_cand = os.path.normpath(cand)
                    if os.path.exists(norm_cand):
                        model_target = norm_cand
                        break
                self._model = YOLO(model_target)
                load_ms = (time.perf_counter() - t0) * 1000.0
                print(f"⏱️ [PERSON DETECTOR] Loaded local YOLOv8n from '{model_target}' in {load_ms:.2f}ms")
            except Exception as e:
                print(f"Notice: YOLO person detector unavailable ({e}), passthrough mode active.")
                self._model = False
        return self._model if self._model is not False else None

    def detect(self, image: Image.Image, min_confidence: float = 0.30) -> DetectionResult:
        """Detect persons in a PIL Image.
        
        Returns DetectionResult with normalized coordinates [0.0, 1.0].
        """
        start = time.perf_counter()
        
        # Ensure image is in RGB mode and EXIF orientation is normalized
        img_rgb = ImageOps.exif_transpose(image)
        if img_rgb.mode != "RGB":
            img_rgb = img_rgb.convert("RGB")
            
        w, h = img_rgb.size
        if w <= 0 or h <= 0:
            return DetectionResult(
                detected=False,
                person_count=0,
                primary_person=None,
                all_persons=[],
                inference_time_ms=0.0,
                image_width=w,
                image_height=h,
            )

        model = self._get_model()
        if model is None:
            return DetectionResult(
                detected=False,
                person_count=0,
                primary_person=None,
                all_persons=[],
                inference_time_ms=0.0,
                image_width=w,
                image_height=h,
            )
        results = model.predict(img_rgb, classes=[0], conf=min_confidence, verbose=False)
        
        persons: List[PersonBox] = []
        if results and len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            for box in boxes:
                # cls 0 is person in COCO dataset
                cls_id = int(box.cls[0].item())
                if cls_id == 0:
                    conf = float(box.conf[0].item())
                    # xyxy coordinates in pixels
                    coords = box.xyxy[0].tolist()
                    px_xmin, px_ymin, px_xmax, px_ymax = coords
                    
                    # Normalize to [0.0, 1.0] and clamp
                    norm_xmin = max(0.0, min(1.0, px_xmin / w))
                    norm_ymin = max(0.0, min(1.0, px_ymin / h))
                    norm_xmax = max(0.0, min(1.0, px_xmax / w))
                    norm_ymax = max(0.0, min(1.0, px_ymax / h))
                    
                    if norm_xmax > norm_xmin and norm_ymax > norm_ymin:
                        persons.append(
                            PersonBox(
                                xmin=norm_xmin,
                                ymin=norm_ymin,
                                xmax=norm_xmax,
                                ymax=norm_ymax,
                                confidence=conf,
                            )
                        )

        inference_ms = (time.perf_counter() - start) * 1000.0
        
        if not persons:
            return DetectionResult(
                detected=False,
                person_count=0,
                primary_person=None,
                all_persons=[],
                inference_time_ms=inference_ms,
                image_width=w,
                image_height=h,
            )

        # Primary person heuristic: largest area, with bias toward image center
        # Score = area * (1.0 - 0.5 * distance_from_horizontal_center)
        def person_score(p: PersonBox) -> float:
            dist_center = abs(p.center_x - 0.5)
            return p.area * (1.0 - 0.5 * dist_center)

        primary = max(persons, key=person_score)
        
        if len(persons) > 1:
            print(f"ℹ️ [PERSON DETECTOR] Multiple persons detected ({len(persons)}). Primary selected area={primary.area:.2%}, conf={primary.confidence:.2f}")

        return DetectionResult(
            detected=True,
            person_count=len(persons),
            primary_person=primary,
            all_persons=persons,
            inference_time_ms=inference_ms,
            image_width=w,
            image_height=h,
        )


detector = LocalPersonDetector()
