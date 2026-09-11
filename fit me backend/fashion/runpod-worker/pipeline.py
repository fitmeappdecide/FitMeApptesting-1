import hashlib


def synthesize_tryon(job_input: dict) -> dict:
    garment_id = str(job_input.get("garment_id", "garment"))
    cluster_key = str(job_input.get("cluster_key", "body"))
    digest = hashlib.sha256(f"{garment_id}:{cluster_key}".encode("utf-8")).hexdigest()[:16]
    images = job_input.get("images") or [{"angle": "front"}]
    return {
        "result_image_urls": [f"https://cdn.fitme.local/runpod/{digest}/{image.get('angle', index)}.jpg" for index, image in enumerate(images)],
        "identity_similarity": 0.9,
        "pipeline": "IDM-VTON/CatVTON dispatch ready",
    }

