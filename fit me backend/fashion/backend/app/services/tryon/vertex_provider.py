import os
import uuid
import time
import tempfile
from typing import Literal

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

            # 1️⃣ Resolve user image
            user_bytes = b""
            garment_bytes = b""
            user_error = None
            garment_error = None

            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            }
            async with httpx.AsyncClient(headers=headers, timeout=30.0, follow_redirects=True) as client:
                try:
                    if not user_image_url or not isinstance(user_image_url, str):
                        user_error = "User image URL is empty"
                    elif os.path.exists(user_image_url):
                        with open(user_image_url, "rb") as f:
                            user_bytes = f.read()
                    elif user_image_url.startswith("http://") or user_image_url.startswith("https://"):
                        resp = await client.get(user_image_url)
                        resp.raise_for_status()
                        user_bytes = resp.content
                    elif user_image_url.startswith("data:"):
                        import base64
                        header, data = user_image_url.split(",", 1)
                        user_bytes = base64.b64decode(data)
                    elif user_image_url.startswith("scans/") or user_image_url.startswith("user-photos/") or user_image_url.startswith("user_photos/"):
                        user_bytes = download_user_photo(user_image_url)
                    else:
                        user_bytes = retrieve_image_bytes_from_encrypted_ref(user_image_url)
                    timer.mark("1. User Image Downloaded")
                except Exception as e:
                    user_error = str(e)
                    print(f"Notice: User image retrieval error ({e})")

                # 2️⃣ Download garment image
                try:
                    if not garment_image_url or not isinstance(garment_image_url, str):
                        garment_error = "Garment image URL is empty"
                    elif os.path.exists(garment_image_url):
                        with open(garment_image_url, "rb") as f:
                            garment_bytes = f.read()
                    elif (
                        garment_image_url.startswith("garments/")
                        or garment_image_url.startswith("scans/")
                        or garment_image_url.startswith("user_photos/")
                        or garment_image_url.startswith("tryon_results/")
                    ):
                        garment_bytes = download_image_from_storage(garment_image_url)
                    elif (
                        settings.supabase_url
                        and settings.supabase_url in garment_image_url
                        and ("/storage/v1/object/" in garment_image_url or f"/{settings.supabase_storage_bucket}/" in garment_image_url)
                    ):
                        # Extract the storage object key directly from the Supabase URL
                        bucket_name = settings.supabase_storage_bucket
                        clean_path = garment_image_url.split("?")[0]
                        for prefix in (f"/storage/v1/object/public/{bucket_name}/", f"/storage/v1/object/sign/{bucket_name}/", f"/{bucket_name}/"):
                            if prefix in clean_path:
                                clean_path = clean_path.split(prefix, 1)[1]
                                break
                        try:
                            garment_bytes = download_image_from_storage(clean_path)
                        except Exception:
                            signed = sign_if_private(garment_image_url)
                            target_url = signed if (signed and signed != garment_image_url) else garment_image_url
                            resp = await client.get(target_url)
                            resp.raise_for_status()
                            garment_bytes = resp.content
                    elif garment_image_url.startswith("http://") or garment_image_url.startswith("https://"):
                        try:
                            resp = await client.get(garment_image_url)
                            resp.raise_for_status()
                            garment_bytes = resp.content
                        except Exception as http_err:
                            # If HTTP GET failed (e.g. 400 Bad Request on a Supabase URL or expired token), try signing or direct storage
                            signed = sign_if_private(garment_image_url)
                            if signed and signed != garment_image_url:
                                resp = await client.get(signed)
                                resp.raise_for_status()
                                garment_bytes = resp.content
                            elif settings.supabase_storage_bucket and f"/{settings.supabase_storage_bucket}/" in garment_image_url:
                                clean_path = garment_image_url.split(f"/{settings.supabase_storage_bucket}/", 1)[1].split("?")[0]
                                garment_bytes = download_image_from_storage(clean_path)
                            else:
                                raise http_err
                    elif garment_image_url.startswith("data:"):
                        import base64
                        header, data = garment_image_url.split(",", 1)
                        garment_bytes = base64.b64decode(data)
                    elif garment_image_url.startswith("/"):
                        full_url = f"{settings.supabase_url}{garment_image_url}" if settings.supabase_url else ""
                        if full_url:
                            resp = await client.get(full_url)
                            resp.raise_for_status()
                            garment_bytes = resp.content
                    else:
                        garment_bytes = retrieve_image_bytes_from_encrypted_ref(garment_image_url)
                    timer.mark("2. Garment Image Downloaded")
                except Exception as e:
                    garment_error = str(e)
                    print(f"Notice: Garment image retrieval error ({e})")

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
                # Preprocess user image (smart framing if person is small)
                prepared_user_bytes, prep_report = preprocess_user_image(user_bytes)

                # Preprocess garment reference (SegFormer Ghost-Mannequin isolation)
                prepared_garment_bytes, garment_report = await garment_preprocessor.preprocess(
                    garment_bytes,
                    garment_type=garment_type,
                    garment_url=garment_image_url,
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

                    upload_image_to_storage(canonical_bytes, storage_path)
                    upload_image_to_storage(thumb_bytes, thumb_storage_path)

                    signed_res_url = create_signed_photo_url(storage_path, expires_in=7200)
                    public_url = signed_res_url if signed_res_url else storage_path
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

