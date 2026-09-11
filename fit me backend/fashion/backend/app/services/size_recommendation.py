from app.models.body_profile import BodyProfile
from app.models.garment import Garment


DEFAULT_SIZE_CHART = {
    "S": {"chest": 88, "waist": 76, "shoulder": 38},
    "M": {"chest": 96, "waist": 84, "shoulder": 41},
    "L": {"chest": 104, "waist": 92, "shoulder": 44},
    "XL": {"chest": 112, "waist": 100, "shoulder": 47},
}


def _nearest_size(profile: BodyProfile, chart: dict) -> tuple[str, float]:
    chest = profile.chest_cm or 92
    waist = profile.waist_cm or 78
    shoulder = profile.shoulder_width_cm or 40
    best_size = "M"
    best_score = float("inf")
    for size, values in chart.items():
        score = abs(float(values.get("chest", chest)) - chest) + abs(float(values.get("waist", waist)) - waist) + abs(float(values.get("shoulder", shoulder)) - shoulder) * 1.5
        if score < best_score:
            best_size = size
            best_score = score
    confidence = max(0.55, min(0.96, 1 - best_score / 80))
    return best_size, round(confidence, 2)


def recommend_size(profile: BodyProfile, garment: Garment) -> dict:
    chart = garment.size_chart or DEFAULT_SIZE_CHART
    size, confidence = _nearest_size(profile, chart)
    values = chart.get(size, DEFAULT_SIZE_CHART.get(size, DEFAULT_SIZE_CHART["M"]))
    chest_delta = float(values.get("chest", profile.chest_cm or 92)) - float(profile.chest_cm or 92)
    shoulder_delta = float(values.get("shoulder", profile.shoulder_width_cm or 40)) - float(profile.shoulder_width_cm or 40)
    chest_fit = "tight" if chest_delta < 2 else "loose" if chest_delta > 10 else "comfortable"
    shoulder_fit = "tight" if shoulder_delta < 0 else "loose" if shoulder_delta > 4 else "true"
    tone = "This colour should photograph well against your detected skin tone."
    return {
        "size": size,
        "confidence": confidence,
        "fit_description": f"{size} is the closest match based on chest, waist, and shoulder measurements.",
        "chest_fit": chest_fit,
        "shoulder_fit": shoulder_fit,
        "skin_tone_note": tone,
    }

