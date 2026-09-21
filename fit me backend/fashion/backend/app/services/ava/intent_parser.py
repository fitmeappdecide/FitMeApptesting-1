"""
AVA Intent Parser — High-Precision Deterministic Natural Language Understanding.
Fast deterministic regex & keyword parser with zero cloud latency and zero external LLM dependencies.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class AVAIntentParser:
    @staticmethod
    def parse(user_prompt: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        # Fast deterministic NLU parsing (<1ms latency)
        parsed = AVAIntentParser._parse_deterministic(user_prompt, context)
        return parsed

    @staticmethod
    def _parse_deterministic(user_prompt: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        text = user_prompt.lower().strip()

        intent = "outfit_recommendation"
        occasion: Optional[str] = None
        style: Optional[str] = None
        platform: Optional[str] = None
        budget: Optional[float] = None
        currency: str = "INR"
        color: Optional[str] = None
        gender: Optional[str] = None
        swap_target: Optional[str] = None
        target_outfit_index: Optional[int] = None
        needs_products: bool = False
        needs_price_comparison: bool = False
        needs_tryon: bool = False
        existing_item: Optional[str] = None

        # 1. Platform Detection
        for p in ["myntra", "ajio", "amazon", "flipkart", "meesho", "zara", "h&m", "nykaa", "tatacliq", "bewakoof"]:
            if p in text:
                platform = p
                needs_products = True
                break

        # 2. Budget Extraction
        budget_match = re.search(r'(?:under|below|within|max|budget|rs\.?|₹)\s*(\d{3,6})', text) or re.search(r'(\d{3,6})\s*(?:rupees|rs|inr|₹)?', text)
        if budget_match:
            try:
                val = float(budget_match.group(1))
                if val >= 300:
                    budget = val
                    needs_products = True
            except ValueError:
                pass

        # 3. Occasion Detection
        occasions_map = {
            "college": ["college", "campus", "class", "university", "presentation", "lecture"],
            "wedding": ["wedding", "shaadi", "marriage", "reception", "baraat"],
            "mehendi": ["mehendi", "haldi", "sangeet"],
            "office": ["office", "workwear", "corporate", "desk", "work"],
            "interview": ["interview", "job interview"],
            "party": ["party", "clubbing", "night out", "celebration"],
            "date": ["date", "date night", "romantic", "dinner date"],
            "travel": ["travel", "airport", "flight", "trip", "vacation"],
            "ethnic": ["ethnic", "diwali", "puja", "traditional", "festive"],
            "casual": ["casual", "everyday", "hangout", "chilling"],
        }
        for occ_key, keywords in occasions_map.items():
            if any(k in text for k in keywords):
                occasion = occ_key
                break

        # 4. Color Extraction
        for c in ["black", "white", "beige", "navy", "blue", "red", "maroon", "green", "olive", "pink", "yellow", "gold", "grey", "gray", "brown", "dark"]:
            if re.search(rf'\b{c}\b', text):
                color = "navy" if c == "dark" else c
                break

        # 5. Gender Hint
        if any(k in text for k in ["women", "womens", "girl", "ladies", "her", "she"]):
            gender = "women"
        elif any(k in text for k in ["men", "mens", "boy", "gentlemen", "him", "he"]):
            gender = "men"

        # 6. Target Outfit Index
        if any(k in text for k in ["first", "1st", "outfit 1", "outfit #1"]):
            target_outfit_index = 0
        elif any(k in text for k in ["second", "2nd", "outfit 2", "outfit #2"]):
            target_outfit_index = 1
        elif any(k in text for k in ["third", "3rd", "outfit 3", "outfit #3"]):
            target_outfit_index = 2

        # 7. Style Extraction
        if "minimal" in text or "understated" in text:
            style = "minimal"
        elif "streetwear" in text:
            style = "streetwear"
        elif "formal" in text or "polished" in text or "elegant" in text:
            style = "formal"
        elif "ethnic" in text or "traditional" in text:
            style = "ethnic"
        elif "casual" in text:
            style = "casual"

        # 8. Intent Actions
        # Priority 1: Try-On History
        if any(k in text for k in [
            "tryon history", "try on history", "try-on history", "past tryon", "past try-on", "past try on",
            "previous tryon", "previous try-on", "previous try on", "recent tryon history",
            "my tryons", "my try-ons", "my try ons", "show my tryon", "open my tryon", "see my tryon",
            "view my tryon", "tryon gallery", "try-on gallery", "all my tryons", "open history", "try-on jobs", "try on jobs"
        ]):
            intent = "tryon_history"
            needs_tryon = False

        # Priority 2: Style Recent Try-On
        elif (
            any(k in text for k in [
                "recent tryon", "recent try-on", "recent try on", "last tryon", "last try-on", "last try on",
                "latest tryon", "latest try-on", "latest try on", "previous tryon", "past tryon"
            ])
            and any(k in text for k in [
                "recommend", "product", "products", "item", "items", "match", "style", "pair",
                "go with", "goes with", "outfit", "look", "complete", "wear with", "suggest", "accessories", "shoes"
            ])
        ):
            intent = "style_recent_tryon"
            needs_products = True

        # Priority 3: Conversational Fashion Advice / Style Tips / Questions
        elif (
            any(k in text for k in [
                "who are you", "what can you do", "what are you", "help me", "how does tryon work",
                "how does virtual try on work", "how do you work", "how to style", "styling tips",
                "fashion tips", "fashion advice", "what should i wear", "body shape", "color season",
                "how should i dress", "how do i dress", "what suits", "guide me", "style advice"
            ])
            or (text in ["hi", "hello", "hey", "hola", "namaste", "good morning", "good evening", "what's up", "help"])
        ) and not (bool(re.search(r'\b(?:under|rs\.?|inr|below|budget|buy|shop)\b', text)) or '₹' in text):
            intent = "fashion_advice"

        elif "cheaper" in text or any(k in text for k in ["reduce price", "lower price", "less expensive"]):
            intent = "make_cheaper"
            needs_products = True

        elif "cheapest" in text or any(k in text for k in ["compare", "price comparison", "prices", "best price"]):
            intent = "price_comparison"
            needs_price_comparison = True

        elif any(k in text for k in ["change", "replace", "swap", "different"]) and any(k in text for k in ["shoes", "shoe", "shirt", "top", "pant", "pants", "jacket", "bag"]):
            intent = "swap_item"
            needs_products = True
            for target in ["shoes", "shoe", "shirt", "top", "pants", "pant", "trousers", "jacket", "bag", "accessory"]:
                if target in text:
                    swap_target = target
                    break

        elif (
            any(k in text for k in [
                "try this on me", "try on me", "virtual try on", "try it on me", "wear this on me",
                "try this outfit", "try the first outfit", "try the second outfit", "try the third outfit",
                "try on this", "try outfit on", "try it on", "try this on", "try it",
            ])
            or (re.search(r'\btry\s+(?:the\s+)?(?:first|second|third|this|it|outfit|on\s+me)\b', text) and not any(k in text for k in ["history", "recent", "past", "last", "latest"]))
            or (text.startswith("try ") and not any(k in text for k in ["history", "recent", "past", "last", "latest"]))
        ):
            intent = "try_on"
            needs_tryon = True

        elif any(k in text for k in ["complete my look", "complete look", "what goes with this", "already have this"]):
            intent = "complete_look"
            needs_products = True
            existing_item = text

        elif any(k in text for k in ["save this look", "save outfit", "save look", "bookmark outfit", "save this"]):
            intent = "save_outfit"

        elif any(k in text for k in ["find this", "search product", "find similar"]):
            intent = "product_search"
            needs_products = True

        # Mode determination
        mode = "Stylist"
        if needs_products or platform or budget:
            mode = "Shopping Stylist"
        if needs_tryon or needs_price_comparison or intent in ["tryon_history", "style_recent_tryon"]:
            mode = "Shopping Action Agent"

        return {
            "intent": intent,
            "mode": mode,
            "occasion": occasion or "casual",
            "style": style,
            "platform": platform,
            "budget": budget,
            "currency": currency,
            "color": color,
            "gender": gender,
            "swap_target": swap_target,
            "target_outfit_index": target_outfit_index,
            "existing_item": existing_item,
            "needs_products": needs_products,
            "needs_price_comparison": needs_price_comparison,
            "needs_tryon": needs_tryon,
            "raw_prompt": user_prompt,
        }
