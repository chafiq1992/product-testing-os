"""Persisted, sequential wholesale imports using the existing product pipeline."""
import asyncio
import hashlib
import json
import logging
import math
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, String, Text, or_
from sqlalchemy.exc import IntegrityError

from app import db

router = APIRouter(prefix="/api/wholesale/vendors/{vendor_id}/product-batches")
log = logging.getLogger("app.wholesale.batch")


class Batch(db.Base):
    __tablename__ = "wholesale_product_batches"
    id = Column(String, primary_key=True)
    vendor_id = Column(String, nullable=False, index=True)
    fingerprint = Column(String, nullable=False)
    status = Column(String, nullable=False, default="queued", index=True)
    payload = Column(Text, nullable=False)
    items = Column(Text, nullable=False)
    lease = Column(String, nullable=True)
    lease_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Batch.__table__.create(db.engine, checkfirst=True)


class BatchImage(BaseModel):
    image_url: str = Field(min_length=1, max_length=4096)
    name: str = Field(default="", max_length=255)


class BatchRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=100)
    images: list[BatchImage] = Field(min_length=1, max_length=50)
    shared: dict


def _vendor(vendor_id):
    from app.main import WHOLESALE_STORE, _wholesale_vendor_key
    vid = vendor_id.strip().lower()
    vendor = db.get_app_setting(WHOLESALE_STORE, _wholesale_vendor_key(vid))
    if not isinstance(vendor, dict):
        raise HTTPException(404, "Vendor not found")
    return vid, vendor


def _view(row):
    items = json.loads(row.items)
    return {"id": row.id, "status": row.status, "items": items,
            "total": len(items), "completed": sum(i["status"] == "completed" for i in items),
            "failed": sum(i["status"] in {"failed", "needs_review"} for i in items)}


def read_batch(vendor_id, batch_id):
    with db.SessionLocal() as session:
        row = session.get(Batch, batch_id)
        if not row or row.vendor_id != vendor_id:
            raise HTTPException(404, "Batch not found")
        return _view(row)


def _validate_shared(shared, vendor):
    from app.main import WholesaleProductCreate, WHOLESALE_STORE_TYPES
    # Image-derived fields must never leak from the single-product form.
    allowed = {"store_type", "cog_price", "sale_price", "compare_at_price", "size_groups"}
    req = WholesaleProductCreate(**{k: v for k, v in shared.items() if k in allowed})
    req.store_type = (req.store_type or vendor.get("store_type") or "general").strip().lower()
    if req.store_type not in WHOLESALE_STORE_TYPES:
        raise ValueError("Invalid product type")
    if not req.size_groups:
        raise ValueError("Add at least one size or quantity")
    for group in req.size_groups:
        if req.store_type in {"general", "electronics"} and group.get("option_name"):
            if not str(group.get("label") or "").strip():
                raise ValueError("Enter a size or version")
            if len(req.size_groups) != 1:
                raise ValueError("Use one size or version per product")
        for key in ("pcs_per_crate", "crate_quantity"):
            value = float(group.get(key) or 0)
            if not math.isfinite(value) or value <= 0 or not value.is_integer():
                raise ValueError("Quantities and pieces per crate must be positive whole numbers")
        for key in ("sale_price", "cog_price", "compare_at_price"):
            value = float(group.get(key) if group.get(key) is not None else getattr(req, key) or 0)
            if not math.isfinite(value) or value < 0 or (key == "sale_price" and value == 0):
                raise ValueError("Enter valid prices, including a sale price greater than zero")
        if req.store_type == "shoes":
            start, end = float(group.get("from") or 0), float(group.get("to") or 0)
            if not all(math.isfinite(n) and n > 0 and n.is_integer() for n in (start, end)) or end < start:
                raise ValueError("Enter a valid size range")
            if not str(group.get("sku") or "").strip():
                raise ValueError("SKU is required")
    return req.model_dump()


@router.post("")
async def create_batch(vendor_id: str, req: BatchRequest, background_tasks: BackgroundTasks):
    vid, vendor = _vendor(vendor_id)
    try:
        shared = _validate_shared(req.shared, vendor)
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error
    images = [i.model_dump() for i in req.images]
    if any(not i["image_url"].startswith(("https://", "http://", "/uploads/")) for i in images):
        raise HTTPException(422, "Upload each product image before creating the batch")
    if len({i["image_url"] for i in images}) != len(images):
        raise HTTPException(422, "The same image appears more than once")
    payload = json.dumps({"shared": shared, "images": images}, sort_keys=True)
    fingerprint = hashlib.sha256(payload.encode()).hexdigest()
    batch_id = hashlib.sha256(f"{vid}:{req.request_id}".encode()).hexdigest()[:32]
    with db.SessionLocal() as session:
        row = session.get(Batch, batch_id)
        if not row:
            row = Batch(id=batch_id, vendor_id=vid, fingerprint=fingerprint, payload=payload,
                        items=json.dumps([{**i, "status": "queued"} for i in images]))
            session.add(row)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                row = session.get(Batch, batch_id)
        if row.fingerprint != fingerprint:
            raise HTTPException(409, "This submission already exists with different inputs")
        result = _view(row)
    background_tasks.add_task(run_batch, batch_id)
    return {"data": result}


@router.get("")
async def list_batches(vendor_id: str):
    vid, _ = _vendor(vendor_id)
    with db.SessionLocal() as session:
        rows = session.query(Batch).filter_by(vendor_id=vid).order_by(Batch.created_at.desc()).limit(10).all()
        return {"data": [_view(row) for row in rows]}


@router.get("/{batch_id}")
async def get_batch(vendor_id: str, batch_id: str, background_tasks: BackgroundTasks):
    vid, _ = _vendor(vendor_id)
    result = read_batch(vid, batch_id)
    if result["status"] in {"queued", "running"}:
        background_tasks.add_task(run_batch, batch_id)
    return {"data": result}


@router.post("/{batch_id}/retry")
async def retry_batch(vendor_id: str, batch_id: str, background_tasks: BackgroundTasks):
    vid, _ = _vendor(vendor_id)
    with db.SessionLocal() as session:
        row = session.get(Batch, batch_id)
        if not row or row.vendor_id != vid:
            raise HTTPException(404, "Batch not found")
        if row.status != "completed_with_errors":
            raise HTTPException(409, "Wait for the batch to finish")
        items = json.loads(row.items)
        for item in items:
            # Never recreate a product whose Shopify write may have succeeded.
            if item["status"] == "failed" and not item.get("product_id"):
                item["status"] = "queued"
                item.pop("error", None)
        changed = session.query(Batch).filter_by(id=batch_id, status="completed_with_errors").update(
            {"items": json.dumps(items), "status": "queued"})
        session.commit()
        if not changed:
            raise HTTPException(409, "Batch is already being retried")
    background_tasks.add_task(run_batch, batch_id)
    return {"data": read_batch(vid, batch_id)}


def _claim(batch_id):
    now = datetime.utcnow()
    token = uuid4().hex
    with db.SessionLocal() as session:
        changed = session.query(Batch).filter(
            Batch.id == batch_id, Batch.status.in_(["queued", "running"]),
            or_(Batch.lease_until.is_(None), Batch.lease_until < now),
        ).update({"lease": token, "lease_until": now + timedelta(minutes=5), "status": "running"})
        session.commit()
        if not changed:
            return None
        row = session.get(Batch, batch_id)
        return token, row.vendor_id, json.loads(row.payload), json.loads(row.items)


def _checkpoint(batch_id, token, items, status="running"):
    with db.SessionLocal() as session:
        changed = session.query(Batch).filter_by(id=batch_id, lease=token).update({
            "items": json.dumps(items), "status": status,
            "lease_until": datetime.utcnow() + timedelta(minutes=5) if status == "running" else None,
            "lease": token if status == "running" else None,
        })
        session.commit()
        if not changed:
            raise RuntimeError("Batch processing lease expired")


async def _heartbeat(batch_id, token):
    while True:
        await asyncio.sleep(30)
        with db.SessionLocal() as session:
            session.query(Batch).filter_by(id=batch_id, lease=token).update(
                {"lease_until": datetime.utcnow() + timedelta(minutes=5)})
            session.commit()


async def run_batch(batch_id):
    from app import main
    claimed = _claim(batch_id)
    if not claimed:
        return
    token, vendor_id, payload, items = claimed
    heartbeat = asyncio.create_task(_heartbeat(batch_id, token))
    try:
        for item in items:
            if item["status"] in {"creating", "processing"}:
                item.update(status="needs_review", error="Processing was interrupted. Check the product before adding it again.")
            elif item["status"] == "analyzing":
                item["status"] = "queued"  # No Shopify write has started.
            if item["status"] != "queued":
                continue
            item["status"] = "analyzing"
            _checkpoint(batch_id, token, items)
            try:
                analysis = await main.api_wholesale_analyze_image(main.WholesaleAnalyzeImageRequest(
                    image_url=item["image_url"], target_category=payload["shared"]["store_type"]))
                ai = analysis.get("data")
                if not isinstance(ai, dict) or not ai.get("title"):
                    raise RuntimeError("Image analysis failed. Retry this image.")
                colors = ai.get("colors") or [v.get("name") for v in (ai.get("variants") or []) if isinstance(v, dict)]
                req = main.WholesaleProductCreate(**{**payload["shared"], "image_url": item["image_url"],
                    "title": ai.get("title"), "description": ". ".join(ai.get("benefits") or []),
                    "colors": [str(c).strip() for c in colors if str(c or "").strip()],
                    "segment": ai.get("segment"), "season": ai.get("season"),
                    "collection": ai.get("collection"), "product_type": ai.get("product_type"), "tags": ai.get("tags")})
                req._analysis = ai
                req._strict_processing = True
                item.update(status="creating", title=ai["title"])
                _checkpoint(batch_id, token, items)
                work = BackgroundTasks()
                result = await main.api_wholesale_create_product(vendor_id, req, work)
                product_id = (((result.get("data") or {}).get("product") or {}).get("id"))
                if result.get("error") or not product_id:
                    raise RuntimeError("Product creation could not be confirmed. Check your catalog before adding it again.")
                item.update(status="processing", product_id=product_id)
                _checkpoint(batch_id, token, items)
                await work()  # Finish this image before moving to the next one.
                item["status"] = "completed"
            except Exception:
                log.exception("Wholesale batch %s image failed", batch_id)
                needs_review = item["status"] in {"creating", "processing"}
                item.update(status="needs_review" if needs_review else "failed",
                            error="Check this product in your catalog; setup may be incomplete." if needs_review else "Image analysis failed. Retry this image.")
            _checkpoint(batch_id, token, items)
        status = "completed_with_errors" if any(i["status"] != "completed" for i in items) else "completed"
        _checkpoint(batch_id, token, items, status)
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass


async def recover_batches():
    """Resume persisted work on a new instance, with database leases preventing duplicates."""
    while True:
        try:
            with db.SessionLocal() as session:
                ids = [row.id for row in session.query(Batch).filter(
                    Batch.status.in_(["queued", "running"]),
                    or_(Batch.lease_until.is_(None), Batch.lease_until < datetime.utcnow()),
                ).order_by(Batch.created_at).limit(10).all()]
            for batch_id in ids:
                await run_batch(batch_id)
        except Exception:
            log.exception("Wholesale batch recovery failed")
        await asyncio.sleep(60)
