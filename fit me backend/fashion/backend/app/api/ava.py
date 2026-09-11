"""
AVA Backend API Router — Dedicated endpoints for AVA AI Fashion Agent.
Mounted under /api/v1/ava.
"""
import logging
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.api.deps import get_current_user, get_current_user_or_anonymous
from app.core.database import get_db
from app.models.user import User
from app.models.ava import AVAConversation, AVAMessage, AVAPreference, AVASavedOutfit
from app.services.ava.agent import AVAAgent

router = APIRouter(prefix="/api/v1/ava", tags=["ava"])


class AVAChatRequest(BaseModel):
    message: str = Field(description="Natural language fashion request or command")
    conversation_id: Optional[uuid.UUID] = Field(default=None, description="Active conversation session ID")
    image_base64: Optional[str] = Field(default=None, description="Optional image payload for visual requests")
    selected_outfit: Optional[Dict[str, Any]] = Field(default=None, description="Active outfit context being modified")


class AVAChatResponse(BaseModel):
    conversation_id: str
    message: str
    intent: str
    mode: str
    outfits: List[Dict[str, Any]] = Field(default_factory=list)
    tool_calls_log: List[Dict[str, Any]] = Field(default_factory=list)
    suggested_actions: List[str] = Field(default_factory=list)


@router.post("/chat", response_model=AVAChatResponse)
async def chat_with_ava(
    payload: AVAChatRequest,
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Main natural-language interaction endpoint for AVA AI Fashion Agent.
    """
    if not payload.message or not payload.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message prompt cannot be empty.",
        )

    if payload.conversation_id:
        conv_stmt = select(AVAConversation).where(AVAConversation.id == payload.conversation_id)
        conv_res = await db.execute(conv_stmt)
        existing_conv = conv_res.scalar_one_or_none()
        if existing_conv and existing_conv.user_id:
            if not current_user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required to access this conversation.",
                )
            if existing_conv.user_id != current_user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to access this conversation.",
                )

    user_id = current_user.id if current_user else None
    logger.info(f"[AVA API] CHAT_REQUEST: prompt='{payload.message}'")
    logger.info(f"[AVA API] USER_ID: {user_id}")
    logger.info("[AVA API] AGENT_CALLED")

    agent = AVAAgent(db, user_id=user_id)

    res = await agent.process_request(
        user_prompt=payload.message,
        conversation_id=payload.conversation_id,
        image_base64=payload.image_base64,
        selected_outfit=payload.selected_outfit,
    )
    logger.info(f"[AVA API] AGENT_RESPONSE: intent='{res.get('intent')}', outfits={len(res.get('outfits', []))}")
    return res


@router.get("/conversations")
async def get_user_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    stmt = (
        select(AVAConversation)
        .where(AVAConversation.user_id == current_user.id)
        .order_by(AVAConversation.updated_at.desc())
        .limit(30)
    )
    res = await db.execute(stmt)
    convs = res.scalars().all()

    return [
        {
            "id": str(c.id),
            "title": c.title,
            "last_message": "",
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        }
        for c in convs
    ]


@router.delete("/conversations/{conversation_id}")
async def delete_user_conversation(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    conv_stmt = select(AVAConversation).where(AVAConversation.id == conversation_id)
    conv_res = await db.execute(conv_stmt)
    conv = conv_res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation '{conversation_id}' not found.",
        )
    if conv.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this conversation.",
        )

    from sqlalchemy import delete
    await db.execute(delete(AVAMessage).where(AVAMessage.conversation_id == conversation_id))
    await db.execute(delete(AVAConversation).where(AVAConversation.id == conversation_id))
    await db.commit()
    return {"success": True, "deleted_conversation_id": str(conversation_id)}


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    # Verify conversation exists and belongs to current user
    conv_stmt = select(AVAConversation).where(AVAConversation.id == conversation_id)
    conv_res = await db.execute(conv_stmt)
    conv = conv_res.scalar_one_or_none()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation '{conversation_id}' not found.",
        )
    if conv.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this conversation.",
        )

    stmt = (
        select(AVAMessage)
        .where(AVAMessage.conversation_id == conversation_id)
        .order_by(AVAMessage.created_at.asc())
    )
    res = await db.execute(stmt)
    messages = res.scalars().all()

    formatted_messages = []
    for m in messages:
        formatted_messages.append({
            "id": str(m.id),
            "sender": m.sender,
            "text": m.text_content,
            "intent": m.intent,
            "structured_payload": m.structured_payload,
            "created_at": m.created_at.isoformat(),
        })

    return {
        "conversation_id": str(conv.id),
        "title": conv.title,
        "messages": formatted_messages,
    }


@router.get("/preferences")
async def get_ava_preferences(
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    if not current_user:
        return {
            "style_dna": {"casual": 0.6, "minimal": 0.5, "streetwear": 0.4, "formal": 0.3, "ethnic": 0.4},
            "preferred_colors": ["black", "white", "beige", "navy"],
            "disliked_colors": [],
            "disliked_items": [],
        }

    stmt = select(AVAPreference).where(AVAPreference.user_id == current_user.id)
    res = await db.execute(stmt)
    pref = res.scalar_one_or_none()
    if not pref:
        return {
            "style_dna": {"casual": 0.6, "minimal": 0.5, "streetwear": 0.4, "formal": 0.3, "ethnic": 0.4},
            "preferred_colors": ["black", "white", "beige", "navy"],
            "disliked_colors": [],
            "disliked_items": [],
        }

    return {
        "style_dna": pref.style_dna,
        "preferred_colors": pref.preferred_colors,
        "disliked_colors": pref.disliked_colors,
        "disliked_items": pref.disliked_items,
        "preferred_fits": pref.preferred_fits,
        "favorite_brands": pref.favorite_brands,
        "favorite_retailers": pref.favorite_retailers,
    }


@router.get("/saved-outfits")
async def get_saved_outfits(
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    if not current_user:
        return []

    stmt = (
        select(AVASavedOutfit)
        .where(AVASavedOutfit.user_id == current_user.id)
        .order_by(AVASavedOutfit.created_at.desc())
    )
    res = await db.execute(stmt)
    outfits = res.scalars().all()
    return [
        {
            "id": str(o.id),
            "name": o.name,
            "occasion": o.occasion,
            "style": o.style,
            "total_price": o.total_price,
            "items": o.items,
            "created_at": o.created_at.isoformat(),
        }
        for o in outfits
    ]
