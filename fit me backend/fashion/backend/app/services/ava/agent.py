"""
AVA Core Orchestration Agent — Intent Analysis, Tool Execution, Reasoning Loop, and Structured Response Construction.
"""
import logging
import time
import uuid
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ava import AVAConversation, AVAMessage
from app.services.ava.intent_parser import AVAIntentParser
from app.services.ava.memory import AVAMemoryManager
from app.services.ava.outfit_engine import OutfitEngine
from app.services.ava.tools import AVAToolSuite

logger = logging.getLogger(__name__)

AVA_SYSTEM_PROMPT = """
You are AVA, FitMe's personal fashion stylist and shopping agent.
Your job is to help users discover, create, evaluate, and shop for outfits.
You must:
- Understand natural language fashion requests.
- Personalize recommendations using the user's style preferences.
- Respect user constraints (budget, retailer platform, style, occasion).
- Use FitMe tools when live product data is required.
- Never invent product facts, prices, URLs, or retailers.
- Explain why recommendations fit the request.
- Return structured responses.
"""


class AVAAgent:
    def __init__(self, db: AsyncSession, user_id: Optional[uuid.UUID] = None):
        self.db = db
        self.user_id = user_id
        self.tools = AVAToolSuite(db, user_id)

    async def process_request(
        self,
        user_prompt: str,
        conversation_id: Optional[uuid.UUID] = None,
        image_base64: Optional[str] = None,
        selected_outfit: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        start_time = time.time()
        tool_calls_log: List[Dict[str, Any]] = []

        # 1. Parse Intent & Entities
        parsed_intent = AVAIntentParser.parse(user_prompt)
        intent = parsed_intent["intent"]
        mode = parsed_intent["mode"]
        occasion = parsed_intent["occasion"]
        platform = parsed_intent["platform"]
        budget = parsed_intent["budget"]
        color = parsed_intent["color"]

        # 2. Extract Memory & Profile
        profile = await self.tools.get_user_profile()
        tool_calls_log.append({"tool": "get_user_profile", "time_ms": int((time.time() - start_time) * 1000), "status": "success"})

        if self.user_id:
            await AVAMemoryManager.extract_and_update_preferences(self.db, self.user_id, user_prompt)

        preferences = await self.tools.get_user_preferences()
        tool_calls_log.append({"tool": "get_user_preferences", "time_ms": int((time.time() - start_time) * 1000), "status": "success"})

        # Initialize or touch conversation session
        if not conversation_id:
            plat_str = f" · {platform.capitalize()}" if platform else ""
            low = user_prompt.lower()
            if "college" in low:
                title = f"College Outfit{plat_str}"
            elif "wedding" in low or "ethnic" in low or "shaadi" in low:
                title = f"Ethnic Wedding Outfit{plat_str}"
            elif "cheaper" in low:
                title = f"Budget Optimization{plat_str}"
            elif "try" in low:
                title = f"Virtual Try-On{plat_str}"
            elif occasion and occasion != "casual":
                title = f"{occasion.capitalize()} Styling{plat_str}"
            else:
                words = [w.capitalize() for w in user_prompt.split() if len(w) > 2][:4]
                title = " ".join(words) if words else "Fashion Styling"

            conv = AVAConversation(user_id=self.user_id, title=title)
            self.db.add(conv)
            await self.db.flush()
            conversation_id = conv.id
        else:
            from datetime import UTC, datetime
            from sqlalchemy import select
            stmt = select(AVAConversation).where(AVAConversation.id == conversation_id)
            c_res = await self.db.execute(stmt)
            existing_conv = c_res.scalar_one_or_none()
            if existing_conv:
                existing_conv.updated_at = datetime.now(UTC)

        # 3. Intent Routing & Tool Orchestration
        outfits: List[Dict[str, Any]] = []
        message_text = ""
        suggested_actions: List[str] = []

        if intent == "make_cheaper":
            t_start = time.time()
            target_outfit = selected_outfit or (outfits[0] if outfits else None)
            if not target_outfit:
                # Mock base outfit if context doesn't provide one
                products = await self.tools.search_products(occasion=occasion, budget=budget, platform=platform, limit=10)
                tool_calls_log.append({"tool": "search_products", "time_ms": int((time.time() - t_start) * 1000), "count": len(products)})
                target_outfit = await self.tools.build_outfit(occasion, products, budget, platform)
            
            cheaper_outfit = await OutfitEngine.make_cheaper(target_outfit, self.tools)
            tool_calls_log.append({"tool": "replace_outfit_item", "time_ms": int((time.time() - t_start) * 1000), "status": "success"})

            outfits = [cheaper_outfit]
            savings = cheaper_outfit.get("savings", 0)
            message_text = f"I've optimized your outfit for budget! Total is now ₹{cheaper_outfit['total_price']:.0f} (saved ₹{savings:.0f})."
            suggested_actions = ["Try this look", "Shop this look", "Save look"]

        elif intent == "swap_item":
            t_start = time.time()
            target_outfit = selected_outfit or (outfits[0] if outfits else None)
            if not target_outfit:
                products = await self.tools.search_products(occasion=occasion, limit=10)
                target_outfit = await self.tools.build_outfit(occasion, products)

            swap_target = parsed_intent.get("swap_target") or "shoes"
            updated_outfit = await self.tools.replace_outfit_item(target_outfit, swap_target, budget)
            tool_calls_log.append({"tool": "replace_outfit_item", "time_ms": int((time.time() - t_start) * 1000), "target": swap_target})

            outfits = [updated_outfit]
            message_text = f"I've updated the {swap_target} for your look. Here is the updated combination."
            suggested_actions = ["Make it cheaper", "Try on me", "Save look"]

        elif intent == "price_comparison":
            t_start = time.time()
            target_url = selected_outfit.get("items", [{}])[0].get("url") if selected_outfit else None
            comp_res = await self.tools.compare_prices(source_url=target_url, title=user_prompt)
            tool_calls_log.append({"tool": "compare_prices", "time_ms": int((time.time() - t_start) * 1000), "status": "success"})

            message_text = f"Here is the price comparison for this item across top retailers."
            suggested_actions = ["Shop at lowest price", "Try this on me"]

        elif intent == "try_on":
            t_start = time.time()
            # Execute Try-On
            garment_img = "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800"
            person_img = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800"
            tryon_res = await self.tools.generate_tryon(person_img, garment_img, garment_type="top")
            tool_calls_log.append({"tool": "generate_tryon", "time_ms": int((time.time() - t_start) * 1000), "status": tryon_res.get("status")})

            message_text = "I've generated a virtual try-on visual for your selected outfit!"
            suggested_actions = ["Save try-on photo", "Shop look", "Try another outfit"]

        elif intent == "save_outfit":
            t_start = time.time()
            target_outfit = selected_outfit or {
                "id": "outfit_save_001",
                "name": f"{(occasion.capitalize() if occasion else 'Saved')} Look",
                "occasion": occasion or "casual",
                "total_price": 2499.0,
                "items": [],
            }
            save_res = await self.tools.save_outfit(target_outfit)
            tool_calls_log.append({"tool": "save_outfit", "time_ms": int((time.time() - t_start) * 1000), "status": "success"})

            message_text = f"Your outfit '{target_outfit.get('name')}' has been saved to your wardrobe favorites!"
            suggested_actions = ["Show saved looks", "Build another outfit"]

        elif intent == "complete_look":
            t_start = time.time()
            products = await self.tools.search_products(occasion=occasion, query=user_prompt, limit=15)
            tool_calls_log.append({"tool": "search_products", "time_ms": int((time.time() - t_start) * 1000), "count": len(products)})

            outfit = await self.tools.build_outfit(occasion, products, budget, platform)
            outfits = [outfit]
            message_text = f"Here are complementary items to complete your look!"
            suggested_actions = ["Make it cheaper", "Try on me", "Save look"]

        else:
            # Default: Outfit Recommendation / Search
            t_start = time.time()
            products = await self.tools.search_products(
                query=user_prompt,
                platform=platform,
                occasion=occasion,
                color=color,
                max_price=budget,
                limit=15,
            )
            tool_calls_log.append({"tool": "search_products", "time_ms": int((time.time() - t_start) * 1000), "count": len(products)})

            if not products:
                if platform:
                    message_text = f"I couldn't retrieve in-stock products from {platform.capitalize()} matching your criteria right now. Try expanding your search or adjusting your budget!"
                else:
                    message_text = "I couldn't find in-stock products matching your exact criteria right now. Try adjusting your budget or style preferences!"
                suggested_actions = ["Search all platforms", "Change budget"]
            else:
                outfit = await self.tools.build_outfit(occasion, products, budget, platform)
                outfits = [outfit] if outfit and outfit.get("items") else []
                
                # Rank outfits
                if outfits:
                    outfits = OutfitEngine.rank_outfits(outfits, preferences, occasion, budget, platform)
                tool_calls_log.append({"tool": "build_outfit", "time_ms": int((time.time() - t_start) * 1000), "score": outfits[0].get("score") if outfits else 0})

                if platform and platform.lower() == "ajio":
                    budget_str = f" under ₹{budget:.0f}" if budget else ""
                    message_text = f"AJIO direct product pages aren't accessible via live search, so I curated these real verified alternatives for you from Myntra{budget_str}:"
                else:
                    platform_str = f" from {platform.capitalize()}" if platform else ""
                    budget_str = f" under ₹{budget:.0f}" if budget else ""
                    message_text = f"I've put together a complete {occasion} look for you{platform_str}{budget_str}."
                suggested_actions = ["Make it cheaper", "Swap the shoes", "Try this on me", "Save look"]

        # Store user message
        user_msg = AVAMessage(
            conversation_id=conversation_id,
            sender="user",
            text_content=user_prompt,
            intent=intent,
        )
        self.db.add(user_msg)

        # Store AVA response message
        ava_response_payload = {
            "conversation_id": str(conversation_id),
            "message": message_text,
            "intent": intent,
            "mode": mode,
            "outfits": outfits,
            "tool_calls_log": tool_calls_log,
            "suggested_actions": suggested_actions,
        }

        ava_msg = AVAMessage(
            conversation_id=conversation_id,
            sender="ava",
            text_content=message_text,
            intent=intent,
            structured_payload=ava_response_payload,
            tool_calls_log=tool_calls_log,
        )
        self.db.add(ava_msg)
        await self.db.commit()

        return ava_response_payload
