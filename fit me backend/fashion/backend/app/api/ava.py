"""
AVA Backend API Router — Dedicated endpoints for AVA AI Fashion Agent.
Mounted under /api/v1/ava.
"""
import logging
import os
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Union
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.api.deps import get_current_user, get_current_user_or_anonymous
from app.core.config import settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.user import User
from app.models.ava import AVAConversation, AVAMessage, AVAPreference, AVASavedOutfit
from app.services.ava.agent import AVAAgent
from app.services.ava.memory import AVAMemoryManager
from app.services.ava.tools import AVAToolSuite

router = APIRouter(prefix="/api/v1/ava", tags=["ava"])


def parse_optional_uuid(val: Optional[Union[uuid.UUID, str]]) -> Optional[uuid.UUID]:
    if not val:
        return None
    if isinstance(val, uuid.UUID):
        return val
    try:
        return uuid.UUID(str(val).strip())
    except (ValueError, AttributeError):
        return None


class AVAChatRequest(BaseModel):
    message: str = Field(description="Natural language fashion request or command")
    conversation_id: Optional[Union[uuid.UUID, str]] = Field(default=None, description="Active conversation session ID")
    image_base64: Optional[str] = Field(default=None, description="Optional image payload for visual requests")
    selected_outfit: Optional[Dict[str, Any]] = Field(default=None, description="Active outfit context being modified")


class AVAPreferenceUpdateRequest(BaseModel):
    style_dna: Optional[Dict[str, float]] = None
    preferred_colors: Optional[List[str]] = None
    disliked_colors: Optional[List[str]] = None
    disliked_items: Optional[List[str]] = None
    preferred_fits: Optional[List[str]] = None
    favorite_brands: Optional[List[str]] = None
    favorite_retailers: Optional[List[str]] = None
    budget_range_min: Optional[float] = None
    budget_range_max: Optional[float] = None


class AVARenameConversationRequest(BaseModel):
    title: str


class AVAChatResponse(BaseModel):
    conversation_id: str
    message: str
    intent: str
    mode: str
    outfits: List[Dict[str, Any]] = Field(default_factory=list)
    tool_calls_log: List[Dict[str, Any]] = Field(default_factory=list)
    suggested_actions: List[str] = Field(default_factory=list)


@router.post("/chat", response_model=AVAChatResponse)
@limiter.limit("20/minute")
async def chat_with_ava(
    request: Request,
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

    conv_uuid = parse_optional_uuid(payload.conversation_id)
    if conv_uuid:
        conv_stmt = select(AVAConversation).where(AVAConversation.id == conv_uuid)
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
        conversation_id=conv_uuid,
        image_base64=payload.image_base64,
        selected_outfit=payload.selected_outfit,
    )
    logger.info(f"[AVA API] AGENT_RESPONSE: intent='{res.get('intent')}', outfits={len(res.get('outfits', []))}")
    return res


@router.post("/chat/stream")
@limiter.limit("20/minute")
async def chat_with_ava_stream(
    request: Request,
    payload: AVAChatRequest,
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
):
    """
    Streaming SSE interaction endpoint for AVA AI Fashion Agent.
    Delivers ChatGPT-style instant token typing and real-time outfit delivery.
    """
    if not payload.message or not payload.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message prompt cannot be empty.",
        )

    conv_uuid = parse_optional_uuid(payload.conversation_id)
    if conv_uuid:
        conv_stmt = select(AVAConversation).where(AVAConversation.id == conv_uuid)
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
    logger.info(f"[AVA API STREAM] prompt='{payload.message}', user_id={user_id}")

    agent = AVAAgent(db, user_id=user_id)
    stream_generator = agent.process_request_stream(
        user_prompt=payload.message,
        conversation_id=conv_uuid,
        image_base64=payload.image_base64,
        selected_outfit=payload.selected_outfit,
    )

    return StreamingResponse(
        stream_generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
    if not convs:
        return []

    conv_ids = [c.id for c in convs]
    # Lightweight batch query: select ONLY conversation_id, sender, and text_content.
    # Exclude structured_payload completely to prevent loading multi-megabyte base64 photos into memory!
    msg_stmt = (
        select(AVAMessage.conversation_id, AVAMessage.sender, AVAMessage.text_content)
        .where(AVAMessage.conversation_id.in_(conv_ids))
        .order_by(AVAMessage.created_at.asc())
    )
    msg_res = await db.execute(msg_stmt)
    all_msgs = msg_res.all()

    user_texts_by_conv: Dict[uuid.UUID, List[str]] = defaultdict(list)
    for c_id, sender, text_content in all_msgs:
        if sender == "user" and text_content:
            user_texts_by_conv[c_id].append(text_content)

    result = []
    for c in convs:
        user_texts = user_texts_by_conv.get(c.id, [])
        first_user_msg = user_texts[0] if user_texts else ""
        last_user_msg = user_texts[-1] if user_texts else ""

        title = c.title
        if (not title or title == "Fashion Styling Session" or title == "Outfit styling session") and (first_user_msg or last_user_msg):
            source = first_user_msg or last_user_msg
            words = source.strip().split()[:7]
            title = " ".join(words) if words else "Fashion Styling"
            title = title[0].upper() + title[1:] if title else "Fashion Styling"

        result.append({
            "id": str(c.id),
            "title": title,
            "last_message": last_user_msg,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        })

    return result


@router.delete("/conversations/{conversation_id}")
async def delete_user_conversation(
    conversation_id: uuid.UUID,
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    conv_stmt = select(AVAConversation).where(AVAConversation.id == conversation_id)
    conv_res = await db.execute(conv_stmt)
    conv = conv_res.scalar_one_or_none()
    if not conv:
        # Idempotent DELETE: resource already removed or local-first
        return {"success": True, "deleted_conversation_id": str(conversation_id), "status": "already_deleted"}
    if conv.user_id and current_user and conv.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this conversation.",
        )

    from sqlalchemy import delete
    await db.execute(delete(AVAMessage).where(AVAMessage.conversation_id == conversation_id))
    await db.execute(delete(AVAConversation).where(AVAConversation.id == conversation_id))
    await db.commit()
    return {"success": True, "deleted_conversation_id": str(conversation_id)}


@router.patch("/conversations/{conversation_id}")
async def rename_user_conversation(
    conversation_id: uuid.UUID,
    payload: AVARenameConversationRequest,
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    conv_stmt = select(AVAConversation).where(AVAConversation.id == conversation_id)
    conv_res = await db.execute(conv_stmt)
    conv = conv_res.scalar_one_or_none()
    if not conv:
        return {"success": True, "conversation_id": str(conversation_id), "status": "not_found"}
    if conv.user_id and current_user and conv.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this conversation.",
        )
    clean_title = payload.title.strip()
    if clean_title:
        conv.title = clean_title
        await db.commit()
    return {"success": True, "conversation_id": str(conversation_id), "title": conv.title}


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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    stmt = select(AVAPreference).where(AVAPreference.user_id == current_user.id)
    res = await db.execute(stmt)
    pref = res.scalar_one_or_none()
    if not pref:
        return {
            "style_dna": {},
            "preferred_colors": [],
            "disliked_colors": [],
            "disliked_items": [],
            "preferred_fits": [],
            "favorite_brands": [],
            "favorite_retailers": [],
            "budget_range_min": None,
            "budget_range_max": None,
        }

    return {
        "style_dna": pref.style_dna or {},
        "preferred_colors": pref.preferred_colors or [],
        "disliked_colors": pref.disliked_colors or [],
        "disliked_items": pref.disliked_items or [],
        "preferred_fits": pref.preferred_fits or [],
        "favorite_brands": pref.favorite_brands or [],
        "favorite_retailers": pref.favorite_retailers or [],
        "budget_range_min": pref.budget_range_min,
        "budget_range_max": pref.budget_range_max,
    }


@router.put("/preferences")
async def update_ava_preferences(
    payload: AVAPreferenceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    pref = await AVAMemoryManager.save_explicit_preference(
        db=db,
        user_id=current_user.id,
        preferred_fits=payload.preferred_fits,
        preferred_colors=payload.preferred_colors,
        disliked_colors=payload.disliked_colors,
        disliked_items=payload.disliked_items,
        favorite_brands=payload.favorite_brands,
        favorite_retailers=payload.favorite_retailers,
        budget_range_min=payload.budget_range_min,
        budget_range_max=payload.budget_range_max,
        style_dna=payload.style_dna,
    )
    return {
        "status": "success",
        "preferences": {
            "style_dna": pref.style_dna,
            "preferred_colors": pref.preferred_colors,
            "disliked_colors": pref.disliked_colors,
            "disliked_items": pref.disliked_items,
            "preferred_fits": pref.preferred_fits,
            "favorite_brands": pref.favorite_brands,
            "favorite_retailers": pref.favorite_retailers,
            "budget_range_min": pref.budget_range_min,
            "budget_range_max": pref.budget_range_max,
        },
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


class AVAResolvePDPRequest(BaseModel):
    title: str = Field(description="Product title")
    seller: Optional[str] = Field(default=None, description="Seller or platform name")
    current_url: Optional[str] = Field(default=None, description="Current fallback URL if any")


class AVAResolvePDPResponse(BaseModel):
    direct_url: str
    is_direct: bool
    retailer: str


# In-memory cache for resolved PDP URLs: (seller, clean_title) -> direct_url
_PDP_RESOLVER_CACHE: Dict[str, str] = {}


def is_direct_pdp_url(url: Optional[str]) -> bool:
    if not url or not url.startswith("http"):
        return False
    u = url.lower()
    # Reject search and generic listing pages
    if any(k in u for k in ["/s?", "/search", "/category", "/collections/", "/collection/", "google.com", "google.co.in"]):
        return False
    # Accept genuine Product Detail Pages across Indian and international fashion stores
    is_amazon_pdp = bool(re.search(r"/(?:dp|gp/product)/[A-Z0-9]{10}", url, re.I))
    is_myntra_pdp = bool(re.search(r"/(?:buy|buy\?|buy/\d+)$", url, re.I) or ("/buy" in url and not "/search" in url))
    is_ajio_pdp = bool(re.search(r"/p/\d+", url, re.I))
    is_flipkart_pdp = bool(re.search(r"/p/[a-zA-Z0-9]+", url, re.I))
    is_brand_pdp = bool(re.search(r"/products?/[a-zA-Z0-9\-]+", url, re.I))
    return is_amazon_pdp or is_myntra_pdp or is_ajio_pdp or is_flipkart_pdp or is_brand_pdp


@router.post("/resolve-pdp", response_model=AVAResolvePDPResponse)
async def resolve_product_pdp(
    payload: AVAResolvePDPRequest,
    current_user: Optional[User] = Depends(get_current_user_or_anonymous),
) -> Dict[str, Any]:
    """Resolves an exact, direct merchant Product Detail Page (PDP) for a garment,
    ensuring users land directly on the product's checkout/size page instead of search results.
    """
    raw_title = (payload.title or "").strip()
    raw_seller = (payload.seller or "").strip()
    current_url = (payload.current_url or "").strip()

    if is_direct_pdp_url(current_url):
        return {
            "direct_url": current_url,
            "is_direct": True,
            "retailer": raw_seller or "Store",
        }

    # Clean title by removing parenthesized counts, noise, seller suffixes
    clean_t = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", raw_title)
    clean_t = re.sub(
        r"(?i)\b(by\s+(?:myntra|ajio|amazon|flipkart|meesho|zara|h&m|kalki)|online\s+in\s+india|at\s+best\s+price|best\s+price|buy\s+now|mrp)\b",
        " ",
        clean_t,
    )
    clean_t = re.sub(r"[^\w\s\-\&]", " ", clean_t)
    clean_t = " ".join(clean_t.split()).strip() or raw_title

    cache_key = f"{(raw_seller or 'any').lower()}::{clean_t.lower()}"
    if cache_key in _PDP_RESOLVER_CACHE:
        return {
            "direct_url": _PDP_RESOLVER_CACHE[cache_key],
            "is_direct": True,
            "retailer": raw_seller or "Store",
        }

    serper_key = getattr(settings, "serper_api_key", None) or os.getenv("SERPER_API_KEY")
    resolved_url = None

    if serper_key and clean_t:
        try:
            # Query Serper Google Search for the exact product
            q = f"{clean_t} {raw_seller}".strip()
            async with httpx.AsyncClient(timeout=6.0, verify=False) as client:
                resp = await client.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                    json={"q": q, "gl": "in", "hl": "en", "num": 10},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    organic = data.get("organic", [])

                    # Priority 1: Direct PDP from matching seller
                    s_low = raw_seller.lower() if raw_seller else ""
                    if s_low:
                        for item in organic:
                            link = item.get("link", "")
                            if is_direct_pdp_url(link) and s_low in link.lower():
                                resolved_url = link
                                break

                    # Priority 2: Direct PDP from any reputable retailer
                    if not resolved_url:
                        for item in organic:
                            link = item.get("link", "")
                            if is_direct_pdp_url(link):
                                resolved_url = link
                                break

                    # Priority 3: First non-search merchant link
                    if not resolved_url:
                        for item in organic:
                            link = item.get("link", "")
                            if link.startswith("http") and not any(k in link for k in ["google.", "/search", "/s?"]):
                                resolved_url = link
                                break
        except Exception as e:
            logger.warn(f"[AVAResolvePDP] Serper resolution error: {e}")

    # Fallback to safe merchant search URL if no direct PDP was found
    if not resolved_url:
        resolved_url = AVAToolSuite.make_merchant_search_url(raw_seller, clean_t)
        is_direct = False
    else:
        is_direct = is_direct_pdp_url(resolved_url)

    _PDP_RESOLVER_CACHE[cache_key] = resolved_url
    return {
        "direct_url": resolved_url,
        "is_direct": is_direct,
        "retailer": raw_seller or "Store",
    }
