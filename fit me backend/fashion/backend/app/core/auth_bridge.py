"""
FitMe Auth -> V2 Product Intelligence AuthUser Bridge.

This bridge adapts FitMe's core authentication pipeline (app.api.deps.get_current_user)
to the AuthUser contract expected by Product Intelligence V2 endpoints and services.
Zero modification to existing FitMe auth routes or token mechanics.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional, Set
from fastapi import Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.models.user import User


class AuthUser(BaseModel):
    user_id: str = Field(description="FitMe User UUID as string")
    email: Optional[str] = None
    is_admin: bool = False
    provider: str = "fitme_jwt"


@lru_cache(maxsize=1)
def _admin_ids_cached() -> Set[str]:
    raw = os.environ.get("ADMIN_USER_IDS", "")
    return frozenset({x.strip() for x in raw.split(",") if x.strip()})


def get_admin_ids() -> Set[str]:
    return _admin_ids_cached()


async def get_v2_auth_user(user: User = Depends(get_current_user)) -> AuthUser:
    """Dependency bridge that adapts the existing FitMe SQLAlchemy User model
    to the V2 AuthUser schema."""
    user_id_str = str(user.id)
    is_admin = user_id_str in get_admin_ids()
    return AuthUser(
        user_id=user_id_str,
        email=user.email,
        is_admin=is_admin,
        provider="fitme_jwt",
    )


async def require_v2_admin(v2_user: AuthUser = Depends(get_v2_auth_user)) -> AuthUser:
    """Admin-only dependency for Product Intelligence administrative endpoints."""
    if not v2_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for Product Intelligence admin endpoints.",
        )
    return v2_user
