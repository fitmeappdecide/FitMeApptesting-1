from PIL import Image
from io import BytesIO


def image_dimensions(data: bytes) -> tuple[int, int]:
    with Image.open(BytesIO(data)) as image:
        return image.size


def dominant_hex_from_image(data: bytes) -> str:
    with Image.open(BytesIO(data)) as image:
        rgb = image.convert("RGB").resize((1, 1))
        r, g, b = rgb.getpixel((0, 0))
    return f"#{r:02X}{g:02X}{b:02X}"

