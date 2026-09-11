import asyncio
from unittest.mock import patch
from app.core.database import SessionLocal
from app.api.auth import login_firebase
from app.schemas.auth import FirebaseLoginRequest
import pytest

@pytest.mark.asyncio
async def test_firebase_login():
    mock_token = "fake-token"
    mock_decoded = {
        "uid": "12345",
        "email": "test@firebase.com",
        "name": "Firebase User",
        "firebase": {"sign_in_provider": "google.com"}
    }
    
    with patch('app.core.firebase.auth.verify_id_token', return_value=mock_decoded):
        # We need a DB session. We can use the real DB if it's up, or a mock.
        pass
