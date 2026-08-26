from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, desc, or_
from sqlalchemy.exc import IntegrityError

from app import db
from app.social_agent.models import SocialAgentPost, SocialAgentRun


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "live_publish": False,
    "timezone": "Africa/Casablanca",
    "schedule_mode": "rolling",
    "posting_window_start": "12:00",
    "posting_window_end": "00:00",
    "midday_time": "14:00",
    "evening_time": "17:00",
    "evening_end_time": "23:59",
    "batch_size": 5,
    "midday_post_interval_minutes": 8,
    "post_interval_minutes": 30,
    "prepare_minutes_before": 60,
    "creative_variants": 2,
    "minimum_review_score": 82,
    "max_review_attempts": 3,
    "minimum_inventory": 1,
    "image_provider": "openai",
    "gemini_image_model": "gemini-3.1-flash-image",
    "quantity_offer_enabled": False,
    "approved_quantity_offer_ar": "",
    "brand_notes": "",
    "hashtags": ["#المغرب", "#تسوق_أونلاين"],
    "analytics_lookback_days": 30,
}

CONFIG_KEY = "social_agent_config_v1"
LEARNING_KEY = "social_agent_learning_v1"
ANALYTICS_MARKER_KEY = "social_agent_analytics_marker_v1"


def utcnow() -> datetime:
    return datetime.utcnow()


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def loads(value: str | None, fallback: Any = None) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _iso(value: datetime | None) -> str | None:
    return f"{value.isoformat()}Z" if value else None


def canonical_store(store: str | None) -> str:
    value = (store or "").strip().lower()
    if value == "nouralibas":
        return "irrakids"
    return value or "default"


def get_config(store: str | None) -> dict[str, Any]:
    stored = db.get_app_setting(canonical_store(store), CONFIG_KEY)
    merged = dict(DEFAULT_CONFIG)
    if isinstance(stored, dict):
        merged.update(stored)
    merged["batch_size"] = max(1, min(5, int(merged.get("batch_size") or 5)))
    merged["creative_variants"] = max(2, min(3, int(merged.get("creative_variants") or 2)))
    merged["image_provider"] = "gemini" if str(merged.get("image_provider") or "").lower() == "gemini" else "openai"
    allowed_gemini_models = {
        "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image",
    }
    if str(merged.get("gemini_image_model") or "") not in allowed_gemini_models:
        merged["gemini_image_model"] = "gemini-3.1-flash-image"
    return merged


def save_config(store: str | None, patch: dict[str, Any]) -> dict[str, Any]:
    allowed = set(DEFAULT_CONFIG)
    current = get_config(store)
    for key, value in (patch or {}).items():
        if key in allowed:
            current[key] = value
    current["batch_size"] = max(1, min(5, int(current.get("batch_size") or 5)))
    current["schedule_mode"] = "rolling" if str(current.get("schedule_mode") or "rolling") == "rolling" else "legacy"
    current["midday_post_interval_minutes"] = max(
        2, min(60, int(current.get("midday_post_interval_minutes") or 8))
    )
    current["post_interval_minutes"] = max(2, min(60, int(current.get("post_interval_minutes") or 30)))
    current["prepare_minutes_before"] = max(15, min(180, int(current.get("prepare_minutes_before") or 60)))
    current["creative_variants"] = max(2, min(3, int(current.get("creative_variants") or 2)))
    current["image_provider"] = "gemini" if str(current.get("image_provider") or "").lower() == "gemini" else "openai"
    allowed_gemini_models = {
        "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image",
    }
    if str(current.get("gemini_image_model") or "") not in allowed_gemini_models:
        current["gemini_image_model"] = "gemini-3.1-flash-image"
    current["minimum_review_score"] = max(60, min(100, int(current.get("minimum_review_score") or 82)))
    current["max_review_attempts"] = max(1, min(5, int(current.get("max_review_attempts") or 3)))
    current["minimum_inventory"] = max(1, int(current.get("minimum_inventory") or 1))
    current["analytics_lookback_days"] = max(7, min(90, int(current.get("analytics_lookback_days") or 30)))
    db.set_app_setting(canonical_store(store), CONFIG_KEY, current)
    return current


def get_learning(store: str | None) -> dict[str, Any]:
    value = db.get_app_setting(canonical_store(store), LEARNING_KEY)
    return value if isinstance(value, dict) else {
        "summary": "No performance evidence yet. Start with diverse hooks and offers.",
        "winning_patterns": [],
        "losing_patterns": [],
        "next_rules": [],
        "experiments": [],
        "sample_size": 0,
    }


def save_learning(store: str | None, value: dict[str, Any]) -> dict[str, Any]:
    db.set_app_setting(canonical_store(store), LEARNING_KEY, value)
    return value


def analytics_marker(store: str | None) -> dict[str, Any]:
    value = db.get_app_setting(canonical_store(store), ANALYTICS_MARKER_KEY)
    return value if isinstance(value, dict) else {}


def set_analytics_marker(store: str | None, value: dict[str, Any]) -> None:
    db.set_app_setting(canonical_store(store), ANALYTICS_MARKER_KEY, value)


def run_to_dict(row: SocialAgentRun) -> dict[str, Any]:
    return {
        "id": row.id,
        "store": row.store,
        "batch_key": row.batch_key,
        "slot": row.slot,
        "status": row.status,
        "target_count": row.target_count,
        "completed_count": row.completed_count,
        "context": loads(row.context_json, {}),
        "error": loads(row.error_json, None),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def post_to_dict(row: SocialAgentPost) -> dict[str, Any]:
    return {
        "id": row.id,
        "run_id": row.run_id,
        "store": row.store,
        "slot": row.slot,
        "position": row.position,
        "status": row.status,
        "scheduled_for": _iso(row.scheduled_for),
        "product_id": row.product_id,
        "product": loads(row.product_json, {}),
        "strategy": loads(row.strategy_json, {}),
        "assets": loads(row.assets_json, []),
        "review": loads(row.review_json, {}),
        "platforms": loads(row.platforms_json, {}),
        "metrics": loads(row.metrics_json, {}),
        "error": loads(row.error_json, None),
        "attempts": row.attempts,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def get_run(run_id: str) -> dict[str, Any] | None:
    with db.SessionLocal() as session:
        row = session.get(SocialAgentRun, run_id)
        return run_to_dict(row) if row else None


def get_run_by_key(batch_key: str) -> dict[str, Any] | None:
    with db.SessionLocal() as session:
        row = session.query(SocialAgentRun).filter(SocialAgentRun.batch_key == batch_key).first()
        return run_to_dict(row) if row else None


def create_run(store: str, batch_key: str, slot: str, target_count: int, context: dict[str, Any]) -> dict[str, Any]:
    row = SocialAgentRun(
        id=str(uuid4()), store=canonical_store(store), batch_key=batch_key, slot=slot,
        status="queued", target_count=target_count, completed_count=0,
        context_json=dumps(context), created_at=utcnow(), updated_at=utcnow(),
    )
    try:
        with db.SessionLocal() as session:
            session.add(row)
            session.commit()
            session.refresh(row)
            return run_to_dict(row)
    except IntegrityError:
        existing = get_run_by_key(batch_key)
        if existing:
            return existing
        raise


def update_run(run_id: str, **values: Any) -> dict[str, Any] | None:
    mapping = {
        "status": "status", "completed_count": "completed_count",
        "context": "context_json", "error": "error_json",
    }
    with db.SessionLocal() as session:
        row = session.get(SocialAgentRun, run_id)
        if not row:
            return None
        for key, value in values.items():
            attr = mapping.get(key)
            if not attr:
                continue
            setattr(row, attr, dumps(value) if attr.endswith("_json") else value)
        row.updated_at = utcnow()
        session.commit()
        session.refresh(row)
        return run_to_dict(row)


def create_post(
    *, run_id: str, store: str, slot: str, position: int, scheduled_for: datetime,
    product: dict[str, Any], status: str = "generating",
) -> dict[str, Any]:
    row = SocialAgentPost(
        id=str(uuid4()), run_id=run_id, store=canonical_store(store), slot=slot,
        position=position, status=status, scheduled_for=scheduled_for,
        product_id=str(product.get("id") or ""), product_json=dumps(product),
        created_at=utcnow(), updated_at=utcnow(),
    )
    try:
        with db.SessionLocal() as session:
            session.add(row)
            session.commit()
            session.refresh(row)
            return post_to_dict(row)
    except IntegrityError:
        with db.SessionLocal() as session:
            existing = session.query(SocialAgentPost).filter(
                SocialAgentPost.run_id == run_id, SocialAgentPost.position == position,
            ).first()
            if existing:
                return post_to_dict(existing)
        raise


def get_post(post_id: str) -> dict[str, Any] | None:
    with db.SessionLocal() as session:
        row = session.get(SocialAgentPost, post_id)
        return post_to_dict(row) if row else None


def update_post(post_id: str, **values: Any) -> dict[str, Any] | None:
    mapping = {
        "status": "status", "strategy": "strategy_json", "assets": "assets_json",
        "review": "review_json", "platforms": "platforms_json", "metrics": "metrics_json",
        "error": "error_json", "attempts": "attempts",
    }
    with db.SessionLocal() as session:
        row = session.get(SocialAgentPost, post_id)
        if not row:
            return None
        for key, value in values.items():
            if key == "product" and isinstance(value, dict):
                row.product_id = str(value.get("id") or "")
                row.product_json = dumps(value)
                continue
            attr = mapping.get(key)
            if not attr:
                continue
            setattr(row, attr, dumps(value) if attr.endswith("_json") else value)
        row.updated_at = utcnow()
        session.commit()
        session.refresh(row)
        return post_to_dict(row)


def list_runs(store: str | None, limit: int = 20) -> list[dict[str, Any]]:
    with db.SessionLocal() as session:
        rows = session.query(SocialAgentRun).filter(
            SocialAgentRun.store == canonical_store(store)
        ).order_by(desc(SocialAgentRun.created_at)).limit(max(1, min(limit, 100))).all()
        return [run_to_dict(row) for row in rows]


def list_posts(store: str | None, limit: int = 80, since: datetime | None = None) -> list[dict[str, Any]]:
    with db.SessionLocal() as session:
        query = session.query(SocialAgentPost).filter(SocialAgentPost.store == canonical_store(store))
        if since:
            query = query.filter(SocialAgentPost.scheduled_for >= since)
        rows = query.order_by(desc(SocialAgentPost.scheduled_for)).limit(max(1, min(limit, 500))).all()
        return [post_to_dict(row) for row in rows]


def list_run_posts(run_id: str) -> list[dict[str, Any]]:
    with db.SessionLocal() as session:
        rows = session.query(SocialAgentPost).filter(
            SocialAgentPost.run_id == run_id
        ).order_by(SocialAgentPost.position.asc()).all()
        return [post_to_dict(row) for row in rows]


def recent_product_ids(store: str | None, days: int = 7) -> set[str]:
    cutoff = utcnow() - timedelta(days=max(1, days))
    with db.SessionLocal() as session:
        rows = session.query(SocialAgentPost.product_id).filter(
            SocialAgentPost.store == canonical_store(store),
            SocialAgentPost.created_at >= cutoff,
        ).all()
        return {str(row[0]) for row in rows if row and row[0]}


def claim_due_posts(store: str | None, now_utc: datetime, limit: int = 3) -> list[dict[str, Any]]:
    claimed: list[dict[str, Any]] = []
    with db.SessionLocal() as session:
        candidates = session.query(SocialAgentPost).filter(
            SocialAgentPost.store == canonical_store(store),
            SocialAgentPost.status.in_(["approved", "partial", "publish_failed"]),
            SocialAgentPost.attempts < 5,
            SocialAgentPost.scheduled_for <= now_utc,
        ).order_by(SocialAgentPost.scheduled_for.asc()).limit(max(1, limit)).all()
        for row in candidates:
            changed = session.query(SocialAgentPost).filter(
                SocialAgentPost.id == row.id,
                SocialAgentPost.status.in_(["approved", "partial", "publish_failed"]),
                SocialAgentPost.attempts < 5,
            ).update({"status": "publishing", "updated_at": utcnow()}, synchronize_session=False)
            if changed:
                session.commit()
                fresh = session.get(SocialAgentPost, row.id)
                if fresh:
                    claimed.append(post_to_dict(fresh))
    return claimed


def arm_preview_posts(store: str | None, *, earliest: datetime | None = None) -> int:
    cutoff = earliest or (utcnow() - timedelta(hours=2))
    with db.SessionLocal() as session:
        changed = session.query(SocialAgentPost).filter(
            SocialAgentPost.store == canonical_store(store),
            SocialAgentPost.status == "preview_ready",
            SocialAgentPost.scheduled_for >= cutoff,
        ).update({"status": "approved", "updated_at": utcnow()}, synchronize_session=False)
        session.commit()
        return int(changed or 0)


def claim_next_run(store: str | None = None) -> dict[str, Any] | None:
    with db.SessionLocal() as session:
        # Recover a lease if an instance was terminated mid-generation. Cloud
        # Run can stop an instance at any time; a stale lease must not strand a
        # daily batch forever.
        session.query(SocialAgentRun).filter(
            SocialAgentRun.status == "preparing",
            SocialAgentRun.updated_at < utcnow() - timedelta(minutes=20),
        ).update({"status": "running", "updated_at": utcnow()}, synchronize_session=False)
        session.commit()
        query = session.query(SocialAgentRun).filter(or_(
            SocialAgentRun.status.in_(["queued", "running"]),
            and_(
                SocialAgentRun.status == "completed",
                SocialAgentRun.updated_at >= utcnow() - timedelta(days=2),
            ),
        ))
        if store:
            query = query.filter(SocialAgentRun.store == canonical_store(store))
        rows = query.order_by(SocialAgentRun.created_at.asc()).limit(20).all()
        for row in rows:
            posts = session.query(SocialAgentPost).filter(SocialAgentPost.run_id == row.id).all()
            max_attempts = int(get_config(row.store).get("max_review_attempts") or 3)
            retriable_statuses = {"generating", "failed", "rejected"}
            retriable = any(
                post.status in retriable_statuses and int(post.attempts or 0) < max_attempts
                for post in posts
            )
            # Re-open a recently completed batch when its reviewer rejected a
            # slot that still has attempts available. This repairs batches made
            # by older revisions without retrying stale historical content.
            latest_schedule = max((post.scheduled_for for post in posts), default=None)
            if row.status == "completed":
                if not retriable or not latest_schedule or latest_schedule < utcnow() - timedelta(hours=8):
                    continue
                row.status = "running"
                row.updated_at = utcnow()
                session.commit()
            terminal = sum(
                1 for post in posts
                if not (post.status in retriable_statuses and int(post.attempts or 0) < max_attempts)
            )
            if len(posts) >= row.target_count and terminal >= row.target_count and not retriable:
                row.status = "completed"
                row.completed_count = terminal
                row.updated_at = utcnow()
                session.commit()
                continue
            changed = session.query(SocialAgentRun).filter(
                SocialAgentRun.id == row.id,
                SocialAgentRun.status.in_(["queued", "running"]),
            ).update({"status": "preparing", "updated_at": utcnow()}, synchronize_session=False)
            if changed:
                session.commit()
                fresh = session.get(SocialAgentRun, row.id)
                if fresh:
                    session.refresh(fresh)
                    return run_to_dict(fresh)
    return None


def refresh_run_progress(run_id: str) -> dict[str, Any] | None:
    with db.SessionLocal() as session:
        row = session.get(SocialAgentRun, run_id)
        if not row:
            return None
        posts = session.query(SocialAgentPost).filter(SocialAgentPost.run_id == run_id).all()
        max_attempts = int(get_config(row.store).get("max_review_attempts") or 3)
        retriable_statuses = {"generating", "failed", "rejected"}
        terminal = sum(
            1 for post in posts
            if not (post.status in retriable_statuses and int(post.attempts or 0) < max_attempts)
        )
        retriable = any(
            post.status in retriable_statuses and int(post.attempts or 0) < max_attempts
            for post in posts
        )
        row.completed_count = terminal
        if len(posts) >= row.target_count and terminal >= row.target_count and not retriable:
            row.status = "completed"
        elif row.status != "failed":
            row.status = "running"
        row.updated_at = utcnow()
        session.commit()
        session.refresh(row)
        return run_to_dict(row)
