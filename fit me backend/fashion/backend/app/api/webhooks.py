from fastapi import APIRouter, Request, status

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])


@router.post("/shopify", status_code=status.HTTP_202_ACCEPTED)
async def shopify(request: Request) -> dict:
    topic = request.headers.get("X-Shopify-Topic", "unknown")
    return {"status": "accepted", "topic": topic}


@router.post("/stripe", status_code=status.HTTP_202_ACCEPTED)
async def stripe(request: Request) -> dict:
    event = await request.json()
    return {"status": "accepted", "event_type": event.get("type", "unknown")}

