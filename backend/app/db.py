import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

from sqlalchemy import create_engine, Column, String, DateTime, Text, desc
from sqlalchemy.orm import sessionmaker, declarative_base

# Ensure data directory exists (works in both containers)
DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Simple SQLite persistence for MVP
engine = create_engine("sqlite:////app/data/app.db", future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
Base = declarative_base()


class Test(Base):
    __tablename__ = "tests"

    id = Column(String, primary_key=True)
    status = Column(String, nullable=False, default="queued")
    page_url = Column(String, nullable=True)
    campaign_id = Column(String, nullable=True)
    payload_json = Column(Text, nullable=True)
    result_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Base.metadata.create_all(engine)


def _now() -> datetime:
    return datetime.utcnow()


def create_test_row(test_id: str, payload: Dict[str, Any]):
    with SessionLocal() as session:
        t = Test(
            id=test_id,
            status="queued",
            payload_json=json.dumps(payload, ensure_ascii=False),
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(t)
        session.commit()


def update_test_status(test_id: str, status: str, error: Optional[Dict[str, Any]] = None):
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return
        t.status = status
        if error is not None:
            t.error_json = json.dumps(error, ensure_ascii=False)
        t.updated_at = _now()
        session.commit()


def set_test_result(test_id: str, page: Dict[str, Any], campaign: Dict[str, Any], creatives: list, angles: Optional[list] = None, trace: Optional[list] = None):
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return
        t.status = "completed"
        t.page_url = page.get("url") if page else None
        t.campaign_id = (campaign or {}).get("campaign_id")
        result_payload: Dict[str, Any] = {"page": page, "campaign": campaign, "creatives": creatives}
        if angles is not None:
            result_payload["angles"] = angles
        if trace is not None:
            result_payload["trace"] = trace
        t.result_json = json.dumps(result_payload, ensure_ascii=False)
        t.updated_at = _now()
        session.commit()


def set_test_failed(test_id: str, error: Dict[str, Any], trace: Optional[list] = None, partial: Optional[Dict[str, Any]] = None):
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return
        t.status = "failed"
        t.error_json = json.dumps(error, ensure_ascii=False)
        # Preserve any partial results and trace so UI can show prompts/outputs
        if trace is not None or partial is not None:
            current = {}
            if t.result_json:
                try:
                    current = json.loads(t.result_json)
                except Exception:
                    current = {}
            if trace is not None:
                current["trace"] = trace
            if partial is not None:
                current.update(partial)
            t.result_json = json.dumps(current, ensure_ascii=False)
        t.updated_at = _now()
        session.commit()


def get_test(test_id: str) -> Optional[Dict[str, Any]]:
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return None
        return {
            "id": t.id,
            "status": t.status,
            "page_url": t.page_url,
            "campaign_id": t.campaign_id,
            "payload": json.loads(t.payload_json) if t.payload_json else None,
            "result": json.loads(t.result_json) if t.result_json else None,
            "error": json.loads(t.error_json) if t.error_json else None,
            "created_at": t.created_at.isoformat() + "Z",
            "updated_at": t.updated_at.isoformat() + "Z",
        }


def list_tests(limit: int | None = None) -> list[Dict[str, Any]]:
    with SessionLocal() as session:
        q = session.query(Test).order_by(desc(Test.created_at))
        if limit:
            q = q.limit(limit)
        items = q.all()
        out: list[Dict[str, Any]] = []
        for t in items:
            out.append({
                "id": t.id,
                "status": t.status,
                "page_url": t.page_url,
                "campaign_id": t.campaign_id,
                "payload": json.loads(t.payload_json) if t.payload_json else None,
                "result": json.loads(t.result_json) if t.result_json else None,
                "error": json.loads(t.error_json) if t.error_json else None,
                "created_at": t.created_at.isoformat() + "Z",
                "updated_at": t.updated_at.isoformat() + "Z",
            })
        return out
