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
   - When the user asks for an outfit / look / what to wear for an occasion, ALWAYS call `build_curated_outfit` and pass `styles` with exactly 3 distinct outfit styles (first = your top pick). Each style needs a short name, a one-line outfit formula, a short 'why', and a product search_query that includes the retailer/budget hints the user gave.
   - For single product searches (a specific shirt, perfume, shoes), call `search_fashion_products`.
   - Never invent fake product URLs or prices. Always use the live data returned by tools.

### STYLIST VOICE & CONVERSATION FORMAT
You are AVA, FitMe's AI personal fashion stylist and image director.
Communicate with natural elegance, warmth, chic discernment, and helpful authority.

1. NATURAL & ENGAGING CONVERSATION:
   - Converse naturally and intelligently, without artificial length constraints or rigid formulas. Speak directly to the user as a real, attentive personal stylist.
   - For fashion questions, styling advice, or general conversation, provide clear, stylish, well-formatted answers using markdown (bolding, lists, and clean structure).

2. FOR SKIN TONE, COMPLEXION, & COLOR ANALYSIS:
   - If the user asks to analyze their skin tone without an attached photo, warmly explain how you can help and encourage them to upload a photo of their face or wrist using the (+) button, or ask them about their undertone tendencies (e.g. jewelry preference, reaction to the sun).
   - If a photo is provided or skin tone is discussed, provide a helpful diagnosis of their undertone (Warm, Cool, or Neutral), their Color Season (e.g. Warm Autumn, Cool Summer, Deep Winter), and prescribe their most flattering Power Colors.
   - Do NOT search for or force clothing products when the user simply asks about their skin tone.

3. FOR OUTFIT CURATION & SHOPPING REQUESTS:
   - When the user asks for outfits, looks, or specific clothing pieces, use your tools (`build_curated_outfit` or `search_fashion_products`) to find live catalog pieces.
   - Interactive visual product cards with images, prices, and try-on buttons are rendered directly below your text response. Explain your styling rationale in conversational markdown without repeating raw URLs or prices.
"""

AVA_PLANNER_PROMPT = """
You are the query planner for AVA, FitMe's AI personal fashion stylist.
Analyze the entire conversation history and the latest user request to produce a structured JSON plan.

OUTPUT JSON SCHEMA:
{
  "type": "outfit" | "product_search" | "chat",
  "occasion": "wedding" | "college" | "office" | "party" | "casual" | "date" | "festival",
  "gender": "women" | "men",
  "store": "myntra" | "ajio" | null,
  "unsupported_store": "H&M" | "Zara" | null,
  "budget": number | null,
  "styles": [
    {
      "name": "Short Style Name (e.g. Vibrant Lehenga Set, Minimal Streetwear, Classy College Look)",
      "description": "One-line outfit formula (e.g. Bright lehenga with an embellished choli and dupatta.)",
      "why": "One sentence explaining why it fits the occasion/silhouette.",
      "search_query": "concrete product search query for this style (e.g. women wedding lehenga choli)"
    }
  ],
  "product_queries": ["query 1", "query 2"]
}

RULES:
1. "type":
   - "outfit": when user asks for a look, outfit, clothing combination, what to wear for an event, or asks for skin tone / undertone / color season styling recommendations (e.g., "analyse my skin tone", "what colors look good on me", "what should I wear", "under 3000", "ethnic wedding", "something for college", "only Ajio").
     When user asks for skin tone analysis or flattering colors, set "type": "outfit" and generate 3 styles in "styles" celebrating their flattering palette (e.g. "Warm Earthy Chic", "Terracotta Evening", "Olive & Cream Minimalist") so live product cards are fetched and rendered below Ava's warm 2-sentence note!
     Always carry over previous occasion/gender/preferences from conversation history!
     If "type" is "outfit", you MUST provide exactly 3 distinct styles in "styles" (the first is the top pick).
   - "product_search": when user asks for a specific single category piece (e.g. "show me white sneakers", "perfume under 2000", "linen shirts").
     Provide 2-4 specific product search queries in "product_queries".
   - "chat": brief styling inquiries or fashion chit-chat where no clothing recommendations are needed (e.g. "what is a capsule wardrobe?", "how to tie a bow tie?").
2. "store" & "unsupported_store":
   - FitMe currently supports "myntra" and "ajio". If the user explicitly asks for "h&m", "hm", "zara", "urbanic", etc., set "unsupported_store" to that brand name (e.g. "H&M"), and set "store" to "myntra" as a graceful alternative!
   - If user asks for Myntra, set "store": "myntra". If Ajio, set "store": "ajio". If not mentioned, look at history or default to "myntra".
3. "budget":
   - Extract numeric budget in INR (₹) from current turn or previous turns (e.g. 5000, 2500). If none, null.
4. "occasion" & "gender":
   - Deduce occasion (e.g. "wedding", "college", "casual") and gender (e.g. "women", "men") from prompt or history.
5. "search_query" in styles:
   - Must be concrete fashion search queries matching the garment (e.g. "women wedding lehenga choli", "women embroidered anarkali", "men casual linen shirt").
"""

OPENAI_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "search_fashion_products",
            "description": "Search live catalogs from Myntra, AJIO, etc., for garments, dresses, perfumes, fragrances, shoes, or accessories matching queries, budget, and platform. Do NOT call this tool for skin tone, complexion, or undertone analysis queries.",
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
            "description": "Construct a complete, harmonized head-to-toe outfit from discovered items for a specific clothing occasion and budget. Do NOT call this tool for skin tone, complexion, or color analysis queries.",
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
                    },
                    "styles": {
                        "type": "array",
                        "description": "For outfit/occasion requests, provide exactly 3 distinct outfit styles. The first is your top pick.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Short style name, e.g. 'Smart casual'"},
                                "description": {"type": "string", "description": "One line outfit formula, e.g. 'Olive textured shirt + dark blue jeans + white sneakers.'"},
                                "why": {"type": "string", "description": "One short line on why it suits the user"},
                                "search_query": {"type": "string", "description": "Product search query for this style, e.g. 'men olive casual shirt'"}
                            },
                            "required": ["name", "description", "search_query"]
                        }
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
        Selects the configured OpenAI model, respecting settings.openai_model directly.
        Defaults to gpt-6-luna for high-speed, cost-efficient personal fashion intelligence.
        """
        if settings.openai_model and settings.openai_model.strip():
            return settings.openai_model.strip()
        return "gpt-6-luna"

    def _build_payload(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        max_tokens: int = 1500,
        stream: bool = False,
    ) -> Dict[str, Any]:
        """
        Constructs an OpenAI API payload tailored to the specific model architecture.
        For GPT-6 Luna / reasoning models: uses max_completion_tokens, reasoning_effort='none' with tools, and omits custom temperature.
        For GPT-4o / standard models: uses max_completion_tokens and temperature=0.7.
        """
        is_luna = "luna" in model.lower() or "gpt-6" in model.lower()
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        if stream:
            payload["stream"] = True

        if is_luna:
            payload["reasoning_effort"] = "none"
        else:
            payload["temperature"] = 0.7

        return payload

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
        if "outfits" in tool_res:
            compact["outfits"] = [
                {
                    "name": o.get("name"),
                    "description": o.get("description"),
                    "budget": f"₹{o.get('budget_min', 0):,.0f}–₹{o.get('budget_max', 0):,.0f}",
                }
                for o in tool_res["outfits"]
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
                styles = args.get("styles") or []

                # Exactly 1 single search call (consumes strictly 1 Serper credit!)
                primary_q = f"{occ} outfit"
                if isinstance(styles, list) and styles and isinstance(styles[0], dict) and styles[0].get("search_query"):
                    primary_q = styles[0]["search_query"]
                all_items = await self.tools.search_products(
                    query=primary_q,
                    occasion=occ,
                    budget=bud,
                    limit=18,
                )

                if isinstance(styles, list) and styles:
                    outfits = []
                    # Distribute items across the 3 styles in-memory without extra API calls
                    chunk_sz = max(1, len(all_items) // len(styles[:3])) if all_items else 0
                    for s_idx, st in enumerate(styles[:3]):
                        if not isinstance(st, dict):
                            continue
                        s_items = all_items[s_idx * chunk_sz : (s_idx + 1) * chunk_sz] if all_items else []
                        if not s_items and all_items:
                            s_items = all_items[:4]
                        if not s_items:
                            continue
                        o = await self.tools.build_outfit(
                            occasion=occ,
                            products=s_items,
                            budget=bud,
                            name=st.get("name"),
                            description=st.get("description"),
                            why=st.get("why"),
                            tag="My top pick" if s_idx == 0 else None,
                        )
                        if o and o.get("items"):
                            outfits.append(o)
                    if outfits:
                        return {"status": "success", "outfits": outfits}

                # Single outfit fallback using the already-fetched product pool
                outfit = await self.tools.build_outfit(occasion=occ, products=all_items[:6], budget=bud)
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

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": AVA_MASTER_FASHION_SYSTEM_PROMPT + profile_context}
        ]

        # Multi-turn history (full session context memory)
        for msg in conversation_history[-20:]:
            messages.append({"role": msg["role"], "content": msg["content"]})

        # Current user turn
        if image_base64:
            # Handle image payload
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            img_data_url = f"data:image/jpeg;base64,{image_base64}"
            raw_prompt = user_prompt or "Critique this outfit and give me styling advice."
            lower_p = raw_prompt.lower()
            if any(k in lower_p for k in ("skin", "undertone", "complexion", "color season", "palette")):
                refined_prompt = (
                    f"{raw_prompt}\n"
                    f"[Stylist Directive: Deliver a warm, flattering editorial color consultation in exactly 2 to 3 sentences (under 50 words). "
                    f"State their radiant Color Season (e.g. Warm Autumn, Deep Winter) and 3 Power Colors. "
                    f"STRICTLY FORBIDDEN: Do not write articles, blog headings, numbered checklists, or closet homework. "
                    f"NEVER say 'Explore Your Closet', 'Plan Your Next Outfit', 'Accessorize Thoughtfully', 'Shopping List', 'Finding Your Undertone', or 'Vein Test'.]"
                )
            else:
                refined_prompt = raw_prompt

            user_content = [
                {"type": "text", "text": refined_prompt},
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

        selected_model = self._select_model(image_base64)

        discovered_outfits: List[Dict[str, Any]] = []
        tool_calls_log: List[Dict[str, Any]] = []

        payload = self._build_payload(selected_model, messages, tools=OPENAI_TOOLS_SPEC, max_tokens=1500, stream=False)

        # Step 1: Initial Model Call
        resp = await self.client.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        if resp.status_code != 200:
            if selected_model != "gpt-4o":
                logger.warning(f"[AVAGPTOrchestrator] Model {selected_model} HTTP {resp.status_code}, automatically falling back to gpt-4o")
                fb_payload = self._build_payload("gpt-4o", messages, tools=OPENAI_TOOLS_SPEC, max_tokens=1500, stream=False)
                resp = await self.client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=fb_payload,
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
                elif "outfits" in tool_res and tool_res["outfits"]:
                    discovered_outfits.extend(tool_res["outfits"])
                elif "outfit" in tool_res and tool_res["outfit"]:
                    discovered_outfits.append(tool_res["outfit"])

                # Send compact tool response to LLM context (saves ~90% tokens)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": json.dumps(self._compact_tool_result(tool_res)),
                })

            # Step 3: Second call to generate final styling explanation based on tool results
            messages.append({
                "role": "system",
                "content": (
                    "The visual product cards with images, prices, and try-on buttons are automatically rendered directly below your message. "
                    "Share your expert styling advice, aesthetic rationale, and chic outfit tips naturally. "
                    "Do not repeat raw product URLs or prices in text since the interactive cards handle that directly."
                )
            })
            second_payload = self._build_payload(selected_model, messages, tools=None, max_tokens=1200, stream=False)
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
        suggested_actions = []

        return {
            "message": final_text,
            "outfits": discovered_outfits,
            "tool_calls_log": tool_calls_log,
            "suggested_actions": suggested_actions,
            "model_used": selected_model,
        }

    async def plan_reply(
        self,
        user_prompt: str,
        conversation_history: List[Dict[str, str]],
    ) -> Optional[Dict[str, Any]]:
        """
        Step 1 of the unified pipeline: classify the request and (for shopping requests)
        plan the 3 outfit styles / product queries as strict JSON. Returns None on any failure
        so the caller can fall back to the legacy tool-calling path.
        """
        hist = "\n".join(
            f"{m.get('role', 'user')}: {(m.get('content') or '')[:400]}" for m in conversation_history[-6:]
        )
        body = {
            "model": self._select_model(None),
            "messages": [
                {"role": "system", "content": AVA_PLANNER_PROMPT},
                {"role": "user", "content": f"Conversation so far:\n{hist or '(none)'}\n\nLatest user message: {user_prompt}"},
            ],
            "temperature": 0.3,
            "max_tokens": 700,
            "response_format": {"type": "json_object"},
        }
        try:
            resp = await self.client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=body,
                timeout=30.0,
            )
            if resp.status_code != 200 and body.get("model") != "gpt-4o":
                logger.info(f"[AVAGPTOrchestrator] Planner model {body.get('model')} HTTP {resp.status_code}, falling back to gpt-4o")
                body["model"] = "gpt-4o"
                resp = await self.client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json=body,
                    timeout=30.0,
                )
            if resp.status_code != 200:
                logger.warning(f"[AVAGPTOrchestrator] Planner HTTP {resp.status_code}")
                return None
            plan = json.loads(resp.json()["choices"][0]["message"]["content"])
            return plan if isinstance(plan, dict) else None
        except Exception as e:
            logger.warning(f"[AVAGPTOrchestrator] Planner failed, using legacy path: {e}")
            return None

    async def _stream_text(
        self,
        messages: List[Dict[str, Any]],
        headers: Dict[str, str],
        model: str,
        max_tokens: int = 300,
    ) -> AsyncGenerator[str, None]:
        """Stream plain assistant text tokens (no tools)."""
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.7,
            "stream": True,
            "max_tokens": max_tokens,
        }
        async with self.client.stream(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=60.0,
        ) as response:
            if response.status_code != 200:
                if model != "gpt-4o":
                    logger.info(f"[AVAGPTOrchestrator] Stream model {model} HTTP {response.status_code}, falling back to gpt-4o")
                    fallback_payload = dict(payload, model="gpt-4o")
                    async with self.client.stream(
                        "POST",
                        "https://api.openai.com/v1/chat/completions",
                        headers=headers,
                        json=fallback_payload,
                        timeout=60.0,
                    ) as fb_resp:
                        if fb_resp.status_code == 200:
                            async for line in fb_resp.aiter_lines():
                                if not line or not line.startswith("data: "):
                                    continue
                                raw = line[len("data: "):].strip()
                                if raw == "[DONE]":
                                    break
                                try:
                                    delta = json.loads(raw)["choices"][0].get("delta", {})
                                    if delta.get("content"):
                                        yield delta["content"]
                                except Exception:
                                    pass
                return
            async for line in response.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                raw = line[len("data: "):].strip()
                if raw == "[DONE]":
                    break
                try:
                    delta = json.loads(raw)["choices"][0].get("delta", {})
                    if delta.get("content"):
                        yield delta["content"]
                except Exception:
                    pass

    async def _run_planned_reply(
        self,
        plan: Dict[str, Any],
        messages: List[Dict[str, Any]],
        headers: Dict[str, str],
        model: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Step 2: execute the plan deterministically, emit outfit events, then stream a short intro."""
        reply_type = plan.get("type")
        occasion = (plan.get("occasion") or "casual").strip().lower()
        budget = plan.get("budget")
        try:
            budget = float(budget) if budget else None
        except (TypeError, ValueError):
            budget = None

        store = (plan.get("store") or "").strip().lower() or None
        unsupported = (plan.get("unsupported_store") or "").strip() or None
        if store not in ("myntra", "ajio"):
            store = None
        store_label = store.capitalize() if store else "Myntra"

        yield {"event": "status", "data": {"status": "Curating looks from live fashion catalogs..."}}

        outfits: List[Dict[str, Any]] = []
        if reply_type == "outfit":
            for idx, st in enumerate((plan.get("styles") or [])[:3]):
                if not isinstance(st, dict):
                    continue
                items = await self.tools.search_products(
                    query=st.get("search_query") or f"{occasion} {st.get('name', '')}",
                    platform=store,
                    occasion=occasion,
                    budget=budget,
                    max_price=budget,
                    limit=6,
                )
                if not items:
                    continue
                o = await self.tools.build_outfit(
                    occasion=occasion,
                    products=items,
                    budget=budget,
                    name=st.get("name"),
                    description=st.get("description"),
                    why=st.get("why"),
                    tag="My top pick" if idx == 0 else None,
                )
                if o and o.get("items"):
                    o["kind"] = "style"
                    outfits.append(o)
        else:  # product_search
            for idx, pq in enumerate((plan.get("product_queries") or [])[:4]):
                if not isinstance(pq, str) or not pq.strip():
                    continue
                items = await self.tools.search_products(
                    query=pq,
                    platform=store,
                    occasion=occasion,
                    budget=budget,
                    max_price=budget,
                    limit=3,
                )
                if not items:
                    continue
                p = items[0]
                price = float(p.get("price") or 0)
                outfits.append({
                    "id": f"prod_{uuid.uuid4().hex[:6]}",
                    "name": p.get("title") or pq,
                    "occasion": occasion,
                    "style": "product",
                    "kind": "product",
                    "items": [p],
                    "total_price": price,
                    "description": f"{p.get('seller') or store_label} · {p.get('slot') or 'Pick'}",
                    "tag": "My top pick" if idx == 0 else None,
                    "budget_min": round(price),
                    "budget_max": round(price),
                    "actions": ["TRY_ON", "SHOP", "SAVE", "MAKE_CHEAPER", "SWAP"],
                })

        for o in outfits:
            yield {"event": "outfit", "data": {"outfit": o}}

        # Authentic stylist consultation, streamed
        notes = []
        if unsupported:
            notes.append(
                f"The user asked for {unsupported}, which AVA does not support yet. State this clearly in ONE polite sentence, "
                f"then say you are showing options from {store_label} instead."
            )
        if outfits and reply_type == "outfit":
            names = ", ".join(o.get("name", "") for o in outfits)
            notes.append(
                f"CRITICAL LUXURY EDITORIAL STYLIST INSTRUCTION:\n"
                f"The mobile app will display interactive visual lookbook cards for these {len(outfits)} styles ({names}) from {store_label}"
                f"{f' within ₹{budget:,.0f}' if budget else ''} directly below your response.\n"
                "- KEEP YOUR TEXT RESPONSE CONCISE, ELEGANT, AND REFINED (2 to 3 sentences maximum, like a Net-a-Porter or Vogue personal stylist).\n"
                "- DO NOT write separate paragraphs for each outfit, and DO NOT write 'Aesthetic Rationale:', 'Styling Tip:', or 'Color Harmony:' in text, because the visual look cards below already present each look, formula, and garment!\n"
                "- Structure your concise reply in two clean parts:\n"
                "  1. A warm, chic 1-2 sentence introduction acknowledging the occasion, styling direction, and store/budget (bold store and budget with **).\n"
                "  2. A brief 1-sentence closing note inviting the user to refine or explore (e.g., 'Let me know if you would like to adjust the color palette, explore alternative footwear, or try any look on your 3D avatar!').\n"
                "- NEVER duplicate outfit names, price breakdowns, or long bullet lists in text."
            )
        elif outfits:
            notes.append(
                f"The app is rendering visual cards for these pieces from {store_label} directly below. "
                "Write a warm, concise stylist introduction explaining why these pieces fit the user's request. "
                "Do not repeat product links or raw prices in text."
            )
        else:
            notes.append(
                "No products could be found. Apologise briefly in one sentence and ask one clarifying question."
            )

        stream_messages = list(messages) + [{"role": "system", "content": " ".join(notes)}]
        full_text: List[str] = []
        try:
            async for tok in self._stream_text(stream_messages, headers, model, max_tokens=1000):
                full_text.append(tok)
                yield {"event": "token", "data": {"chunk": tok}}
        except Exception as e:
            logger.debug(f"[AVAGPTOrchestrator] Planned intro stream error: {e}")

        actions = []
        yield {
            "event": "done",
            "data": {
                "message": "".join(full_text),
                "outfits": outfits,
                "suggested_actions": actions,
                "model_used": model,
            },
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

        payload = self._build_payload(selected_model, messages, tools=OPENAI_TOOLS_SPEC, max_tokens=1500, stream=True)

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
                    if selected_model != "gpt-4o":
                        logger.info(f"[AVAGPTOrchestrator] stream_chat model {selected_model} HTTP {response.status_code}, falling back to gpt-4o")
                        fb_payload = self._build_payload("gpt-4o", messages, tools=OPENAI_TOOLS_SPEC, max_tokens=1500, stream=False)
                        fb_response = await self.client.post(
                            "https://api.openai.com/v1/chat/completions",
                            headers=headers,
                            json=fb_payload,
                            timeout=60.0
                        )
                        if fb_response.status_code == 200:
                            fb_data = fb_response.json()
                            msg_content = fb_data["choices"][0]["message"].get("content", "")
                            yield {"event": "token", "data": {"chunk": msg_content}}
                            yield {"event": "done", "data": {"message": msg_content, "outfits": [], "suggested_actions": [], "model_used": "gpt-4o"}}
                            return
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
                    elif "outfits" in tool_res and tool_res["outfits"]:
                        for st_outfit in tool_res["outfits"]:
                            discovered_outfits.append(st_outfit)
                            yield {
                                "event": "outfit",
                                "data": {"outfit": st_outfit}
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
                messages.append({
                    "role": "system",
                    "content": (
                        "The visual product cards with images, prices, and links are automatically rendered directly below your message. "
                        "As an expert personal stylist, write a chic, personalized consultation: explain the aesthetic rationale, "
                        "mention the user's budget and store naturally (bold with **), and provide 1-2 pro styling or color harmony tips for the occasion. "
                        "Do not list raw product names, prices, or shop links in text, as the interactive cards handle that directly."
                    )
                })

                second_payload = self._build_payload(selected_model, messages, tools=None, max_tokens=1200, stream=True)
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
                    "suggested_actions": [],
                    "model_used": selected_model,
                }
            }

        except Exception as stream_err:
            logger.error(f"[AVAGPTOrchestrator] Stream error: {stream_err}", exc_info=True)
            yield {
                "event": "error",
                "data": {"detail": str(stream_err)}
            }
