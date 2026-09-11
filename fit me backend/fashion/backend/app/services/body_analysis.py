import hashlib
import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class BodyMeasurements:
    height_cm: float
    chest_cm: float
    waist_cm: float
    hips_cm: float
    shoulder_width_cm: float
    inseam_cm: float
    sleeve_cm: float
    skin_tone_fitzpatrick: int
    skin_tone_hex: str
    body_type: str
    face_embedding_ref: str
    smplx_params: dict


def cluster_key(measurements: BodyMeasurements) -> str:
    return (
        f"h{round(measurements.height_cm / 4) * 4}_"
        f"c{round(measurements.chest_cm / 4) * 4}_"
        f"w{round(measurements.waist_cm / 4) * 4}_"
        f"hip{round(measurements.hips_cm / 4) * 4}"
    )


def analyse_body(front_photo: bytes, back_photo: bytes | None, left_photo: bytes | None, right_photo: bytes | None) -> BodyMeasurements:
    digest = hashlib.sha256(front_photo + (back_photo or b"") + (left_photo or b"") + (right_photo or b"")).digest()
    height = 154 + digest[0] % 36
    chest = 78 + digest[1] % 34
    waist = 62 + digest[2] % 32
    hips = max(waist + 8, 82 + digest[3] % 34)
    shoulder = 34 + digest[4] % 14
    body_type = "average"
    if waist < 70 and chest < 88:
        body_type = "slim"
    elif chest > 100 or hips > 108:
        body_type = "plus"
    elif shoulder > 42 and chest > 94:
        body_type = "athletic"
    skin_scale = 1 + digest[5] % 6
    palette = {1: "#F6D7C3", 2: "#E8B894", 3: "#C88F68", 4: "#A66A43", 5: "#7A4B32", 6: "#4A2A1D"}
    return BodyMeasurements(
        height_cm=float(height),
        chest_cm=float(chest),
        waist_cm=float(waist),
        hips_cm=float(hips),
        shoulder_width_cm=float(shoulder),
        inseam_cm=round(height * 0.45, 1),
        sleeve_cm=round(height * 0.34, 1),
        skin_tone_fitzpatrick=skin_scale,
        skin_tone_hex=palette[skin_scale],
        body_type=body_type,
        face_embedding_ref=f"embeddings/{uuid.uuid4()}.npy",
        smplx_params={"height": height, "shape_digest": digest[:16].hex(), "landmarks": 33, "mesh_vertices": 10475},
    )

