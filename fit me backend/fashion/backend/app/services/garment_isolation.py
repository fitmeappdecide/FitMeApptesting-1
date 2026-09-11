import io
from abc import ABC, abstractmethod
from PIL import Image

class GarmentIsolator(ABC):
    @abstractmethod
    def isolate(self, image_bytes: bytes, bbox: list[int]) -> bytes:
        """
        Isolate the garment from the image.
        :param image_bytes: The original image bytes.
        :param bbox: A list [ymin, xmin, ymax, xmax] representing the normalized bounding box (0-1000).
        :return: The isolated image bytes.
        """
        pass

class PillowCropIsolator(GarmentIsolator):
    def isolate(self, image_bytes: bytes, bbox: list[int]) -> bytes:
        if not bbox or len(bbox) != 4:
            return image_bytes

        ymin, xmin, ymax, xmax = bbox
        
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                width, height = img.size
                
                # Convert normalized coordinates (0-1000) to actual pixel coordinates
                left = int((xmin / 1000.0) * width)
                upper = int((ymin / 1000.0) * height)
                right = int((xmax / 1000.0) * width)
                lower = int((ymax / 1000.0) * height)
                
                # Ensure coordinates are within bounds
                left = max(0, min(left, width - 1))
                upper = max(0, min(upper, height - 1))
                right = max(0, min(right, width))
                lower = max(0, min(lower, height))
                
                if right <= left or lower <= upper:
                    return image_bytes
                    
                cropped_img = img.crop((left, upper, right, lower))
                
                out_io = io.BytesIO()
                # Determine format based on image
                fmt = img.format if img.format else "JPEG"
                if fmt not in ["JPEG", "PNG", "WEBP"]:
                    fmt = "JPEG"
                cropped_img.save(out_io, format=fmt)
                return out_io.getvalue()
        except Exception as e:
            print(f"Error during image crop isolation: {e}")
            return image_bytes

# Provide a default instance
default_isolator = PillowCropIsolator()
