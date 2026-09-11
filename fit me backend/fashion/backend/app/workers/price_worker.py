from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.price_worker.compare_price_job")
def compare_price_job(product_id: str) -> dict:
    return {"status": "completed", "product_id": product_id, "comparisons": []}

