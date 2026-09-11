from celery import Celery

from app.core.config import settings

celery_app = Celery("fitme", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    beat_schedule={
        "cleanup-expired-scan-photos-hourly": {
            "task": "app.workers.tryon_worker.cleanup_expired_scan_photos",
            "schedule": 3600,
        }
    },
)

