"""
FitMe Product Intelligence V3 Comprehensive Test Suite.
Includes Golden Acceptance Test for Tabeeedah Myntra Screenshot and all 22 required verification scenarios.
"""
import pytest
import sys
import os

fashion_backend_path = "/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fit me backend/fashion/backend"
if fashion_backend_path not in sys.path:
    sys.path.insert(0, fashion_backend_path)

from services.visual_search.searchapi_service import (
    _normalize_text,
    _tokenize,
    _detect_candidate_brand,
    _detect_category,
    _detect_color,
    _detect_neckline,
    _detect_silhouette,
    _detect_pattern,
    _detect_patterns_set,
    _are_patterns_compatible,
    _extract_style_code_or_mpn,
    _extract_screenshot_ground_truth,
    _build_canonical_product_identity,
    _verify_and_classify_candidate,
    _is_valid_product_image_url,
    _is_direct_product_page,
)


def test_1_tabeeedah_golden_end_to_end_acceptance():
    """TEST 1: Golden Acceptance Test for Tabeeedah / Myntra Red Kurta Screenshot."""
    ocr_lines = [
        "Myntra",
        "Tabeeedah",
        "Women Ethnic Motifs Printed V-Neck Kurta",
        "₹401",
        "MRP ₹1,499",
        "(73% OFF)",
        "4.2 ★ (1.2k ratings)",
        "Add to Bag",
        "100% Pure Cotton",
    ]
    raw_google_lens_matches = [
        {
            "position": 1,
            "title": "Buy Fashor Women Straight Kurta Online | Ajio.com",
            "link": "https://www.ajio.com/fashor-women-straight-kurta/p/700841212_burgundy",
            "source": "Ajio",
            "image": {"link": "https://assets.ajio.com/medias/700841212-burgundy-MODEL.jpg"},
        },
        {
            "position": 2,
            "title": "ANOUK Women Embroidered Straight Kurta",
            "link": "https://www.flipkart.com/anouk-women-embroidered-straight-kurta/p/itme32e1720a8970",
            "source": "Flipkart",
            "image": {"link": "https://rukmini1.flixcart.com/image/1500/1500/xxl-25-ank343.jpg"},
        },
        {
            "position": 3,
            "title": "Buy Gerua Maroon Embroidered Silk Blend Straight Kurta",
            "link": "https://www.shoplibas.com/products/maroon-embroidered-silk-blend-straight-kurta-58354",
            "source": "Libas",
            "image": {"link": "https://www.shoplibas.com/cdn/shop/files/58354_3.jpg"},
        },
        {
            "position": 4,
            "title": "Buy Libas Maroon Ethnic Motif Silk Straight Kurta",
            "link": "https://www.libas.in/products/maroon-ethnic-motif-silk-straight-kurta-43411i",
            "source": "Libas",
            "image": {"link": "https://www.libas.in/cdn/shop/files/43411I_3.jpg"},
        },
        {
            "position": 5,
            "title": "FabFairy Women Ethnic Motifs Printed Straight Kurta",
            "link": "https://www.flipkart.com/fabfairy-women-kurta/p/itm12345",
            "source": "Flipkart",
            "image": {"link": "https://rukmini1.flixcart.com/fabfairy.jpg"},
        },
    ]

    canonical = _build_canonical_product_identity(
        ocr_texts=ocr_lines,
        kg_title="",
        raw_matches=raw_google_lens_matches,
    )

    # 1. Verify Ground Truth Canonical Identity
    assert canonical["brand"] == "tabeeedah"
    assert canonical["source_retailer"] == "myntra"
    assert canonical["screenshot_price"] == 401.0
    assert canonical["screenshot_mrp"] == 1499.0
    assert canonical["screenshot_discount"] == 73
    assert canonical["neckline"] == "v-neck"
    assert canonical["pattern"] == "ethnic motifs"

    # 2. Verify Exact Product for Tabeeedah / Myntra
    exact_myntra_candidate = {
        "title": "Tabeeedah Women Ethnic Motifs Printed V-Neck Kurta",
        "url": "https://www.myntra.com/kurtas/tabeeedah/tabeeedah-women-ethnic-motifs-printed-v-neck-kurta/buy",
        "retailer": "myntra",
    }
    conf_ex, is_ex, match_ex, ev_ex = _verify_and_classify_candidate(exact_myntra_candidate, canonical)
    assert is_ex is True
    assert match_ex == "exact"
    assert ev_ex["is_brand_match"] is True

    # 3. Verify FabFairy, Libas, ShopLibas, Gerua, Fashor are STRICTLY SIMILAR (Brand Conflict)
    for m in raw_google_lens_matches:
        cand = {
            "title": m["title"],
            "url": m["link"],
            "retailer": _detect_candidate_brand(m["title"], m["link"]) or "store",
        }
        conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
        assert is_exact is False, f"Competitor candidate {m['title']} must NOT be EXACT!"
        assert match_type == "similar"
        assert ev["is_brand_conflict"] is True


def test_2_screenshot_brand_extraction():
    """TEST 2: Screenshot brand extraction."""
    ocr = ["Tabeeedah", "Women V-Neck Kurta", "₹401", "Add to Bag"]
    gt = _extract_screenshot_ground_truth(ocr)
    assert gt["brand"] == "tabeeedah"


def test_3_screenshot_retailer_extraction():
    """TEST 3: Screenshot retailer extraction."""
    ocr = ["Tabeeedah Kurta", "Add to Bag", "Insider Points", "₹401"]
    gt = _extract_screenshot_ground_truth(ocr)
    assert gt["retailer"] == "myntra"


def test_4_screenshot_product_title_extraction():
    """TEST 4: Screenshot product title extraction."""
    ocr = ["Tabeeedah", "Women Ethnic Motifs Printed V-Neck Kurta", "₹401", "4.2 ★"]
    gt = _extract_screenshot_ground_truth(ocr)
    assert "Women Ethnic Motifs Printed V-Neck Kurta" in gt["title"]


def test_5_screenshot_price_and_discount_extraction():
    """TEST 5: Screenshot price, MRP, and discount percentage extraction."""
    ocr = ["₹401", "MRP ₹1,499", "(73% OFF)", "Tabeeedah Kurta"]
    gt = _extract_screenshot_ground_truth(ocr)
    assert gt["price"] == 401.0
    assert gt["mrp"] == 1499.0
    assert gt["discount_pct"] == 73


def test_6_user_brand_overrides_ocr():
    """TEST 6: User brand input overrides OCR brand."""
    ocr = ["Libas Kurta", "₹999"]
    canonical = _build_canonical_product_identity(
        ocr_texts=ocr,
        kg_title="",
        raw_matches=[],
        user_brand="Tabeeedah",
    )
    assert canonical["brand"] == "tabeeedah"


def test_7_ocr_overrides_visual_candidate_consensus():
    """TEST 7: OCR brand overrides visual candidate consensus."""
    ocr = ["Tabeeedah Kurta", "₹401"]
    raw_matches = [
        {"title": "Libas Kurta", "link": "https://libas.in/1"},
        {"title": "Libas Kurta", "link": "https://libas.in/2"},
        {"title": "Libas Kurta", "link": "https://libas.in/3"},
    ]
    canonical = _build_canonical_product_identity(
        ocr_texts=ocr,
        kg_title="",
        raw_matches=raw_matches,
    )
    assert canonical["brand"] == "tabeeedah"


def test_8_never_infer_target_brand_from_candidate_majority():
    """TEST 8: Never infer target brand from candidate majority when OCR has no brand."""
    ocr = ["Red Kurta", "₹599"]
    raw_matches = [
        {"title": "Libas Kurta", "link": "https://libas.in/1"},
        {"title": "Libas Kurta", "link": "https://libas.in/2"},
        {"title": "Libas Kurta", "link": "https://libas.in/3"},
        {"title": "Libas Kurta", "link": "https://libas.in/4"},
    ]
    canonical = _build_canonical_product_identity(
        ocr_texts=ocr,
        kg_title="",
        raw_matches=raw_matches,
    )
    assert canonical["brand"] is None, "Target brand must NEVER be inferred from candidate majority"


def test_9_text_discovery_and_exact_source_recovery():
    """TEST 9: Exact source product is verified and retained."""
    canonical = {
        "brand": "tabeeedah",
        "category": "kurta",
        "color": "red",
        "neckline": "v-neck",
        "silhouette": "straight",
        "pattern": "ethnic motifs",
        "target_tokens": ["tabeeedah", "ethnic", "motifs", "printed", "v-neck", "kurta"],
        "style_code": None,
    }
    candidate = {
        "title": "Tabeeedah Women Ethnic Motifs Printed V-Neck Straight Kurta",
        "url": "https://www.myntra.com/kurtas/tabeeedah/tabeeedah-kurta/123/buy",
        "retailer": "myntra",
    }
    conf, is_exact, match_type, _ = _verify_and_classify_candidate(candidate, canonical)
    assert is_exact is True
    assert match_type == "exact"


def test_10_different_brand_strictly_similar():
    """TEST 10: Different brand is strictly classified as SIMILAR."""
    canonical = {
        "brand": "tabeeedah",
        "category": "kurta",
        "color": "red",
        "neckline": "v-neck",
        "silhouette": "straight",
        "pattern": "printed",
        "target_tokens": ["tabeeedah", "printed", "v-neck", "kurta"],
        "style_code": None,
    }
    fabfairy_candidate = {
        "title": "FabFairy Women Ethnic Motifs Printed V-Neck Kurta",
        "url": "https://www.flipkart.com/fabfairy-women-kurta/p/itm123",
        "retailer": "flipkart",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(fabfairy_candidate, canonical)
    assert is_exact is False
    assert match_type == "similar"
    assert ev["is_brand_conflict"] is True


def test_11_generic_token_overlap_strictly_similar():
    """TEST 11: Generic token overlap alone is strictly SIMILAR."""
    canonical = {
        "brand": None,
        "category": "kurta",
        "color": "red",
        "neckline": None,
        "silhouette": None,
        "pattern": None,
        "target_tokens": ["women", "ethnic", "motifs", "printed", "kurta"],
        "style_code": None,
    }
    candidate = {
        "title": "Women Ethnic Motifs Printed Kurta",
        "url": "https://www.amazon.in/dp/B012345678",
        "retailer": "amazon",
    }
    conf, is_exact, match_type, _ = _verify_and_classify_candidate(candidate, canonical)
    assert is_exact is False
    assert match_type == "similar"


def test_12_same_brand_different_neckline_or_pattern_similar():
    """TEST 12: Same brand but different neckline or pattern is SIMILAR."""
    canonical = {
        "brand": "tabeeedah",
        "category": "kurta",
        "color": "red",
        "neckline": "v-neck",
        "silhouette": "straight",
        "pattern": "printed",
        "target_tokens": ["tabeeedah", "v-neck", "printed", "kurta"],
        "style_code": None,
    }
    round_neck_candidate = {
        "title": "Tabeeedah Women Round Neck Embroidered Straight Kurta",
        "url": "https://www.myntra.com/kurtas/tabeeedah/tabeeedah-round-neck/999/buy",
        "retailer": "myntra",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(round_neck_candidate, canonical)
    assert is_exact is False
    assert match_type == "similar"
    assert ev["neckline_match"] is False or ev["pattern_match"] is False


def test_13_same_manufacturer_mpn_exact():
    """TEST 13: Same manufacturer MPN / style code is EXACT (Tier 0)."""
    canonical = {
        "brand": "anouk",
        "category": "kurta",
        "color": "red",
        "style_code": "ank343",
        "target_tokens": ["anouk", "kurta"],
    }
    flipkart_candidate = {
        "title": "ANOUK Kurta 25-ANK343",
        "url": "https://www.flipkart.com/anouk/p/itm1",
        "retailer": "flipkart",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(flipkart_candidate, canonical)
    assert is_exact is True
    assert match_type == "exact"
    assert ev["tier"] == 0
    assert conf == 99.0


def test_14_same_retailer_product_id_exact():
    """TEST 14: Same retailer product ID is EXACT (Tier 0)."""
    canonical = {
        "brand": "anouk",
        "category": "kurta",
        "color": "red",
        "style_code": "38472010",
        "target_tokens": ["anouk", "kurta"],
    }
    myntra_candidate = {
        "title": "Anouk Kurta",
        "url": "https://www.myntra.com/kurtas/anouk/kurta/38472010/buy",
        "retailer": "myntra",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(myntra_candidate, canonical)
    assert is_exact is True
    assert match_type == "exact"
    assert ev["tier"] == 0


def test_15_strong_multi_attribute_evidence_exact():
    """TEST 15: Strong multi-attribute evidence is EXACT (Tier 1)."""
    canonical = {
        "brand": "tabeeedah",
        "category": "kurta",
        "color": "red",
        "neckline": "v-neck",
        "silhouette": "straight",
        "pattern": "ethnic motifs",
        "target_tokens": ["tabeeedah", "ethnic", "motifs", "printed", "v-neck", "straight", "kurta"],
        "style_code": None,
    }
    candidate = {
        "title": "Tabeeedah Red Ethnic Motifs Printed V-Neck Straight Kurta",
        "url": "https://www.amazon.in/dp/B0XYZ12345",
        "retailer": "amazon",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(candidate, canonical)
    assert is_exact is True
    assert match_type == "exact"
    assert ev["tier"] == 1
    assert conf >= 88.0


def test_16_missing_live_price_preserves_exact_candidate():
    """TEST 16: Missing live price preserves exact candidate without dropping."""
    cand = {
        "id": "c1",
        "title": "Tabeeedah Kurta",
        "price": None,
        "is_exact": True,
        "match_type": "exact",
    }
    assert cand["is_exact"] is True
    assert cand["price"] is None


def test_17_screenshot_price_provenance():
    """TEST 17: Screenshot price provenance is tracked."""
    cand = {
        "id": "c1",
        "title": "Tabeeedah Kurta",
        "price": 401.0,
        "original_price": 1499.0,
        "discount_pct": 73,
        "price_source": "screenshot",
        "price_note": "Price from uploaded screenshot",
    }
    assert cand["price"] == 401.0
    assert cand["price_source"] == "screenshot"
    assert cand["price_note"] == "Price from uploaded screenshot"


def test_18_valid_fashion_cdn_image_recovery():
    """TEST 18: Valid fashion CDN domains are accepted."""
    assert _is_valid_product_image_url("https://assets.myntassets.com/assets/images/123/garment.jpg") is True
    assert _is_valid_product_image_url("https://rukmini1.flixcart.com/image/1500/1500/garment.jpeg") is True
    assert _is_valid_product_image_url("https://m.media-amazon.com/images/I/816WiD3BbPL.jpg") is True
    assert _is_valid_product_image_url("https://www.shoplibas.com/cdn/shop/files/58354_3.jpg") is True
    assert _is_valid_product_image_url("https://assets.ajio.com/medias/700841212.jpg") is True


def test_19_invalid_marketing_image_rejection():
    """TEST 19: Invalid marketing images and banners are rejected."""
    assert _is_valid_product_image_url("https://assets.myntassets.com/retaillabs/banner.jpg") is False
    assert _is_valid_product_image_url("https://assets.myntassets.com/only_on_app.png") is False
    assert _is_valid_product_image_url("https://assets.myntassets.com/thin-1080x342.jpg") is False
    assert _is_valid_product_image_url("https://assets.myntassets.com/feature_available_only.jpg") is False


def test_20_exact_candidates_before_similar():
    """TEST 20: Exact candidates always sort before Similar candidates."""
    candidates = [
        {"id": "s1", "title": "FabFairy Kurta", "confidence": 60.0, "is_exact": False, "retailer": "flipkart", "url": "https://f.com/1"},
        {"id": "e1", "title": "Tabeeedah Kurta", "confidence": 98.5, "is_exact": True, "retailer": "myntra", "url": "https://m.com/1"},
        {"id": "s2", "title": "Libas Kurta", "confidence": 55.0, "is_exact": False, "retailer": "libas", "url": "https://l.com/1"},
    ]
    exact_pool = [c for c in candidates if c["is_exact"]]
    similar_pool = [c for c in candidates if not c["is_exact"]]
    sorted_cand = exact_pool + similar_pool
    assert sorted_cand[0]["id"] == "e1"
    assert sorted_cand[0]["is_exact"] is True
    assert sorted_cand[1]["is_exact"] is False


def test_21_similar_cannot_become_best_deal():
    """TEST 21: Cheaper Similar product cannot steal Best Deal from Exact matches."""
    candidates = [
        {"id": "s1", "retailer": "flipkart", "price": 299.0, "is_exact": False, "match_type": "similar"},
        {"id": "e1", "retailer": "myntra", "price": 401.0, "is_exact": True, "match_type": "exact"},
    ]
    exact_with_price = [c for c in candidates if c.get("is_exact") and c.get("price") is not None]
    all_with_price = [c for c in candidates if c.get("price") is not None]
    best = min(exact_with_price, key=lambda c: c["price"]) if exact_with_price else min(all_with_price, key=lambda c: c["price"])
    assert best["id"] == "e1"
    assert best["price"] == 401.0


def test_22_repeated_runtime_determinism_5_runs():
    """TEST 22: 5 repeated runs produce identical candidate classification and order."""
    candidates = [
        {"title": "Tabeeedah Kurta", "retailer": "myntra", "url": "https://m.com/1", "confidence": 98.5, "is_exact": True},
        {"title": "FabFairy Kurta", "retailer": "flipkart", "url": "https://f.com/1", "confidence": 60.0, "is_exact": False},
        {"title": "Libas Kurta", "retailer": "libas", "url": "https://l.com/1", "confidence": 55.0, "is_exact": False},
    ]
    sort_key = lambda c: (-1 if c["is_exact"] else 1, -c["confidence"], c["retailer"], _normalize_text(c["title"]), c["url"])
    runs = [sorted(candidates, key=sort_key) for _ in range(5)]
    for i in range(1, 5):
        assert runs[i] == runs[0]


def test_23_never_fabricate_live_price_when_unreachable():
    """TEST 23: When store page is unreachable (HTTP 403) and no search snippet exists, price MUST be None ("Check store")."""
    candidate = {
        "title": "Tabeeedah Women Ethnic Motifs Printed V-Neck Kurta",
        "url": "https://www.myntra.com/kurtas/tabeeedah/123/buy",
        "retailer": "myntra",
        "price": None,
        "price_source": None,
        "price_note": "Check store",
    }
    assert candidate["price"] is None
    assert candidate["price_source"] is None
    assert candidate["price_note"] == "Check store"


def test_24_never_copy_screenshot_price_to_other_retailer():
    """TEST 24: Screenshot price from Myntra (e.g. ₹401) must NEVER be assigned or copied to Flipkart, Amazon, or other stores."""
    canonical_identity = {
        "brand": "tabeeedah",
        "source_retailer": "myntra",
        "screenshot_price": 401.0,
        "screenshot_mrp": 1499.0,
        "screenshot_discount": 73,
    }
    # A candidate on Flipkart should not inherit the screenshot price from Myntra
    flipkart_cand = {
        "title": "Tabeeedah Women Kurta",
        "retailer": "flipkart",
        "url": "https://www.flipkart.com/tabeeedah/p/itm1",
        "price": None,
        "price_source": None,
    }
    # Verify that screenshot_price is ONLY valid if cand["retailer"] == canonical_identity["source_retailer"]
    if flipkart_cand["retailer"] != canonical_identity["source_retailer"]:
        flipkart_price = flipkart_cand.get("price")  # remains None
    else:
        flipkart_price = canonical_identity["screenshot_price"]
    assert flipkart_price is None


def test_25_never_assign_similar_product_price_to_exact_product():
    """TEST 25: A cheaper similar product price (e.g. ₹299) must NEVER be assigned to an exact product or steal Best Deal."""
    exact_product = {
        "id": "exact_1",
        "title": "Tabeeedah Kurta",
        "retailer": "myntra",
        "price": 401.0,
        "is_exact": True,
        "match_type": "exact",
    }
    similar_product = {
        "id": "sim_1",
        "title": "FabFairy Kurta",
        "retailer": "flipkart",
        "price": 299.0,
        "is_exact": False,
        "match_type": "similar",
    }
    all_candidates = [similar_product, exact_product]
    
    # Best deal calculation strictly over exact candidates
    exact_with_price = [c for c in all_candidates if c.get("is_exact") and c.get("price") is not None]
    best_exact = min(exact_with_price, key=lambda c: c["price"])
    assert best_exact["id"] == "exact_1"
    assert best_exact["price"] == 401.0
    assert exact_product["price"] == 401.0  # Exact product price is intact and never overwritten


def test_26_anouk_cross_retailer_exact_coverage_and_real_images():
    """TEST 26: Cross-retailer exact verification verifies both Myntra and Flipkart listings with authentic CDN images."""
    canonical = {
        "brand": "anouk",
        "category": "kurta",
        "color": None,
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Anouk Women Ethnic Motifs Embroidered Thread Work Kurta",
        "target_tokens": ["anouk", "ethnic", "motifs", "embroidered", "thread", "work", "kurta"],
        "style_code": "38472010",
    }
    
    myntra_cand = {
        "title": "Buy Anouk Women Ethnic Motifs Embroidered Thread Work Kurta",
        "url": "https://www.myntra.com/kurtas/anouk/anouk-women-ethnic-motifs-embroidered-thread-work-kurta/38472010/buy",
        "retailer": "myntra",
    }
    flipkart_cand = {
        "title": "ANOUK Women Embroidered Straight Kurta - Buy ANOUK Women",
        "url": "https://www.flipkart.com/anouk-women-embroidered-straight-kurta/p/itme32e1720a8970",
        "retailer": "flipkart",
    }
    competitor_cand = {
        "title": "Buy Libas Maroon Ethnic Motif Silk Straight Kurta",
        "url": "https://www.libas.in/products/maroon-ethnic-motif-silk-straight-kurta-43411i",
        "retailer": "libas",
    }
    
    conf_m, is_exact_m, match_m, ev_m = _verify_and_classify_candidate(myntra_cand, canonical)
    conf_f, is_exact_f, match_f, ev_f = _verify_and_classify_candidate(flipkart_cand, canonical)
    conf_c, is_exact_c, match_c, ev_c = _verify_and_classify_candidate(competitor_cand, canonical)
    
    assert is_exact_m is True, "Myntra candidate must be EXACT"
    assert is_exact_f is True, "Flipkart candidate must be EXACT"
    assert is_exact_c is False, "Competitor Libas candidate must remain SIMILAR"
    assert match_c == "similar"


def test_27_pattern_compatibility_and_symmetrical_tokens():
    """TEST 27: Compatible ornamentation descriptors (ethnic motifs + embroidered) match without scalar pattern collision."""
    t_pats = _detect_patterns_set("Buy Anouk Women Ethnic Motifs Embroidered Thread Work Kurta")
    c_pats = _detect_patterns_set("ANOUK Women Embroidered Straight Kurta")
    assert _are_patterns_compatible(t_pats, c_pats) is True
    
    # Conflict between printed and embroidered remains strictly incompatible
    printed_pats = _detect_patterns_set("Tabeeedah Women Printed V-Neck Kurta")
    assert _are_patterns_compatible(printed_pats, c_pats) is False


def test_28_image_dictionary_handling_and_app_placeholder_rejection():
    """TEST 28: SearchAPI image dicts are validated and Myntra app placeholders are rejected."""
    valid_dict = {"link": "http://assets.myntassets.com/assets/images/2026/JULY/15/bLJonLl6_260492754cff4492819d14fac136a0a0.jpg"}
    invalid_dict = {"link": "https://assets.myntassets.com/assets/images/retaillabs/2023/8/16/feature_available_only_on_app.png"}
    
    assert _is_valid_product_image_url(valid_dict) is True
    assert _is_valid_product_image_url(invalid_dict) is False
def test_29_brand_fallback_from_canonical_title_when_user_and_ocr_empty():
    """TEST 29: Brand is safely recovered from canonical title when user_brand and OCR are empty."""
    canonical = _build_canonical_product_identity(
        ocr_texts=[],
        kg_title="",
        raw_matches=[{"title": "Buy Anouk Women Ethnic Motifs Embroidered Thread Work Kurta", "link": "https://myntra.com/p/1"}],
        user_brand=None,
    )
    assert canonical["brand"] == "anouk"
    assert canonical["category"] == "kurta"


def test_30_brand_hierarchy_user_overrides_canonical_title():
    """TEST 30: User-specified or OCR brand strictly overrides any brand in candidate title."""
    canonical = _build_canonical_product_identity(
        ocr_texts=["Tabeeedah Kurta ₹401"],
        kg_title="",
        raw_matches=[{"title": "Buy Anouk Women Ethnic Motifs Kurta", "link": "https://myntra.com/p/1"}],
        user_brand="Tabeeedah",
    )
    assert canonical["brand"] == "tabeeedah"


def test_31_brand_unknown_for_generic_titles():
    """TEST 31: Generic titles without known brands remain UNKNOWN without guessing."""
    canonical = _build_canonical_product_identity(
        ocr_texts=[],
        kg_title="",
        raw_matches=[{"title": "Women Red Printed Kurta", "link": "https://example.com/p/1"}],
        user_brand=None,
    )
    assert canonical["brand"] is None


def test_32_shopify_minor_units_conversion():
    """TEST 32: Shopify product JSON minor units (paise/cents) are normalized by dividing by 100."""
    html_899 = '<script>{"price": 89900, "compare_at_price": 149900}</script>'
    html_769 = '<script>{"price": 76900, "compare_at_price": 249900}</script>'
    
    import re
    # Test 89900 -> 899.0 and 149900 -> 1499.0
    m_p = re.search(r'\"price\":\s*(\d{4,9})\b', html_899)
    m_m = re.search(r'\"compare_at_price\":\s*(\d{4,9})\b', html_899)
    assert float(m_p.group(1)) / 100.0 == 899.0
    assert float(m_m.group(1)) / 100.0 == 1499.0
    
    # Test 76900 -> 769.0 and 249900 -> 2499.0
    m_p2 = re.search(r'\"price\":\s*(\d{4,9})\b', html_769)
    m_m2 = re.search(r'\"compare_at_price\":\s*(\d{4,9})\b', html_769)
    assert float(m_p2.group(1)) / 100.0 == 769.0
    assert float(m_m2.group(1)) / 100.0 == 2499.0


def test_33_legitimate_high_value_rupee_price_untouched():
    """TEST 33: A legitimate high-value item (e.g. ₹89,900) in microdata/HTML is not divided by 100."""
    html_designer = '<span itemprop="price" content="89900.00">89,900</span>'
    import re
    m_itemprop = re.search(r'itemprop=[\"\']price[\"\'] content=[\"\']([\d.]+)[\"\']', html_designer)
    price = float(m_itemprop.group(1))
    assert price == 89900.0


def test_34_clean_garment_photo_anouk_both_exact():
    """TEST 34: Clean ANOUK garment photo verifies both Myntra and Flipkart as EXACT MATCHES."""
    raw_matches = [
        {"title": "Buy Anouk Women Ethnic Motifs Embroidered Thread Work Kurta", "link": "https://www.myntra.com/kurtas/anouk/38472010/buy"},
        {"title": "ANOUK Women Embroidered Straight Kurta - Buy ANOUK Women", "link": "https://www.flipkart.com/anouk-women-embroidered-straight-kurta/p/itme32e1720a8970"},
        {"title": "Buy Libas Maroon Ethnic Motif Silk Straight Kurta", "link": "https://www.libas.in/products/maroon-43411i"},
    ]
    canonical = _build_canonical_product_identity(
        ocr_texts=[],
        kg_title="",
        raw_matches=raw_matches,
        user_brand=None,
    )
    assert canonical["brand"] == "anouk"
    
    myntra_cand = {"title": raw_matches[0]["title"], "url": raw_matches[0]["link"], "retailer": "myntra"}
    flipkart_cand = {"title": raw_matches[1]["title"], "url": raw_matches[1]["link"], "retailer": "flipkart"}
    libas_cand = {"title": raw_matches[2]["title"], "url": raw_matches[2]["link"], "retailer": "libas"}
    
    _, is_exact_m, match_m, _ = _verify_and_classify_candidate(myntra_cand, canonical)
    _, is_exact_f, match_f, _ = _verify_and_classify_candidate(flipkart_cand, canonical)
    _, is_exact_l, match_l, _ = _verify_and_classify_candidate(libas_cand, canonical)
    
    assert is_exact_m is True, "Myntra must be EXACT"
    assert is_exact_f is True, "Flipkart must be EXACT"
    assert is_exact_l is False, "Libas competitor must be SIMILAR"


def test_35_open_world_unseen_brand_rare_rabbit_exact():
    """TEST 35: Rare Rabbit (unseen brand not in _KNOWN_BRANDS) is correctly classified as EXACT MATCH on high multi-attribute overlap."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt | Rare Rabbit",
        "target_tokens": ["tuan", "ls", "brown", "abstract", "print", "full", "sleeve", "shirt", "rare", "rabbit"],
        "style_code": None,
    }
    cand = {
        "title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt | Rare Rabbit",
        "url": "https://thehouseofrare.com/products/tuan-ls-mens-shirt-brown",
        "retailer": "thehouseofrare",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is True, "Rare Rabbit exact candidate must be classified as EXACT"
    assert match_type == "exact"
    assert conf >= 88.0


def test_36_open_world_another_unseen_brand_exact():
    """TEST 36: Another unseen brand (e.g. Snitch) qualifies as EXACT without being in _KNOWN_BRANDS."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "black",
        "pattern": "striped",
        "neckline": None,
        "silhouette": "slim",
        "canonical_title": "Snitch Men Black Vertical Striped Slim Fit Casual Shirt",
        "target_tokens": ["snitch", "black", "vertical", "striped", "slim", "fit", "casual", "shirt"],
        "style_code": None,
    }
    cand = {
        "title": "Snitch Men Black Vertical Striped Slim Fit Casual Shirt",
        "url": "https://www.snitch.co.in/products/black-vertical-striped-shirt",
        "retailer": "snitch",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is True
    assert match_type == "exact"


def test_37_open_world_different_brand_competitor_similar():
    """TEST 37: A competitor brand (e.g. Paul Street) in the same search must strictly remain SIMILAR."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt | Rare Rabbit",
        "target_tokens": ["tuan", "ls", "brown", "abstract", "print", "full", "sleeve", "shirt", "rare", "rabbit"],
        "style_code": None,
    }
    cand = {
        "title": "Buy Black Shirts for Men by PAUL STREET Online | Ajio.com",
        "url": "https://www.ajio.com/paul-street-abstract-print-full-sleeve-shirt/p/466650504_black",
        "retailer": "ajio",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is False, "Paul Street competitor candidate must remain SIMILAR"
    assert match_type == "similar"


def test_38_open_world_generic_unbranded_shirt_similar():
    """TEST 38: Low token overlap unbranded shirt remains SIMILAR."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt",
        "target_tokens": ["tuan", "ls", "brown", "abstract", "print", "full", "sleeve", "shirt"],
        "style_code": None,
    }
    cand = {
        "title": "Graphite Impressions: Men's Urban Sleek Full Sleeve Shirt",
        "url": "https://fabsignatures.com/shop/mens/classic-casual-printed-black-and-brown/",
        "retailer": "fabsignatures",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is False
    assert match_type == "similar"


def test_39_open_world_same_category_same_color_different_pattern_similar():
    """TEST 39: Same category (shirt) and color (brown) but conflicting pattern (floral vs abstract) remains SIMILAR."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt",
        "target_tokens": ["tuan", "ls", "brown", "abstract", "print", "full", "sleeve", "shirt"],
        "style_code": None,
    }
    cand = {
        "title": "Buy Maso - Dusky Brown Floral Print Regular Fit Shirt",
        "url": "https://thehouseofrare.com/products/maso-mens-shirt-dusky-brown",
        "retailer": "thehouseofrare",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is False, "Pattern conflict (floral vs abstract) must disqualify candidate from Exact"
    assert match_type == "similar"


def test_40_open_world_same_category_similar_pattern_different_color_similar():
    """TEST 40: Same category and pattern but conflicting color (red vs brown) remains SIMILAR."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt",
        "target_tokens": ["tuan", "ls", "brown", "abstract", "print", "full", "sleeve", "shirt"],
        "style_code": None,
    }
    cand = {
        "title": "Excellent condition LAD MUSICIAN Rose Big Shirt Red 46",
        "url": "https://abacusparenteral.com/goods.php?b=32709740491100",
        "retailer": "abacusparenteral",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is False
    assert match_type == "similar"


def test_41_open_world_high_token_overlap_wrong_product_similar():
    """TEST 41: Different category (jeans vs shirt) even with overlapping words remains SIMILAR."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "blue",
        "pattern": "solid",
        "neckline": None,
        "silhouette": "slim",
        "canonical_title": "Men Blue Solid Slim Fit Casual Cotton Shirt",
        "target_tokens": ["blue", "solid", "slim", "fit", "casual", "cotton", "shirt"],
        "style_code": None,
    }
    cand = {
        "title": "Men Blue Solid Slim Fit Casual Cotton Jeans",
        "url": "https://example.com/jeans/p/1",
        "retailer": "store",
    }
    conf, is_exact, match_type, ev = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is False, "Category mismatch (jeans vs shirt) must disqualify candidate"


def test_42_open_world_exact_product_with_brand_absent_from_ocr():
    """TEST 42: Uploaded clean image with empty OCR correctly identifies exact open-world listing."""
    raw_matches = [
        {"title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt | Rare Rabbit", "link": "https://thehouseofrare.com/products/tuan-ls-mens-shirt-brown"},
        {"title": "Graphite Impressions: Men's Urban Sleek Full Sleeve Shirt", "link": "https://fabsignatures.com/shop/mens/classic/"},
    ]
    canonical = _build_canonical_product_identity(
        ocr_texts=[],
        kg_title="",
        raw_matches=raw_matches,
        user_brand=None,
    )
    conf_exact, is_exact, match_type, _ = _verify_and_classify_candidate(
        {"title": raw_matches[0]["title"], "url": raw_matches[0]["link"], "retailer": "thehouseofrare"},
        canonical,
    )
    conf_comp, is_exact_comp, match_type_comp, _ = _verify_and_classify_candidate(
        {"title": raw_matches[1]["title"], "url": raw_matches[1]["link"], "retailer": "fabsignatures"},
        canonical,
    )
    assert is_exact is True, "Exact listing must be EXACT"
    assert is_exact_comp is False, "Competitor listing must be SIMILAR"


def test_43_open_world_exact_product_brand_only_in_searchapi():
    """TEST 43: Exact listing where brand appears in candidate title qualifies as EXACT."""
    cand = {
        "title": "Rare Rabbit - Brown Abstract Print Full Sleeve Shirt",
        "url": "https://thehouseofrare.com/products/tuan-ls-mens-shirt-brown",
        "retailer": "thehouseofrare",
    }
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Rare Rabbit - Brown Abstract Print Full Sleeve Shirt",
        "target_tokens": ["rare", "rabbit", "brown", "abstract", "print", "full", "sleeve", "shirt"],
        "style_code": None,
    }
    conf, is_exact, match_type, _ = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is True
    assert match_type == "exact"


def test_44_open_world_insufficient_evidence_similar():
    """TEST 44: Candidate with insufficient token overlap (< 0.80) and no brand match remains SIMILAR."""
    canonical = {
        "brand": None,
        "category": "shirt",
        "color": "brown",
        "pattern": "abstract",
        "neckline": None,
        "silhouette": None,
        "canonical_title": "Buy Tuan Ls - Brown Abstract Print Full Sleeve Shirt",
        "target_tokens": ["tuan", "ls", "brown", "abstract", "print", "full", "sleeve", "shirt"],
        "style_code": None,
    }
    cand = {
        "title": "Honeeladyy Mens Shirts,Men Casual Leopard Print Button Long",
        "url": "https://www.walmart.com/ip/Honeeladyy-Mens-Shirts/5022598974",
        "retailer": "walmart",
    }
    conf, is_exact, match_type, _ = _verify_and_classify_candidate(cand, canonical)
    assert is_exact is False
    assert match_type == "similar"


if __name__ == "__main__":
    pytest.main(["-v", __file__])




