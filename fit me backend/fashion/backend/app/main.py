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

from app.core.limiter import limiter

docs_url = None if settings.is_production else "/docs"
redoc_url = None if settings.is_production else "/redoc"
openapi_url = None if settings.is_production else "/openapi.json"

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url=docs_url,
    redoc_url=redoc_url,
    openapi_url=openapi_url,
)
app.state.limiter = limiter

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

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
    logger.error(f"Unhandled Exception on {request.method} {request.url.path}: {exc}")
    error_msg = "An internal server error occurred. Please try again later." if settings.is_production else (str(exc) if (exc and str(exc)) else "Something went wrong.")
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



