"""Store-scoped analyzer controls and server-only OpenAI model discovery."""
import base64
import os
import re
import threading
import time
from functools import lru_cache
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field
from app import db

LATEST_MODELS = ("gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna")
_model_cache: dict = {}
_model_lock = threading.Lock()


class AnalyzerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = True
    model: str = Field(default=LATEST_MODELS[0], pattern=r"^[a-zA-Z0-9._:-]{1,100}$")
    reasoning_effort: Literal["low", "medium", "high"] = "medium"
    max_output_tokens: int = Field(default=8000, ge=3000, le=16000)
    profiler_enabled: bool = True
    reviewer_enabled: bool = False
    reviewer_model: str = Field(default=LATEST_MODELS[0], pattern=r"^[a-zA-Z0-9._:-]{1,100}$")
    clarity_enabled: bool = True
    screenshots_enabled: bool = True
    compare_previous_period: bool = True
    min_purchases: int = Field(default=10, ge=3, le=500)
    min_spend: float = Field(default=50.0, ge=0, le=100000, allow_inf_nan=False)
    target_cpa: float | None = Field(default=None, gt=0, le=100000, allow_inf_nan=False)
    target_roas: float | None = Field(default=None, gt=0, le=1000, allow_inf_nan=False)
    language: Literal["auto", "English", "Arabic", "French"] = "auto"
    instructions: str = Field(default="", max_length=6000)


def canonical_store(store: str | None) -> str | None:
    value = (store or "").strip().lower()
    return "irrakids" if value == "nouralibas" else value or None


def get_settings(store: str | None) -> AnalyzerSettings:
    stored = db.get_app_setting(canonical_store(store), "ads_analyzer_settings") or {}
    return AnalyzerSettings.model_validate(stored)


@lru_cache(maxsize=1)
def get_client() -> OpenAI:
    # Cloud Run injects this env var from Secret Manager; Netcup uses pull-env.sh.
    # Direct access is optional and never accepts credentials from the browser.
    resource = os.getenv("ADS_ANALYZER_OPENAI_SECRET_VERSION", "").strip()
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if resource:
        if not re.fullmatch(r"projects/[^/]+/secrets/[^/]+/versions/[^/]+", resource):
            raise RuntimeError("Invalid ADS_ANALYZER_OPENAI_SECRET_VERSION")
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        with AuthorizedSession(credentials) as session:
            response = session.get(f"https://secretmanager.googleapis.com/v1/{resource}:access", timeout=15)
            if not response.ok:
                raise RuntimeError("Google Secret Manager access failed; check the server service account")
            key = base64.b64decode(response.json()["payload"]["data"]).decode().strip()
    if not key:
        raise RuntimeError("OpenAI key is missing from the server Secret Manager configuration")
    return OpenAI(api_key=key, timeout=150, max_retries=1)


def is_analysis_model(model: str) -> bool:
    return bool(re.match(r"^(gpt-(?:[4-9]|[1-9][0-9])|o[3-9](?:-|$))", model)) and not any(
        term in model for term in ("audio", "realtime", "transcribe", "tts", "image", "search", "codex", "chat", "cyber", "deep-research", "pro")
    )


def model_catalog(refresh: bool = False) -> dict:
    with _model_lock:
        if not refresh and _model_cache.get("expires", 0) > time.monotonic():
            return _model_cache["data"]
        try:
            available = [m for m in get_client().models.list() if is_analysis_model(m.id)]
            available.sort(key=lambda m: (m.id in LATEST_MODELS, m.created or 0, m.id), reverse=True)
            data = {"models": [{"id": m.id, "available": True} for m in available], "source": "openai", "error": None}
        except Exception:
            # A documented catalog is useful for setup, but never claim account availability.
            data = {"models": [{"id": m, "available": False} for m in LATEST_MODELS], "source": "documented", "error": "Could not verify account models. Check the server OpenAI key and connection."}
        _model_cache.update(expires=time.monotonic() + (300 if data["source"] == "openai" else 30), data=data)
        return data


def save_settings(store: str | None, settings: AnalyzerSettings) -> None:
    if not is_analysis_model(settings.model) or not is_analysis_model(settings.reviewer_model):
        raise ValueError("Select a general-purpose text and vision model for analysis")
    catalog = model_catalog()
    if catalog["source"] == "openai":
        ids = {m["id"] for m in catalog["models"]}
        if settings.model not in ids or (settings.reviewer_enabled and settings.reviewer_model not in ids):
            raise ValueError("The selected model is not available to the server OpenAI account")
    db.set_app_setting(canonical_store(store), "ads_analyzer_settings", settings.model_dump())
