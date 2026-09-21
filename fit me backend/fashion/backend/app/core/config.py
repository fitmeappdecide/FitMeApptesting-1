from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "FitMe"
    environment: str = "development"
    enable_body_analysis: bool = False
    database_url: str = Field(default="sqlite+aiosqlite:///fitme_dev.db", description="Database URL. Defaults to local SQLite for standalone dev.")
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str = Field(default="change-this-in-production")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    encryption_key: str = "0b0TQd8ZLF6jOoO0Yqti8X6Zz6dHmU1xI1mBevC5A28="
    aws_region: str = "ap-south-1"
    s3_bucket: str = "fitme-dev"
    cloudflare_r2_bucket: str = "fitme-dev-r2"
    scraper_service_url: str = "http://localhost:8001"
    runpod_api_key: str = ""
    runpod_endpoint_id: str = ""
    gpu_mode: Literal["runpod", "local", "aws"] = "runpod"
    anthropic_api_key: str = ""
    stripe_secret_key: str = ""
    firebase_credentials_path: str = "./firebase/fitme-3ac94-firebase-adminsdk-fbsvc-5ec19c616f.json"
    anonymous_website_user_email: str = "testtryon_user@example.com"

    # New Supabase configuration
    supabase_url: str = "https://smzhdmutffzapshfajyj.supabase.co"
    supabase_service_key: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtemhkbXV0ZmZ6YXBzaGZhanlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc3MzMwNSwiZXhwIjoyMDk3MzQ5MzA1fQ.8hKVg5ux564VEczw7L8DO-u3cavfjxZcSEbwtOvuKEc"
    supabase_storage_bucket: str = "scans"
    supabase_user_photos_bucket: str = "user-photos"

    # Vertex AI configuration
    vertex_project_id: str = "fitme-3ac94"
    vertex_location: str = "us-central1"

    # Visual Search API configuration
    searchapi_api_key: str = "PPfe3AziK1FGR2btbHcSYgAy"
    serpapi_api_key: str = "PPfe3AziK1FGR2btbHcSYgAy"

    price_refresh_ttl_hours: int = 12

    # Affiliate Marketing configuration
    cuelinks_api_key: str = ""
    amazon_associate_tag: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

from functools import lru_cache

def get_settings() -> Settings:
    return Settings()

settings = get_settings()
