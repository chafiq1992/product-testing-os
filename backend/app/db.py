import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

from sqlalchemy import create_engine, Column, String, DateTime, Text, desc, Index, ForeignKey
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

# Generic app settings (key/value per store)
class AppSetting(Base):
    __tablename__ = "app_settings"

    pk = Column(String, primary_key=True)  # composed key: f"{(store or '').strip()}|{key}"
    store = Column(String, nullable=True)
    key = Column(String, nullable=False)
    value = Column(Text, nullable=True)  # JSON-encoded value
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Index('ix_app_settings_store_key', AppSetting.store, AppSetting.key)

# ---------------- Confirmation (order confirmation team) ----------------
class ConfirmationEvent(Base):
    __tablename__ = "confirmation_events"

    id = Column(String, primary_key=True)  # uuid
    store = Column(String, nullable=True, index=True)
    agent = Column(String, nullable=False, index=True)  # email/username
    order_id = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False)  # 'confirm' | 'phone' | 'whatsapp'
    meta_json = Column(Text, nullable=True)  # optional JSON
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


Index("ix_confirmation_events_store_agent_created_at", ConfirmationEvent.store, ConfirmationEvent.agent, ConfirmationEvent.created_at)

# Campaign ID mappings (persist manual product/collection IDs per campaign row)
class CampaignMapping(Base):
    __tablename__ = "campaign_mappings"

    pk = Column(String, primary_key=True)  # composed key: f"{(store or '').strip()}|{campaign_key}"
    store = Column(String, nullable=True)
    campaign_key = Column(String, nullable=False)
    kind = Column(String, nullable=False)  # 'product' | 'collection'
    target_id = Column(String, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Index('ix_campaign_mappings_store_key', CampaignMapping.store, CampaignMapping.campaign_key)

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


def list_flows_light(limit: int | None = None, store: str | None = None) -> list[Dict[str, Any]]:
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
            Flow.product_json,
        ).order_by(desc(Flow.created_at))
        if limit:
            q = q.limit(limit)
        rows = q.all()
        out: list[Dict[str, Any]] = []
        for r in rows:
            # Derive store from settings; default to 'irrakids' when missing for backwards compatibility
            eff_store = "irrakids"
            flow_type = "product"
            try:
                if r.settings_json:
                    sj = json.loads(r.settings_json)
                    # Store affinity (multi-store support)
                    s = (sj or {}).get("store")
                    if isinstance(s, str) and s.strip():
                        eff_store = s.strip()
                    t = (sj or {}).get("flow_type")
                    if isinstance(t, str) and t:
                        flow_type = t
            except Exception:
                flow_type = "product"
                eff_store = "irrakids"
            # Optional server-side filter by store
            try:
                if isinstance(store, str) and store.strip():
                    wanted = store.strip().lower()
                    if (eff_store or "").strip().lower() != wanted:
                        continue
            except Exception:
                pass
            # Derive a fallback card image if not explicitly set
            card_image = r.card_image
            if not card_image:
                try:
                    # Prefer assets_used.feature_gallery[0] in settings
                    if r.settings_json:
                        sj = json.loads(r.settings_json)
                        assets = (sj or {}).get("assets_used") or {}
                        gallery = assets.get("feature_gallery") or []
                        if isinstance(gallery, list) and gallery:
                            first = gallery[0]
                            if isinstance(first, str) and first:
                                card_image = first
                    # Fallback: first uploaded image from product_json
                    if (not card_image) and r.product_json:
                        pj = json.loads(r.product_json)
                        up = (pj or {}).get("uploaded_images") or []
                        if isinstance(up, list) and up:
                            first = up[0]
                            if isinstance(first, str) and first:
                                card_image = first
                except Exception:
                    card_image = r.card_image
            out.append({
                "id": r.id,
                "status": r.status,
                "title": r.title,
                "card_image": card_image,
                "page_url": r.page_url,
                "created_at": r.created_at.isoformat() + "Z",
                "updated_at": r.updated_at.isoformat() + "Z",
                    "flow_type": flow_type,
                    "store": eff_store,
            })
        return out


def delete_flow_row(flow_id: str) -> bool:
    with SessionLocal() as session:
        f = session.get(Flow, flow_id)
        if not f:
            return False
        session.delete(f)
        session.commit()
        return True


def delete_test_row(test_id: str) -> bool:
    with SessionLocal() as session:
        t = session.get(Test, test_id)
        if not t:
            return False
        session.delete(t)
        session.commit()
        return True


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


# ---------------- Campaign Mappings ----------------
def _mk_pk(store: str | None, campaign_key: str) -> str:
    s = (store or "").strip()
    return f"{s}|{campaign_key}"


# ---------------- App Settings (key/value per store) ----------------
def _mk_setting_pk(store: str | None, key: str) -> str:
    s = (store or "").strip()
    return f"{s}|{key}"


def get_app_setting(store: str | None, key: str) -> Any:
    with SessionLocal() as session:
        pk = _mk_setting_pk(store, key)
        item = session.get(AppSetting, pk)
        if not item:
            return None
        try:
            return json.loads(item.value) if item.value is not None else None
        except Exception:
            return item.value


def set_app_setting(store: str | None, key: str, value: Any) -> Any:
    with SessionLocal() as session:
        pk = _mk_setting_pk(store, key)
        item = session.get(AppSetting, pk)
        payload = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        if item:
            item.value = payload
            item.updated_at = _now()
        else:
            item = AppSetting(pk=pk, store=store, key=key, value=payload, updated_at=_now())
            session.add(item)
        session.commit()
        try:
            return json.loads(item.value) if item.value is not None else None
        except Exception:
            return item.value


def list_campaign_meta(store: str | None = None) -> Dict[str, dict]:
    """Return dict keyed by campaign_key: { campaign_key: { supplier_name?, supplier_alt_name?, timeline?: [{text, at}] } }"""
    with SessionLocal() as session:
        q = session.query(AppSetting).filter(AppSetting.key.like("campaign_meta:%"))
        if isinstance(store, str):
            q = q.filter(AppSetting.store == store)
        rows = q.all()
        out: Dict[str, dict] = {}
        for r in rows:
            try:
                key = r.key or ""
                if key.startswith("campaign_meta:"):
                    ck = key.split("campaign_meta:", 1)[1]
                else:
                    continue
                val: dict
                try:
                    val = json.loads(r.value) if r.value else {}
                except Exception:
                    val = {}
                out[ck] = val or {}
            except Exception:
                continue
        return out


def list_profit_costs(store: str | None = None) -> Dict[str, dict]:
    """Return dict keyed by product_id: { product_id: { product_cost?, service_delivery_cost? } }"""
    with SessionLocal() as session:
        q = session.query(AppSetting).filter(AppSetting.key.like("profit_costs:%"))
        if isinstance(store, str):
            q = q.filter(AppSetting.store == store)
        rows = q.all()
        out: Dict[str, dict] = {}
        for r in rows:
            try:
                key = r.key or ""
                if not key.startswith("profit_costs:"):
                    continue
                pid = key.split("profit_costs:", 1)[1]
                if not pid:
                    continue
                try:
                    val = json.loads(r.value) if r.value else {}
                except Exception:
                    val = {}
                if not isinstance(val, dict):
                    val = {}
                out[pid] = val
            except Exception:
                continue
        return out


def set_profit_costs(store: str | None, product_id: str, patch: Dict[str, Any]) -> dict:
    """Upsert profit costs by merging patch into existing JSON stored in AppSetting under key profit_costs:{product_id}."""
    if not isinstance(product_id, str) or not product_id.strip():
        return {}


# ---------------- Profit Cards (stored in AppSetting) ----------------
def list_profit_cards(store: str | None = None) -> list[dict]:
    """Return a list of saved profit cards for the store.

    Cards are stored under keys: profit_card:{card_id}
    """
    with SessionLocal() as session:
        q = session.query(AppSetting).filter(AppSetting.key.like("profit_card:%"))
        if isinstance(store, str):
            q = q.filter(AppSetting.store == store)
        rows = q.order_by(desc(AppSetting.updated_at)).all()
        out: list[dict] = []
        for r in rows:
            try:
                key = r.key or ""
                if not key.startswith("profit_card:"):
                    continue
                cid = key.split("profit_card:", 1)[1]
                if not cid:
                    continue
                try:
                    val = json.loads(r.value) if r.value else {}
                except Exception:
                    val = {}
                if not isinstance(val, dict):
                    val = {}
                # Ensure id field exists
                if "id" not in val:
                    val["id"] = cid
                # Attach updated_at for sorting/UX
                try:
                    val["updated_at"] = r.updated_at.isoformat() + "Z"
                except Exception:
                    pass
                out.append(val)
            except Exception:
                continue
        return out


def get_profit_card(store: str | None, card_id: str) -> dict | None:
    cid = (card_id or "").strip()
    if not cid:
        return None
    key = f"profit_card:{cid}"
    val = get_app_setting(store, key)
    if not isinstance(val, dict):
        return None
    if "id" not in val:
        val["id"] = cid
    return val


def upsert_profit_card(store: str | None, card_id: str, data: dict) -> dict:
    cid = (card_id or "").strip()
    if not cid:
        return {}
    key = f"profit_card:{cid}"
    payload = dict(data or {})
    payload["id"] = cid
    saved = set_app_setting(store, key, payload)
    try:
        if isinstance(saved, dict):
            return saved
        if isinstance(saved, str):
            return json.loads(saved)
    except Exception:
        pass
    return payload


def delete_profit_card(store: str | None, card_id: str) -> bool:
    cid = (card_id or "").strip()
    if not cid:
        return False
    key = f"profit_card:{cid}"
    pk = _mk_setting_pk(store, key)
    with SessionLocal() as session:
        item = session.get(AppSetting, pk)
        if not item:
            return False
        session.delete(item)
        session.commit()
        return True


# ---------------- Exchange rate (USD -> MAD) ----------------
def get_usd_to_mad_rate(store: str | None) -> float | None:
    try:
        v = get_app_setting(store, "usd_to_mad_rate")
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def set_usd_to_mad_rate(store: str | None, rate: float) -> float:
    try:
        r = float(rate)
    except Exception:
        r = 10.0
    r = max(0.01, min(r, 1000.0))
    set_app_setting(store, "usd_to_mad_rate", r)
    return r
    pid = product_id.strip()
    key = f"profit_costs:{pid}"
    try:
        existing = get_app_setting(store, key) or {}
        if not isinstance(existing, dict):
            existing = {}
    except Exception:
        existing = {}
    data = dict(existing)
    for k, v in (patch or {}).items():
        if k in ("product_cost", "service_delivery_cost"):
            data[k] = v
    saved = set_app_setting(store, key, data)
    try:
        return saved if isinstance(saved, dict) else (json.loads(saved) if isinstance(saved, str) else {})
    except Exception:
        return {}


def set_campaign_meta(store: str | None, campaign_key: str, patch: Dict[str, Any]) -> dict:
    """Upsert campaign meta by merging patch into existing JSON stored in AppSetting under key campaign_meta:{campaign_key}."""
    if not isinstance(campaign_key, str) or not campaign_key.strip():
        return {}
    key = f"campaign_meta:{campaign_key.strip()}"
    # Load existing
    try:
        existing = get_app_setting(store, key) or {}
        if not isinstance(existing, dict):
            existing = {}
    except Exception:
        existing = {}
    # Merge shallow
    data = dict(existing)
    for k, v in (patch or {}).items():
        # Only allow specific fields
        if k in ("supplier_name", "supplier_alt_name", "supply_available", "timeline"):
            data[k] = v
    saved = set_app_setting(store, key, data)
    try:
        return saved if isinstance(saved, dict) else (json.loads(saved) if isinstance(saved, str) else {})
    except Exception:
        return {}


def append_campaign_timeline(store: str | None, campaign_key: str, text: str) -> dict:
    """Append a timeline note to campaign meta; returns updated meta dict."""
    if not isinstance(campaign_key, str) or not campaign_key.strip():
        return {}
    key = f"campaign_meta:{campaign_key.strip()}"
    # Load existing
    try:
        existing = get_app_setting(store, key) or {}
        if not isinstance(existing, dict):
            existing = {}
    except Exception:
        existing = {}
    timeline = []
    try:
        tl = existing.get("timeline")
        if isinstance(tl, list):
            timeline = list(tl)
    except Exception:
        timeline = []
    note = {"text": str(text or ""), "at": _now().isoformat() + "Z"}
    timeline.append(note)
    existing["timeline"] = timeline
    saved = set_app_setting(store, key, existing)
    try:
        return saved if isinstance(saved, dict) else (json.loads(saved) if isinstance(saved, str) else {})
    except Exception:
        return {}

def upsert_campaign_mapping(store: str | None, campaign_key: str, kind: str, target_id: str) -> dict:
    with SessionLocal() as session:
        pk = _mk_pk(store, campaign_key)
        item = session.get(CampaignMapping, pk)
        if item:
            item.kind = kind
            item.target_id = target_id
            item.updated_at = _now()
        else:
            item = CampaignMapping(pk=pk, store=store, campaign_key=campaign_key, kind=kind, target_id=target_id, updated_at=_now())
            session.add(item)
        session.commit()
        return {"store": item.store, "campaign_key": item.campaign_key, "kind": item.kind, "id": item.target_id, "updated_at": item.updated_at.isoformat() + "Z"}


def delete_campaign_mapping(store: str | None, campaign_key: str) -> bool:
    with SessionLocal() as session:
        pk = _mk_pk(store, campaign_key)
        item = session.get(CampaignMapping, pk)
        if not item:
            return False
        session.delete(item)
        session.commit()
        return True


def list_campaign_mappings(store: str | None = None) -> dict:
    """Return dict keyed by campaign_key: { campaign_key: { kind, id } }.
    If store is provided, filter by it; otherwise return all mappings across stores.
    """
    with SessionLocal() as session:
        q = session.query(CampaignMapping)
        if isinstance(store, str):
            q = q.filter(CampaignMapping.store == store)
        rows = q.all()
        out: Dict[str, dict] = {}
        for r in rows:
            try:
                out[r.campaign_key] = {"kind": r.kind, "id": r.target_id, "store": r.store}
            except Exception:
                continue
        return out


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


# ---------------- Agents & Runs ----------------
class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    instruction = Column(Text, nullable=True)
    output_pref = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(String, primary_key=True)
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    status = Column(String, nullable=False, default="draft")
    title = Column(String, nullable=True)
    input_json = Column(Text, nullable=True)
    output_json = Column(Text, nullable=True)
    messages_json = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Index('ix_agents_created_at', Agent.created_at)
Index('ix_agent_runs_agent_id_created_at', AgentRun.agent_id, AgentRun.created_at)

Base.metadata.create_all(engine)


def create_agent(agent_id: str, name: str, description: str | None = None, instruction: str | None = None, output_pref: str | None = None):
    with SessionLocal() as session:
        a = Agent(
            id=agent_id,
            name=name,
            description=description,
            instruction=instruction,
            output_pref=output_pref,
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(a)
        session.commit()


def update_agent(agent_id: str, *, name: str | None = None, description: str | None = None, instruction: str | None = None, output_pref: str | None = None) -> bool:
    with SessionLocal() as session:
        a = session.get(Agent, agent_id)
        if not a:
            return False
        if name is not None:
            a.name = name
        if description is not None:
            a.description = description
        if instruction is not None:
            a.instruction = instruction
        if output_pref is not None:
            a.output_pref = output_pref
        a.updated_at = _now()
        session.commit()
        return True


def get_agent(agent_id: str) -> Optional[Dict[str, Any]]:
    with SessionLocal() as session:
        a = session.get(Agent, agent_id)
        if not a:
            return None
        return {
            "id": a.id,
            "name": a.name,
            "description": a.description,
            "instruction": a.instruction,
            "output_pref": a.output_pref,
            "created_at": a.created_at.isoformat() + "Z",
            "updated_at": a.updated_at.isoformat() + "Z",
        }


def list_agents(limit: int | None = None) -> list[Dict[str, Any]]:
    with SessionLocal() as session:
        q = session.query(Agent).order_by(desc(Agent.created_at))
        if limit:
            q = q.limit(limit)
        items = q.all()
        out: list[Dict[str, Any]] = []
        for a in items:
            out.append({
                "id": a.id,
                "name": a.name,
                "description": a.description,
                "created_at": a.created_at.isoformat() + "Z",
                "updated_at": a.updated_at.isoformat() + "Z",
            })
        return out


def create_agent_run(agent_id: str, run_id: str, *, title: str | None = None, status: str = "draft", input: Dict[str, Any] | None = None):
    with SessionLocal() as session:
        r = AgentRun(
            id=run_id,
            agent_id=agent_id,
            status=status,
            title=title,
            input_json=json.dumps(input, ensure_ascii=False) if input is not None else None,
            created_at=_now(),
            updated_at=_now(),
        )
        session.add(r)
        session.commit()


def update_agent_run(agent_id: str, run_id: str, *, status: str | None = None, title: str | None = None, input: Dict[str, Any] | None = None, output: Dict[str, Any] | None = None, messages: list[Dict[str, Any]] | None = None) -> bool:
    with SessionLocal() as session:
        r = session.get(AgentRun, run_id)
        if not r or r.agent_id != agent_id:
            return False
        if status is not None:
            r.status = status
        if title is not None:
            r.title = title
        if input is not None:
            r.input_json = json.dumps(input, ensure_ascii=False)
        if output is not None:
            r.output_json = json.dumps(output, ensure_ascii=False)
        if messages is not None:
            r.messages_json = json.dumps(messages, ensure_ascii=False)
        r.updated_at = _now()
        session.commit()
        return True


def get_agent_run(agent_id: str, run_id: str) -> Optional[Dict[str, Any]]:
    with SessionLocal() as session:
        r = session.get(AgentRun, run_id)
        if not r or r.agent_id != agent_id:
            return None
        return {
            "id": r.id,
            "agent_id": r.agent_id,
            "status": r.status,
            "title": r.title,
            "input": json.loads(r.input_json) if r.input_json else None,
            "output": json.loads(r.output_json) if r.output_json else None,
            "messages": json.loads(r.messages_json) if r.messages_json else None,
            "created_at": r.created_at.isoformat() + "Z",
            "updated_at": r.updated_at.isoformat() + "Z",
        }


def list_agent_runs(agent_id: str, limit: int | None = None) -> list[Dict[str, Any]]:
    with SessionLocal() as session:
        q = session.query(AgentRun).filter(AgentRun.agent_id == agent_id).order_by(desc(AgentRun.created_at))
        if limit:
            q = q.limit(limit)
        rows = q.all()
        out: list[Dict[str, Any]] = []
        for r in rows:
            out.append({
                "id": r.id,
                "agent_id": r.agent_id,
                "status": r.status,
                "title": r.title,
                "created_at": r.created_at.isoformat() + "Z",
                "updated_at": r.updated_at.isoformat() + "Z",
            })
        return out


def delete_all_agents() -> int:
    """Delete all agents and their runs. Returns number of agents deleted."""
    with SessionLocal() as session:
        # Delete runs first due to FK
        session.query(AgentRun).delete()
        count = session.query(Agent).delete()
        session.commit()
        return int(count or 0)


def log_confirmation_event(store: str | None, agent: str, order_id: str | int, kind: str, meta: dict | None = None) -> dict:
    """Append an event. Intended for analytics/attribution (not access control)."""
    from uuid import uuid4
    a = (agent or "").strip()
    oid = str(order_id).strip()
    k = (kind or "").strip().lower()
    if not a or not oid or k not in ("confirm", "phone", "whatsapp"):
        return {"ok": False}
    with SessionLocal() as session:
        row = ConfirmationEvent(
            id=str(uuid4()),
            store=(store.strip() if isinstance(store, str) else None),
            agent=a,
            order_id=oid,
            kind=k,
            meta_json=(json.dumps(meta, ensure_ascii=False) if isinstance(meta, dict) else None),
            created_at=_now(),
        )
        session.add(row)
        session.commit()
        return {"ok": True, "id": row.id}


def count_confirmation_events(store: str | None = None, *, kind: str | None = None) -> dict:
    """Return counts grouped by agent."""
    k = (kind or "").strip().lower() if kind else None
    with SessionLocal() as session:
        q = session.query(ConfirmationEvent)
        if isinstance(store, str) and store.strip():
            q = q.filter(ConfirmationEvent.store == store.strip())
        if k in ("confirm", "phone", "whatsapp"):
            q = q.filter(ConfirmationEvent.kind == k)
        rows = q.all()
        out: dict[str, int] = {}
        for r in rows:
            try:
                out[r.agent] = int(out.get(r.agent, 0)) + 1
            except Exception:
                continue
        return out


def confirmation_analytics(store: str | None = None, *, days: int | None = 30) -> dict:
    """Compute per-agent counts and daily series for confirmation events.

    Returns:
      {
        totals: { confirm:int, phone:int, whatsapp:int },
        agents: { email: { confirm, phone, whatsapp, last_at } },
        daily: [ { date: "YYYY-MM-DD", confirm, phone, whatsapp } ]
      }
    """
    from datetime import timedelta
    try:
        n = int(days or 30)
    except Exception:
        n = 30
    n = max(1, min(n, 365))
    cutoff = _now() - timedelta(days=n)
    with SessionLocal() as session:
        q = session.query(ConfirmationEvent)
        if isinstance(store, str) and store.strip():
            q = q.filter(ConfirmationEvent.store == store.strip())
        q = q.filter(ConfirmationEvent.created_at >= cutoff)
        rows = q.all()
        totals = {"confirm": 0, "phone": 0, "whatsapp": 0}
        agents: dict[str, dict] = {}
        daily: dict[str, dict] = {}
        for r in rows:
            try:
                kind = (r.kind or "").lower()
                if kind not in ("confirm", "phone", "whatsapp"):
                    continue
                a = (r.agent or "").strip().lower()
                d = (r.created_at.date().isoformat() if r.created_at else None)
                totals[kind] = int(totals.get(kind, 0)) + 1
                if a:
                    ag = agents.setdefault(a, {"confirm": 0, "phone": 0, "whatsapp": 0, "last_at": None})
                    ag[kind] = int(ag.get(kind, 0)) + 1
                    try:
                        last = ag.get("last_at")
                        cur = (r.created_at.isoformat() + "Z") if r.created_at else None
                        if cur and (not last or cur > str(last)):
                            ag["last_at"] = cur
                    except Exception:
                        pass
                if d:
                    day = daily.setdefault(d, {"date": d, "confirm": 0, "phone": 0, "whatsapp": 0})
                    day[kind] = int(day.get(kind, 0)) + 1
            except Exception:
                continue
        # fill missing days for stable chart display
        try:
            from datetime import date as _date
            start = cutoff.date()
            today = _now().date()
            cur = start
            while cur <= today:
                key = cur.isoformat()
                daily.setdefault(key, {"date": key, "confirm": 0, "phone": 0, "whatsapp": 0})
                cur = cur + timedelta(days=1)
        except Exception:
            pass
        daily_list = list(daily.values())
        daily_list.sort(key=lambda x: x.get("date") or "")
        return {"totals": totals, "agents": agents, "daily": daily_list}