import asyncio, httpx, os, tempfile
from google import genai
from google.genai.types import Image, ProductImage, RecontextImageSource, RecontextImageConfig
from app.core.config import settings

async def main():
    client = genai.Client(enterprise=True, project=settings.vertex_project_id, location=settings.vertex_location)
    model_name = "virtual-try-on-001"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as http_client:
        user_resp = await http_client.get("https://picsum.photos/400/600")
        garment_resp = await http_client.get("https://picsum.photos/400/600")
        user_bytes = user_resp.content
        garment_bytes = garment_resp.content
    # write temporary files
    fd1, path1 = tempfile.mkstemp(suffix=".jpg")
    with os.fdopen(fd1, "wb") as f:
        f.write(user_bytes)
    fd2, path2 = tempfile.mkstemp(suffix=".png")
    with os.fdopen(fd2, "wb") as f:
        f.write(garment_bytes)
    # create genai Image objects
    person_image = Image.from_file(location=path1)
    garment_image = Image.from_file(location=path2)
    source = RecontextImageSource(
        person_image=person_image,
        product_images=[ProductImage(product_image=garment_image)],
    )
    config = RecontextImageConfig(output_mime_type="image/png", number_of_images=1)
    response = client.models.recontext_image(
        model=model_name,
        source=source,
        config=config,
    )
    print("--- RESPONSE OBJECT ---")
    print(response)
    print("--- TYPE ---")
    print(type(response))
    print("--- DIR ---")
    print(dir(response))
    print("--- MODEL DUMP (if available) ---")
    try:
        print(response.model_dump())
    except Exception as e:
        print("model_dump error:", e)
    # cleanup temporary files
    os.remove(path1)
    os.remove(path2)

if __name__ == "__main__":
    asyncio.run(main())
