from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from app import db
from app.config import UPLOADS_DIR
from app.storage import save_file


JOB_PREFIX = "ad_launcher:job:"
CAMPAIGN_SEQUENCE_PREFIX = "ad_launcher:campaign_sequence:"
_CAMPAIGN_SEQUENCE_LOCK = Lock()


def canonical_store(store: str | None) -> str:
    value = str(store or "default").strip().lower()
    return "irrakids" if value == "nouralibas" else (value or "default")


def _key(job_id: str) -> str:
    return f"{JOB_PREFIX}{str(job_id).strip()}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def campaign_letter(sequence: int) -> str:
    """Convert a one-based sequence to spreadsheet-style letters: A..Z, AA.."""
    value = int(sequence)
    if value < 1:
        raise ValueError("Campaign sequence must be positive")
    output = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        output = chr(65 + remainder) + output
    return output


def _letter_sequence(value: str) -> int:
    sequence = 0
    for character in str(value or "").upper():
        if not "A" <= character <= "Z":
            return 0
        sequence = sequence * 26 + ord(character) - 64
    return sequence


def reserve_campaign_name(store: str | None, ad_account_id: str | None, product_id: str) -> str:
    """Reserve the next store/account/product campaign name, such as 123A then 123B."""
    normalized_store = canonical_store(store)
    normalized_account = str(ad_account_id or "default").strip().removeprefix("act_") or "default"
    numeric_id = str(product_id or "").strip().split("/")[-1]
    if not numeric_id.isdigit():
        raise ValueError("A numeric Shopify product ID is required for campaign sequencing")
    sequence_key = f"{CAMPAIGN_SEQUENCE_PREFIX}{normalized_account}:{numeric_id}"

    with _CAMPAIGN_SEQUENCE_LOCK:
        saved = db.get_app_setting(normalized_store, sequence_key)
        highest = int(saved or 0) if str(saved or "").isdigit() else 0
        pattern = re.compile(rf"^{re.escape(numeric_id)}([A-Z]+)$")
        with db.SessionLocal() as session:
            rows = (
                session.query(db.AppSetting)
                .filter(db.AppSetting.store == normalized_store, db.AppSetting.key.like(f"{JOB_PREFIX}%"))
                .all()
            )
        for row in rows:
            try:
                job = json.loads(row.value or "{}")
                request_data = dict(job.get("request") or {})
                plan = dict((job.get("result") or {}).get("plan") or {})
                if str(request_data.get("meta_ad_account_id") or "default") != normalized_account:
                    continue
                name = str(request_data.get("campaign_name") or plan.get("campaign_name") or "").upper()
                match = pattern.fullmatch(name)
                if match:
                    highest = max(highest, _letter_sequence(match.group(1)))
            except Exception:
                continue
        next_sequence = highest + 1
        db.set_app_setting(normalized_store, sequence_key, next_sequence)
        return f"{numeric_id}{campaign_letter(next_sequence)}"


def create_job(store: str | None, job_id: str, request_data: dict[str, Any]) -> dict[str, Any]:
    created_at = utc_now()
    row = {
        "id": job_id,
        "store": canonical_store(store),
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "created_at": created_at,
        "updated_at": created_at,
        "request": request_data,
        "result": None,
        "error": None,
        "activity": [{
            "at": created_at,
            "stage": "queued",
            "status": "completed",
            "title": "Campaign request received",
            "summary": "The selected store, Meta ad account, product, budget, and creative files were locked for this job.",
        }],
    }
    db.set_app_setting(canonical_store(store), _key(job_id), row)
    return row


def get_job(store: str | None, job_id: str) -> dict[str, Any] | None:
    value = db.get_app_setting(canonical_store(store), _key(job_id))
    return value if isinstance(value, dict) else None


def list_product_cards(store: str | None = None, limit: int = 60) -> list[dict[str, Any]]:
    """Return the newest saved launcher setup for each store/product pair."""
    with db.SessionLocal() as session:
        query = session.query(db.AppSetting).filter(db.AppSetting.key.like(f"{JOB_PREFIX}%"))
        if store:
            query = query.filter(db.AppSetting.store == canonical_store(store))
        rows = query.order_by(db.AppSetting.updated_at.desc()).limit(max(1, min(int(limit), 250))).all()

    cards: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        try:
            job = json.loads(row.value or "{}")
        except Exception:
            continue
        if not isinstance(job, dict):
            continue
        request_data = dict(job.get("request") or {})
        product_id = str(request_data.get("product_id") or "").strip()
        job_store = canonical_store(str(job.get("store") or row.store or ""))
        if not product_id or (job_store, product_id) in seen:
            continue
        seen.add((job_store, product_id))
        result = dict(job.get("result") or {})
        checkpoint = dict(job.get("checkpoint") or {})
        product = dict(result.get("product") or checkpoint.get("product") or {})
        review = dict(result.get("review") or {})
        images = product.get("images") or []
        cover_url = str(((images or [{}])[0]).get("url") or "")
        if not cover_url:
            cover_url = next(
                (str(item.get("url") or "") for item in request_data.get("media") or [] if item.get("kind") == "image"),
                "",
            )
        cards.append({
            "job_id": str(job.get("id") or ""),
            "store": job_store,
            "status": str(job.get("status") or ""),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
            "product_id": product_id,
            "product_title": str(product.get("title") or f"Product {product_id}"),
            "cover_url": cover_url or None,
            "review_score": review.get("score"),
            "request": request_data,
        })
    return cards


def update_job(store: str | None, job_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    current = get_job(store, job_id) or {"id": job_id, "store": canonical_store(store)}
    merged = {**current, **patch, "updated_at": utc_now()}
    db.set_app_setting(canonical_store(store), _key(job_id), merged)
    return merged


def add_activity(
    store: str | None,
    job_id: str,
    *,
    stage: str,
    title: str,
    summary: str,
    status: str = "completed",
    source: str = "system",
) -> dict[str, Any]:
    current = get_job(store, job_id) or {"id": job_id, "store": canonical_store(store)}
    activity = list(current.get("activity") or [])
    activity.append({
        "at": utc_now(),
        "stage": str(stage)[:80],
        "status": str(status)[:20],
        "title": str(title)[:180],
        "summary": str(summary)[:4000],
        "source": str(source)[:40],
    })
    return update_job(store, job_id, {"activity": activity[-40:]})


def claim_job_launch(store: str | None, job_id: str) -> dict[str, Any]:
    """Atomically move one approved job to launching across API instances."""
    normalized_store = canonical_store(store)
    key = _key(job_id)
    pk = f"{normalized_store}|{key}"
    with db.SessionLocal() as session:
        item = session.get(db.AppSetting, pk)
        if not item:
            raise ValueError("Ad launcher job not found")
        original = str(item.value or "")
        try:
            current = json.loads(original)
        except Exception as error:
            raise RuntimeError("Ad launcher job state is invalid") from error
        if not isinstance(current, dict) or current.get("status") != "approved":
            raise ValueError("Only an independently approved campaign can be launched")
        claimed = {
            **current,
            "status": "launching",
            "stage": "meta_creation",
            "progress": 100,
            "updated_at": utc_now(),
        }
        changed = (
            session.query(db.AppSetting)
            .filter(db.AppSetting.pk == pk, db.AppSetting.value == original)
            .update({
                db.AppSetting.value: json.dumps(claimed, ensure_ascii=False),
                db.AppSetting.updated_at: datetime.now(timezone.utc).replace(tzinfo=None),
            }, synchronize_session=False)
        )
        if changed != 1:
            session.rollback()
            raise RuntimeError("This approved campaign is already being launched by another request")
        session.commit()
        return claimed


def save_asset(filename: str, data: bytes, content_type: str) -> str:
    """Save an upload locally and in the shared DB fallback used by /uploads."""
    path = save_file(filename, data)
    db.set_app_setting(None, f"upload_blob:{filename}", {
        "filename": filename,
        "content_type": content_type,
        "data_b64": base64.b64encode(data).decode("ascii"),
        "created_at": utc_now(),
    })
    return path


def load_asset(filename: str) -> bytes:
    local = Path(UPLOADS_DIR) / str(filename).replace("\\", "/").split("/")[-1]
    if local.exists() and local.is_file():
        return local.read_bytes()
    payload = db.get_app_setting(None, f"upload_blob:{local.name}")
    if not isinstance(payload, dict):
        raise FileNotFoundError(local.name)
    data = base64.b64decode(str(payload.get("data_b64") or ""))
    if not data:
        raise FileNotFoundError(local.name)
    return data
