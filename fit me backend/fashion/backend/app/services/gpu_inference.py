import time

from app.models.garment import Garment


async def run_tryon_inference(garment: Garment, cluster_key: str) -> dict:
    started = time.perf_counter()
    image_urls = []
    source_images = garment.images or [{"url": "https://cdn.fitme.local/sample-product.jpg", "angle": "front"}]
    for index, image in enumerate(source_images):
        angle = image.get("angle", f"angle-{index + 1}")
        image_urls.append(f"https://cdn.fitme.local/tryon/{garment.id}/{cluster_key}/{angle}.jpg")
    return {
        "result_image_urls": image_urls,
        "processing_time_seconds": round(max(0.1, time.perf_counter() - started), 2),
        "runpod_job_id": f"local-{garment.id}",
    }

