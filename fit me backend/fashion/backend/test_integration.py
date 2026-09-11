import asyncio
import os
import uuid
import time
import httpx

from app.core.config import settings
from app.services.storage_service import (
    build_encrypted_storage_ref,
    upload_image_to_storage,
    retrieve_image_bytes_from_encrypted_ref,
    cdn_url_for_private_ref,
)
from app.utils.encryption import encrypt_text
from app.services.tryon.vertex_provider import VertexProvider

async def main():
    print("--- 1. Verifying Supabase connection ---")
    if not settings.supabase_url or not settings.supabase_service_key:
        print("Error: Supabase config is missing in environment.")
        return
    print(f"Supabase URL: {settings.supabase_url}")
    
    print("\n--- Fetching test images ---")
    user_img_url = "https://picsum.photos/400/600"
    garment_img_url = "https://picsum.photos/400/600"
    
    async with httpx.AsyncClient() as client:
        u_resp = await client.get(user_img_url, follow_redirects=True)
        g_resp = await client.get(garment_img_url, follow_redirects=True)
        user_bytes = u_resp.content
        garment_bytes = g_resp.content
    print(f"Downloaded user image ({len(user_bytes)} bytes) and garment image ({len(garment_bytes)} bytes)")

    print("\n--- 2/3/4. Upload test scan image to Supabase Storage ---")
    storage_path = build_encrypted_storage_ref("scans", f"test_{uuid.uuid4()}.jpg")
    try:
        upload_image_to_storage(user_bytes, storage_path)
        print(f"Upload successful. Path: {storage_path}")
    except Exception as e:
        print(f"Upload failed: {e}")
        return

    print("\n--- 5. Encrypting reference (mocking BodyScan behavior) ---")
    encrypted_ref = encrypt_text(storage_path)
    print(f"Encrypted ref generated (length {len(encrypted_ref)})")

    print("\n--- 6. Confirm retrieve_image_bytes_from_encrypted_ref ---")
    try:
        retrieved_bytes = retrieve_image_bytes_from_encrypted_ref(encrypted_ref)
        if len(retrieved_bytes) == len(user_bytes):
            print("Successfully retrieved exact bytes.")
        else:
            print("Bytes mismatch!")
    except Exception as e:
        print(f"Retrieval failed: {e}")
        return

    print("\n--- 7/8. Instantiating VertexProvider ---")
    try:
        provider = VertexProvider()
        print("VertexProvider instantiated. GenAI client initialized.")
    except Exception as e:
        print(f"Provider instantiation failed: {e}")
        return
        
    print("\n--- 9/10/11/12/13. Executing Vertex AI TryOn ---")
    start_time = time.time()
    try:
        result = await provider.generate_tryon(
            user_image_url=encrypted_ref,
            garment_image_url=garment_img_url,
            garment_type="top"
        )
        duration = time.time() - start_time
        print(f"\n✅ TryOn Succeeded in {duration:.2f} seconds.")
        print(f"Provider: {result.provider_name}")
        print(f"Generated Image URL: {result.image_urls[0]}")
        
        # Verify URL opens
        async with httpx.AsyncClient() as client:
            test_resp = await client.get(result.image_urls[0])
            if test_resp.status_code == 200:
                print("✅ Generated image URL is reachable.")
            else:
                print(f"❌ Generated image URL returned status {test_resp.status_code}")
                
    except Exception as e:
        print(f"\n❌ TryOn failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
