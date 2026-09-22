import os
import uuid
import time
import tempfile
import asyncio
from typing import Literal, Optional

import httpx
from google import genai
from google.genai.types import Image, ProductImage, RecontextImageConfig, RecontextImageSource

from app.core.config import settings
from app.services.storage_service import (
    build_encrypted_storage_ref,
    cdn_url_for_private_ref,
    create_signed_photo_url,
    create_thumbnail,
    download_image_from_storage,
    download_user_photo,
    optimize_tryon_result,
    retrieve_image_bytes_from_encrypted_ref,
    sign_if_private,
    upload_image_to_storage,
)
from app.services.tryon.provider import TryOnProvider, TryOnResult
from app.services.preprocessing import preprocess_user_image, garment_preprocessor


from app.utils.telemetry import TelemetryTimer

class VertexProvider(TryOnProvider):
    """Vertex AI Virtual Try‑On provider."""

    def __init__(self) -> None:
        self.model_name = "virtual-try-on-001"
        t0 = time.time()
        
        # Set absolute path for Google credentials
        backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        gcp_key = os.path.join(backend_dir, "gcp-vertex-key.json")
        creds_path = os.path.join(backend_dir, "firebase", "fitme-3ac94-firebase-adminsdk-fbsvc-5ec19c616f.json")

        # Check if GCP key is provided via environment variable (e.g. on Railway)
        gcp_key_env = os.environ.get("GCP_VERTEX_KEY_JSON") or os.environ.get("GCP_VERTEX_KEY_B64") or os.environ.get("GOOGLE_CREDENTIALS_JSON")
        if gcp_key_env and not os.path.exists(gcp_key):
            try:
                raw_val = gcp_key_env.strip()
                if not raw_val.startswith("{"):
                    import base64
                    try:
                        decoded = base64.b64decode(raw_val).decode("utf-8")
                        if decoded.strip().startswith("{"):
                            raw_val = decoded.strip()
                    except Exception:
                        pass
                with open(gcp_key, "w") as f:
                    f.write(raw_val)
                print(f"✓ Written GCP Vertex credentials from environment to {gcp_key}")
            except Exception as e:
                print(f"Warning writing GCP credentials: {e}")

        if os.path.exists(gcp_key):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = gcp_key
        elif os.path.exists(creds_path):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path

        if settings.vertex_project_id:
            try:
                self.client = genai.Client(
                    vertexai=True,
                    project=settings.vertex_project_id,
                    location=settings.vertex_location,
                )
            except Exception as e:
                print(f"Notice: Vertex AI client init warning: {e}")
                self.client = None
        else:
            self.client = None
        self.init_duration_ms = (time.time() - t0) * 1000.0
        print(f"⏱️ [CLIENT TELEMETRY] Persistent VertexProvider singleton created in {self.init_duration_ms:.2f}ms")

    def close(self) -> None:
        if self.client and hasattr(self.client, "close"):
            try:
                self.client.close()
            except Exception:
                pass

    async def _resolve_user_image(self, client: httpx.AsyncClient, user_image_url: str) -> tuple[bytes, Optional[str]]:
        try:
            if not user_image_url or not isinstance(user_image_url, str):
                return b"", "User image URL is empty"
            if os.path.exists(user_image_url):
                with open(user_image_url, "rb") as f:
                    return f.read(), None
            if user_image_url.startswith("http://") or user_image_url.startswith("https://"):
                resp = await client.get(user_image_url)
                resp.raise_for_status()
                return resp.content, None
            if user_image_url.startswith("data:"):
                import base64
                header, data = user_image_url.split(",", 1)
                return base64.b64decode(data), None
            if user_image_url.startswith("scans/") or user_image_url.startswith("user-photos/") or user_image_url.startswith("user_photos/"):
                data = await asyncio.to_thread(download_user_photo, user_image_url)
                return data, None
            data = await asyncio.to_thread(retrieve_image_bytes_from_encrypted_ref, user_image_url)
            return data, None
        except Exception as e:
            print(f"Notice: User image retrieval error ({e})")
            return b"", str(e)

    async def _resolve_garment_image(self, client: httpx.AsyncClient, garment_image_url: str) -> tuple[bytes, Optional[str]]:
        try:
            if not garment_image_url or not isinstance(garment_image_url, str):
                return b"", "Garment image URL is empty"
            if os.path.exists(garment_image_url):
                with open(garment_image_url, "rb") as f:
                    return f.read(), None
            if (
                garment_image_url.startswith("garments/")
                or garment_image_url.startswith("scans/")
                or garment_image_url.startswith("user_photos/")
                or garment_image_url.startswith("tryon_results/")
            ):
                data = await asyncio.to_thread(download_image_from_storage, garment_image_url)
                return data, None
            if (
                settings.supabase_url
                and settings.supabase_url in garment_image_url
                and ("/storage/v1/object/" in garment_image_url or f"/{settings.supabase_storage_bucket}/" in garment_image_url)
            ):
                bucket_name = settings.supabase_storage_bucket
                clean_path = garment_image_url.split("?")[0]
                for prefix in (f"/storage/v1/object/public/{bucket_name}/", f"/storage/v1/object/sign/{bucket_name}/", f"/{bucket_name}/"):
                    if prefix in clean_path:
                        clean_path = clean_path.split(prefix, 1)[1]
                        break
                try:
                    data = await asyncio.to_thread(download_image_from_storage, clean_path)
                    return data, None
                except Exception:
                    signed = sign_if_private(garment_image_url)
                    target_url = signed if (signed and signed != garment_image_url) else garment_image_url
                    resp = await client.get(target_url)
                    resp.raise_for_status()
                    return resp.content, None
            if garment_image_url.startswith("http://") or garment_image_url.startswith("https://"):
                try:
                    resp = await client.get(garment_image_url)
                    resp.raise_for_status()
                    return resp.content, None
                except Exception as http_err:
                    signed = sign_if_private(garment_image_url)
                    if signed and signed != garment_image_url:
                        resp = await client.get(signed)
                        resp.raise_for_status()
                        return resp.content, None
                    elif settings.supabase_storage_bucket and f"/{settings.supabase_storage_bucket}/" in garment_image_url:
                        clean_path = garment_image_url.split(f"/{settings.supabase_storage_bucket}/", 1)[1].split("?")[0]
                        data = await asyncio.to_thread(download_image_from_storage, clean_path)
                        return data, None
                    else:
                        raise http_err
            if garment_image_url.startswith("data:"):
                import base64
                header, data = garment_image_url.split(",", 1)
                return base64.b64decode(data), None
            if garment_image_url.startswith("/"):
                full_url = f"{settings.supabase_url}{garment_image_url}" if settings.supabase_url else ""
                if full_url:
                    resp = await client.get(full_url)
                    resp.raise_for_status()
                    return resp.content, None
            data = await asyncio.to_thread(retrieve_image_bytes_from_encrypted_ref, garment_image_url)
            return data, None
        except Exception as e:
            print(f"Notice: Garment image retrieval error ({e})")
            return b"", str(e)

    def _image_from_bytes(self, img_bytes: bytes, suffix: str = ".png") -> tuple[Image, str]:
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            from PIL import Image as PILImage
            import io
            im = PILImage.open(io.BytesIO(img_bytes))
            if im.mode in ("RGBA", "P") and suffix.endswith(".jpg"):
                im = im.convert("RGB")
            max_dim = 1440
            if max(im.size) > max_dim:
                im.thumbnail((max_dim, max_dim), PILImage.Resampling.LANCZOS)
            im.save(path, quality=95, optimize=True)
        except Exception:
            with os.fdopen(fd, "wb") as f:
                f.write(img_bytes)
        else:
            try:
                os.close(fd)
            except Exception:
                pass
        return Image.from_file(location=path), path

    async def generate_tryon(
        self,
        user_image_url: str,
        garment_image_url: str,
        *,
        garment_type: Literal["top", "bottom", "dress", "saree", "full_body", "shoes"] | None = None,
    ) -> TryOnResult:
        with TelemetryTimer("VertexProvider.generate_tryon()") as timer:
            start = time.time()

            # Fast reject for unsupported footwear category
            if garment_type == "shoes":
                raise RuntimeError("Footwear try-on (shoes, slippers, heels, boots) is currently unsupported by Google Vertex AI virtual-try-on-001 model.")

            # Ensure client is initialized
            if self.client is None:
                self.__init__()

            # 1️⃣ & 2️⃣ Concurrently resolve user image and garment image in parallel
            user_bytes = b""
            garment_bytes = b""
            user_error = None
            garment_error = None

            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            }
            async with httpx.AsyncClient(headers=headers, timeout=30.0, follow_redirects=True) as client:
                (user_bytes, user_error), (garment_bytes, garment_error) = await asyncio.gather(
                    self._resolve_user_image(client, user_image_url),
                    self._resolve_garment_image(client, garment_image_url),
                )
            timer.mark("1 & 2. User and Garment Images Downloaded Concurrently")

            if not user_bytes:
                raise RuntimeError(f"User image could not be loaded: {user_error or 'image data is empty'}")
            if not garment_bytes:
                raise RuntimeError(f"Garment image could not be loaded: {garment_error or 'garment data is empty'}")
            if self.client is None:
                raise RuntimeError("Google Vertex AI client is not available. Please verify GCP_VERTEX_KEY_JSON.")
            if garment_type == "shoes":
                raise RuntimeError("Footwear try-on (shoes, slippers, heels, boots) is currently unsupported by Google Vertex AI virtual-try-on-001 model.")

            person_path = None
            garment_path = None
            try:
                # Preprocess user image & garment reference concurrently
                user_task = asyncio.to_thread(preprocess_user_image, user_bytes)
                garment_task = garment_preprocessor.preprocess(
                    garment_bytes,
                    garment_type=garment_type,
                    garment_url=garment_image_url,
                )
                (prepared_user_bytes, prep_report), (prepared_garment_bytes, garment_report) = await asyncio.gather(
                    user_task, garment_task
                )

                person_image, person_path = self._image_from_bytes(prepared_user_bytes, suffix=".png")
                garment_image, garment_path = self._image_from_bytes(prepared_garment_bytes, suffix=".png")
                timer.mark("3. Temp Files Created on Disk")

                source = RecontextImageSource(
                    person_image=person_image,
                    product_images=[ProductImage(product_image=garment_image)],
                )
                config = RecontextImageConfig(
                    output_mime_type="image/png",
                    number_of_images=1,
                    person_generation="ALLOW_ALL",
                    safety_filter_level="BLOCK_ONLY_HIGH",
                )

                # 4️⃣ Call Vertex AI
                v_start = time.time()
                print(f"⏱️ [VERTEX AI START] Model: {self.model_name}")
                response = self.client.models.recontext_image(
                    model=self.model_name,
                    source=source,
                    config=config,
                )
                v_duration = time.time() - v_start
                print(f"⏱️ [VERTEX AI SUCCESS] Model Inference Duration: {v_duration:.4f}s")
                timer.mark(f"4. Vertex AI Model Inference Complete ({v_duration:.2f}s)")

                generated_bytes = response.generated_images[0].image.image_bytes
                public_url = ""
                try:
                    # Optimize to canonical WebP (max 1200px, quality 88) and grid thumbnail (400px width, quality 80)
                    canonical_bytes, canonical_mime = optimize_tryon_result(generated_bytes, max_dim=1200, quality=88)
                    thumb_bytes, thumb_mime = create_thumbnail(generated_bytes, target_width=400, quality=80)

                    ext = "webp" if "webp" in canonical_mime else "jpg"
                    thumb_ext = "webp" if "webp" in thumb_mime else "jpg"
                    res_uuid = uuid.uuid4()

                    storage_path = f"tryon_results/{res_uuid}.{ext}"
                    thumb_storage_path = f"tryon_results/thumb_{res_uuid}.{thumb_ext}"

                    # Parallelize canonical WebP and thumbnail uploads to Supabase Storage
                    await asyncio.gather(
                        asyncio.to_thread(upload_image_to_storage, canonical_bytes, storage_path),
                        asyncio.to_thread(upload_image_to_storage, thumb_bytes, thumb_storage_path),
                    )

                    # Return canonical relative storage path so tryon_jobs DB record permanently stores stable reference
                    public_url = storage_path
                except Exception as s_err:
                    print(f"Supabase storage upload notice ({s_err}), using instant high-res Data URI")
                    import base64
                    b64_str = base64.b64encode(generated_bytes).decode("utf-8")
                    public_url = f"data:image/png;base64,{b64_str}"

                return TryOnResult(
                    image_urls=[public_url],
                    provider_name="vertex_ai",
                    processing_time_seconds=time.time() - start,
                )

            except Exception as e:
                print(f"Vertex AI inference error: {e}")
                raise RuntimeError(f"Vertex AI Try-On failed: {e}") from e
            finally:
                for p in (person_path, garment_path):
                    if p and os.path.exists(p):
                        try:
                            os.remove(p)
                        except Exception:
                            pass

