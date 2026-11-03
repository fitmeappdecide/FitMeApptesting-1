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
    async def get_preferences(db: AsyncSession, user_id: uuid.UUID) -> Optional[AVAPreference]:
        stmt = select(AVAPreference).where(AVAPreference.user_id == user_id)
        res = await db.execute(stmt)
        return res.scalar_one_or_none()

    @staticmethod
    async def get_or_create_preference(db: AsyncSession, user_id: uuid.UUID) -> AVAPreference:
        stmt = select(AVAPreference).where(AVAPreference.user_id == user_id)
        res = await db.execute(stmt)
        pref = res.scalar_one_or_none()
        if not pref:
            pref = AVAPreference(
                user_id=user_id,
                style_dna={},
                preferred_colors=[],
                disliked_colors=[],
                disliked_items=[],
                preferred_fits=[],
                favorite_brands=[],
                favorite_retailers=[],
            )
            db.add(pref)
            await db.flush()
        return pref

    @staticmethod
    def format_style_dna_for_prompt(pref: AVAPreference, body_profile: Optional[Dict[str, Any]] = None) -> str:
        """
        Generates an ultra-compact, high-density Style DNA summary (~35-50 tokens)
        for injection into GPT-4o / GPT-4o-mini system prompt.
        """
        lines = ["[USER STYLE DNA & PERSISTENT MEMORY]"]
        
        # Fits
        if pref.preferred_fits:
            lines.append(f"- Fits: {', '.join(pref.preferred_fits[:4])}")
        
        # Colors
        if pref.preferred_colors:
            lines.append(f"- Favorite Colors: {', '.join(pref.preferred_colors[:5])}")
        if pref.disliked_colors:
            lines.append(f"- Avoid Colors: {', '.join(pref.disliked_colors[:4])}")
            
        # Dislikes / Dealbreakers
        if pref.disliked_items:
            lines.append(f"- Dislikes / Avoid: {', '.join(pref.disliked_items[:5])}")
            
        # Brands & Retailers
        retailers = pref.favorite_retailers or []
        brands = pref.favorite_brands or []
        if retailers or brands:
            combined = (retailers + brands)[:4]
            lines.append(f"- Preferred Brands/Stores: {', '.join(combined)}")
            
        # Budget Comfort
        if pref.budget_range_max:
            min_b = f"₹{pref.budget_range_min:,.0f}" if pref.budget_range_min else "₹0"
            max_b = f"₹{pref.budget_range_max:,.0f}"
            lines.append(f"- Budget Range: {min_b} to {max_b}")
            
        # Top Aesthetic affinities
        if pref.style_dna:
            sorted_dna = sorted(pref.style_dna.items(), key=lambda x: x[1], reverse=True)
            top_styles = [f"{k.capitalize()}" for k, v in sorted_dna if v >= 0.5][:3]
            if top_styles:
                lines.append(f"- Aesthetics: {', '.join(top_styles)}")

        # Body Profile if available
        if body_profile:
            body = body_profile.get("body_profile", body_profile) if isinstance(body_profile, dict) else {}
            b_shape = body.get("silhouette_profile", {}).get("body_shape")
            c_season = body.get("color_season", {}).get("season")
            if b_shape or c_season:
                lines.append(f"- Body: {b_shape or 'balanced'} silhouette | {c_season or 'neutral'} season")

        lines.append("STYLING RULE: Always prioritize the user's fits, favorite colors, and budget while strictly avoiding their disliked items unless they explicitly request otherwise.")
        return "\n".join(lines)

    @staticmethod
    async def extract_and_update_preferences(db: AsyncSession, user_id: uuid.UUID, prompt: str) -> Optional[AVAPreference]:
        """
        Non-intrusive heuristic extraction of style preferences, fits, dislikes, brands, and budgets
        from conversational user text. Executes in <1ms without calling LLMs.
        """
        text = prompt.lower().strip()
        if len(text) < 3:
            return None

        pref = await AVAMemoryManager.get_or_create_preference(db, user_id)
        modified = False

        # 1. Fit Preferences
        FIT_KEYWORDS = ["oversized", "relaxed", "slim", "baggy", "tailored", "regular fit", "loose", "boxy", "tapered"]
        for fit in FIT_KEYWORDS:
            if fit in text:
                if any(neg in text for neg in [f"not {fit}", f"no {fit}", f"hate {fit}", f"dislike {fit}", f"don't like {fit}"]):
                    # User dislikes this fit
                    if fit not in pref.disliked_items:
                        pref.disliked_items = list(pref.disliked_items) + [f"{fit} fit"]
                        modified = True
                    if fit in pref.preferred_fits:
                        pref.preferred_fits = [f for f in pref.preferred_fits if f != fit]
                        modified = True
                elif any(pos in text for pos in ["love", "prefer", "like", "wear", "only", "always", "into", "want"]):
                    if fit not in pref.preferred_fits:
                        pref.preferred_fits = list(pref.preferred_fits) + [fit]
                        modified = True

        # 2. Color Preferences & Dislikes
        COLORS = [
            "black", "white", "beige", "navy", "olive", "emerald", "terracotta", "burgundy",
            "cream", "brown", "pastel", "red", "pink", "blue", "grey", "khaki", "yellow",
            "orange", "purple", "maroon", "lavender", "mustard", "gold", "silver"
        ]
        for c in COLORS:
            if c in text:
                if any(neg in text for neg in [f"no {c}", f"hate {c}", f"not {c}", f"dislike {c}", f"don't like {c}", f"avoid {c}"]):
                    if c not in pref.disliked_colors:
                        pref.disliked_colors = list(pref.disliked_colors) + [c]
                        modified = True
                    if c in pref.preferred_colors:
                        pref.preferred_colors = [col for col in pref.preferred_colors if col != c]
                        modified = True
                elif any(pos in text for pos in ["love", "prefer", "like", "favorite", "favourite", "wear", "into"]):
                    if c not in pref.preferred_colors:
                        pref.preferred_colors = list(pref.preferred_colors) + [c]
                        modified = True
                    if c in pref.disliked_colors:
                        pref.disliked_colors = [col for col in pref.disliked_colors if col != c]
                        modified = True

        # 3. Disliked Items / Dealbreakers
        DISLIKE_TARGETS = [
            ("skinny jeans", "skinny jeans"),
            ("ripped", "ripped jeans"),
            ("loafers", "loafers"),
            ("heels", "heels"),
            ("polyester", "synthetic/polyester"),
            ("leather", "leather"),
            ("crop top", "crop tops"),
            ("tie-dye", "tie-dye"),
            ("neon", "neon colors"),
            ("cargo", "cargos"),
        ]
        for trigger, label in DISLIKE_TARGETS:
            if trigger in text and any(neg in text for neg in ["don't like", "dislike", "hate", "no ", "avoid", "never wear"]):
                if label not in pref.disliked_items:
                    pref.disliked_items = list(pref.disliked_items) + [label]
                    modified = True

        # 4. Favorite Brands & Retailers
        RETAILERS = ["myntra", "ajio", "amazon", "zara", "h&m", "snitch", "uniqlo", "bonkers corner", "westside", "nykaa"]
        for r in RETAILERS:
            if r in text and any(pos in text for pos in ["only", "prefer", "buy from", "shop from", "love", "like"]):
                r_title = r.title()
                if r in ["myntra", "ajio", "amazon"]:
                    if r_title not in pref.favorite_retailers and r not in pref.favorite_retailers:
                        pref.favorite_retailers = list(pref.favorite_retailers) + [r_title]
                        modified = True
                elif r_title not in pref.favorite_brands and r not in pref.favorite_brands:
                    pref.favorite_brands = list(pref.favorite_brands) + [r_title]
                    modified = True

        # 5. Aesthetic Affinities (Style DNA update)
        STYLE_TRIGGERS = {
            "minimal": ["minimal", "minimalist", "clean aesthetic", "old money", "quiet luxury"],
            "streetwear": ["streetwear", "hypebeast", "oversized hoodie", "sneakerhead"],
            "casual": ["casual", "everyday", "relaxed weekend", "college"],
            "formal": ["formal", "office", "corporate", "blazer", "tuxedo", "suit"],
            "ethnic": ["ethnic", "kurta", "wedding", "sherwani", "lehenga", "saree", "traditional"],
        }
        for style_key, triggers in STYLE_TRIGGERS.items():
            if any(t in text for t in triggers):
                current_val = pref.style_dna.get(style_key, 0.5)
                pref.style_dna = {**pref.style_dna, style_key: min(1.0, round(current_val + 0.05, 2))}
                modified = True

        # 6. Budget ceilings
        import re
        budget_match = re.search(r"(?:under|below|max|budget|within|upto)\s*(?:of)?\s*(?:₹|rs\.?|inr)?\s*(\d{3,6})", text)
        if budget_match:
            try:
                b_val = float(budget_match.group(1))
                if 500 <= b_val <= 100000:
                    pref.budget_range_max = b_val
                    modified = True
            except ValueError:
                pass

        if modified:
            await db.flush()
        return pref

    @staticmethod
    async def save_explicit_preference(
        db: AsyncSession,
        user_id: uuid.UUID,
        preferred_fits: Optional[List[str]] = None,
        preferred_colors: Optional[List[str]] = None,
        disliked_colors: Optional[List[str]] = None,
        disliked_items: Optional[List[str]] = None,
        favorite_brands: Optional[List[str]] = None,
        favorite_retailers: Optional[List[str]] = None,
        budget_range_min: Optional[float] = None,
        budget_range_max: Optional[float] = None,
        style_dna: Optional[Dict[str, float]] = None,
    ) -> AVAPreference:
        """Explicit programmatic update of user style preferences."""
        pref = await AVAMemoryManager.get_or_create_preference(db, user_id)
        if preferred_fits is not None:
            pref.preferred_fits = preferred_fits
        if preferred_colors is not None:
            pref.preferred_colors = preferred_colors
        if disliked_colors is not None:
            pref.disliked_colors = disliked_colors
        if disliked_items is not None:
            pref.disliked_items = disliked_items
        if favorite_brands is not None:
            pref.favorite_brands = favorite_brands
        if favorite_retailers is not None:
            pref.favorite_retailers = favorite_retailers
        if budget_range_min is not None:
            pref.budget_range_min = budget_range_min
        if budget_range_max is not None:
            pref.budget_range_max = budget_range_max
        if style_dna is not None:
            pref.style_dna = style_dna

        await db.commit()
        await db.refresh(pref)
        return pref

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
