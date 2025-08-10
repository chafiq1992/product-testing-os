from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from uuid import uuid4
import json

from app.tasks import pipeline_launch

app = FastAPI(title="Product Testing OS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")

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
