import io
import os
import time
import hashlib
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter
try:
    import torch
    from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation
    HAS_TORCH = True
except ImportError:
    torch = None
    AutoImageProcessor = None
    AutoModelForSemanticSegmentation = None
    HAS_TORCH = False

# Configurable concurrency limit (Default: 2 per worker for safe memory bounding)
MAX_CONCURRENT_WORKERS = int(os.getenv("SEGFORMER_MAX_CONCURRENT", "2"))

# Semantic label mapping for mattmdjaga/segformer_b2_clothes:
# 0: Background, 1: Hat, 2: Hair, 3: Sunglasses, 4: Upper-clothes, 5: Skirt,
# 6: Pants, 7: Dress, 8: Belt, 9: Left-shoe, 10: Right-shoe, 11: Face,
# 12: Left-leg, 13: Right-leg, 14: Left-arm, 15: Right-arm, 16: Bag, 17: Scarf
CATEGORY_LABEL_MAP: dict[str, list[int]] = {
    # 1. Standard Western Upper Garments (Strictly excludes Label 7 / Pants)
    "top": [4, 17],
    "shirt": [4, 17],
    "tshirt": [4, 17],
    "t-shirt": [4, 17],
    "jacket": [4, 17],
    "hoodie": [4, 17],
    "sweater": [4, 17],
    "blazer": [4, 17],
    "coat": [4, 17],

    # 2. Ethnic Kurtas / Tunics (Accepts [4, 7, 17] - Upper-clothes, Dress, Scarf; strictly excludes Pants [6] & Limbs)
    "kurta": [4, 7, 17],
    "tunic": [4, 7, 17],
    "ethnic_top": [4, 7, 17],

    # 3. Dresses / Gowns / Full Body (Dress, Upper-clothes)
    "dress": [7, 4],
    "gown": [7, 4],
    "jumpsuit": [7, 4],
    "full_body": [7, 4, 6],

    # 4. Bottoms (Jeans, Pants, Trousers, Shorts, Skirts - strictly excludes Upper-clothes [4] & Dress [7])
    "bottom": [6, 5],
    "pants": [6, 5],
    "jeans": [6, 5],
    "trouser": [6, 5],
    "trousers": [6, 5],
    "shorts": [6, 5],
    "skirt": [6, 5],

    # 5. Ethnic Sets (Saree, Lehenga)
    "saree": [4, 5, 7, 17],
    "lehenga": [4, 5, 7, 17],

    # 6. Footwear / Shoes / Slippers / Heels / Mules / Sandals / Boots (Strictly Left-shoe [9] & Right-shoe [10])
    "shoes": [9, 10],
    "shoe": [9, 10],
    "slipper": [9, 10],
    "slippers": [9, 10],
    "heel": [9, 10],
    "heels": [9, 10],
    "mule": [9, 10],
    "mules": [9, 10],
    "sandal": [9, 10],
    "sandals": [9, 10],
    "flats": [9, 10],
    "flat": [9, 10],
    "sneaker": [9, 10],
    "sneakers": [9, 10],
    "boot": [9, 10],
    "boots": [9, 10],
    "footwear": [9, 10],
    "footwear_set": [9, 10],
    "apparel": [4, 5, 6, 7, 17],
}

SKIN_AND_LIMB_LABELS = [11, 12, 13, 14, 15]  # Face, Legs, Arms


class GarmentPreprocessor:
    """Production-grade garment reference preprocessor using SegFormer.
    
    Isolates the target apparel item from on-model catalog photos into a clean
    Ghost-Mannequin canvas on pure white (#FFFFFF), eliminating catalog-model
    body, skin, arms, pose, and background leakage during Virtual Try-On.
    
    Guarantees:
    - Zero persistent storage (all outputs are ephemeral in-memory JPEG bytes).
    - In-flight deduplication (concurrent requests for the same garment share 1 inference).
    - Bounded CPU concurrency (caps PyTorch tensor memory under peak load).
    - Deterministic fail-safe fallback (errors safely return original raw bytes).
    - Non-blocking async execution (CPU inference runs in a bounded ThreadPoolExecutor).
    """

    def __init__(self, max_concurrent: int = MAX_CONCURRENT_WORKERS):
        self.model_name = "mattmdjaga/segformer_b2_clothes"
        self._processor: Optional[AutoImageProcessor] = None
        self._model: Optional[AutoModelForSemanticSegmentation] = None
        self._model_loaded = False
        self._load_lock = asyncio.Lock()
        
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.executor = ThreadPoolExecutor(
            max_workers=max_concurrent,
            thread_name_prefix="segformer_worker",
        )
        
        # In-flight deduplication: map cache_key -> asyncio.Future
        self.in_flight_tasks: dict[str, asyncio.Future] = {}
        self.in_flight_lock = asyncio.Lock()

    def _ensure_model_loaded_sync(self):
        if not HAS_TORCH:
            return
        if not self._model_loaded:
            t0 = time.time()
            self._processor = AutoImageProcessor.from_pretrained(self.model_name)
            self._model = AutoModelForSemanticSegmentation.from_pretrained(self.model_name)
            self._model.eval()
            self._model_loaded = True
            dur = (time.time() - t0) * 1000.0
            print(f"✅ [SEGFORMER PREPROCESSOR] Model loaded in {dur:.1f}ms on CPU (max_concurrent={self.max_concurrent})")

    async def ensure_model_loaded(self):
        if not self._model_loaded:
            async with self._load_lock:
                if not self._model_loaded:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(self.executor, self._ensure_model_loaded_sync)

    def _compute_dedup_key(self, image_url: str, image_bytes: bytes, garment_type: Optional[str]) -> str:
        if image_url:
            clean_ref = image_url.split("?")[0].strip()
            raw_hash = hashlib.sha256(clean_ref.encode()).hexdigest()
        else:
            raw_hash = hashlib.sha256(image_bytes[:4096]).hexdigest()
        g_type = garment_type or "top"
        return f"{raw_hash}_{g_type}_v1_segformer_b2"

    async def preprocess(
        self,
        image_bytes: bytes,
        *,
        garment_type: Optional[str] = None,
        garment_url: str = "",
    ) -> Tuple[bytes, dict]:
        """Preprocesses garment reference image bytes.
        
        Args:
            image_bytes: Raw binary bytes of the catalog garment image.
            garment_type: Detected category ('top', 'bottom', 'dress', 'saree', etc.).
            garment_url: Original product image URL for in-flight deduplication.
            
        Returns:
            Tuple of (prepared_image_bytes, diagnostic_report_dict).
        """
        t0 = time.time()
        if not image_bytes or len(image_bytes) < 100:
            return image_bytes, {
                "status": "FALLBACK_EMPTY_INPUT",
                "is_fallback": True,
                "duration_ms": 0.0,
            }

        if not HAS_TORCH:
            return image_bytes, {
                "status": "PASSTHROUGH_NO_TORCH",
                "is_fallback": True,
                "duration_ms": 0.0,
            }

        # 1. Unknown / undefined categories bypass SegFormer gracefully
        norm_type = (garment_type or "top").lower()
        if norm_type in ("unknown",):
            return image_bytes, {
                "status": "PASSTHROUGH_NON_APPAREL",
                "is_fallback": False,
                "garment_type": norm_type,
                "duration_ms": (time.time() - t0) * 1000.0,
            }

        target_labels = CATEGORY_LABEL_MAP.get(norm_type, CATEGORY_LABEL_MAP["top"])
        dedup_key = self._compute_dedup_key(garment_url, image_bytes, norm_type)

        # 2. In-Flight Deduplication Check
        is_initiator = False
        async with self.in_flight_lock:
            if dedup_key in self.in_flight_tasks:
                future = self.in_flight_tasks[dedup_key]
            else:
                loop = asyncio.get_running_loop()
                future = loop.create_future()
                self.in_flight_tasks[dedup_key] = future
                is_initiator = True

        if is_initiator:
            # First caller processes the garment in the thread pool
            asyncio.create_task(
                self._execute_and_resolve(dedup_key, future, image_bytes, target_labels, norm_type)
            )

        # Await the shared future (whether initiator or joining consumer)
        try:
            result_bytes, report = await future
            report["total_latency_ms"] = (time.time() - t0) * 1000.0
            return result_bytes, report
        except Exception as e:
            # Failsafe fallback if future throws unexpected error
            return image_bytes, {
                "status": f"ERROR_FALLBACK ({e})",
                "is_fallback": True,
                "duration_ms": (time.time() - t0) * 1000.0,
            }

    async def _execute_and_resolve(
        self,
        dedup_key: str,
        future: asyncio.Future,
        image_bytes: bytes,
        target_labels: list[int],
        norm_type: str,
    ):
        try:
            await self.ensure_model_loaded()
            async with self.semaphore:
                loop = asyncio.get_running_loop()
                res_bytes, is_fallback, coverage, inf_ms = await loop.run_in_executor(
                    self.executor, self._segment_sync, image_bytes, target_labels
                )

            report = {
                "status": "FALLBACK" if is_fallback else "SEGMENTED",
                "is_fallback": is_fallback,
                "coverage_pct": round(coverage, 2),
                "inference_ms": round(inf_ms, 2),
                "garment_type": norm_type,
            }
            if not future.done():
                future.set_result((res_bytes, report))
        except Exception as e:
            print(f"⚠️ [GARMENT PREPROCESS] Unexpected error ({e}) -> falling back to original bytes.")
            report = {
                "status": f"EXCEPTION_FALLBACK ({e})",
                "is_fallback": True,
                "coverage_pct": 0.0,
                "inference_ms": 0.0,
                "garment_type": norm_type,
            }
            if not future.done():
                future.set_result((image_bytes, report))
        finally:
            # Unconditional cleanup of the in-flight key
            async with self.in_flight_lock:
                if dedup_key in self.in_flight_tasks:
                    del self.in_flight_tasks[dedup_key]

    def _segment_sync(
        self,
        image_bytes: bytes,
        target_labels: list[int],
    ) -> Tuple[bytes, bool, float, float]:
        """Synchronous CPU inference function executed inside thread pool."""
        t_start = time.time()
        try:
            raw_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            w, h = raw_img.size

            # Ensure model is ready
            self._ensure_model_loaded_sync()
            assert self._processor is not None and self._model is not None

            # 1. Run SegFormer forward pass under inference_mode
            inputs = self._processor(images=raw_img, return_tensors="pt")
            with torch.inference_mode():
                outputs = self._model(**inputs)
                logits = outputs.logits.cpu()

            # 2. Bilinear upsampling to original dimensions
            upsampled = torch.nn.functional.interpolate(
                logits,
                size=(h, w),
                mode="bilinear",
                align_corners=False,
            )
            pred_seg = upsampled.argmax(dim=1)[0].numpy()
            inf_dur = (time.time() - t_start) * 1000.0

            # 3. Create garment mask
            target_mask_arr = np.isin(pred_seg, target_labels).astype(np.uint8) * 255
            coverage_pct = (np.count_nonzero(target_mask_arr) / (w * h)) * 100.0

            # 4. Fail-safe validation: coverage must be within safe bounds
            min_coverage = 1.0 if target_labels == [9, 10] else 4.0
            if coverage_pct < min_coverage or coverage_pct > 92.0:
                print(f"ℹ️ [GARMENT PREPROCESS] Coverage {coverage_pct:.1f}% out of safe bounds [{min_coverage}%, 92%] -> fallback to raw bytes.")
                return image_bytes, True, coverage_pct, inf_dur

            # 5. Morphological boundary protection & skin exclusion
            mask_img = Image.fromarray(target_mask_arr, mode="L")
            smooth_mask = mask_img.filter(ImageFilter.GaussianBlur(radius=1.5))

            # 6. Composite onto studio white (#FFFFFF) Ghost-Mannequin canvas
            white_canvas = Image.new("RGB", (w, h), (255, 255, 255))
            white_canvas.paste(raw_img, (0, 0), mask=smooth_mask)

            # 7. Encode to high-quality JPEG in memory
            buf = io.BytesIO()
            white_canvas.save(buf, format="JPEG", quality=95)
            output_bytes = buf.getvalue()

            # Release intermediate PIL/NumPy buffers
            del raw_img, mask_img, smooth_mask, white_canvas, target_mask_arr, pred_seg, upsampled, logits

            return output_bytes, False, coverage_pct, inf_dur

        except Exception as e:
            print(f"⚠️ [GARMENT PREPROCESS] Segmentation exception ({e}) -> returning original bytes.")
            return image_bytes, True, 0.0, (time.time() - t_start) * 1000.0


# Module singleton instance
garment_preprocessor = GarmentPreprocessor(max_concurrent=MAX_CONCURRENT_WORKERS)
