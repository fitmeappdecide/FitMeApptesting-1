"""Full pipeline orchestrator: image -> profile -> strategies -> retailers ->
rerank -> similarity -> confidence -> exact vs closest."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from .image_pipeline import prepare_image
from .hard_filter import hard_filter
from .ocr_vision import (
    OCRResult,
    LogoBrand,
    ocr_result_from_paddle,
    logo_brand_from_yolo,
    merge_tag_evidence,
    understand_product,
    rerank_candidates,
    image_similarity,
)
from .product_intelligence import (
    merge_profile,
    generate_search_strategies,
    profile_to_dict,
)
from .confidence import score_candidate, retail_consistency
from .product_cache import manager as product_cache
from .learning import engine as learning_engine
from adapters.registry import display_name
from providers.candidates.pool import acquire_candidates
from providers.ocr.registry import get_active_ocr_result
from providers.logo.registry import get_active_logo_result
from providers.similarity.registry import get_active_similarity_result
from providers.barcode.registry import get_active_barcode_result
from providers.googlevision.registry import get_web_detection_result

logger = logging.getLogger(__name__)


EXACT_MATCH_THRESHOLD = 95.0
CLOSEST_MATCH_THRESHOLD = 80.0


async def _download_b64(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as c:
            r = await c.get(url)
        if r.status_code != 200 or not r.content:
            return None
        import base64
        return base64.b64encode(r.content).decode("ascii")
    except Exception:  # noqa: BLE001
        return None


async def run_scan(image_b64: str, mime: Optional[str] = None,
                   tag_image_b64: Optional[str] = None,
                   tag_mime: Optional[str] = None) -> Dict[str, Any]:
    """`image_b64` is always the GARMENT photo (V2: garment-first). `tag_image_b64`
    is optional supplementary evidence — a photo of the care/size tag, if the
    user provides one. When absent, behavior is byte-for-byte identical to
    before V2 Phase 1 (backward compatible)."""
    scan_id = uuid.uuid4().hex
    stages: List[Dict[str, Any]] = []
    started = time.time()

    def stage(name: str, status: str = "done", **extras):
        stages.append({"name": name, "status": status, "t_ms": int((time.time() - started) * 1000), **extras})

    # 1) Mandatory serial prerequisite: decode -> validate -> OpenCV enhance
    # -> quality check. Every detector below depends on prepared.enhanced_*,
    # so this alone cannot be parallelized away.
    try:
        prepared = prepare_image(image_b64, mime)
    except ValueError as exc:
        stage("Image validation", status="error", error=str(exc))
        return {"scan_id": scan_id, "status": "invalid_image", "error": str(exc), "stages": stages}
    stage("Image validation")
    stage("Image enhancement")
    stage("Image quality", sharpness=prepared.quality.sharpness, brightness=prepared.quality.brightness,
          is_blurry=prepared.quality.is_blurry)

    # 2) Evidence Providers — Barcode/QR, OCR, Logo, and (V2 Phase 2) Google
    # Vision Web Detection now go through the Phase 9 provider registries
    # (providers/<category>/registry.py): config-driven active/fallback
    # selection (providers.yaml), enforced timeouts (a hung provider can no
    # longer hang the whole scan), uniform ProviderResult reporting. Still
    # run concurrently — the registries wrap what each task calls, they
    # don't change that these four are independent. Google Vision is
    # ADDITIVE (see providers/googlevision/registry.py) — it never competes
    # for "active" selection with any of the other three; when disabled or
    # unconfigured it simply returns ok=False and contributes nothing,
    # exactly like a locally-unavailable model degrading to its fallback.
    barcode_result, ocr_result, logo_result, vision_result = await asyncio.gather(
        get_active_barcode_result(scan_id, prepared.enhanced_img),
        get_active_ocr_result(scan_id, prepared.enhanced_b64),
        get_active_logo_result(scan_id, prepared.enhanced_b64),
        get_web_detection_result(scan_id, prepared.enhanced_b64),
    )
    barcode_hits, qr_hits = barcode_result.value if barcode_result.value else ([], [])
    barcodes = [b.value for b in barcode_hits]
    qrs = [q.value for q in qr_hits]
    stage("Barcode detection", count=len(barcodes), values=barcodes,
          provider=barcode_result.provider_name, t_task_ms=barcode_result.latency_ms)
    stage("QR detection", count=len(qrs), values=qrs,
          provider=barcode_result.provider_name, t_task_ms=barcode_result.latency_ms)

    if ocr_result.ok:
        ocr = (ocr_result_from_paddle(ocr_result.value) if ocr_result.provider_name == "paddleocr"
              else ocr_result.value)
    else:
        logger.warning("All OCR providers failed for scan %s", scan_id)
        ocr = OCRResult()

    if logo_result.ok:
        logo = (logo_brand_from_yolo(logo_result.value) if logo_result.provider_name == "yolov11"
               else logo_result.value)
    else:
        logger.warning("All logo providers failed for scan %s", scan_id)
        logo = LogoBrand()

    stage("OCR extraction", provider=ocr_result.provider_name, fallback_used=ocr_result.fallback_used,
          product_name=ocr.product_name, sku=ocr.sku, t_task_ms=ocr_result.latency_ms)
    stage("Logo recognition", provider=logo_result.provider_name, fallback_used=logo_result.fallback_used,
          brand_guess=logo.brand_guess, logos=logo.detected_logos, t_task_ms=logo_result.latency_ms)

    vision_evidence = vision_result.value.evidence if vision_result.ok else None
    stage("Google Vision Web Detection", status="done" if vision_result.ok else "skipped",
          ok=vision_result.ok, error=vision_result.error, t_task_ms=vision_result.latency_ms,
          labels=[l.description for l in vision_evidence.best_guess_labels] if vision_evidence else [],
          candidate_urls=len(vision_result.value.candidate_urls) if vision_result.ok else 0)

    # V2 Phase 1 (Input Layer): optional tag photo, additional evidence only —
    # never the primary source. Tag OCR/barcode take priority over the
    # garment's own read for identifier fields (merge_tag_evidence), since a
    # tag photo exists specifically to capture SKU/style/size/price cleanly.
    # Logo/similarity/vision stay garment-primary per the V2 evidence list —
    # a tag photo doesn't carry visual garment attributes.
    if tag_image_b64:
        try:
            tag_prepared = prepare_image(tag_image_b64, tag_mime)
            tag_barcode_result, tag_ocr_result = await asyncio.gather(
                get_active_barcode_result(scan_id, tag_prepared.enhanced_img),
                get_active_ocr_result(scan_id, tag_prepared.enhanced_b64),
            )
            tag_barcode_hits, tag_qr_hits = (
                tag_barcode_result.value if tag_barcode_result.value else ([], [])
            )
            tag_barcodes = [b.value for b in tag_barcode_hits]
            tag_qrs = [q.value for q in tag_qr_hits]
            barcodes = list(dict.fromkeys(barcodes + tag_barcodes))
            qrs = list(dict.fromkeys(qrs + tag_qrs))

            if tag_ocr_result.ok:
                tag_ocr = (ocr_result_from_paddle(tag_ocr_result.value)
                          if tag_ocr_result.provider_name == "paddleocr" else tag_ocr_result.value)
                ocr = merge_tag_evidence(ocr, tag_ocr)
            stage("Tag evidence", provider=tag_ocr_result.provider_name, ok=tag_ocr_result.ok,
                  barcodes_added=len(tag_barcodes), qrs_added=len(tag_qrs),
                  sku=ocr.sku, style_number=ocr.style_number)
        except ValueError as exc:
            # Tag photo failed validation (e.g. too small/corrupt) — it's
            # supplementary, so the scan continues on the garment alone
            # rather than failing the whole request.
            stage("Tag evidence", status="skipped", error=str(exc))
            logger.warning("Tag photo invalid for scan %s, continuing garment-only: %s", scan_id, exc)

    # 3) Single Gemini call (Phase 2, Section 8) — reasons over the Evidence
    # Bundle above, does not re-extract OCR/logo itself.
    vision = await understand_product(scan_id, prepared.enhanced_b64, ocr, barcodes, qrs, logo)
    stage("AI vision understanding", category=vision.category, gender=vision.gender)

    # 3) Structured profile + strategies
    profile = merge_profile(ocr, logo, vision, barcodes, qrs, vision_web=vision_evidence)
    strategies = generate_search_strategies(profile)
    stage("Structured profile", brand=profile.brand, category=profile.category,
          web_brand_guess=profile.web_brand_guess)
    stage("Search strategies", count=len(strategies), items=[
        {"name": s.name, "kind": s.kind, "query": s.query} for s in strategies
    ])

    # Computed once here (was previously computed later, right before Hard
    # Filter) so the Product Cache Lookup below — and every early-return
    # branch — can use the same dict.
    profile_dict = profile_to_dict(profile)

    # Product Cache Lookup (V2 Phase 6) — sits between Retail Intelligence
    # (used per-candidate inside Candidate Acquisition's providers, not as
    # a separate upstream stage — see ARCHITECTURE.md for why the original
    # frozen diagram's "Brand Intelligence -> Retail Intelligence" gate
    # doesn't correspond to a real pre-acquisition step) and Candidate
    # Acquisition itself. A hit skips Candidate Acquisition, Web
    # Extraction, Hard Filter, Metadata Agreement, OpenCLIP, and Gemini
    # Verification entirely and returns straight to Results/Try-On.
    cached = await product_cache.lookup(profile_dict)
    stage("Product cache lookup", status="hit" if cached else "miss")
    if cached is not None:
        return {
            "scan_id": scan_id,
            "status": "ok",
            "match_status": cached["match_status"],
            "match_label": {
                "exact": "Exact Match",
                "closest": "Closest Matching Product",
                "similar": "We found similar products",
            }[cached["match_status"]],
            "top_confidence": cached["top_confidence"],
            "profile": profile_dict,
            "strategies": [
                {"name": s.name, "kind": s.kind, "query": s.query} for s in strategies
            ],
            "candidates": cached["candidates"],
            "cache": {"hit": True, "fingerprint_hash": cached["fingerprint_hash"],
                      "verified_at": cached["verified_at"]},
            "stages": stages,
            "elapsed_ms": int((time.time() - started) * 1000),
        }

    # 4) Retail search — run all adapters in parallel
    if not strategies:
        stage("Retail search", status="skipped")
        return {
            "scan_id": scan_id,
            "status": "no_strategies",
            "profile": profile_dict,
            "stages": stages,
            "candidates": [],
            "elapsed_ms": int((time.time() - started) * 1000),
        }

    # Multi-Source Candidate Acquisition Engine (V2 Phase 3): Retail Search
    # runs exactly as before (Tier 1/Tier 2 identifier priority untouched,
    # wrapped by RetailSearchProvider) + Google Vision's already-fetched
    # result (from the evidence-collection gather above — NOT re-queried
    # here) + Brand Search, all as independent, concurrently-run,
    # pluggable providers. See providers/candidates/.
    raw_candidates = await acquire_candidates(
        strategies, profile, {"scan_id": scan_id, "vision_result": vision_result}
    )
    # Dedupe by candidate id (multiple strategies can return the same product)
    seen_ids: set[str] = set()
    unique: List = []
    for c in raw_candidates:
        if c.id in seen_ids:
            continue
        seen_ids.add(c.id)
        unique.append(c)
    raw_candidates = unique
    stage("Retail search", count=len(raw_candidates),
          by_retailer={r: sum(1 for c in raw_candidates if c.retailer == r)
                       for r in {c.retailer for c in raw_candidates}},
          by_source={src: sum(1 for c in raw_candidates if c.strategy == src)
                    for src in {c.strategy for c in raw_candidates}})

    if not raw_candidates:
        return {
            "scan_id": scan_id,
            "status": "no_matches",
            "profile": profile_dict,
            "strategies": [
                {"name": s.name, "kind": s.kind, "query": s.query} for s in strategies
            ],
            "stages": stages,
            "candidates": [],
            "elapsed_ms": int((time.time() - started) * 1000),
        }

    # 5) Hard Filter — deterministic, zero-cost rejection BEFORE any AI
    # verification call (Evidence Engine Spec, Section 5). Runs on every
    # candidate; only candidates that survive go on to the paid AI re-rank.
    # (profile_dict was already computed above, before the Product Cache
    # Lookup — not recomputed here.)
    normalized = [c.to_dict() for c in raw_candidates]
    survivors, rejected = hard_filter(profile_dict, normalized)
    stage("Hard filter", input_count=len(normalized), survived=len(survivors),
          rejected=len(rejected), reasons=[r.reason for r in rejected[:10]])

    if not survivors:
        return {
            "scan_id": scan_id,
            "status": "no_matches",
            "profile": profile_dict,
            "strategies": [
                {"name": s.name, "kind": s.kind, "query": s.query} for s in strategies
            ],
            "stages": stages,
            "candidates": [],
            "elapsed_ms": int((time.time() - started) * 1000),
        }

    # 6) Normalize + AI rerank — only on Hard Filter survivors
    reranked = await rerank_candidates(scan_id, profile_dict, survivors)
    stage("AI re-ranking", count=len(reranked))

    # 6) Image similarity — OpenCLIP primary (Evidence Engine Spec, Section
    # 6), Gemini only used as a fallback (OpenCLIP unavailable) or a
    # tie-break for genuinely ambiguous close calls between the top two
    # candidates. This is the "OpenCLIP -> Gemini Verification (only if
    # required)" step in the Phase 5 verification pipeline.
    CLIP_TIE_MARGIN = 0.03
    top_for_sim = reranked[:4]
    downloaded_cache: Dict[str, Optional[str]] = {}  # candidate id -> downloaded b64, reused by tie-break below

    async def _sim_for(c):
        img_url = c.get("image")
        if not img_url:
            return c["id"], 0.0, "none"
        rb = await _download_b64(img_url)
        downloaded_cache[c["id"]] = rb
        if not rb:
            return c["id"], 0.0, "none"
        sim_result = await get_active_similarity_result(scan_id, prepared.enhanced_b64, rb)
        return c["id"], sim_result.value, sim_result.provider_name

    sim_results = list(await asyncio.gather(*[_sim_for(c) for c in top_for_sim]))
    sim_map = {cid: s for cid, s, _ in sim_results}
    sim_provider_map = {cid: p for cid, s, p in sim_results}

    # Tie-break: only if the top two candidates both used OpenCLIP and their
    # scores are too close to trust a purely numeric embedding distance —
    # ask Gemini for closer semantic reasoning on just those two. This calls
    # image_similarity() directly rather than through the registry: it's a
    # deliberate override to get Gemini specifically, not a fallback
    # selection, so it doesn't belong in get_active_similarity_result's
    # active/fallback logic. Reuses the image bytes already downloaded above
    # (Phase 7 fix — this previously re-fetched the same candidate image
    # URLs a second time over the network, a real avoidable round-trip on
    # the critical path).
    ranked_by_sim = sorted(sim_results, key=lambda x: x[1], reverse=True)
    if len(ranked_by_sim) >= 2:
        (id1, s1, p1), (id2, s2, p2) = ranked_by_sim[0], ranked_by_sim[1]
        if p1 == "openclip" and p2 == "openclip" and abs(s1 - s2) < CLIP_TIE_MARGIN:
            for cid in (id1, id2):
                rb = downloaded_cache.get(cid)
                if rb:
                    sim_map[cid] = await image_similarity(scan_id, prepared.enhanced_b64, rb)
                    sim_provider_map[cid] = "gemini(tiebreak)"

    stage("Image similarity", count=len(sim_map),
          scores={cid: round(s, 3) for cid, s in sim_map.items()},
          providers=sim_provider_map)

    # 7) Confidence
    consistency = retail_consistency(reranked)
    scored: List[Dict[str, Any]] = []
    for c in reranked:
        sim = sim_map.get(c["id"], 0.0)
        conf, breakdown = score_candidate(profile_dict, c, image_sim=sim,
                                          retail_consistency=consistency,
                                          ocr_confidence=profile_dict.get("ocr_confidence", 0.0),
                                          logo_confidence=profile_dict.get("logo_confidence", 0.0))
        c2 = dict(c)
        c2["image_similarity"] = round(sim, 3)
        c2["confidence"] = conf
        c2["confidence_breakdown"] = breakdown.to_dict()
        c2["retailer_display"] = display_name(c2["retailer"])
        scored.append(c2)
    scored.sort(key=lambda x: (x["confidence"], x.get("ai_score", 0.0)), reverse=True)
    stage("Confidence calculation", top=scored[0]["confidence"] if scored else 0)

    # Learning Engine (V2 Phase 9) — may REORDER `scored` (verified-
    # identifier candidates are structurally exempt and always stay
    # first, in their existing order — see services/learning/engine.py's
    # module docstring for the full safety contract), but never rewrites
    # any candidate's `confidence` field. top_conf/match_status below are
    # therefore always computed from the real, deterministic Confidence
    # Engine score of whichever candidate ends up first — a Learning
    # Engine failure of any kind falls back to `scored` completely
    # unmodified, so this line can never make ranking WORSE than Phase 8.
    scored = await learning_engine.apply_learned_ranking(scored, profile_dict)
    stage("Learning engine ranking", applied=any("learned_boost" in c for c in scored))

    top_conf = scored[0]["confidence"] if scored else 0.0
    if top_conf >= EXACT_MATCH_THRESHOLD:
        match_status = "exact"
    elif top_conf >= CLOSEST_MATCH_THRESHOLD:
        match_status = "closest"
    else:
        match_status = "similar"

    # Product Cache Population (V2 Phase 6) — only AFTER verification,
    # ranking, and confidence calculation, and only for "exact"/"closest"
    # (the two verified-enough tiers per product decision — "similar" is
    # explicitly NOT cached, since it represents low-confidence/ambiguous
    # results that shouldn't be replayed to a future identical-looking scan).
    # Best-effort: a cache write failure never affects the response below.
    cache_populated = await product_cache.populate(profile_dict, match_status, top_conf, scored)
    stage("Product cache population", status="stored" if cache_populated else "skipped")

    # 8) Price comparison — group by "best match" (top candidate) or return all
    return {
        "scan_id": scan_id,
        "status": "ok",
        "match_status": match_status,
        "match_label": {
            "exact": "Exact Match",
            "closest": "Closest Matching Product",
            "similar": "We found similar products",
        }[match_status],
        "top_confidence": top_conf,
        "profile": profile_dict,
        "strategies": [
            {"name": s.name, "kind": s.kind, "query": s.query} for s in strategies
        ],
        "candidates": scored,
        "cache": {"hit": False},
        "stages": stages,
        "elapsed_ms": int((time.time() - started) * 1000),
    }
