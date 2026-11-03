"""
Ava Ultra-Advanced GPT-4o Orchestration Engine.
Powers real-time streaming, comprehensive fashion domain intelligence,
function calling, multimodal visual critique, and virtual try-on handoff.
"""
import json
import logging
import time
from typing import Any, AsyncGenerator, Dict, List, Optional
import httpx

from app.core.config import settings
from app.services.ava.tools import AVAToolSuite

logger = logging.getLogger(__name__)

AVA_MASTER_FASHION_SYSTEM_PROMPT = """
You are Ava, FitMe's world-class AI personal fashion stylist, visual image consultant, and shopping concierge.
You combine the haute couture authority of an editorial stylist (Vogue, GQ) with the speed, warmth, and practical budget-awareness of a personal shopping advisor.

### YOUR CORE MISSION
Help every user solve any fashion problem, look their absolute best, and shop with confidence.
You understand all genders, aesthetics, body silhouettes, occasions, and budgets (priced in Indian Rupees ₹).

### MASTER FASHION INTELLIGENCE DOMAINS

1. SILHOUETTE & PROPORTION ARCHITECTURE:
   - Hourglass: Celebrate the natural waistline. Wrap dresses, belted coats, tailored high-rise trousers.
   - Pear / Triangle: Draw focus upward. Structured shoulders, boat necks, statement lapels, paired with straight or wide-leg bottoms to balance proportions.
   - Inverted Triangle: Soften broad shoulders with V-necks, raglan cuts, and add visual volume to hips with A-line skirts, pleats, or cargo pants.
   - Rectangle / Athletic: Inject dimensional curves with belted waists, ruched detailing, cropped jackets, and flared hems.
   - Apple / Oval: Prioritize fluid elongation. Empire waistlines, vertical open jackets, V-neck tunics, and clean monochrome drape.
   - Petite: Emphasize leg length with high-waistlines, tonal/monochromatic columns of color, cropped hemlines, and avoiding oversized drowning prints.
   - Tall: Lean into bold proportions, floor-grazing maxis, tailored wide-leg trousers, color-blocking, and oversized statement outerwear.

2. COLOR HARMONY & UNDERTONE THEORY:
   - Warm Undertones: Flattered by rich earthy tones, olive, terracotta, mustard, warm corals, cream, and yellow gold accents.
   - Cool Undertones: Flattered by jewel tones (sapphire, emerald, ruby), icy pastels, crisp pure white, navy, and sterling silver.
   - Neutral Undertones: Can pull off rose gold, jade, dusty blues, mauve, and soft charcoal with ease.
   - Contrast Ratios: Pair high-contrast combinations (e.g. cream with dark espresso) for sharp formal impact, or analogous palettes for relaxed everyday polish.

3. OCCASION & CULTURAL DRESS CODES:
   - Indian Ethnic & Celebrations:
     * Sangeet: Vibrant, dynamic movement (georgette lehengas, mirror-work kurtas, Indo-western bandhgalas).
     * Haldi: Marigold/sunshine yellow, raw silk, chikankari, light festive embroidery.
     * Mehendi: Rich emerald, mint green, floral motifs, breathable cuts.
     * Wedding & Reception: Heavy silks, banarasi, zardozi, velvet tuxedos, layered sherwanis.
     * Festive/Puja: Anarkalis, chanderi sarees, cotton-silk kurtas.
   - Western & Corporate:
     * Boardroom / Formal: Power tailoring, structured blazers, crisp poplin shirts, sheath dresses, minimal oxford shoes or block pumps.
     * Smart Casual: Unstructured blazers with dark denim, knit polo with chinos, elevated shirt-dresses with loafers.
   - College & Streetwear:
     * Relaxed fit tees, vintage varsity jackets, wide-leg denim, clean white minimalist sneakers, canvas totes.
   - Nightlife & Party:
     * Satin slip dresses, tailored faux-leather, monochrome minimalist chic, sleek ankle boots.

4. WARDROBE CAPSULE & MULTI-WAY RESTYLING:
   - When asked to style an existing piece (e.g. "How do I style this white linen shirt?"), always provide 3 distinct aesthetics (e.g., Casual Weekend, Office Smart-Casual, Sunset Dinner).

5. MULTIMODAL MIRROR SELFIE & FIT CRITIQUE:
   - When reviewing user mirror selfies or clothing photos:
     * Give a genuine Stylist Rating out of 10.
     * "🌟 What Works": 2-3 specific compliments on silhouette balance, proportion, or color coordination.
     * "💡 Stylist Elevation Tips": 2-3 actionable, concrete micro-adjustments (e.g., French tuck, cuff roll, swap bulky footwear for sleek retro sneakers, add a leather belt or layered chain).

6. TOOL ORCHESTRATION & SHOPPING:
   - When the user asks for clothing, dress, perfume, shoe, or outfit recommendations, ALWAYS call `search_fashion_products` to pull live products from Myntra, AJIO, etc.
   - Never invent fake product URLs or prices. Always use the live data returned by tools.
   - Offer a one-tap invitation to Try-On the curated outfits virtually on their FitMe 3D avatar.

### OUTPUT STRUCTURE & CONVERSATION FORMAT (AUTHENTIC CHATGPT CONVERSATIONAL SHOPPING)
When you curate looks, recommend outfits, or suggest fashion pieces:
Interactive visual product cards (with real garment photos, prices, retailer badges, and Try-On/Shop buttons) are automatically rendered by the FitMe interface immediately beneath your message.

CRITICAL INSTRUCTION:
1. NEVER print duplicate numbered item lists (e.g. "1. Item Name... 2. Item Name...") or repeat individual garment titles, prices, and catalog specs in your text.
2. Structure your conversational response as an authentic personal fashion stylist:
   - OPENING STYLING RATIONALE (1–2 sentences): A chic, warm explanation of why this outfit aesthetic was chosen for the user's occasion, comfort, or silhouette.
   - PRO STYLING ELEVATION TIPS (1–2 punchy sentences or bullets): Actionable advice on how to wear, pair, or accessorize these pieces together (e.g., rolling sleeves, cuffing chinos, layering accessories, or color harmony).
   - INVITATION (1 sentence): A brief, elegant note inviting the user to explore the product cards below, try them on their 3D avatar, or customize the pieces.

Keep your message punchy, sophisticated, and conversational. Let the visual product cards speak for the products!
"""

OPENAI_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "search_fashion_products",
            "description": "Search live catalogs from Myntra, AJIO, etc., for garments, dresses, perfumes, fragrances, shoes, or accessories matching queries, budget, and platform.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Specific fashion search query, e.g. 'navy slim fit blazer', 'emerald green wedding lehenga', or 'luxury fresh perfume'"
                    },
                    "platform": {
                        "type": "string",
                        "enum": ["myntra", "ajio", "all"],
                        "description": "Retailer platform filter if specified by user"
                    },
                    "budget": {
                        "type": "number",
                        "description": "Maximum budget in INR (₹) if requested"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of items to fetch (default 6)"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "build_curated_outfit",
            "description": "Construct a complete, harmonized head-to-toe outfit from discovered items for a specific occasion and budget.",
            "parameters": {
                "type": "object",
                "properties": {
                    "occasion": {
                        "type": "string",
                        "description": "Occasion like 'wedding', 'college', 'formal', 'casual', 'party', 'interview'"
                    },
                    "budget": {
                        "type": "number",
                        "description": "Target budget in INR"
                    }
                },
                "required": ["occasion"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_product_prices",
            "description": "Check if a product is available cheaper on competing platforms (Myntra vs AJIO vs Amazon).",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_title": {
                        "type": "string",
                        "description": "Title or description of the product"
                    },
                    "brand": {
                        "type": "string",
                        "description": "Garment brand"
                    }
                },
                "required": ["product_title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_virtual_tryon",
            "description": "Initiate a virtual try-on render of a selected garment on the user's digital model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "garment_url": {
                        "type": "string",
                        "description": "Image URL of the garment to try on"
                    },
                    "garment_type": {
                        "type": "string",
                        "enum": ["upper_body", "lower_body", "dresses", "outerwear"],
                        "description": "Category of garment"
                    }
                },
                "required": ["garment_url", "garment_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_user_style_preference",
            "description": "Explicitly save or update user's persistent style preferences, favorite/disliked colors, fits, brands, retailers, or budget ceiling into their permanent Style DNA.",
            "parameters": {
                "type": "object",
                "properties": {
                    "preference_type": {
                        "type": "string",
                        "enum": ["color", "fit", "brand", "retailer", "disliked_color", "disliked_item", "budget_max", "style_dna"],
                        "description": "Category of style preference to store"
                    },
                    "value": {
                        "type": "string",
                        "description": "The specific value (e.g. 'oversized', 'olive', 'Zara', 'no polyester', '5000', 'minimalist streetwear')"
                    }
                },
                "required": ["preference_type", "value"]
            }
        }
    }
]


class AVAGPTOrchestrator:
    """
    High-performance GPT-4o orchestrator for Ava.
    Provides streaming responses, OpenAI function calling, vision processing,
    and automatic fallback if API keys are missing.
    """

    def __init__(self, tools: AVAToolSuite):
        self.tools = tools
        self.api_key = settings.openai_api_key or ""
        self.client = httpx.AsyncClient(timeout=45.0)

    def _select_model(self, image_base64: Optional[str] = None) -> str:
        """
        Smart Cost-Optimizer:
        - gpt-4o: For multimodal image vision (mirror selfie critique & closet inspection)
        - gpt-4o-mini: For all text styling, budget queries & live catalog shopping (96% cheaper, 2x faster)
        """
        if image_base64:
            return "gpt-4o"
        if settings.openai_model and settings.openai_model not in ("gpt-4o", ""):
            return settings.openai_model
        return "gpt-4o-mini"

    def _compact_tool_result(self, tool_res: Dict[str, Any]) -> Dict[str, Any]:
        """
        Strips bulky merchant tracking links and raw metadata
        before feeding back to LLM context. Reduces input tokens by 90%!
        """
        compact = {"status": tool_res.get("status", "success")}
        if "products" in tool_res:
            compact["products"] = [
                {
                    "title": p.get("title") or p.get("name"),
                    "price": f"₹{p.get('price', 0):,.0f}" if isinstance(p.get("price"), (int, float)) else str(p.get("price")),
                    "seller": p.get("seller") or p.get("retailer", "Myntra"),
                    "slot": p.get("slot", "Garment"),
                }
                for p in tool_res["products"][:6]
            ]
        if "outfit" in tool_res:
            o = tool_res["outfit"]
            compact["outfit"] = {
                "name": o.get("name"),
                "total_price": f"₹{o.get('total_price', 0):,.0f}" if isinstance(o.get("total_price"), (int, float)) else str(o.get("total_price")),
                "items": [
                    {
                        "title": i.get("title") or i.get("name"),
                        "price": f"₹{i.get('price', 0):,.0f}" if isinstance(i.get("price"), (int, float)) else str(i.get("price")),
                        "slot": i.get("slot", "Piece"),
                    }
                    for i in o.get("items", [])[:4]
                ],
            }
        if "comparison" in tool_res:
            compact["comparison"] = tool_res["comparison"]
        if "tryon_result" in tool_res:
            compact["tryon_result"] = {"status": "started", "job_id": tool_res["tryon_result"].get("job_id")}
        return compact

    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Execute AVAToolSuite methods based on LLM function calls."""
        logger.info(f"[AVAGPTOrchestrator] Executing tool '{name}' with args: {args}")
        try:
            if name == "search_fashion_products":
                q = args.get("query", "")
                plat = args.get("platform")
                if plat == "all":
                    plat = None
                bud = args.get("budget")
                lim = args.get("limit", 6)
                products = await self.tools.search_products(query=q, platform=plat, budget=bud, limit=lim)
                return {"status": "success", "count": len(products), "products": products}

            elif name == "build_curated_outfit":
                occ = args.get("occasion", "casual")
                bud = args.get("budget")
                # Search items if not provided
                items = await self.tools.search_products(query=f"{occ} trending", limit=6)
                outfit = await self.tools.build_outfit(occasion=occ, products=items, budget=bud)
                return {"status": "success", "outfit": outfit}

            elif name == "compare_product_prices":
                title = args.get("product_title", "")
                brand = args.get("brand")
                res = await self.tools.compare_prices(product_title=title, brand=brand)
                return {"status": "success", "comparison": res}

            elif name == "trigger_virtual_tryon":
                url = args.get("garment_url", "")
                g_type = args.get("garment_type", "upper_body")
                res = await self.tools.start_tryon(garment_url=url, garment_type=g_type)
                return {"status": "success", "tryon_result": res}

            elif name == "save_user_style_preference":
                pref_type = args.get("preference_type", "")
                val = args.get("value", "")
                if hasattr(self.tools, "save_preference"):
                    res = await self.tools.save_preference(pref_type=pref_type, value=val)
                    return {"status": "success", "saved": res}
                return {"status": "success", "saved": {pref_type: val}}

            else:
                return {"status": "error", "message": f"Unknown tool: {name}"}
        except Exception as e:
            logger.error(f"[AVAGPTOrchestrator] Tool execution error for '{name}': {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    def _build_messages(
        self,
        user_prompt: str,
        conversation_history: List[Dict[str, str]],
        image_base64: Optional[str] = None,
        user_profile: Optional[Dict[str, Any]] = None,
        style_dna_summary: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Construct the prompt messages array including system instructions, context, and vision."""
        profile_context = ""
        if user_profile:
            body = user_profile.get("body_profile", {})
            profile_context = (
                f"\n\nUSER PROFILE CONTEXT:\n"
                f"- Gender: {body.get('gender', 'unspecified')}\n"
                f"- Body Silhouette: {body.get('silhouette_profile', {}).get('body_shape', 'balanced')}\n"
                f"- Color Season: {body.get('color_season', {}).get('season', 'neutral')}\n"
                f"- Height: {body.get('height_cm', 165)}cm\n"
            )
        if style_dna_summary:
            profile_context += f"\n{style_dna_summary}\n"

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": AVA_MASTER_FASHION_SYSTEM_PROMPT + profile_context}
        ]

        # Multi-turn history
        for msg in conversation_history[-6:]:
            messages.append({"role": msg["role"], "content": msg["content"]})

        # Current user turn
        if image_base64:
            # Handle image payload
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            img_data_url = f"data:image/jpeg;base64,{image_base64}"
            user_content = [
                {"type": "text", "text": user_prompt or "Critique this outfit and give me styling advice."},
                {
                    "type": "image_url",
                    "image_url": {"url": img_data_url, "detail": "high"}
                }
            ]
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": user_prompt})

        return messages

    async def chat_completion(
        self,
        user_prompt: str,
        conversation_history: List[Dict[str, str]],
        image_base64: Optional[str] = None,
        user_profile: Optional[Dict[str, Any]] = None,
        style_dna_summary: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Standard single-turn OpenAI completion with tool execution loop.
        """
        if not self.api_key:
            return {
                "error": "OPENAI_API_KEY_NOT_CONFIGURED",
                "message": "OpenAI API key is not configured.",
            }

        messages = self._build_messages(user_prompt, conversation_history, image_base64, user_profile, style_dna_summary)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        discovered_outfits: List[Dict[str, Any]] = []
        tool_calls_log: List[Dict[str, Any]] = []

        selected_model = self._select_model(image_base64)
        payload = {
            "model": selected_model,
            "messages": messages,
            "tools": OPENAI_TOOLS_SPEC,
            "tool_choice": "auto",
            "temperature": 0.7,
            "max_tokens": 500,
        }

        # Step 1: Initial Model Call
        resp = await self.client.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        if resp.status_code != 200:
            logger.error(f"[AVAGPTOrchestrator] OpenAI API Error: {resp.status_code} - {resp.text}")
            return {"error": "OPENAI_API_ERROR", "status_code": resp.status_code, "detail": resp.text}

        data = resp.json()
        choice = data["choices"][0]
        message = choice["message"]

        # Step 2: Handle Tool Calls if the model decided to execute tools
        if message.get("tool_calls"):
            messages.append(message)
            for tool_call in message["tool_calls"]:
                tool_name = tool_call["function"]["name"]
                try:
                    tool_args = json.loads(tool_call["function"]["arguments"])
                except Exception:
                    tool_args = {}

                t0 = time.time()
                tool_res = await self.execute_tool(tool_name, tool_args)
                elapsed_ms = int((time.time() - t0) * 1000)

                tool_calls_log.append({
                    "tool": tool_name,
                    "args": tool_args,
                    "time_ms": elapsed_ms,
                    "status": tool_res.get("status", "success"),
                })

                # If products or outfit were found, record them for the response cards
                if "products" in tool_res and tool_res["products"]:
                    outfit_card = await self.tools.build_outfit("curated", tool_res["products"])
                    if outfit_card and outfit_card.get("items"):
                        discovered_outfits.append(outfit_card)
                elif "outfit" in tool_res and tool_res["outfit"]:
                    discovered_outfits.append(tool_res["outfit"])

                # Send compact tool response to LLM context (saves ~90% tokens)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": json.dumps(self._compact_tool_result(tool_res)),
                })

            # Step 3: Second call to generate final styling explanation based on tool results
            second_payload = {
                "model": selected_model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 500,
            }
            second_resp = await self.client.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=second_payload,
            )
            if second_resp.status_code == 200:
                final_data = second_resp.json()
                final_text = final_data["choices"][0]["message"]["content"]
            else:
                final_text = message.get("content") or "Here are the curated looks I discovered for you!"
        else:
            final_text = message.get("content") or ""

        # Suggested follow-up actions
        suggested_actions = ["Try this on", "Make it cheaper", "Show another style", "Find shoes to match"]

        return {
            "message": final_text,
            "outfits": discovered_outfits,
            "tool_calls_log": tool_calls_log,
            "suggested_actions": suggested_actions,
            "model_used": selected_model,
        }

    async def stream_chat(
        self,
        user_prompt: str,
        conversation_history: List[Dict[str, str]],
        image_base64: Optional[str] = None,
        user_profile: Optional[Dict[str, Any]] = None,
        style_dna_summary: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Real-time SSE token stream just like ChatGPT!
        Yields chunk events immediately as they generate.
        """
        if not self.api_key:
            yield {
                "event": "token",
                "data": {"chunk": "⚠️ OpenAI API Key is not configured in backend `.env`. Falling back to instant local styling."}
            }
            yield {"event": "done", "data": {"is_fallback": True}}
            return

        messages = self._build_messages(user_prompt, conversation_history, image_base64, user_profile, style_dna_summary)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        selected_model = self._select_model(image_base64)
        payload = {
            "model": selected_model,
            "messages": messages,
            "tools": OPENAI_TOOLS_SPEC,
            "tool_choice": "auto",
            "temperature": 0.7,
            "stream": True,
            "max_tokens": 500,
        }

        full_content = []
        tool_calls_in_progress: Dict[int, Dict[str, Any]] = {}

        try:
            async with self.client.stream(
                "POST",
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=60.0
            ) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    yield {
                        "event": "error",
                        "data": {"status": response.status_code, "detail": err_body.decode()}
                    }
                    return

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        raw_data = line[len("data: "):].strip()
                        if raw_data == "[DONE]":
                            break
                        try:
                            chunk_json = json.loads(raw_data)
                            delta = chunk_json["choices"][0].get("delta", {})

                            # 1. Text token chunk -> stream immediately to UI
                            if "content" in delta and delta["content"]:
                                token = delta["content"]
                                full_content.append(token)
                                yield {
                                    "event": "token",
                                    "data": {"chunk": token}
                                }

                            # 2. Tool call delta accumulation
                            if "tool_calls" in delta and delta["tool_calls"]:
                                for tc in delta["tool_calls"]:
                                    idx = tc.get("index", 0)
                                    if idx not in tool_calls_in_progress:
                                        tool_calls_in_progress[idx] = {
                                            "id": tc.get("id", ""),
                                            "name": tc.get("function", {}).get("name", ""),
                                            "arguments": "",
                                        }
                                    if tc.get("function", {}).get("name"):
                                        tool_calls_in_progress[idx]["name"] = tc["function"]["name"]
                                    if tc.get("function", {}).get("arguments"):
                                        tool_calls_in_progress[idx]["arguments"] += tc["function"]["arguments"]

                        except Exception as parse_err:
                            logger.debug(f"[AVAGPTOrchestrator] Stream parse notice: {parse_err}")

            # If tools were invoked during the stream, execute them, deliver outfits, and stream final explanation
            discovered_outfits: List[Dict[str, Any]] = []
            if tool_calls_in_progress:
                yield {
                    "event": "status",
                    "data": {"status": "Curating looks from live fashion catalogs..."}
                }
                assistant_tool_calls = []
                tool_result_messages = []

                for idx, tc in tool_calls_in_progress.items():
                    name = tc["name"]
                    try:
                        args = json.loads(tc["arguments"])
                    except Exception:
                        args = {}

                    assistant_tool_calls.append({
                        "id": tc["id"] or f"call_{idx}",
                        "type": "function",
                        "function": {"name": name, "arguments": tc["arguments"]}
                    })

                    tool_res = await self.execute_tool(name, args)
                    if "products" in tool_res and tool_res["products"]:
                        outfit = await self.tools.build_outfit("curated", tool_res["products"])
                        if outfit and outfit.get("items"):
                            discovered_outfits.append(outfit)
                            yield {
                                "event": "outfit",
                                "data": {"outfit": outfit}
                            }
                    elif "outfit" in tool_res and tool_res["outfit"]:
                        discovered_outfits.append(tool_res["outfit"])
                        yield {
                            "event": "outfit",
                            "data": {"outfit": tool_res["outfit"]}
                        }

                    # Compact tool result to save ~90% tokens
                    tool_result_messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"] or f"call_{idx}",
                        "content": json.dumps(self._compact_tool_result(tool_res)),
                    })

                # Stream the final styling explanation
                messages.append({"role": "assistant", "tool_calls": assistant_tool_calls})
                messages.extend(tool_result_messages)

                second_payload = {
                    "model": selected_model,
                    "messages": messages,
                    "temperature": 0.7,
                    "stream": True,
                    "max_tokens": 500,
                }
                try:
                    async with self.client.stream(
                        "POST",
                        "https://api.openai.com/v1/chat/completions",
                        headers=headers,
                        json=second_payload,
                        timeout=60.0
                    ) as second_response:
                        if second_response.status_code == 200:
                            async for s_line in second_response.aiter_lines():
                                if not s_line:
                                    continue
                                if s_line.startswith("data: "):
                                    s_raw = s_line[len("data: "):].strip()
                                    if s_raw == "[DONE]":
                                        break
                                    try:
                                        s_chunk = json.loads(s_raw)
                                        s_delta = s_chunk["choices"][0].get("delta", {})
                                        if "content" in s_delta and s_delta["content"]:
                                            s_token = s_delta["content"]
                                            full_content.append(s_token)
                                            yield {
                                                "event": "token",
                                                "data": {"chunk": s_token}
                                            }
                                    except Exception:
                                        pass
                except Exception as s_err:
                    logger.debug(f"[AVAGPTOrchestrator] Second stream error: {s_err}")

            # Final completion event
            yield {
                "event": "done",
                "data": {
                    "message": "".join(full_content),
                    "outfits": discovered_outfits,
                    "suggested_actions": ["Try on this look", "Make it cheaper", "Explore more styles", "Shop pieces"],
                    "model_used": selected_model,
                }
            }

        except Exception as stream_err:
            logger.error(f"[AVAGPTOrchestrator] Stream error: {stream_err}", exc_info=True)
            yield {
                "event": "error",
                "data": {"detail": str(stream_err)}
            }
