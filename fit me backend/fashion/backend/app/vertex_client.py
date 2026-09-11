import os
from google import genai
from google.genai.types import Image, ProductImage, RecontextImageSource, RecontextImageConfig
from app.core.config import settings


def get_vertex_client():
    """Create and return a Vertex AI GenAI client.
    The required environment variables must be set in **settings**:
    - ``vertex_project_id`` – GCP project ID where Vertex AI is enabled.
    - ``vertex_location`` – Region (e.g. ``us-central1``).
    """
    return genai.Client(
        enterprise=True,
        project=settings.vertex_project_id,
        location=settings.vertex_location,
    )


def call_recontext_image(
    model_name: str,
    person_image_path: str,
    garment_image_path: str,
    output_mime_type: str = "image/png",
    number_of_images: int = 1,
):
    """Run the Vertex AI *recontext_image* endpoint.

    Parameters
    ----------
    model_name: str
        Name of the Vertex model (e.g. ``"virtual-try-on-001"``).
    person_image_path: str
        Local path to the user‑photo.
    garment_image_path: str
        Local path to the garment image.
    output_mime_type: str, default ``"image/png"``
        Desired MIME type of the generated image.
    number_of_images: int, default ``1``
        How many images the model should return.
    """
    client = get_vertex_client()

    # Build Image objects required by the GenAI SDK
    person_image = Image.from_file(location=person_image_path)
    garment_image = Image.from_file(location=garment_image_path)
    source = RecontextImageSource(
        person_image=person_image,
        product_images=[ProductImage(product_image=garment_image)],
    )
    config = RecontextImageConfig(
        output_mime_type=output_mime_type,
        number_of_images=number_of_images,
    )

    response = client.models.recontext_image(
        model=model_name,
        source=source,
        config=config,
    )
    return response

# Example usage (run as a script)
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Call Vertex AI recontext_image model")
    parser.add_argument("--model", default="virtual-try-on-001", help="Vertex model name")
    parser.add_argument("--person", required=True, help="Path to person image")
    parser.add_argument("--garment", required=True, help="Path to garment image")
    args = parser.parse_args()

    resp = call_recontext_image(
        model_name=args.model,
        person_image_path=args.person,
        garment_image_path=args.garment,
    )
    print("--- RESPONSE OBJECT ---")
    print(resp)
    # If the SDK provides a model_dump method you can inspect the raw payload
    try:
        print(resp.model_dump())
    except Exception:
        pass
