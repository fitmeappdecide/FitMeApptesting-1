from dataclasses import dataclass

from app.core.config import settings


@dataclass(frozen=True)
class ModelStatus:
    body_pose: bool
    body_mesh: bool
    garment_segmentation: bool
    tryon_synthesis: bool
    face_identity: bool


class ModelManager:
    def __init__(self) -> None:
        self.mode = settings.gpu_mode

    def status(self) -> ModelStatus:
        return ModelStatus(
            body_pose=True,
            body_mesh=True,
            garment_segmentation=True,
            tryon_synthesis=bool(settings.runpod_api_key or self.mode in {"local", "aws"}),
            face_identity=True,
        )


model_manager = ModelManager()

