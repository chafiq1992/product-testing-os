import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

from sqlalchemy import create_engine, Column, String, DateTime, Text, desc, Index
from sqlalchemy.orm import sessionmaker, declarative_base

# Support external database via DATABASE_URL (e.g., Supabase Postgres). Fallback to SQLite.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if DATABASE_URL:
    engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True)
else:
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


# Lightweight index to speed home listing by created date
Index('ix_tests_created_at', Test.created_at)

Base.metadata.create_all(engine)


def _now() -> datetime:
    return datetime.utcnow()


def create_test_row(test_id: str, payload: Dict[str, Any], status: str = "queued"):
    with SessionLocal() as session:
        t = Test(
            id=test_id,
            status=status,
            payload_json=json.dumps(payload, ensure_ascii=False),
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(t)
        session.commit()


# ---------------- Flows (structured) ----------------
class Flow(Base):
    __tablename__ = "flows"

    id = Column(String, primary_key=True)
    status = Column(String, nullable=False, default="draft")
    title = Column(String, nullable=True)
    card_image = Column(String, nullable=True)
    page_url = Column(String, nullable=True)
    product_json = Column(Text, nullable=True)
    flow_json = Column(Text, nullable=True)
    ui_json = Column(Text, nullable=True)
    prompts_json = Column(Text, nullable=True)
    settings_json = Column(Text, nullable=True)
    ads_json = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Index('ix_flows_created_at', Flow.created_at)

# Global app-wide prompts (key/value store)
class AppPrompt(Base):
    __tablename__ = "app_prompts"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Index('ix_app_prompts_updated_at', AppPrompt.updated_at)

# Ensure new tables are created when module is imported (includes newly added tables)
Base.metadata.create_all(engine)


def create_flow_row(flow_id: str, *, product: Dict[str, Any] | None = None, flow: Dict[str, Any] | None = None, ui: Dict[str, Any] | None = None, prompts: Dict[str, Any] | None = None, settings: Dict[str, Any] | None = None, ads: Dict[str, Any] | None = None, status: str = "draft", page_url: str | None = None, card_image: str | None = None):
    with SessionLocal() as session:
        # Derive title from product if provided
        title = None
        try:
            if isinstance(product, dict):
                title = product.get("title")
        except Exception:
            title = None
        f = Flow(
            id=flow_id,
            status=status,
            title=title,
            card_image=card_image,
            page_url=page_url,
            product_json=json.dumps(product, ensure_ascii=False) if product is not None else None,
            flow_json=json.dumps(flow, ensure_ascii=False) if flow is not None else None,
            ui_json=json.dumps(ui, ensure_ascii=False) if ui is not None else None,
            prompts_json=json.dumps(prompts, ensure_ascii=False) if prompts is not None else None,
            settings_json=json.dumps(settings, ensure_ascii=False) if settings is not None else None,
            ads_json=json.dumps(ads, ensure_ascii=False) if ads is not None else None,
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(f)
        session.commit()


def update_flow_row(flow_id: str, *, product: Dict[str, Any] | None = None, flow: Dict[str, Any] | None = None, ui: Dict[str, Any] | None = None, prompts: Dict[str, Any] | None = None, settings: Dict[str, Any] | None = None, ads: Dict[str, Any] | None = None, status: str | None = None, page_url: str | None = None, card_image: str | None = None) -> bool:
    with SessionLocal() as session:
        f = session.get(Flow, flow_id)
        if not f:
            return False
        if status is not None:
            f.status = status
        if card_image is not None:
            f.card_image = card_image
        if page_url is not None:
            f.page_url = page_url
        if product is not None:
            f.product_json = json.dumps(product, ensure_ascii=False)
            try:
                t = product.get("title")
                if t:
                    f.title = t
            except Exception:
                pass
        if flow is not None:
            f.flow_json = json.dumps(flow, ensure_ascii=False)
        if ui is not None:
            f.ui_json = json.dumps(ui, ensure_ascii=False)
        if prompts is not None:
            f.prompts_json = json.dumps(prompts, ensure_ascii=False)
        if settings is not None:
            f.settings_json = json.dumps(settings, ensure_ascii=False)
        if ads is not None:
            f.ads_json = json.dumps(ads, ensure_ascii=False)
        f.updated_at = _now()
        session.commit()
        return True


def get_flow(flow_id: str) -> Optional[Dict[str, Any]]:
    with SessionLocal() as session:
        f = session.get(Flow, flow_id)
        if not f:
            return None
        return {
            "id": f.id,
            "status": f.status,
            "title": f.title,
            "card_image": f.card_image,
            "page_url": f.page_url,
            "product": json.loads(f.product_json) if f.product_json else None,
            "flow": json.loads(f.flow_json) if f.flow_json else None,
            "ui": json.loads(f.ui_json) if f.ui_json else None,
            "prompts": json.loads(f.prompts_json) if f.prompts_json else None,
            "settings": json.loads(f.settings_json) if f.settings_json else None,
            "ads": json.loads(f.ads_json) if f.ads_json else None,
            "created_at": f.created_at.isoformat() + "Z",
            "updated_at": f.updated_at.isoformat() + "Z",
        }


def list_flows_light(limit: int | None = None) -> list[Dict[str, Any]]:
    with SessionLocal() as session:
        # Include settings_json to derive flow_type without heavy loads
        q = session.query(
            Flow.id,
            Flow.status,
            Flow.title,
            Flow.card_image,
            Flow.page_url,
            Flow.created_at,
            Flow.updated_at,
            Flow.settings_json,
        ).order_by(desc(Flow.created_at))
        if limit:
            q = q.limit(limit)
        rows = q.all()
        out: list[Dict[str, Any]] = []
        for r in rows:
            flow_type = "product"
            try:
                if r.settings_json:
                    sj = json.loads(r.settings_json)
                    t = (sj or {}).get("flow_type")
                    if isinstance(t, str) and t:
                        flow_type = t
            except Exception:
                flow_type = "product"
            out.append({
                "id": r.id,
                "status": r.status,
                "title": r.title,
                "card_image": r.card_image,
                "page_url": r.page_url,
                "created_at": r.created_at.isoformat() + "Z",
                "updated_at": r.updated_at.isoformat() + "Z",
                "flow_type": flow_type,
            })
        return out


# ---------------- App Prompts (global defaults) ----------------
def get_app_prompts() -> Dict[str, str]:
    """Return all global prompt defaults as a dict { key: value }"""
    with SessionLocal() as session:
        rows = session.query(AppPrompt).all()
        out: Dict[str, str] = {}
        for r in rows:
            try:
                if isinstance(r.key, str) and isinstance(r.value, str):
                    out[r.key] = r.value
            except Exception:
                continue
        return out


def set_app_prompts(patch: Dict[str, str]) -> Dict[str, str]:
    """Upsert provided prompt keys; returns full dict after update."""
    if not isinstance(patch, dict):
        return get_app_prompts()
    with SessionLocal() as session:
        for k, v in patch.items():
            if not isinstance(k, str):
                continue
            if not isinstance(v, str):
                continue
            item = session.get(AppPrompt, k)
            if item:
                item.value = v
                item.updated_at = _now()
            else:
                session.add(AppPrompt(key=k, value=v, updated_at=_now()))
        session.commit()
    return get_app_prompts()


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


def list_tests_light(limit: int | None = None) -> list[Dict[str, Any]]:
    with SessionLocal() as session:
        q = session.query(Test.id, Test.status, Test.page_url, Test.campaign_id, Test.payload_json, Test.result_json, Test.created_at, Test.updated_at).order_by(desc(Test.created_at))
        if limit:
            q = q.limit(limit)
        rows = q.all()
        out: list[Dict[str, Any]] = []
        for r in rows:
            out.append({
                "id": r.id,
                "status": r.status,
                "page_url": r.page_url,
                "campaign_id": r.campaign_id,
                # Return raw JSON strings to avoid eager parsing; caller can parse minimally
                "payload_json": r.payload_json,
                "result_json": r.result_json,
                "created_at": r.created_at.isoformat() + "Z",
                "updated_at": r.updated_at.isoformat() + "Z",
            })
        return out


def update_test_payload(test_id: str, payload: Dict[str, Any]) -> bool:
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return False
        t.payload_json = json.dumps(payload, ensure_ascii=False)
        t.updated_at = _now()
        session.commit()
        return True