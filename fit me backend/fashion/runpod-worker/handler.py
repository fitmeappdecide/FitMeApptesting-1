try:
    import runpod
except ImportError:
    runpod = None

from pipeline import synthesize_tryon


def handler(event: dict) -> dict:
    return synthesize_tryon(event.get("input", {}))


if __name__ == "__main__":
    if runpod:
        runpod.serverless.start({"handler": handler})
    else:
        print(handler({"input": {"garment_id": "local", "cluster_key": "h168_c92_w76_hip96"}}))

