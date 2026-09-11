from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_current_user
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.models.user import User
import secrets
from app.core.firebase import verify_token
from app.schemas.auth import FirebaseLoginRequest, LoginRequest, RefreshRequest, TokenResponse, UserCreate, UserPublic

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == payload.email.lower()))
    if existing.scalar_one_or_none() is not None:
        raise api_error(400, "EMAIL_EXISTS", "This email is already registered.", "यह ईमेल पहले से पंजीकृत है।")
    user = User(email=payload.email.lower(), password_hash=hash_password(payload.password), full_name=payload.full_name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(str(user.id)), refresh_token=create_refresh_token(str(user.id)), user=UserPublic.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise api_error(401, "INVALID_CREDENTIALS", "Email or password is incorrect.", "ईमेल या पासवर्ड गलत है।")
    return TokenResponse(access_token=create_access_token(str(user.id)), refresh_token=create_refresh_token(str(user.id)), user=UserPublic.model_validate(user))



from datetime import UTC, datetime

@router.post("/firebase", response_model=TokenResponse)
async def login_firebase(payload: FirebaseLoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    print("========== FIREBASE LOGIN ==========")
    print("payload.token =", payload.token)
    print("payload.token length =", len(payload.token) if payload.token else 0)
    try:
        decoded = verify_token(payload.token)
        print("Decoded Firebase Token:")
        print(decoded)
    except Exception as e:
        import traceback
        print("========== VERIFY TOKEN FAILED ==========")
        print(type(e).__name__)
        print(str(e))
        traceback.print_exc()
        raise api_error(400, "INVALID_TOKEN", f"Google/Firebase authentication failed: {str(e)}", "गूगल/फायरबेस प्रमाणीकरण विफल रहा।")

    
    uid = decoded.get("uid")
    email = decoded.get("email")
    name = decoded.get("name")
    
    if not email:
        raise api_error(400, "INVALID_TOKEN", "Token does not contain an email address.", "टोकन में ईमेल पता नहीं है।")
        
    try:
        result = await db.execute(select(User).where(User.email == email.lower()))
        user = result.scalar_one_or_none()
        
        if user is None:
            random_pwd = secrets.token_urlsafe(32)
            user = User(
                email=email.lower(),
                password_hash=hash_password(random_pwd),
                full_name=name
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
    except Exception as db_err:
        print(f"Database error during Firebase login: {db_err}")
        raise api_error(500, "DATABASE_ERROR", "Could not complete user authentication.", "उपयोगकर्ता प्रमाणीकरण पूरा नहीं किया जा सका।")
        
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        user=UserPublic.model_validate(user)
    )

@router.post("/refresh")
async def refresh(payload: RefreshRequest) -> dict:
    decoded = decode_token(payload.refresh_token, expected_type="refresh")
    if decoded is None:
        raise api_error(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.", "रिफ्रेश टोकन अमान्य या समाप्त हो गया है।")
    return {"access_token": create_access_token(str(decoded["sub"])), "token_type": "bearer"}


@router.post("/logout")
async def logout(_: User = Depends(get_current_user)) -> dict:
    return {"status": "logged_out"}

