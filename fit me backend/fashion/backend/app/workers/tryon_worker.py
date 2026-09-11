from datetime import UTC, datetime

from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.tryon_worker.cleanup_expired_scan_photos")
def cleanup_expired_scan_photos() -> dict:
    return {"status": "completed", "checked_at": datetime.now(UTC).isoformat(), "deleted": 0}


@celery_app.task(name="app.workers.tryon_worker.process_tryon_job")
def process_tryon_job(job_id: str) -> dict:
    return {"status": "completed", "job_id": job_id}

