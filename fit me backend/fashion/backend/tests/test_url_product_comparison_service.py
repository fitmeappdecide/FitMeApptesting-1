import pytest
from services.link_comparison.url_product_comparison_service import (
    URLProductComparisonService,
    _extract_tokens,
    _extract_retailer_from_url,
    _extract_style_id_from_url,
    _normalize_text,
)


def test_extract_tokens():
    tokens = _extract_tokens("Anouk Women Ethnic Motifs Embroidered Thread Work Kurta")
    assert "ethnic" in tokens
    assert "motifs" in tokens
    assert "embroidered" in tokens
    assert "thread" in tokens
    assert "work" in tokens
    assert "kurta" in tokens
    assert "anouk" in tokens
    # Stopwords should be filtered
    assert "women" not in tokens


def test_extract_retailer_from_url():
    assert _extract_retailer_from_url("https://www.myntra.com/kurtas/anouk/123/buy") == "myntra"
    assert _extract_retailer_from_url("https://www.flipkart.com/anouk-kurta/p/itm123") == "flipkart"
    assert _extract_retailer_from_url("https://www.ajio.com/anouk-kurta/p/464573262_maroon") == "ajio"
    assert _extract_retailer_from_url("https://www.amazon.in/dp/B0GFFCFD19") == "amazon"


def test_extract_style_id_from_url():
    assert _extract_style_id_from_url("https://www.myntra.com/kurtas/anouk/31289196/buy") == "31289196"
    assert _extract_style_id_from_url("https://www.amazon.in/dp/B0GFFCFD19") == "B0GFFCFD19"
    assert _extract_style_id_from_url("https://www.ajio.com/p/464573262_maroon") == "464573262"


def test_exact_verification_same_product():
    svc = URLProductComparisonService(api_key=None)
    source_brand = "anouk"
    source_title = "anouk women ethnic motifs embroidered thread work kurta"
    source_tokens = _extract_tokens(source_title)

    # Candidate 1: Flipkart selling the exact same Anouk embroidered kurta
    cand_exact = {
        "title": "Anouk Women Ethnic Motifs Embroidered Thread Work Kurta - Buy Online",
        "url": "https://www.flipkart.com/anouk-women-ethnic-motifs-embroidered-thread-work-kurta/p/itm12345",
    }
    is_exact, conf, reason = svc._verify_exact_product(
        source_brand=source_brand,
        source_title=source_title,
        source_tokens=source_tokens,
        source_style_id="31289196",
        candidate=cand_exact,
    )
    assert is_exact is True
    assert conf >= 80.0


def test_exact_verification_different_garment_same_brand():
    svc = URLProductComparisonService(api_key=None)
    source_brand = "anouk"
    source_title = "anouk women ethnic motifs embroidered thread work kurta"
    source_tokens = _extract_tokens(source_title)

    # Candidate 2: Anouk brand, but completely different product (printed straight kurta vs embroidered thread work)
    cand_diff = {
        "title": "Anouk Women Geometric Printed Regular Straight Kurta",
        "url": "https://www.flipkart.com/anouk-women-printed-kurta/p/itm98765",
    }
    is_exact, conf, reason = svc._verify_exact_product(
        source_brand=source_brand,
        source_title=source_title,
        source_tokens=source_tokens,
        source_style_id="31289196",
        candidate=cand_diff,
    )
    # Brand matches, but different physical product -> MUST BE REJECTED
    assert is_exact is False


def test_exact_verification_cross_label_matching():
    svc = URLProductComparisonService(api_key=None)
    source_brand = "anouk"
    source_title = "anouk women ethnic motifs embroidered thread work kurta"
    source_tokens = _extract_tokens(source_title)

    # Candidate 1: Identical garment attributes under another label (should be accepted)
    cand_cross_label = {
        "title": "KALINI Women Ethnic Motifs Embroidered Thread Work Kurta",
        "url": "https://www.myntra.com/kurtas/kalini/41646806/buy",
    }
    is_exact, conf, reason = svc._verify_exact_product(
        source_brand=source_brand,
        source_title=source_title,
        source_tokens=source_tokens,
        source_style_id="31289196",
        candidate=cand_cross_label,
    )
    assert is_exact is True
    assert conf >= 65.0

    # Candidate 2: Incompatible garment category (Saree vs Kurta -> MUST BE REJECTED)
    cand_diff_category = {
        "title": "KALINI Women Ethnic Motifs Embroidered Saree with Blouse Piece",
        "url": "https://www.myntra.com/sarees/kalini/512345/buy",
    }
    is_exact_cat, _, _ = svc._verify_exact_product(
        source_brand=source_brand,
        source_title=source_title,
        source_tokens=source_tokens,
        source_style_id="31289196",
        candidate=cand_diff_category,
    )
    assert is_exact_cat is False


@pytest.mark.asyncio
async def test_compare_product_source_offer_and_best_deal():
    svc = URLProductComparisonService(api_key=None)
    # Mock discovery to return an exact Flipkart offer
    async def mock_discover(*args, **kwargs):
        return [
            {
                "title": "Anouk Women Ethnic Motifs Embroidered Thread Work Kurta",
                "url": "https://www.flipkart.com/anouk-kurta/p/itm123",
                "image_url": "https://rukminim2.flixcart.com/anouk.jpg",
                "snippet_price": 649.0,
            }
        ]
    svc._discover_candidates = mock_discover

    res = await svc.compare_product(
        source_url="https://www.myntra.com/kurtas/anouk/anouk-women-ethnic-motifs-embroidered-thread-work-kurta/31289196/buy",
        brand="Anouk",
        title="Anouk Women Ethnic Motifs Embroidered Thread Work Kurta",
        price=792.0,
        original_price=2199.0,
        image_url="https://assets.myntassets.com/anouk.jpg",
        retailer="myntra",
    )

    assert res["total_exact_stores"] == 2
    candidates = res["candidates"]
    # Lowest price is Flipkart (649) vs Myntra (792) -> Flipkart is BEST DEAL
    assert res["best_price"] == 649.0
    assert res["best_retailer"] == "flipkart"
    assert candidates[0]["is_best_deal"] is True
    assert candidates[0]["retailer"] == "flipkart"
    assert candidates[1]["retailer"] == "myntra"


def test_serpapi_google_lens_visual_match_verification():
    svc = URLProductComparisonService(serpapi_key="test-key")
    source_title = "Vbuyz Women Floral Print Straight Cotton Kurta"
    source_tokens = _extract_tokens(source_title)

    # Google Lens visual match candidate (different seller name e.g. DESI HULIA / Lascaux on Flipkart)
    cand_lens = {
        "title": "DESI HULIA Floral Printed V-Neck Kurti(M) by Myntra",
        "url": "https://www.myntra.com/kurtas/desi-hulia/123/buy",
        "is_visual_match": True,
    }

    is_exact, conf, reason = svc._verify_exact_product(
        source_brand="Vbuyz",
        source_title=source_title,
        source_tokens=source_tokens,
        source_style_id=None,
        candidate=cand_lens,
    )
    assert is_exact is True
    assert conf >= 90.0
    assert "Google Lens" in reason

    # Visual match on non-product URL (search page) should be rejected
    cand_search_url = {
        "title": "DESI HULIA Kurtas Search Results",
        "url": "https://www.myntra.com/kurtas/search?q=desi+hulia",
        "is_visual_match": True,
    }
    is_exact_bad_url, _, _ = svc._verify_exact_product(
        source_brand="Vbuyz",
        source_title=source_title,
        source_tokens=source_tokens,
        source_style_id=None,
        candidate=cand_search_url,
    )
    assert is_exact_bad_url is False

