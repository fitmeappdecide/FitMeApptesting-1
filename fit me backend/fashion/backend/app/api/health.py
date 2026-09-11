from fastapi import APIRouter
from sqlalchemy import text

from app.core.cache import redis_client
from app.core.database import engine
from app.core.model_manager import model_manager

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    db_connected = True
    redis_connected = True
    try:
        async with engine.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception:
        db_connected = False
    try:
        await redis_client.ping()
    except Exception:
        redis_connected = False
    status = model_manager.status()
    return {
        "status": "ok" if db_connected and redis_connected else "degraded",
        "models_loaded": status.__dict__,
        "gpu_available": status.tryon_synthesis,
        "queue_depth": 0,
        "db_connected": db_connected,
        "redis_connected": redis_connected,
        "scraper_connected": True,
    }
