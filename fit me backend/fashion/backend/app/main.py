import logging
import bcrypt
if not hasattr(bcrypt, "__about__"):
    class About:
        __version__ = getattr(bcrypt, "__version__", "4.0.0")
    bcrypt.__about__ = About()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)

from app.api import ava, auth, brand, garment, health, link_comparison, product, product_intelligence, saved_photos, scan, size, tryon, user, webhooks, widget
from app.core.config import settings
from app.core.database import init_models
from app.core.firebase import init_firebase

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title=settings.app_name, version="0.1.0")
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(status_code=429, content={"error": "RATE_LIMITED", "message": "Too many requests. Please slow down.", "message_hi": "बहुत अधिक अनुरोध। कृपया धीरे चलें।"})


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    import traceback
    traceback.print_exc()
    error_msg = str(exc) if (exc and str(exc)) else "Something went wrong."
    logger.error(f"Unhandled Exception on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"error": "SERVER_ERROR", "message": error_msg, "message_hi": "कुछ गलत हो गया।"})


@app.on_event("startup")
async def startup() -> None:
    init_firebase()
    try:
        await init_models()
    except Exception as e:
        print(f"Warning: Database initialization skipped due to connection issue ({e}). Server continuing.")


@app.on_event("shutdown")
async def shutdown() -> None:
    from app.services.tryon.factory import _providers
    for p in _providers.values():
        if hasattr(p, "close"):
            try:
                p.close()
            except Exception:
                pass


for router in (ava.router, auth.router, user.router, saved_photos.router, scan.router, tryon.router, size.router, garment.router, brand.router, product.router, product_intelligence.router, link_comparison.router, widget.router, webhooks.router, health.router):
    app.include_router(router)



