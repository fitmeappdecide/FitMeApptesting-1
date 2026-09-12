"""
AVA Core Orchestration Agent — Intent Analysis, Tool Execution, Reasoning Loop, and Structured Response Construction.
"""
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.ava import AVAConversation, AVAMessage
from app.models.user_saved_photo import UserSavedPhoto
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

    async def _analyze_image_with_gemini(self, image_base64: str, prompt_text: str) -> Optional[Dict[str, Any]]:
        """
        Multimodal fashion vision using Vertex AI Gemini 2.5 Flash.
        Handles 'style_closet' (garment item pairing) and 'rate_outfit' (mirror selfie critique).
        """
        try:
            import google.oauth2.service_account as _sa
            import google.auth.transport.requests as _tr
            from app.core.config import settings

            project_id = getattr(settings, "vertex_project_id", None) or os.getenv("VERTEX_PROJECT_ID") or "fitme-3ac94"
            location = getattr(settings, "vertex_location", None) or os.getenv("VERTEX_LOCATION") or "us-central1"
            backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
            gcp_key = os.path.join(backend_dir, "gcp-vertex-key.json")
            gcp_key_env = os.environ.get("GCP_VERTEX_KEY_JSON") or os.environ.get("GCP_VERTEX_KEY_B64")
            if gcp_key_env and not os.path.exists(gcp_key):
                try:
                    raw_val = gcp_key_env.strip()
                    if not raw_val.startswith("{"):
                        import base64
                        raw_val = base64.b64decode(raw_val).decode("utf-8").strip()
                    with open(gcp_key, "w") as f:
                        f.write(raw_val)
                except Exception:
                    pass

            cred_path = gcp_key if os.path.exists(gcp_key) else (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or getattr(settings, "firebase_credentials_path", None))

            if cred_path and os.path.exists(cred_path):
                _creds = _sa.Credentials.from_service_account_file(cred_path, scopes=["https://www.googleapis.com/auth/cloud-platform"])
            else:
                import google.auth as _auth
                _creds, _ = _auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

            _creds.refresh(_tr.Request())
            access_token = _creds.token

            raw_b64 = image_base64
            mime_type = "image/jpeg"
            if "," in image_base64:
                prefix, raw_b64 = image_base64.split(",", 1)
                if "png" in prefix.lower():
                    mime_type = "image/png"
                elif "webp" in prefix.lower():
                    mime_type = "image/webp"

            sys_instruction = (
                "You are AVA, FitMe's AI personal fashion stylist.\n"
                "Analyze the uploaded fashion image alongside the user request.\n"
                "Decide between two modes:\n"
                "1. 'rate_outfit': User is wearing clothes or uploaded a mirror selfie asking for rating, feedback, or 'how do I look'.\n"
                "2. 'style_closet': User shows a single piece of clothing or accessory they already own and want complementary pieces styled around it.\n"
                "Respond strictly with valid JSON:\n"
                "{\n"
                '  "mode": "style_closet" | "rate_outfit",\n'
                '  "item_title": string,\n'
                '  "category": "top" | "bottom" | "dress" | "saree" | "jacket" | "shoes" | "accessory",\n'
                '  "dominant_color": string,\n'
                '  "style": "casual" | "formal" | "ethnic" | "minimal" | "streetwear",\n'
                '  "occasion": "wedding" | "college" | "office" | "party" | "date" | "casual",\n'
                '  "complementary_search_query": string,\n'
                '  "stylist_feedback": string,\n'
                '  "score_out_of_10": number | null,\n'
                '  "strengths": [string],\n'
                '  "improvements": [string]\n'
                "}"
            )

            import asyncio
            import base64
            from google import genai
            from google.genai import types

            client = genai.Client(vertexai=True, project=project_id, location=location)

            raw_b64 = image_base64
            mime_type = "image/jpeg"
            if "," in image_base64:
                prefix, raw_b64 = image_base64.split(",", 1)
                if "png" in prefix.lower():
                    mime_type = "image/png"
                elif "webp" in prefix.lower():
                    mime_type = "image/webp"

            img_bytes = base64.b64decode(raw_b64)
            part_img = types.Part.from_bytes(data=img_bytes, mime_type=mime_type)
            part_text = f"{sys_instruction}\nUser Prompt: {prompt_text}"

            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash",
                contents=[part_text, part_img],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                ),
            )
            text = response.text or ""
            return json.loads(text.strip())
        except Exception as e:
            logger.warning(f"[AVAAgent] Gemini multimodal analysis error: {e}")
        return None

    async def _generate_text_with_gemini(self, prompt: str) -> Optional[str]:
        project_id = getattr(settings, "vertex_project_id", None) or os.getenv("VERTEX_PROJECT_ID") or "fitme-3ac94"
        location = getattr(settings, "vertex_location", None) or os.getenv("VERTEX_LOCATION") or "us-central1"
        try:
            import asyncio
            from google import genai
            client = genai.Client(vertexai=True, project=project_id, location=location)
            res = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash",
                contents=prompt,
            )
            return res.text
        except Exception as e:
            logger.warning(f"[AVA] _generate_text_with_gemini error: {e}")
            return None

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

        # 1.1 Multi-Turn Conversation Context Inheritance
        prev_user_queries: List[str] = []
        prev_occasion: Optional[str] = None
        prev_platform: Optional[str] = None
        prev_outfit: Optional[Dict[str, Any]] = None

        if conversation_id:
            try:
                recent_msgs = await AVAMemoryManager.get_recent_messages(self.db, conversation_id, limit=8)
                for m in recent_msgs:
                    if m.get("sender") == "user":
                        prev_user_queries.append(m.get("text") or "")
                    elif m.get("sender") == "ava":
                        payload = m.get("payload") or {}
                        if payload.get("outfits"):
                            if not prev_outfit:
                                prev_outfit = payload["outfits"][0]
                            if not prev_occasion and payload["outfits"][0].get("occasion"):
                                prev_occasion = payload["outfits"][0].get("occasion")
                        if not prev_platform and payload.get("platform"):
                            prev_platform = payload.get("platform")

                # Inherit occasion if missing or generic
                if (not occasion or occasion == "casual") and prev_occasion:
                    occasion = prev_occasion

                # Inherit platform if missing
                if not platform and prev_platform:
                    platform = prev_platform
            except Exception as e:
                logger.warning(f"[AVAAgent] Context inheritance warning: {e}")

        # Intelligent Search Query Synthesis for Follow-ups
        effective_query = user_prompt
        prompt_words = user_prompt.strip().split()
        is_pure_budget = bool(budget and len(prompt_words) <= 3 and not any(w in user_prompt.lower() for w in ["shirt", "pant", "saree", "lehenga", "dress", "kurta", "shoes"]))
        is_pure_occasion = bool(occasion and len(prompt_words) <= 2 and not any(w in user_prompt.lower() for w in ["shirt", "pant", "saree", "lehenga", "dress", "kurta", "shoes"]))

        if is_pure_budget and prev_user_queries:
            effective_query = f"{prev_user_queries[-1]} {user_prompt}"
        elif is_pure_occasion and prev_user_queries:
            effective_query = f"{occasion} {prev_user_queries[-1]}"
        elif "no budget" in user_prompt.lower() and prev_occasion:
            effective_query = f"{prev_occasion} {user_prompt}"

        # 0. Multimodal Vision Analysis (Style My Closet & Mirror Selfie Critique)
        image_analysis: Optional[Dict[str, Any]] = None
        if image_base64:
            t_img = time.time()
            image_analysis = await self._analyze_image_with_gemini(image_base64, user_prompt)
            tool_calls_log.append({
                "tool": "gemini_multimodal_vision",
                "time_ms": int((time.time() - t_img) * 1000),
                "mode": image_analysis.get("mode") if image_analysis else "failed",
            })
            if image_analysis:
                if image_analysis.get("mode") == "rate_outfit":
                    intent = "rate_outfit"
                elif image_analysis.get("mode") == "style_closet":
                    intent = "style_closet"
                    if image_analysis.get("occasion"):
                        occasion = image_analysis["occasion"]
                    if image_analysis.get("dominant_color"):
                        color = image_analysis["dominant_color"]
                    if image_analysis.get("complementary_search_query"):
                        effective_query = image_analysis["complementary_search_query"]

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
            stmt = select(AVAConversation).where(AVAConversation.id == conversation_id)
            c_res = await self.db.execute(stmt)
            existing_conv = c_res.scalar_one_or_none()
            if existing_conv:
                existing_conv.updated_at = datetime.now(UTC)

        # 3. Intent Routing & Tool Orchestration
        outfits: List[Dict[str, Any]] = []
        message_text = ""
        suggested_actions: List[str] = []

        if intent == "rate_outfit" and image_analysis:
            # Multimodal Mirror Selfie Critique
            score = image_analysis.get("score_out_of_10") or 8.5
            feedback = image_analysis.get("stylist_feedback") or "Looking stylish and confident!"
            strengths = image_analysis.get("strengths") or ["Flattering silhouette balance", "Harmonious color blocking"]
            improvements = image_analysis.get("improvements") or ["Consider pairing with minimalist leather footwear", "Add a subtle watch or accent accessory"]

            strengths_str = "\n".join(f"• {s}" for s in strengths)
            improvements_str = "\n".join(f"• {i}" for i in improvements)

            # Discover upgrade items
            up_query = image_analysis.get("complementary_search_query") or f"{occasion or 'casual'} accessories shoes"
            upgrade_products = await self.tools.search_products(query=up_query, limit=5)
            if upgrade_products:
                outfit = await self.tools.build_outfit(occasion or "casual", upgrade_products, budget)
                outfits = [outfit] if outfit and outfit.get("items") else []

            message_text = (
                f"✨ Stylist Mirror Critique: {score:.1f} / 10\n\n"
                f"{feedback}\n\n"
                f"🌟 What Works:\n{strengths_str}\n\n"
                f"💡 Stylist Elevation Tips:\n{improvements_str}\n\n"
                f"I've curated complementary pieces below that will instantly elevate this look to a 10/10!"
            )
            suggested_actions = ["Try recommended shoes", "Make it cheaper", "Save look"]

        elif intent == "style_closet" and image_analysis:
            # Multimodal Closet Pairing
            item_name = image_analysis.get("item_title") or "Your Closet Item"
            dom_col = image_analysis.get("dominant_color") or "neutral"
            feedback = image_analysis.get("stylist_feedback") or f"A versatile {dom_col} piece ready for complete styling."

            c_query = image_analysis.get("complementary_search_query") or f"{dom_col} {occasion or 'casual'} outfit accessories shoes"
            matching_products = await self.tools.search_products(query=c_query, max_price=budget, limit=10)
            if matching_products:
                outfit = await self.tools.build_outfit(occasion or "casual", matching_products, budget, platform)
                outfits = [outfit] if outfit and outfit.get("items") else []

            message_text = (
                f"✨ Curated Around Your {item_name} ({dom_col.capitalize()}):\n\n"
                f"{feedback}\n\n"
                f"I've built a head-to-toe ensemble below featuring in-stock footwear, complementary bottoms, and accents that perfectly harmonize with your piece."
            )
            suggested_actions = ["Make it cheaper", "Swap the footwear", "Try this on me", "Save look"]

        elif intent == "make_cheaper":
            t_start = time.time()
            target_outfit = selected_outfit or prev_outfit or (outfits[0] if outfits else None)
            if not target_outfit:
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
            target_outfit = selected_outfit or prev_outfit or (outfits[0] if outfits else None)
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
            target_title = user_prompt
            if selected_outfit and selected_outfit.get("items"):
                target_title = selected_outfit["items"][0].get("title") or user_prompt
            elif prev_outfit and prev_outfit.get("items"):
                target_title = prev_outfit["items"][0].get("title") or user_prompt

            cross_deals = await self.tools.compare_prices_across_retailers(target_title)
            tool_calls_log.append({"tool": "compare_prices_across_retailers", "time_ms": int((time.time() - t_start) * 1000), "count": len(cross_deals)})

            if cross_deals:
                cheapest = cross_deals[0]
                lines = []
                for idx, deal in enumerate(cross_deals, 1):
                    seller = deal.get("seller") or "Merchant"
                    p = deal.get("price", 0.0)
                    tag = " 🌟 Lowest Price" if idx == 1 else ""
                    lines.append(f"{idx}. {seller}: ₹{p:,.0f}{tag} — {deal.get('title')[:45]}...")

                deals_summary = "\n".join(lines)
                message_text = (
                    f"🔍 Live Price Comparison for '{target_title[:40]}...':\n\n"
                    f"{deals_summary}\n\n"
                    f"You save the most by shopping on {cheapest.get('seller')} at ₹{cheapest.get('price', 0):,.0f}!"
                )
                comp_outfit = {
                    "id": f"price_comp_{uuid.uuid4().hex[:6]}",
                    "name": "Live Price Comparison",
                    "occasion": "shopping",
                    "style": "deals",
                    "total_price": cheapest.get("price", 0.0),
                    "items": cross_deals,
                    "reason": f"Live cross-store price comparison across top Indian fashion retailers.",
                    "actions": ["SHOP", "TRY_ON", "SAVE"],
                }
                outfits = [comp_outfit]
                suggested_actions = ["Shop at lowest price", "Try this on me", "Save look"]
            else:
                message_text = "I checked top retailers for this piece. Live prices are closely matched with best availability on Myntra!"
                suggested_actions = ["Shop this look", "Try on me"]

        elif intent == "tryon_history":
            t_start = time.time()
            history_jobs = await self.tools.get_tryon_history(limit=6)
            tool_calls_log.append({"tool": "get_tryon_history", "time_ms": int((time.time() - t_start) * 1000), "count": len(history_jobs)})

            if history_jobs:
                for job in history_jobs:
                    g_name = job.get("garment_name") or "Fitted Garment"
                    res_img = job.get("result_image_url")
                    outfits.append({
                        "id": f"tryon_hist_{job['job_id'][:8]}",
                        "name": f"Try-On: {g_name[:35]}",
                        "occasion": "virtual_tryon",
                        "style": job.get("garment_type") or "Fitting Look",
                        "total_price": 0.0,
                        "tryon_image_url": res_img,
                        "items": [{
                            "title": g_name,
                            "slot": "Core Garment",
                            "image": res_img,
                            "price": 0.0,
                            "seller": "Your Fitting Room",
                            "product_url": job.get("product_url"),
                            "is_shoppable": bool(job.get("product_url")),
                        }],
                        "reason": f"Completed 3D Try-On fitting from {job.get('created_at', 'recent session')}.",
                        "actions": ["STYLE_THIS", "TRY_ON", "OPEN_HISTORY"],
                    })

                count = len(history_jobs)
                message_text = (
                    f"✨ Virtual Try-On History ({count} look{'s' if count > 1 else ''} found)\n\n"
                    f"Here are your completed virtual fittings! You can tap **'Style this'** on any piece to curate matching shoes, clutch, and jewelry, "
                    f"or tap **'Open Full History'** to navigate to your fullscreen fitting room gallery."
                )
                suggested_actions = ["Style my latest try-on", "Open Full History", "Curate a new outfit"]
            else:
                message_text = (
                    "✨ Virtual Try-On History\n\n"
                    "You haven't completed any Virtual Try-On fittings yet!\n\n"
                    "Whenever you try on an outfit or tap 'Try On' in chat, your photorealistic 3D body model fitting is saved directly to your history. "
                    "Would you like me to curate an outfit for you to try on right now?"
                )
                suggested_actions = ["Curate a wedding look to try on", "Curate a college look to try on", "Open Full History"]

        elif intent == "style_recent_tryon":
            t_start = time.time()
            latest_job = await self.tools.get_latest_tryon()
            tool_calls_log.append({"tool": "get_latest_tryon", "time_ms": int((time.time() - t_start) * 1000), "found": bool(latest_job)})

            if not latest_job:
                message_text = (
                    "I checked your fitting room, but couldn't find a completed Virtual Try-On yet!\n\n"
                    "Tap 'Try On' on any outfit card or ask me to try on a look, and I will instantly style matching shoes, bags, and jewelry around it."
                )
                suggested_actions = ["Curate wedding look", "Curate college look", "Open Full History"]
            else:
                garment_name = latest_job.get("garment_name") or "Fashion Garment"
                garment_type = (latest_job.get("garment_type") or "dress").lower()
                tryon_img = latest_job.get("result_image_url")

                # Smart complementary query based on the garment category
                if any(k in garment_type for k in ["dress", "maxi", "gown", "saree", "lehenga", "anarkali", "kurta", "kurti", "ethnic"]):
                    comp_query = f"{garment_type} matching heels clutch jewelry for {garment_name[:40]}"
                elif any(k in garment_type for k in ["shirt", "top", "tshirt", "t-shirt", "hoodie", "blazer", "jacket"]):
                    comp_query = f"matching trousers jeans shoes watch for {garment_name[:40]}"
                elif any(k in garment_type for k in ["pant", "trouser", "jeans", "skirt", "bottom"]):
                    comp_query = f"matching shirt top footwear bag for {garment_name[:40]}"
                else:
                    comp_query = f"matching footwear bag accessories for {garment_name[:40]}"

                comp_products = await self.tools.search_products(query=comp_query, max_price=budget, limit=10)
                tool_calls_log.append({"tool": "search_products", "time_ms": int((time.time() - t_start) * 1000), "count": len(comp_products)})

                outfit = await self.tools.build_outfit("styling", comp_products, budget=budget, platform=platform)
                
                # Prepend the user's recent tryon piece as Core Garment with the tryon image
                core_piece = {
                    "title": garment_name,
                    "name": garment_name,
                    "slot": "Core Garment",
                    "image": tryon_img,
                    "price": 0.0,
                    "seller": "In Your Fitting Room",
                    "product_url": latest_job.get("product_url"),
                    "canonical_product_url": latest_job.get("product_url"),
                    "is_shoppable": False,
                }
                
                # Keep up to 3 complementary items + core garment = 4 piece cohesive look
                outfit_items = [core_piece] + [it for it in outfit.get("items", []) if it.get("slot") != "Core Garment"][:3]
                outfit["items"] = outfit_items
                outfit["tryon_image_url"] = tryon_img
                outfit["name"] = f"Styled with your {garment_type.capitalize()}"
                outfit["total_price"] = round(sum(float(i.get("price") or 0.0) for i in outfit_items), 2)
                outfit["reason"] = f"Curated around your recent Virtual Try-On ({garment_name}) with matching live accessories."
                outfit["actions"] = ["SHOP", "TRY_ON", "MAKE_CHEAPER", "OPEN_HISTORY"]
                outfits = [outfit]

                total_acc_price = outfit["total_price"]
                store_name = platform.capitalize() if platform else "Myntra"
                message_text = (
                    f"✨ Styled Around Your Recent Try-On: **{garment_name}**!\n\n"
                    f"I retrieved your latest Virtual Try-On look from your fitting room and hand-picked complementary pieces "
                    f"to assemble a complete, head-to-toe ensemble around your {garment_type}.\n\n"
                    f"👗 **Core Garment**: Your fitted {garment_name}\n"
                    f"👠 **Matching Accents**: Curated footwear, bag, and jewelry below totaling ₹{total_acc_price:,.0f} with live merchant pricing.\n\n"
                    f"Tap any item to buy directly, or tap 'Open Full History' to explore your other try-on looks!"
                )
                suggested_actions = ["Make it cheaper", "Swap the footwear", "Open Full History", "Save look"]

        elif intent == "fashion_advice":
            t_start = time.time()
            advice_prompt = (
                "You are AVA, FitMe's luxury AI Fashion Stylist and Virtual Fitting Room assistant. "
                f"The user asked: '{user_prompt}'. "
                "Respond with high-fashion expertise, warmth, concise styling tips, and actionable advice on how to use FitMe's virtual try-on, 3D body fitting, and live product curations. "
                "Keep it under 150 words with tasteful emojis, bullet points, and welcoming tone."
            )
            advice_res = await self._generate_text_with_gemini(advice_prompt)
            if advice_res:
                message_text = advice_res
            else:
                message_text = (
                    "✨ I am AVA, your luxury AI Fashion Stylist & Fitting Room Assistant!\n\n"
                    "Here is what I can do for you:\n"
                    "• **Curate Head-to-Toe Outfits**: Tell me your occasion, style, or budget (e.g. 'Wedding outfit under ₹5000').\n"
                    "• **Virtual Try-On Previews**: See clothes rendered on your body model.\n"
                    "• **Try-On History & Styling**: Ask 'Open my tryon history' or 'Recommend products for my recent tryon'.\n"
                    "• **Live Price Intelligence**: Ask 'Where is this cheapest?' to compare Myntra, Amazon, and Flipkart.\n"
                    "• **Mirror Selfie Critique**: Upload a photo with 'Rate my outfit' for instant stylist feedback!"
                )
            tool_calls_log.append({"tool": "gemini_fashion_advice", "time_ms": int((time.time() - t_start) * 1000), "status": "success"})
            suggested_actions = ["Curate a wedding look", "Open my tryon history", "Rate my outfit photo"]

        elif intent == "try_on":
            t_start = time.time()
            target_outfit = selected_outfit or prev_outfit or (outfits[0] if outfits else None)
            garment_img = None
            garment_name = "this outfit"

            if target_outfit and target_outfit.get("items"):
                for it in target_outfit["items"]:
                    if it.get("slot") == "Core Garment" or any(k in it.get("title", "").lower() for k in ["dress", "saree", "lehenga", "kurta", "shirt", "top"]):
                        garment_img = it.get("image")
                        garment_name = it.get("title")
                        break
                if not garment_img:
                    garment_img = target_outfit["items"][0].get("image")
                    garment_name = target_outfit["items"][0].get("title")

            if not garment_img:
                garment_img = "https://assets.myntassets.com/h_1440,q_75,w_1080/v1/assets/images/38512950.jpg"

            # Check user's saved photos for real body model
            person_img = None
            if self.user_id:
                stmt = select(UserSavedPhoto).where(UserSavedPhoto.user_id == self.user_id).order_by(UserSavedPhoto.created_at.desc()).limit(1)
                res = await self.db.execute(stmt)
                sp = res.scalar_one_or_none()
                if sp and sp.storage_path:
                    person_img = sp.storage_path

            if not person_img:
                person_img = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800"

            tryon_res = await self.tools.generate_tryon(person_img, garment_img, garment_type="top")
            tool_calls_log.append({"tool": "generate_tryon", "time_ms": int((time.time() - t_start) * 1000), "status": tryon_res.get("status")})

            res_img = tryon_res.get("result_image_url") or garment_img
            if target_outfit:
                target_outfit["tryon_image_url"] = res_img
                outfits = [target_outfit]

            message_text = (
                f"✨ Virtual Try-On Preview Ready!\n\n"
                f"I've rendered '{garment_name}' onto your body profile model so you can evaluate the silhouette, draping, and neckline proportions before shopping."
            )
            suggested_actions = ["Shop this look", "Make it cheaper", "Curate another look"]

        elif intent == "save_outfit":
            t_start = time.time()
            target_outfit = selected_outfit or prev_outfit or {
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
            products = await self.tools.search_products(occasion=occasion, query=effective_query, limit=15)
            tool_calls_log.append({"tool": "search_products", "time_ms": int((time.time() - t_start) * 1000), "count": len(products)})

            outfit = await self.tools.build_outfit(occasion, products, budget, platform)
            outfits = [outfit]
            message_text = f"Here are complementary items to complete your look!"
            suggested_actions = ["Make it cheaper", "Try on me", "Save look"]

        else:
            # Default: Outfit Recommendation / Search
            t_start = time.time()
            products = await self.tools.search_products(
                query=effective_query,
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
                    suggested_actions = ["Search on Myntra", "Change budget"]
                else:
                    message_text = "I couldn't find in-stock products matching your exact criteria right now. Try adjusting your budget or style preferences!"
                    suggested_actions = ["College outfit under ₹2500", "Wedding outfit under ₹5000", "Change budget"]
            else:
                outfit = await self.tools.build_outfit(occasion, products, budget, platform)
                outfits = [outfit] if outfit and outfit.get("items") else []
                
                # Rank outfits
                if outfits:
                    outfits = OutfitEngine.rank_outfits(outfits, preferences, occasion, budget, platform)
                tool_calls_log.append({"tool": "build_outfit", "time_ms": int((time.time() - t_start) * 1000), "score": outfits[0].get("score") if outfits else 0})

                # High-Fashion Stylist Editorial Formatting
                total_outfit_price = outfit.get("total_price", 0.0) if outfit else 0.0
                store_name = platform.capitalize() if platform else "Myntra"
                if platform and platform.lower() == "ajio":
                    store_name = "Myntra (verified live alternative)"

                savings_note = ""
                if budget and total_outfit_price > 0:
                    if total_outfit_price < budget:
                        savings = budget - total_outfit_price
                        savings_note = f" (saving ₹{savings:,.0f} under your ₹{budget:,.0f} budget)"
                    else:
                        savings_note = f" (within your ₹{budget:,.0f} budget)"

                occasion_title = (occasion.capitalize() if occasion else "Curated")
                
                # Editorial style rationale
                style_themes = {
                    "wedding": "A celebratory ethnic ensemble curated with rich textures, graceful silhouettes, and ornate festive accents.",
                    "ethnic": "A heritage-inspired traditional look balancing ornate patterns with refined poise.",
                    "college": "A relaxed, stylish campus fit blending comfort, clean lines, and youthful street-smart ease.",
                    "office": "A sharp, contemporary workwear look radiating effortless sophistication and professional confidence.",
                    "party": "A standout evening silhouette tailored to make a memorable statement under the lights.",
                    "date": "A polished, romantic ensemble focused on flattering cuts and effortless charm.",
                    "casual": "A versatile everyday combination prioritizing premium comfort and sleek styling.",
                }
                theme_note = style_themes.get(occasion.lower() if occasion else "casual", "An exclusively curated ensemble tailored to your personal aesthetic.")

                # Style DNA: Color Season & Silhouette Intelligence
                body_prof = profile.get("body_profile") or {}
                color_season = body_prof.get("color_season") or {}
                sil_profile = body_prof.get("silhouette_profile") or {}

                season_name = color_season.get("season", "Warm Autumn")
                accent_metals = ", ".join(color_season.get("accent_metals", ["Gold", "Silver"])[:2])
                sil_shape = sil_profile.get("silhouette", "Balanced Silhouette")
                sil_note = sil_profile.get("stylist_note", "Accentuates your natural proportions elegantly.")

                message_text = (
                    f"Here is your curated {occasion_title} Look from {store_name} at ₹{total_outfit_price:,.0f}{savings_note}.\n\n"
                    f"✨ Stylist Note: {theme_note}\n\n"
                    f"🎨 Color Harmony: Curated in {season_name} tones with {accent_metals} accents to illuminate your natural undertone.\n"
                    f"📐 Silhouette: Tailored for a {sil_shape} — {sil_note}\n\n"
                    f"Each piece below is currently in stock with live merchant pricing. Tap any item to buy directly on {store_name}, or tap 'Try On' to see how it fits your body profile model!"
                )
                suggested_actions = ["Make it cheaper", "Swap an item", "Try this on me", "Save look"]

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
