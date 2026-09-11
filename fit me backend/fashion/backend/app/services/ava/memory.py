"""
AVA Memory System — Short-Term Conversation Context & Long-Term Style Memory.
"""
import uuid
from typing import Any, Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ava import AVAConversation, AVAMessage, AVAPreference, AVASavedOutfit
from app.services.ava.style_dna import StyleDNAEngine


class AVAMemoryManager:
    @staticmethod
    async def get_or_create_preference(db: AsyncSession, user_id: uuid.UUID) -> AVAPreference:
        stmt = select(AVAPreference).where(AVAPreference.user_id == user_id)
        res = await db.execute(stmt)
        pref = res.scalar_one_or_none()
        if not pref:
            pref = AVAPreference(
                user_id=user_id,
                style_dna=StyleDNAEngine.DEFAULT_STYLE_DNA,
                preferred_colors=["black", "white", "beige", "navy"],
                disliked_colors=[],
                disliked_items=[],
                preferred_fits=["relaxed", "slim"],
                favorite_brands=[],
                favorite_retailers=[],
            )
            db.add(pref)
            await db.flush()
        return pref

    @staticmethod
    async def extract_and_update_preferences(db: AsyncSession, user_id: uuid.UUID, prompt: str) -> None:
        text = prompt.lower()
        pref = await AVAMemoryManager.get_or_create_preference(db, user_id)

        # Detect color preferences
        if "love" in text or "prefer" in text or "like" in text:
            for color in ["black", "white", "beige", "navy", "olive", "red", "pink", "blue"]:
                if color in text and color not in pref.preferred_colors:
                    pref.preferred_colors = list(pref.preferred_colors) + [color]

        # Detect dislikes
        if "don't like" in text or "dislike" in text or "hate" in text or "no " in text:
            for item in ["loafers", "heels", "oversized", "skirt", "saree", "bright colors"]:
                if item in text and item not in pref.disliked_items:
                    pref.disliked_items = list(pref.disliked_items) + [item]

        # Fit preferences
        if "oversized" in text and "oversized" not in pref.preferred_fits:
            pref.preferred_fits = list(pref.preferred_fits) + ["oversized"]

        await db.flush()

    @staticmethod
    async def get_recent_messages(db: AsyncSession, conversation_id: uuid.UUID, limit: int = 10) -> List[Dict[str, Any]]:
        stmt = (
            select(AVAMessage)
            .where(AVAMessage.conversation_id == conversation_id)
            .order_by(AVAMessage.created_at.desc())
            .limit(limit)
        )
        res = await db.execute(stmt)
        msgs = list(res.scalars().all())
        msgs.reverse()
        return [
            {
                "sender": m.sender,
                "text": m.text_content,
                "intent": m.intent,
                "payload": m.structured_payload,
            }
            for m in msgs
        ]
