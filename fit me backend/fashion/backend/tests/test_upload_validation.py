import pytest
import io
from fastapi import UploadFile
from app.utils.validators import validate_image_upload, is_valid_image_bytes

@pytest.mark.asyncio
async def test_validate_image_formats():
    # 1. Valid JPEG
    jpeg_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    file = UploadFile(filename="photo.jpg", file=io.BytesIO(jpeg_bytes))
    res = await validate_image_upload(file)
    assert res == jpeg_bytes

    # 2. Valid PNG
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    file = UploadFile(filename="photo.png", file=io.BytesIO(png_bytes))
    res = await validate_image_upload(file)
    assert res == png_bytes

    # 3. Valid WebP (RIFF....WEBP)
    webp_bytes = b"RIFF\x20\x00\x00\x00WEBP" + b"\x00" * 50
    file = UploadFile(filename="photo.webp", file=io.BytesIO(webp_bytes))
    res = await validate_image_upload(file)
    assert res == webp_bytes

    # 4. Valid HEIC (ftypheic)
    heic_bytes = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 50
    file = UploadFile(filename="photo.heic", file=io.BytesIO(heic_bytes))
    res = await validate_image_upload(file)
    assert res == heic_bytes

    # 5. Invalid format (HTML / text / executable)
    bad_bytes = b"<html><body>Not an image</body></html>"
    file = UploadFile(filename="test.html", file=io.BytesIO(bad_bytes))
    with pytest.raises(ValueError, match="Only JPEG, PNG, WebP, and HEIC"):
        await validate_image_upload(file)

    # 6. File exceeding 10MB limit
    oversized_bytes = b"\xff\xd8\xff" + b"\x00" * (11 * 1024 * 1024)
    file = UploadFile(filename="huge.jpg", file=io.BytesIO(oversized_bytes))
    with pytest.raises(ValueError, match="10MB limit"):
        await validate_image_upload(file)
