from fastapi import FastAPI, UploadFile, Form, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from uuid import uuid4
import json, os
from pathlib import Path

from app.tasks import pipeline_launch, run_pipeline_sync
from app.storage import save_file
from app.config import BASE_URL
from app import db

app = FastAPI(title="Product Testing OS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Determine uploads directory – default /app/uploads (inside container) but for local dev use project_root/uploads.
UPLOADS_DIR = os.getenv("UPLOADS_DIR") or str(Path(__file__).resolve().parents[1] / "uploads")
# ensure uploads dir exists
Path(UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

class ProductInput(BaseModel):
    title: Optional[str] = None
    base_price: Optional[float] = None
    currency: str = "MAD"
    audience: str
    benefits: List[str]
    pain_points: List[str]
    niche: Optional[str] = None

@app.post("/api/tests")
async def create_test(
    request: Request,
    audience: str = Form(...),
    benefits: str = Form(...),
    pain_points: str = Form(...),
    base_price: Optional[float] = Form(None),
    title: Optional[str] = Form(None),
    images: List[UploadFile] = File([])
):
    test_id = str(uuid4())
    payload = ProductInput(
        title=title,
        base_price=base_price,
        audience=audience,
        benefits=json.loads(benefits),
        pain_points=json.loads(pain_points),
    ).model_dump()

    # Save uploaded images (if any) and include absolute URLs in payload
    uploaded_urls: List[str] = []
    # Determine base URL: prefer env BASE_URL if set, otherwise derive from request
    req_base = str(request.base_url).rstrip("/")
    abs_base = BASE_URL or req_base
    for i, f in enumerate(images or []):
        filename = f"{test_id}_{i}_{f.filename}"
        url_path = save_file(filename, await f.read())  # returns /uploads/...
        # Construct absolute URL so worker/Meta can access it
        if abs_base.endswith("/"):
            uploaded_urls.append(f"{abs_base[:-1]}{url_path}")
        else:
            uploaded_urls.append(f"{abs_base}{url_path}")

    if uploaded_urls:
        payload["uploaded_images"] = uploaded_urls

    # Persist initial queued test
    db.create_test_row(test_id, payload)

    # Run synchronously by default unless USE_CELERY is explicitly enabled
    use_celery = os.getenv("USE_CELERY", "false").lower() in ("1", "true", "yes")
    if not use_celery:
        import threading
        threading.Thread(target=run_pipeline_sync, args=(test_id, payload), daemon=True).start()
    else:
        try:
            pipeline_launch.delay(test_id, payload)
        except Exception:
            # If enqueue fails (e.g., no broker), fall back to sync so tests aren't stuck
            import threading
            threading.Thread(target=run_pipeline_sync, args=(test_id, payload), daemon=True).start()

    return {"test_id": test_id, "status": "queued"}


@app.get("/api/tests/{test_id}")
async def get_test(test_id: str):
    t = db.get_test(test_id)
    if not t:
        return {"error": "not_found"}
    return t

@app.get("/health")
async def health():
    return {"ok": True}

# Mount static files last so that API routes have precedence.
# The directory is configurable via STATIC_DIR env var, otherwise we look for
#   - /app/static (inside container)
#   - <project-root>/frontend/out (local dev after `next export`)

STATIC_DIR = os.getenv("STATIC_DIR", "/app/static")
# fallback for local dev
if STATIC_DIR == "/app/static":
    alt = Path(__file__).resolve().parents[2] / "frontend" / "out"
    if alt.exists():
        STATIC_DIR = str(alt)

if Path(STATIC_DIR).exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    # Skip mounting when directory not found (e.g., during backend-only local dev)
    print(f"[WARN] Static directory '{STATIC_DIR}' not found. Frontend assets will not be served.")
