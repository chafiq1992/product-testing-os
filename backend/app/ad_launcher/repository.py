from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app import db
from app.config import UPLOADS_DIR
from app.storage import save_file


JOB_PREFIX = "ad_launcher:job:"


def canonical_store(store: str | None) -> str:
    value = str(store or "default").strip().lower()
    return "irrakids" if value == "nouralibas" else (value or "default")


def _key(job_id: str) -> str:
    return f"{JOB_PREFIX}{str(job_id).strip()}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_job(store: str | None, job_id: str, request_data: dict[str, Any]) -> dict[str, Any]:
    row = {
        "id": job_id,
        "store": canonical_store(store),
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "request": request_data,
        "result": None,
        "error": None,
    }
    db.set_app_setting(canonical_store(store), _key(job_id), row)
    return row


def get_job(store: str | None, job_id: str) -> dict[str, Any] | None:
    value = db.get_app_setting(canonical_store(store), _key(job_id))
    return value if isinstance(value, dict) else None


def update_job(store: str | None, job_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    current = get_job(store, job_id) or {"id": job_id, "store": canonical_store(store)}
    merged = {**current, **patch, "updated_at": utc_now()}
    db.set_app_setting(canonical_store(store), _key(job_id), merged)
    return merged


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
