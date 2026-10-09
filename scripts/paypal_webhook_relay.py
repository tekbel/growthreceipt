import httpx
from fastapi import FastAPI, HTTPException, Request, Response

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BODY_BYTES = 1_000_000
LOCAL_WEBHOOK_URL = "http://127.0.0.1:8000/v1/paypal/webhooks"


@app.post("/v1/paypal/webhooks")
async def relay_paypal_webhook(request: Request) -> Response:
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Webhook payload too large")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Webhook payload too large")

    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() not in {"host", "content-length", "connection"}
    }
    async with httpx.AsyncClient(timeout=15) as client:
        upstream = await client.post(LOCAL_WEBHOOK_URL, content=body, headers=headers)

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
    )
