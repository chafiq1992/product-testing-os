import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

from sqlalchemy import create_engine, Column, String, DateTime, Text
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


def set_test_result(test_id: str, page: Dict[str, Any], campaign: Dict[str, Any], creatives: list):
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return
        t.status = "completed"
        t.page_url = page.get("url") if page else None
        t.campaign_id = (campaign or {}).get("campaign_id")
        t.result_json = json.dumps({"page": page, "campaign": campaign, "creatives": creatives}, ensure_ascii=False)
        t.updated_at = _now()
        session.commit()


def set_test_failed(test_id: str, error: Dict[str, Any]):
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return
        t.status = "failed"
        t.error_json = json.dumps(error, ensure_ascii=False)
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
