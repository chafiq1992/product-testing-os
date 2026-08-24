from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint, Index

from app import db


class SocialAgentRun(db.Base):
    __tablename__ = "social_agent_runs"

    id = Column(String, primary_key=True)
    store = Column(String, nullable=False, index=True)
    batch_key = Column(String, nullable=False, unique=True)
    slot = Column(String, nullable=False)  # midday | evening
    status = Column(String, nullable=False, default="queued", index=True)
    target_count = Column(Integer, nullable=False, default=5)
    completed_count = Column(Integer, nullable=False, default=0)
    context_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class SocialAgentPost(db.Base):
    __tablename__ = "social_agent_posts"
    __table_args__ = (
        UniqueConstraint("run_id", "position", name="uq_social_agent_run_position"),
    )

    id = Column(String, primary_key=True)
    run_id = Column(String, nullable=False, index=True)
    store = Column(String, nullable=False, index=True)
    slot = Column(String, nullable=False, index=True)
    position = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="generating", index=True)
    scheduled_for = Column(DateTime, nullable=False, index=True)
    product_id = Column(String, nullable=False, index=True)
    product_json = Column(Text, nullable=True)
    strategy_json = Column(Text, nullable=True)
    assets_json = Column(Text, nullable=True)
    review_json = Column(Text, nullable=True)
    platforms_json = Column(Text, nullable=True)
    metrics_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


Index("ix_social_posts_store_scheduled", SocialAgentPost.store, SocialAgentPost.scheduled_for)
Index("ix_social_posts_store_status", SocialAgentPost.store, SocialAgentPost.status)

# db.py creates its own tables before this module is imported, so create the two
# additive tables after registering them on the shared metadata.
db.Base.metadata.create_all(db.engine)
