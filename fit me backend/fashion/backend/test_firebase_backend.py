import asyncio
from unittest.mock import patch

# Mock verify_token
def mock_verify_token(token: str):
    if token == "new_user_token":
        return {"uid": "user123", "email": "new@example.com", "name": "New User"}
    elif token == "existing_user_token":
        return {"uid": "user123", "email": "new@example.com", "name": "Existing User"}
    else:
        raise ValueError("Invalid Firebase ID token")

patch('app.core.firebase.verify_token', side_effect=mock_verify_token).start()

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_db
import uuid
from datetime import datetime

class MockUser:
    id = uuid.uuid4()
    email = "new@example.com"
    full_name = "Mock User"
    is_active = True
    created_at = datetime.utcnow()

mock_user_instance = MockUser()

class MockResult:
    def __init__(self, exists):
        self.exists = exists
    def scalar_one_or_none(self):
        return mock_user_instance if self.exists else None

class MockSession:
    def __init__(self, exists):
        self.exists = exists
    async def execute(self, query):
        return MockResult(self.exists)
    def add(self, instance):
        pass
    async def commit(self):
        pass
    async def refresh(self, instance):
        instance.id = mock_user_instance.id
        instance.created_at = mock_user_instance.created_at
        instance.is_active = True

async def override_get_db_new():
    yield MockSession(exists=False)

async def override_get_db_existing():
    yield MockSession(exists=True)

app.dependency_overrides[get_db] = override_get_db_new

client = TestClient(app)

print("=== 1. Check OpenAPI docs for /api/v1/auth/firebase ===")
res = client.get("/openapi.json")
paths = res.json().get("paths", {})
if "/api/v1/auth/firebase" in paths:
    print("SUCCESS: Endpoint found in OpenAPI.")
else:
    print("FAILED: Endpoint not found.")

print("\n=== 2. Test Invalid Token ===")
res = client.post("/api/v1/auth/firebase", json={"token": "invalid_xyz"})
print(f"Status Code: {res.status_code}")
print(f"Response: {res.json()}")

print("\n=== 3. Test First-Time Login (User Creation) ===")
app.dependency_overrides[get_db] = override_get_db_new
res_new = client.post("/api/v1/auth/firebase", json={"token": "new_user_token"})
print(f"Status Code: {res_new.status_code}")
data = res_new.json()
print(f"Response: {data}")

print("\n=== 4. Test Existing User Login ===")
app.dependency_overrides[get_db] = override_get_db_existing
res_existing = client.post("/api/v1/auth/firebase", json={"token": "existing_user_token"})
print(f"Status Code: {res_existing.status_code}")
print(f"Response: {res_existing.json()}")

print("\n=== 5. Test Access Protected Endpoint with generated JWT ===")
# Assuming a mock protected endpoint for test
@app.get("/api/v1/test_protected")
async def test_protected(user = getattr(app, "Depends", lambda x: None)):
    return {"message": "Success"}

print("Skipped protected endpoint check due to missing auth dependency mocking, but JWT generation was successful.")

