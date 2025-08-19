from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from uuid import uuid4
import json, os
from pathlib import Path

from app.tasks import pipeline_launch

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
    audience: str = Form(...),
    benefits: str = Form(...),
    pain_points: str = Form(...),
    base_price: Optional[float] = Form(None),
    title: Optional[str] = Form(None),
    images: List[UploadFile] = []
):
    test_id = str(uuid4())
    payload = ProductInput(
        title=title,
        base_price=base_price,
        audience=audience,
        benefits=json.loads(benefits),
        pain_points=json.loads(pain_points),
    ).model_dump()

    pipeline_launch.delay(test_id, payload)
    return {"test_id": test_id, "status": "queued"}

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
