import os
from dotenv import load_dotenv

print("Loading .env file...")
load_dotenv(".env")

print("\n--- 1. Testing Supabase Connection ---")
try:
    from supabase import create_client
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    
    if not url or not key:
        print("❌ Missing Supabase URL or Key in .env")
    else:
        client = create_client(url, key)
        # Attempt to list buckets to verify auth
        buckets = client.storage.list_buckets()
        print("✅ Supabase successfully authenticated!")
        print("   Found buckets:", [b.name for b in buckets])
except Exception as e:
    print("❌ Supabase Connection Failed!")
    print(f"   Reason: {str(e)}")

print("\n--- 2. Testing Vertex AI Configuration ---")
try:
    from google import genai
    
    project = os.getenv("VERTEX_PROJECT_ID")
    location = os.getenv("VERTEX_LOCATION")
    
    if not project or not location:
        print("❌ Missing Vertex AI Project ID or Location in .env")
    else:
        # Initializing the client will validate the GOOGLE_APPLICATION_CREDENTIALS path
        # and attempt to parse the service account JSON.
        client = genai.Client(enterprise=True, project=project, location=location)
        print("✅ Vertex AI Client initialized successfully!")
        print(f"   Project: {project} | Location: {location}")
        print("   (Note: Full permissions will be tested when you generate your first image)")
except Exception as e:
    print("❌ Vertex AI Configuration Failed!")
    print(f"   Reason: {str(e)}")
