import asyncio
import os
from dotenv import load_dotenv

load_dotenv(".env")

from sqlalchemy import text
from app.core.database import engine

async def check_jobs():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT id, status, error_message FROM tryon_jobs ORDER BY created_at DESC LIMIT 1"))
        row = result.first()
        if not row:
            print("No jobs found")
        else:
            print(f"Latest Job ID: {row[0]}")
            print(f"Status: {row[1]}")
            print(f"Error Message: {row[2]}")

if __name__ == "__main__":
    asyncio.run(check_jobs())
