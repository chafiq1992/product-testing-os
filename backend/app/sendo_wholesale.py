"""Same-origin bridge between the vendor portal and Sendo's wholesale API."""

import os
from typing import Annotated, Literal
from urllib.parse import unquote
from uuid import UUID

import requests
from fastapi import APIRouter, HTTPException, Path, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool


router = APIRouter(prefix="/api/wholesale/sendo", tags=["sendo-wholesale"])
MAX_REQUEST_BYTES = 64 * 1024
NO_STORE = {"Cache-Control": "no-store"}


def _sendo_request(
    method: str,
    path: str,
    headers: dict[str, str],
    params: list[tuple[str, str]],
    body: bytes | None,
) -> requests.Response:
    origin = (os.getenv("SENDO_WHOLESALE_API_ORIGIN") or os.getenv("SENDO_DELIVERY_URL") or "https://sendo.delivery").strip().rstrip("/")
    with requests.Session() as session:
        # Service requests use only the credentials supplied for this operation.
        session.trust_env = False
        return session.request(
            method,
            f"{origin}/integrations/wholesale{path}",
            headers=headers,
            params=params,
            data=body,
            timeout=(5, 25),
            allow_redirects=False,
        )


async def _proxy(request: Request, path: str, *, login: bool = False, listing: bool = False) -> Response:
    headers = {"Accept": "application/json"}
    if not login:
        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token or len(token) > 2048:
            raise HTTPException(401, "Vendor sign-in required", headers=NO_STORE)
        headers["Authorization"] = f"Bearer {token}"

    params = []
    if listing:
        params = [(key, request.query_params[key]) for key in ("offset", "limit") if key in request.query_params]
        if path != "/orders":
            search = request.headers.get("X-Wholesale-Search", "")
            if len(search) > 1200 or len(unquote(search)) > 100:
                raise HTTPException(422, "Search is too long", headers=NO_STORE)
            if search:
                headers["X-Wholesale-Search"] = search
            elif "q" in request.query_params:
                params.append(("q", request.query_params["q"]))

    body = None
    if request.method in ("POST", "PUT"):
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise HTTPException(415, "Send a JSON request", headers=NO_STORE)
        payload = bytearray()
        async for chunk in request.stream():
            if len(payload) + len(chunk) > MAX_REQUEST_BYTES:
                raise HTTPException(413, "Request is too large", headers=NO_STORE)
            payload.extend(chunk)
        body = bytes(payload)
        headers["Content-Type"] = "application/json"

    try:
        upstream = await run_in_threadpool(_sendo_request, request.method, path, headers, params, body)
    except requests.Timeout:
        return JSONResponse({"detail": "Sendo did not respond in time"}, status_code=504, headers=NO_STORE)
    except requests.RequestException:
        return JSONResponse({"detail": "Sendo is temporarily unavailable"}, status_code=502, headers=NO_STORE)

    if upstream.status_code >= 500:
        return JSONResponse(
            {"detail": "Sendo is temporarily unavailable"}, status_code=upstream.status_code, headers=NO_STORE
        )
    content_type = upstream.headers.get("Content-Type", "").partition(";")[0].strip().lower()
    if 300 <= upstream.status_code < 400 or content_type != "application/json":
        return JSONResponse({"detail": "Sendo returned an unexpected response"}, status_code=502, headers=NO_STORE)

    if upstream.status_code == 422:
        return JSONResponse({"detail": "Check the submitted fields"}, status_code=422, headers=NO_STORE)

    response_headers = NO_STORE.copy()
    if upstream.status_code == 429 and "Retry-After" in upstream.headers:
        response_headers["Retry-After"] = upstream.headers["Retry-After"]
    return Response(upstream.content, status_code=upstream.status_code, headers=response_headers, media_type="application/json")


@router.post("/session")
async def start_vendor_session(request: Request) -> Response:
    return await _proxy(request, "/session", login=True)


@router.get("/session")
async def vendor_session(request: Request) -> Response:
    return await _proxy(request, "/session")


@router.get("/{resource}")
async def vendor_records(resource: Literal["products", "customers", "orders"], request: Request) -> Response:
    return await _proxy(request, f"/{resource}", listing=True)


@router.post("/{resource}")
async def create_vendor_record(resource: Literal["products", "customers", "orders"], request: Request) -> Response:
    return await _proxy(request, f"/{resource}")


@router.put("/products/{product_id}")
async def edit_vendor_product(product_id: Annotated[int, Path(gt=0)], request: Request) -> Response:
    return await _proxy(request, f"/products/{product_id}")


@router.put("/customers/{customer_id}")
async def edit_vendor_customer(customer_id: UUID, request: Request) -> Response:
    return await _proxy(request, f"/customers/{customer_id}")
