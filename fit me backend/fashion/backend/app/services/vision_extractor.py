import hashlib
import json
import uuid
from abc import ABC, abstractmethod
from typing import Dict, Any

from google import genai
from google.genai import types

from app.core.config import settings
from app.services.garment_isolation import default_isolator, GarmentIsolator
from app.services.storage_service import build_encrypted_storage_ref, upload_image_to_storage, cdn_url_for_private_ref


class VisionExtractor(ABC):
    @abstractmethod
    def extract_product(self, image_bytes: bytes) -> Dict[str, Any]:
        pass


class MockVisionExtractor(VisionExtractor):
    def extract_product(self, image_bytes: bytes) -> Dict[str, Any]:
        seed = hashlib.sha256(image_bytes or b"").hexdigest()[:12]
        return {
            "title": "Image extracted fashion product",
            "brand": "Detected Brand",
            "price": None,
            "images": [{"url": f"https://cdn.fitme.local/vision/{seed}.jpg", "angle": "front"}],
            "sizes": [],
            "garment_type": "unknown",
            "source": "vision",
        }


class GeminiVisionExtractor(VisionExtractor):
    def __init__(self, isolator: GarmentIsolator = default_isolator):
        self.isolator = isolator
        self.client = genai.Client(
            project=settings.vertex_project_id,
            location=settings.vertex_location,
            enterprise=True
        )

    def extract_product(self, image_bytes: bytes) -> Dict[str, Any]:
        model = "gemini-1.5-flash"
        
        prompt = (
            "Analyze this screenshot of a clothing product. Extract the primary garment details. "
            "Ignore browser UI, buttons, ratings, and surrounding webpage content. "
            "Return the following information strictly as a JSON object:\n"
            "{\n"
            '  "title": "The name of the product",\n'
            '  "brand": "The brand of the product (or null if not found)",\n'
            '  "price": "The price of the product as a string (or null)",\n'
            '  "garment_type": "The type of garment (e.g., dress, top, bottom, outer)",\n'
            '  "bounding_box": [ymin, xmin, ymax, xmax] // A list of 4 integers representing the normalized bounding box (0-1000) of the primary garment isolated from distractions.\n'
            "}"
        )
        
        try:
            image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            
            response = self.client.models.generate_content(
                model=model,
                contents=[prompt, image_part],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            
            text = response.text
            # Sometimes models return ```json ... ```
            if text.startswith("```json"):
                text = text[7:-3]
            elif text.startswith("```"):
                text = text[3:-3]
                
            result = json.loads(text.strip())
        except Exception as e:
            print(f"Gemini Vision Extraction Error: {e}")
            return MockVisionExtractor().extract_product(image_bytes)

        bbox = result.get("bounding_box", [])
        isolated_bytes = self.isolator.isolate(image_bytes, bbox)
        
        filename = f"extracted-{uuid.uuid4().hex[:8]}.jpg"
        storage_path = build_encrypted_storage_ref("garments", filename)
        upload_image_to_storage(isolated_bytes, storage_path)
        public_url = cdn_url_for_private_ref(storage_path)

        return {
            "title": result.get("title", "Image extracted fashion product"),
            "brand": result.get("brand"),
            "price": result.get("price"),
            "images": [{"url": public_url, "angle": "front"}],
            "sizes": [],
            "garment_type": result.get("garment_type", "unknown"),
            "source": "vision",
        }


def extract_product_from_image(image_bytes: bytes | None = None, image_url: str | None = None) -> dict:
    if image_bytes is None:
        return MockVisionExtractor().extract_product(b"")
    
    # Provide pluggable extractor selection
    extractor = GeminiVisionExtractor()
    return extractor.extract_product(image_bytes)
