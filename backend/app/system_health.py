"""
System Health monitoring for Product Testing OS.

Pure-additive, in-memory, bounded telemetry. Records:
  - per-request latency, tagged by surface (ads_management, confirmation,
    page_builder, theme_editor, wholesale, …) via an ASGI middleware
  - per-provider outbound HTTP latency (Shopify, Meta, OpenAI, Gemini, Clarity)
  - DB query latency via SQLAlchemy events + pool checkout stats
  - in-flight pipelines / analysis jobs / ad-automation threads
  - Celery broker reachability + queue depth (best-effort)
  - process stats: RSS, threads, asyncio tasks, threadpool slots

All state lives in process memory. No new dependencies, no new database
tables. Rings have a hard size cap; metric collection adds microseconds per
call. The dashboard polls these endpoints; nothing else depends on this
module — failures are swallowed so instrumentation can never break a hot
path.

================================================================
Tunable env vars (all optional; integers unless noted)
================================================================

Sample sizing
  HEALTH_RING_SIZE                 (500)   samples per (category,op) ring
  HEALTH_ERR_RING_SIZE             (50)    last errors per provider
  HEALTH_SLOWOPS_SIZE              (100)   global slow-ops feed cap
  HEALTH_MIN_SAMPLES               (5)     min samples before p95 evaluation
  HEALTH_WINDOW_S                  (600)   aggregation window in seconds
  HEALTH_SAMPLES_WINDOW_S          (3600)  hard retention window for samples

Latency thresholds (p95, milliseconds — warn,crit)
  HEALTH_SHOPIFY_P95_WARN_MS       (1500)
  HEALTH_SHOPIFY_P95_CRIT_MS       (4000)
  HEALTH_META_P95_WARN_MS          (3000)
  HEALTH_META_P95_CRIT_MS          (8000)
  HEALTH_OPENAI_P95_WARN_MS        (5000)
  HEALTH_OPENAI_P95_CRIT_MS        (20000)
  HEALTH_OPENAI_IMG_P95_WARN_MS    (20000)
  HEALTH_OPENAI_IMG_P95_CRIT_MS    (60000)
  HEALTH_GEMINI_P95_WARN_MS        (5000)
  HEALTH_GEMINI_P95_CRIT_MS        (20000)
  HEALTH_CLARITY_P95_WARN_MS       (5000)
  HEALTH_CLARITY_P95_CRIT_MS       (15000)
  HEALTH_DB_P95_WARN_MS            (100)
  HEALTH_DB_P95_CRIT_MS            (500)
  HEALTH_REQ_P95_WARN_MS           (2000)
  HEALTH_REQ_P95_CRIT_MS           (8000)

Error-rate thresholds (0..1, decimals)
  HEALTH_PROVIDER_ERR_RATE_WARN    (0.10)
  HEALTH_PROVIDER_ERR_RATE_CRIT    (0.30)

Pipeline & queue thresholds
  HEALTH_INFLIGHT_PIPELINES_WARN   (5)
  HEALTH_INFLIGHT_PIPELINES_CRIT   (15)
  HEALTH_PIPELINE_STALE_S          (1800)  in-flight pipeline older than this is "stuck"
  HEALTH_CELERY_QUEUE_WARN         (20)
  HEALTH_CELERY_QUEUE_CRIT         (100)

Confirmation SLA
  HEALTH_CONFIRMATION_STUCK_HOURS  (24)    open+assigned without n/wtp action for X hours
  HEALTH_CONFIRMATION_STUCK_WARN   (10)
  HEALTH_CONFIRMATION_STUCK_CRIT   (50)
  HEALTH_CONFIRMATION_PROBE_TTL_S  (300)   cache TTL for the stuck-orders probe

Process / memory
  HEALTH_RSS_WARN_MB               (350)
  HEALTH_RSS_CRIT_MB               (480)

Auth
  SYSTEM_ADMIN_USERS              (JSON map or array — see system_health_routes.py)
  SYSTEM_ADMIN_SECRET             (signing secret for tokens; falls back to JWT_SECRET)

Incident log
  HEALTH_INCIDENT_LOG_SIZE         (200)   max past incidents kept in memory
  HEALTH_INCIDENT_POLLER_S         (60)    background poller cadence — keeps the log
                                           up to date even when no client is polling
                                           the dashboard. Set to 0 to disable.

Misc
  HEALTH_EXCLUDE_ROUTES           (comma-sep prefixes excluded from request timing;
                                   default: /uploads,/health,/api/system-health,/favicon.ico)
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import threading
import time
from collections import deque
from typing import Any, Callable, Iterable, Optional

_log = logging.getLogger("app.system_health")


# ---------------- env helpers ----------------

def _int_env(name: str, default: int) -> int:
    try:
        v = os.getenv(name, "")
        return int(v) if v not in (None, "") else default
    except Exception:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        v = os.getenv(name, "")
        return float(v) if v not in (None, "") else default
    except Exception:
        return default


# ---------------- configuration ----------------

RING_SIZE = _int_env("HEALTH_RING_SIZE", 500)
ERR_RING_SIZE = _int_env("HEALTH_ERR_RING_SIZE", 50)
SLOWOPS_SIZE = _int_env("HEALTH_SLOWOPS_SIZE", 100)
MIN_SAMPLES = _int_env("HEALTH_MIN_SAMPLES", 5)
WINDOW_S = _int_env("HEALTH_WINDOW_S", 600)
SAMPLES_WINDOW_S = _int_env("HEALTH_SAMPLES_WINDOW_S", 3600)

THRESHOLDS_MS: dict[str, tuple[int, int]] = {
    "shopify":      (_int_env("HEALTH_SHOPIFY_P95_WARN_MS", 1500), _int_env("HEALTH_SHOPIFY_P95_CRIT_MS", 4000)),
    "meta":         (_int_env("HEALTH_META_P95_WARN_MS", 3000),    _int_env("HEALTH_META_P95_CRIT_MS", 8000)),
    "openai":       (_int_env("HEALTH_OPENAI_P95_WARN_MS", 5000),  _int_env("HEALTH_OPENAI_P95_CRIT_MS", 20000)),
    "openai_image": (_int_env("HEALTH_OPENAI_IMG_P95_WARN_MS", 20000), _int_env("HEALTH_OPENAI_IMG_P95_CRIT_MS", 60000)),
    "gemini":       (_int_env("HEALTH_GEMINI_P95_WARN_MS", 5000),  _int_env("HEALTH_GEMINI_P95_CRIT_MS", 20000)),
    "clarity":      (_int_env("HEALTH_CLARITY_P95_WARN_MS", 5000), _int_env("HEALTH_CLARITY_P95_CRIT_MS", 15000)),
    "db":           (_int_env("HEALTH_DB_P95_WARN_MS", 100),       _int_env("HEALTH_DB_P95_CRIT_MS", 500)),
    "request":      (_int_env("HEALTH_REQ_P95_WARN_MS", 2000),     _int_env("HEALTH_REQ_P95_CRIT_MS", 8000)),
}

ERR_RATE_WARN = _float_env("HEALTH_PROVIDER_ERR_RATE_WARN", 0.10)
ERR_RATE_CRIT = _float_env("HEALTH_PROVIDER_ERR_RATE_CRIT", 0.30)

INFLIGHT_WARN = _int_env("HEALTH_INFLIGHT_PIPELINES_WARN", 5)
INFLIGHT_CRIT = _int_env("HEALTH_INFLIGHT_PIPELINES_CRIT", 15)
PIPELINE_STALE_S = _int_env("HEALTH_PIPELINE_STALE_S", 1800)
CELERY_QUEUE_WARN = _int_env("HEALTH_CELERY_QUEUE_WARN", 20)
CELERY_QUEUE_CRIT = _int_env("HEALTH_CELERY_QUEUE_CRIT", 100)

CONFIRMATION_STUCK_HOURS = _int_env("HEALTH_CONFIRMATION_STUCK_HOURS", 24)
CONFIRMATION_STUCK_WARN = _int_env("HEALTH_CONFIRMATION_STUCK_WARN", 10)
CONFIRMATION_STUCK_CRIT = _int_env("HEALTH_CONFIRMATION_STUCK_CRIT", 50)
CONFIRMATION_PROBE_TTL_S = _int_env("HEALTH_CONFIRMATION_PROBE_TTL_S", 300)

RSS_WARN_MB = _int_env("HEALTH_RSS_WARN_MB", 350)
RSS_CRIT_MB = _int_env("HEALTH_RSS_CRIT_MB", 480)

INCIDENT_LOG_SIZE = _int_env("HEALTH_INCIDENT_LOG_SIZE", 200)
INCIDENT_POLLER_S = _int_env("HEALTH_INCIDENT_POLLER_S", 60)

_DEFAULT_EXCLUDES = "/uploads,/health,/api/system-health,/favicon.ico"
EXCLUDE_ROUTES: tuple[str, ...] = tuple(
    p.strip() for p in (os.getenv("HEALTH_EXCLUDE_ROUTES", _DEFAULT_EXCLUDES) or "").split(",")
    if p.strip()
)


# ---------------- state ----------------

_STARTED_AT = time.time()
_LOCK = threading.Lock()

# Samples ring: (category, op) -> deque of (ts, ms, ok, store, route, err)
_SAMPLES: dict[tuple[str, str], deque[tuple[float, float, bool, Optional[str], Optional[str], Optional[str]]]] = {}
# Per-provider error ring: provider -> deque of (ts, op, err)
_ERRORS: dict[str, deque[tuple[float, str, str]]] = {}
# Slow-ops global feed: deque of (ts, category, op, ms, ok, store, route, err)
_SLOWOPS: deque[tuple[float, str, str, float, bool, Optional[str], Optional[str], Optional[str]]] = deque(maxlen=SLOWOPS_SIZE)

# In-flight tracker: pid -> {kind, started_at, store, label, extra}
_INFLIGHT: dict[str, dict[str, Any]] = {}
_INFLIGHT_LOCK = threading.Lock()

# Confirmation stuck-orders probe cache: (ts, result)
_CONFIRMATION_PROBE: dict[str, Any] = {"ts": 0.0, "result": None, "running": False}
_CONFIRMATION_PROBE_LOCK = threading.Lock()

# Incident log: persists past warn/crit reasons with first_seen / last_seen / resolved_at.
# Keyed by code so flapping doesn't spam the log; the same code re-opening after
# resolution starts a new incident entry.
_INCIDENTS_LOCK = threading.Lock()
_INCIDENTS: deque[dict[str, Any]] = deque(maxlen=INCIDENT_LOG_SIZE)
_OPEN_INCIDENTS: dict[str, int] = {}  # code -> index into _INCIDENTS (when still open)

# Background poller state
_POLLER_STARTED = False
_POLLER_LOCK = threading.Lock()

# A reference to the SQLAlchemy engine (set by db.py once it's created)
_DB_ENGINE: Any = None


# ---------------- core recording ----------------

def _ring(cat: str, op: str) -> deque:
    key = (cat, op)
    d = _SAMPLES.get(key)
    if d is None:
        d = deque(maxlen=RING_SIZE)
        _SAMPLES[key] = d
    return d


def _err_ring(provider: str) -> deque:
    d = _ERRORS.get(provider)
    if d is None:
        d = deque(maxlen=ERR_RING_SIZE)
        _ERRORS[provider] = d
    return d


def record(category: str, op: str, duration_ms: float, ok: bool, *,
           store: Optional[str] = None, route: Optional[str] = None,
           error: Optional[str] = None) -> None:
    """Record one sample. Cheap; safe to call from any thread."""
    try:
        if not category or not op:
            return
        now = time.time()
        ms = float(duration_ms or 0.0)
        err_short = None
        if error:
            es = str(error)
            err_short = es if len(es) <= 240 else (es[:237] + "...")
        with _LOCK:
            _ring(category, op).append((now, ms, bool(ok), store, route, err_short))
            if not ok and err_short:
                _err_ring(category).append((now, op, err_short))
            _SLOWOPS.append((now, category, op, ms, bool(ok), store, route, err_short))
    except Exception:
        pass


@contextlib.contextmanager
def time_op(category: str, op: str, *, store: Optional[str] = None, route: Optional[str] = None):
    """Context manager that times a block and records the sample."""
    started = time.perf_counter()
    ok = True
    err: Optional[str] = None
    try:
        yield
    except BaseException as e:
        ok = False
        err = f"{type(e).__name__}: {e}"
        raise
    finally:
        ms = (time.perf_counter() - started) * 1000.0
        record(category, op, ms, ok, store=store, route=route, error=err)


def time_call(category: str, op: str, fn: Callable[..., Any], *args,
              store: Optional[str] = None, route: Optional[str] = None, **kwargs):
    """Call ``fn(*args, **kwargs)`` while timing it. Returns the result."""
    started = time.perf_counter()
    ok = True
    err: Optional[str] = None
    try:
        return fn(*args, **kwargs)
    except BaseException as e:
        ok = False
        err = f"{type(e).__name__}: {e}"
        raise
    finally:
        ms = (time.perf_counter() - started) * 1000.0
        record(category, op, ms, ok, store=store, route=route, error=err)


# ---------------- in-flight tracker (pipelines, analysis jobs, ad automations) ----------------

def register_inflight(pid: str, kind: str, *, store: Optional[str] = None, label: Optional[str] = None,
                       extra: Optional[dict] = None) -> None:
    try:
        with _INFLIGHT_LOCK:
            _INFLIGHT[pid] = {
                "kind": kind,
                "store": store,
                "label": label or pid,
                "started_at": time.time(),
                "extra": extra or {},
            }
    except Exception:
        pass


def clear_inflight(pid: str) -> None:
    try:
        with _INFLIGHT_LOCK:
            _INFLIGHT.pop(pid, None)
    except Exception:
        pass


def list_inflight() -> list[dict[str, Any]]:
    try:
        with _INFLIGHT_LOCK:
            now = time.time()
            return [
                {
                    "id": pid,
                    "kind": v.get("kind"),
                    "store": v.get("store"),
                    "label": v.get("label"),
                    "started_at": v.get("started_at"),
                    "age_s": int(now - float(v.get("started_at") or now)),
                    "extra": v.get("extra") or {},
                }
                for pid, v in _INFLIGHT.items()
            ]
    except Exception:
        return []


# ---------------- aggregation ----------------

def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    v = sorted(values)
    k = int(round((p / 100.0) * (len(v) - 1)))
    return float(v[max(0, min(len(v) - 1, k))])


def _summarize(samples: list[tuple], *, window_s: int = WINDOW_S) -> dict[str, Any]:
    now = time.time()
    if not samples:
        return {"count": 0}
    recent = [s for s in samples if (now - s[0]) <= window_s]
    if not recent:
        return {"count": 0}
    durs = [s[1] for s in recent]
    ok_count = sum(1 for s in recent if s[2])
    return {
        "count": len(recent),
        "ok": ok_count,
        "err": len(recent) - ok_count,
        "err_rate": round((len(recent) - ok_count) / max(1, len(recent)), 4),
        "p50": int(_percentile(durs, 50)),
        "p95": int(_percentile(durs, 95)),
        "p99": int(_percentile(durs, 99)),
        "max": int(max(durs)),
        "last_ts": recent[-1][0],
    }


def _summarize_category(category: str, *, window_s: int = WINDOW_S) -> dict[str, Any]:
    rows: list[tuple] = []
    with _LOCK:
        for (cat, _op), d in _SAMPLES.items():
            if cat == category:
                rows.extend(d)
    return _summarize(rows, window_s=window_s)


def _by_op(category: str, *, window_s: int = WINDOW_S, limit: int = 20) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with _LOCK:
        items = [(op, list(d)) for (cat, op), d in _SAMPLES.items() if cat == category]
    for op, samples in items:
        s = _summarize(samples, window_s=window_s)
        if s.get("count"):
            s["op"] = op
            out.append(s)
    # sort: most painful first — err first, then p95
    out.sort(key=lambda x: (-(x.get("err") or 0), -(x.get("p95") or 0)))
    return out[:limit]


def _recent_errors(category: str, limit: int = 20) -> list[dict[str, Any]]:
    with _LOCK:
        d = list(_ERRORS.get(category) or ())
    d = d[-limit:]
    return [{"ts": ts, "op": op, "error": err} for (ts, op, err) in reversed(d)]


def _slow_ops(limit: int = 50) -> list[dict[str, Any]]:
    with _LOCK:
        rows = list(_SLOWOPS)
    rows.sort(key=lambda x: -x[3])
    return [
        {"ts": ts, "category": cat, "op": op, "ms": int(ms), "ok": ok,
         "store": store, "route": route, "error": err}
        for (ts, cat, op, ms, ok, store, route, err) in rows[:limit]
    ]


# ---------------- DB / engine ----------------

def attach_db_engine(engine: Any) -> None:
    """Called by db.py once the SQLAlchemy engine is created."""
    global _DB_ENGINE
    _DB_ENGINE = engine


def _db_info() -> dict[str, Any]:
    info: dict[str, Any] = {"driver": None, "url": None, "pool": None, "sqlite_ephemeral_warning": False}
    try:
        eng = _DB_ENGINE
        if eng is None:
            return info
        try:
            info["driver"] = eng.dialect.name  # "sqlite", "postgresql", ...
        except Exception:
            pass
        try:
            u = str(eng.url)
            info["url"] = u if not u.startswith("postgresql") else u.split("@")[-1]
        except Exception:
            pass
        try:
            pool = eng.pool
            info["pool"] = {
                "class": type(pool).__name__,
                "size": getattr(pool, "size", lambda: None)() if callable(getattr(pool, "size", None)) else None,
                "checked_in": getattr(pool, "checkedin", lambda: None)() if callable(getattr(pool, "checkedin", None)) else None,
                "checked_out": getattr(pool, "checkedout", lambda: None)() if callable(getattr(pool, "checkedout", None)) else None,
                "overflow": getattr(pool, "overflow", lambda: None)() if callable(getattr(pool, "overflow", None)) else None,
            }
        except Exception:
            pass
        try:
            # Flag the SQLite-on-Cloud-Run footgun
            if (info.get("driver") or "").lower() == "sqlite":
                on_cloud_run = bool(os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_JOB"))
                info["sqlite_ephemeral_warning"] = on_cloud_run
        except Exception:
            pass
    except Exception:
        pass
    return info


# ---------------- Celery ----------------

def _celery_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "broker_ok": None,
        "broker_url": None,
        "queue_depth": None,
        "active_workers": None,
        "last_error": None,
    }
    try:
        from app.config import CELERY_BROKER_URL
        info["broker_url"] = (CELERY_BROKER_URL or "").split("@")[-1] or None
        try:
            from app.tasks import celery as _celery  # type: ignore
        except Exception as e:
            info["last_error"] = f"celery_import: {e}"
            return info
        try:
            with _celery.connection_or_acquire() as conn:
                conn.ensure_connection(max_retries=1, timeout=1.5)
                info["broker_ok"] = True
                try:
                    chan = conn.default_channel
                    qd = chan.queue_declare(queue="celery", passive=True)
                    info["queue_depth"] = getattr(qd, "message_count", None)
                except Exception:
                    info["queue_depth"] = None
        except Exception as e:
            info["broker_ok"] = False
            info["last_error"] = f"broker: {type(e).__name__}: {e}"
        try:
            insp = _celery.control.inspect(timeout=1.0)
            active = insp.active() or {}
            info["active_workers"] = sum(len(v or []) for v in active.values())
        except Exception:
            info["active_workers"] = None
    except Exception as e:
        info["last_error"] = f"{type(e).__name__}: {e}"
    return info


# ---------------- process info ----------------

def _process_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "rss_mb": None,
        "threads": None,
        "asyncio_tasks": None,
        "threadpool_max": None,
        "pid": os.getpid(),
    }
    try:
        info["threads"] = threading.active_count()
    except Exception:
        pass
    try:
        import resource  # POSIX-only — guarded
        ru = resource.getrusage(resource.RUSAGE_SELF)
        # ru_maxrss is KB on Linux, bytes on macOS
        kb = ru.ru_maxrss
        if kb > 10_000_000:  # likely bytes (macOS)
            info["rss_mb"] = int(kb / (1024 * 1024))
        else:
            info["rss_mb"] = int(kb / 1024)
    except Exception:
        try:
            # Fallback for non-POSIX: read /proc/self/statm if available
            with open("/proc/self/statm", "rb") as fh:
                fields = fh.read().split()
                rss_pages = int(fields[1])
                page_size = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096
                info["rss_mb"] = int((rss_pages * page_size) / (1024 * 1024))
        except Exception:
            pass
    try:
        import asyncio
        loop = asyncio.get_event_loop_policy().get_event_loop()
        if loop and loop.is_running():
            info["asyncio_tasks"] = len(asyncio.all_tasks(loop=loop))
    except Exception:
        pass
    try:
        # Starlette default threadpool is anyio.to_thread.run_sync;
        # we can read its limiter total_tokens.
        from anyio.to_thread import current_default_thread_limiter
        info["threadpool_max"] = int(current_default_thread_limiter().total_tokens)
    except Exception:
        pass
    return info


# ---------------- application cache hooks ----------------

# main.py's _API_CACHE / _API_INFLIGHT and the campaign analysis _analysis_jobs
# dict are module-private. We expose lazy accessors so this module never imports
# main.py at module load time (avoids circular imports).
def _app_cache_stats() -> dict[str, Any]:
    out: dict[str, Any] = {"api_cache_size": None, "api_inflight": None, "analysis_jobs": None}
    try:
        import importlib
        m = importlib.import_module("app.main")
        c = getattr(m, "_API_CACHE", None)
        f = getattr(m, "_API_INFLIGHT", None)
        j = getattr(m, "_analysis_jobs", None)
        if isinstance(c, dict):
            out["api_cache_size"] = len(c)
        if isinstance(f, dict):
            out["api_inflight"] = len(f)
        if isinstance(j, dict):
            out["analysis_jobs"] = len(j)
    except Exception:
        pass
    return out


# ---------------- confirmation stuck-orders probe ----------------

def _confirmation_probe_cached() -> Optional[dict[str, Any]]:
    """Best-effort cached count of open+assigned orders sitting for > CONFIRMATION_STUCK_HOURS.

    Does the heavy Shopify scan in a background thread no more than once per
    CONFIRMATION_PROBE_TTL_S so the snapshot endpoint stays fast.
    """
    now = time.time()
    with _CONFIRMATION_PROBE_LOCK:
        ts = float(_CONFIRMATION_PROBE.get("ts") or 0.0)
        running = bool(_CONFIRMATION_PROBE.get("running"))
        result = _CONFIRMATION_PROBE.get("result")
        if (now - ts) > CONFIRMATION_PROBE_TTL_S and not running:
            _CONFIRMATION_PROBE["running"] = True
            t = threading.Thread(target=_confirmation_probe_run, daemon=True, name="health-confirmation-probe")
            t.start()
    return result


def _confirmation_probe_run() -> None:
    try:
        stores = [s.strip() for s in (os.getenv("HEALTH_CONFIRMATION_STORES", "irrakids,irranova") or "").split(",") if s.strip()]
        cutoff_hours = max(1, CONFIRMATION_STUCK_HOURS)
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=cutoff_hours)
        results: dict[str, Any] = {"by_store": {}, "stuck_total": 0, "checked_at": time.time(), "cutoff_hours": cutoff_hours}
        try:
            from app.integrations.shopify_client import list_orders_open_unfulfilled
        except Exception as e:
            results["error"] = f"shopify_import: {e}"
            with _CONFIRMATION_PROBE_LOCK:
                _CONFIRMATION_PROBE["ts"] = time.time()
                _CONFIRMATION_PROBE["result"] = results
                _CONFIRMATION_PROBE["running"] = False
            return
        try:
            from app.integrations.shopify_client import has_cod_tag
        except Exception:
            has_cod_tag = None  # type: ignore

        def _has_action_tag(tags_str: Any) -> bool:
            try:
                if isinstance(tags_str, str):
                    parts = [t.strip().lower() for t in tags_str.split(",") if t.strip()]
                elif isinstance(tags_str, list):
                    parts = [str(t).strip().lower() for t in tags_str if str(t).strip()]
                else:
                    return False
                for t in parts:
                    if t in ("n1", "n2", "n3", "wtp1", "wtp2", "wtp3"):
                        return True
                return False
            except Exception:
                return False

        for st in stores:
            try:
                stuck = 0
                total = 0
                page_info: Optional[str] = None
                pages = 0
                while pages < 8:  # safety cap; this is best-effort
                    res = list_orders_open_unfulfilled(
                        store=st, limit=250, page_info=page_info,
                        fields="id,tags,created_at,assigned_location_id",
                    )
                    orders = (res or {}).get("orders") or []
                    for o in orders:
                        if not isinstance(o, dict):
                            continue
                        total += 1
                        try:
                            if has_cod_tag and has_cod_tag(o.get("tags")):
                                continue
                        except Exception:
                            pass
                        if _has_action_tag(o.get("tags")):
                            continue
                        try:
                            created = o.get("created_at")
                            if not created:
                                continue
                            dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                            if dt < cutoff:
                                stuck += 1
                        except Exception:
                            continue
                    page_info = (res or {}).get("next_page_info") or None
                    pages += 1
                    if not page_info:
                        break
                results["by_store"][st] = {"stuck": stuck, "scanned": total, "pages": pages, "truncated": bool(page_info)}
                results["stuck_total"] += stuck
            except Exception as e:
                results["by_store"][st] = {"error": f"{type(e).__name__}: {e}"}
        with _CONFIRMATION_PROBE_LOCK:
            _CONFIRMATION_PROBE["ts"] = time.time()
            _CONFIRMATION_PROBE["result"] = results
            _CONFIRMATION_PROBE["running"] = False
    except Exception as e:
        try:
            _log.warning("confirmation_probe_failed: %s", e)
        except Exception:
            pass
        with _CONFIRMATION_PROBE_LOCK:
            _CONFIRMATION_PROBE["ts"] = time.time()
            _CONFIRMATION_PROBE["result"] = {"error": f"{type(e).__name__}: {e}", "checked_at": time.time()}
            _CONFIRMATION_PROBE["running"] = False


# ---------------- snapshot + status ----------------

PROVIDERS = ("shopify", "meta", "openai", "openai_image", "gemini", "clarity")


def snapshot() -> dict[str, Any]:
    """Full JSON snapshot for the admin dashboard."""
    now = time.time()
    # Per-surface request summary
    request_by_surface: dict[str, dict[str, Any]] = {}
    request_by_op: list[dict[str, Any]] = []
    with _LOCK:
        for (cat, op), d in _SAMPLES.items():
            if cat == "request":
                rows = [r for r in d if (now - r[0]) <= WINDOW_S]
                if not rows:
                    continue
                surface = (rows[-1][4] or op).split(":", 1)[0]
                bucket = request_by_surface.setdefault(surface, [])
                bucket.extend(rows)
    surface_summary: dict[str, dict[str, Any]] = {
        s: _summarize(rows) for s, rows in request_by_surface.items() if rows
    }
    # By-op for requests (top painful)
    request_by_op = _by_op("request", limit=25)

    providers: dict[str, Any] = {}
    for p in PROVIDERS:
        providers[p] = {
            "summary": _summarize_category(p),
            "by_op": _by_op(p, limit=15),
            "recent_errors": _recent_errors(p, limit=15),
        }

    db_summary = _summarize_category("db")
    db_by_op = _by_op("db", limit=15)
    db_info = _db_info()

    out: dict[str, Any] = {
        "now": now,
        "started_at": _STARTED_AT,
        "uptime_s": int(now - _STARTED_AT),
        "config": {
            "window_s": WINDOW_S,
            "ring_size": RING_SIZE,
            "thresholds_ms": THRESHOLDS_MS,
            "err_rate_warn": ERR_RATE_WARN,
            "err_rate_crit": ERR_RATE_CRIT,
            "inflight_warn": INFLIGHT_WARN,
            "inflight_crit": INFLIGHT_CRIT,
            "pipeline_stale_s": PIPELINE_STALE_S,
            "confirmation_stuck_hours": CONFIRMATION_STUCK_HOURS,
            "confirmation_probe_ttl_s": CONFIRMATION_PROBE_TTL_S,
        },
        "deployment": {
            "cloud_run_service": os.getenv("K_SERVICE") or None,
            "cloud_run_revision": os.getenv("K_REVISION") or None,
            "instance_id": os.getenv("K_REVISION") or os.getenv("HOSTNAME") or None,
            "use_celery_env": (os.getenv("USE_CELERY", "false") or "").lower() in ("1", "true", "yes"),
        },
        "request": {
            "summary": _summarize_category("request"),
            "by_surface": surface_summary,
            "by_op": request_by_op,
        },
        "providers": providers,
        "db": {"summary": db_summary, "by_op": db_by_op, **db_info},
        "cache": _app_cache_stats(),
        "celery": _celery_info(),
        "process": _process_info(),
        "pipelines": {
            "inflight": list_inflight(),
            "count": len(_INFLIGHT),
        },
        "confirmation": _confirmation_probe_cached() or {"pending": True},
        "slow_ops": _slow_ops(limit=50),
        "incidents": list_incidents(limit=100),
    }
    return out


def _record_incidents(reasons: list[dict[str, Any]]) -> None:
    """Maintain the rolling incident log.

    - New reason whose code is not in ``_OPEN_INCIDENTS`` → append a new
      incident entry (first_seen = last_seen = now).
    - Reason whose code IS open → update last_seen + level + msg + tick count.
    - Open incident whose code is absent from current reasons → mark resolved.
    """
    try:
        now = time.time()
        current_codes = {r.get("code"): r for r in reasons or [] if isinstance(r, dict) and r.get("code")}
        with _INCIDENTS_LOCK:
            # Index incidents by id for stable references
            incidents_list = list(_INCIDENTS)

            # 1) Update / open
            for code, r in current_codes.items():
                if code in _OPEN_INCIDENTS:
                    idx = _OPEN_INCIDENTS[code]
                    # The deque might have evicted the entry if it was very old;
                    # fall back to re-opening in that case.
                    try:
                        entry = incidents_list[idx]
                    except Exception:
                        entry = None
                    if entry is not None and entry.get("code") == code and not entry.get("resolved_at"):
                        entry["last_seen"] = now
                        entry["level"] = r.get("level") or entry.get("level")
                        entry["msg"] = r.get("msg") or entry.get("msg")
                        entry["tick_count"] = int(entry.get("tick_count") or 0) + 1
                        # propagate optional extras
                        for k in ("value", "threshold", "provider", "surface", "ids"):
                            if k in r:
                                entry[k] = r[k]
                        continue
                    # Stale index — fall through to open a new one
                    _OPEN_INCIDENTS.pop(code, None)
                # New incident
                entry = {
                    "id": f"{int(now * 1000)}-{code}",
                    "code": code,
                    "level": r.get("level"),
                    "msg": r.get("msg"),
                    "first_seen": now,
                    "last_seen": now,
                    "resolved_at": None,
                    "tick_count": 1,
                }
                for k in ("value", "threshold", "provider", "surface", "ids"):
                    if k in r:
                        entry[k] = r[k]
                _INCIDENTS.append(entry)
                # Recompute open index map (deque can evict on append)
                incidents_list = list(_INCIDENTS)
                _OPEN_INCIDENTS[code] = len(incidents_list) - 1

            # 2) Resolve incidents whose codes are no longer active
            still_open: dict[str, int] = {}
            for code, idx in list(_OPEN_INCIDENTS.items()):
                try:
                    entry = incidents_list[idx]
                except Exception:
                    continue
                if entry.get("code") != code:
                    continue
                if code in current_codes:
                    still_open[code] = idx
                else:
                    if not entry.get("resolved_at"):
                        entry["resolved_at"] = now
            _OPEN_INCIDENTS.clear()
            _OPEN_INCIDENTS.update(still_open)
    except Exception:
        pass


def list_incidents(limit: int = 100) -> list[dict[str, Any]]:
    """Return incidents newest-first. Open incidents have resolved_at=None."""
    try:
        with _INCIDENTS_LOCK:
            items = list(_INCIDENTS)
        # Newest first; open incidents first within same time
        items.sort(key=lambda e: (e.get("resolved_at") is not None, -float(e.get("last_seen") or 0)))
        return items[:limit]
    except Exception:
        return []


def clear_incidents() -> int:
    try:
        with _INCIDENTS_LOCK:
            n = len(_INCIDENTS)
            _INCIDENTS.clear()
            _OPEN_INCIDENTS.clear()
            return n
    except Exception:
        return 0


def status() -> dict[str, Any]:
    """At-a-glance status. Returns {level, reasons[]} where each reason is
    {level, code, msg, value?, threshold?}.
    """
    snap = snapshot()
    reasons: list[dict[str, Any]] = []

    def _add(level: str, code: str, msg: str, **extra: Any) -> None:
        item = {"level": level, "code": code, "msg": msg}
        item.update(extra)
        reasons.append(item)

    # 1) DB checks
    db = snap.get("db") or {}
    if db.get("sqlite_ephemeral_warning"):
        _add("crit", "DB_SQLITE_ON_CLOUD_RUN",
             "Backend is using SQLite on Cloud Run (ephemeral disk). Data will be lost on instance recycle.")
    db_sum = db.get("summary") or {}
    if (db_sum.get("count") or 0) >= MIN_SAMPLES:
        warn, crit = THRESHOLDS_MS["db"]
        p95 = db_sum.get("p95") or 0
        if p95 >= crit:
            _add("crit", "DB_P95", f"DB p95 {p95}ms ≥ {crit}ms", value=p95, threshold=crit)
        elif p95 >= warn:
            _add("warn", "DB_P95", f"DB p95 {p95}ms ≥ {warn}ms", value=p95, threshold=warn)

    # 2) Provider checks
    for p, data in (snap.get("providers") or {}).items():
        s = (data or {}).get("summary") or {}
        if (s.get("count") or 0) < MIN_SAMPLES:
            continue
        warn, crit = THRESHOLDS_MS.get(p, (None, None))
        p95 = s.get("p95") or 0
        if warn and crit:
            if p95 >= crit:
                _add("crit", f"{p.upper()}_P95",
                     f"{p} p95 {p95}ms ≥ {crit}ms (n={s.get('count')})",
                     value=p95, threshold=crit, provider=p)
            elif p95 >= warn:
                _add("warn", f"{p.upper()}_P95",
                     f"{p} p95 {p95}ms ≥ {warn}ms (n={s.get('count')})",
                     value=p95, threshold=warn, provider=p)
        err_rate = float(s.get("err_rate") or 0.0)
        if err_rate >= ERR_RATE_CRIT:
            _add("crit", f"{p.upper()}_ERR_RATE",
                 f"{p} error rate {err_rate:.1%} ≥ {ERR_RATE_CRIT:.0%} (n={s.get('count')})",
                 value=err_rate, threshold=ERR_RATE_CRIT, provider=p)
        elif err_rate >= ERR_RATE_WARN:
            _add("warn", f"{p.upper()}_ERR_RATE",
                 f"{p} error rate {err_rate:.1%} ≥ {ERR_RATE_WARN:.0%} (n={s.get('count')})",
                 value=err_rate, threshold=ERR_RATE_WARN, provider=p)

    # 3) Request-latency checks (overall)
    req = (snap.get("request") or {}).get("summary") or {}
    if (req.get("count") or 0) >= MIN_SAMPLES:
        warn, crit = THRESHOLDS_MS["request"]
        p95 = req.get("p95") or 0
        if p95 >= crit:
            _add("crit", "REQ_P95", f"Request p95 {p95}ms ≥ {crit}ms", value=p95, threshold=crit)
        elif p95 >= warn:
            _add("warn", "REQ_P95", f"Request p95 {p95}ms ≥ {warn}ms", value=p95, threshold=warn)

    # 3b) Per-surface request checks — surface-specific slowness
    for surface, s in (snap.get("request") or {}).get("by_surface", {}).items():
        if (s.get("count") or 0) < MIN_SAMPLES:
            continue
        warn, crit = THRESHOLDS_MS["request"]
        p95 = s.get("p95") or 0
        if p95 >= crit:
            _add("warn", "REQ_SURFACE_P95",
                 f"Surface '{surface}' p95 {p95}ms ≥ {crit}ms", value=p95, threshold=crit, surface=surface)

    # 4) Celery / pipelines
    cel = snap.get("celery") or {}
    if cel.get("broker_ok") is False:
        _add("crit", "CELERY_BROKER_DOWN",
             f"Celery broker unreachable: {cel.get('last_error') or 'unknown'}")
    qd = cel.get("queue_depth")
    if isinstance(qd, int):
        if qd >= CELERY_QUEUE_CRIT:
            _add("crit", "CELERY_QUEUE",
                 f"Celery queue depth {qd} ≥ {CELERY_QUEUE_CRIT}", value=qd, threshold=CELERY_QUEUE_CRIT)
        elif qd >= CELERY_QUEUE_WARN:
            _add("warn", "CELERY_QUEUE",
                 f"Celery queue depth {qd} ≥ {CELERY_QUEUE_WARN}", value=qd, threshold=CELERY_QUEUE_WARN)

    pipes = snap.get("pipelines") or {}
    in_n = int(pipes.get("count") or 0)
    if in_n >= INFLIGHT_CRIT:
        _add("crit", "PIPELINES_INFLIGHT",
             f"{in_n} in-flight background jobs ≥ {INFLIGHT_CRIT}", value=in_n)
    elif in_n >= INFLIGHT_WARN:
        _add("warn", "PIPELINES_INFLIGHT",
             f"{in_n} in-flight background jobs ≥ {INFLIGHT_WARN}", value=in_n)
    # stuck pipelines
    stale = [p for p in (pipes.get("inflight") or []) if (p.get("age_s") or 0) >= PIPELINE_STALE_S]
    if stale:
        _add("warn", "PIPELINES_STUCK",
             f"{len(stale)} background job(s) older than {PIPELINE_STALE_S}s — possibly stuck",
             ids=[p.get("id") for p in stale][:10])

    # 5) Confirmation SLA
    conf = snap.get("confirmation") or {}
    stuck = conf.get("stuck_total")
    if isinstance(stuck, int):
        if stuck >= CONFIRMATION_STUCK_CRIT:
            _add("crit", "CONFIRMATION_STUCK",
                 f"{stuck} open orders without action > {CONFIRMATION_STUCK_HOURS}h",
                 value=stuck, threshold=CONFIRMATION_STUCK_CRIT)
        elif stuck >= CONFIRMATION_STUCK_WARN:
            _add("warn", "CONFIRMATION_STUCK",
                 f"{stuck} open orders without action > {CONFIRMATION_STUCK_HOURS}h",
                 value=stuck, threshold=CONFIRMATION_STUCK_WARN)

    # 6) Memory pressure
    proc = snap.get("process") or {}
    rss = proc.get("rss_mb")
    if isinstance(rss, int):
        if rss >= RSS_CRIT_MB:
            _add("crit", "MEMORY", f"RSS {rss}MB ≥ {RSS_CRIT_MB}MB", value=rss, threshold=RSS_CRIT_MB)
        elif rss >= RSS_WARN_MB:
            _add("warn", "MEMORY", f"RSS {rss}MB ≥ {RSS_WARN_MB}MB", value=rss, threshold=RSS_WARN_MB)

    # Overall level
    level = "ok"
    if any(r["level"] == "crit" for r in reasons):
        level = "crit"
    elif any(r["level"] == "warn" for r in reasons):
        level = "warn"

    # Update the incident log so past issues remain visible even when resolved
    _record_incidents(reasons)

    return {
        "level": level,
        "reasons": reasons,
        "uptime_s": snap.get("uptime_s"),
        "now": snap.get("now"),
    }


def _ensure_incident_poller() -> None:
    """Spin up a daemon thread that calls status() every HEALTH_INCIDENT_POLLER_S
    so the incident log accumulates issues even when no client is polling.

    Safe to call repeatedly; only starts once.
    """
    global _POLLER_STARTED
    if INCIDENT_POLLER_S <= 0:
        return
    with _POLLER_LOCK:
        if _POLLER_STARTED:
            return
        _POLLER_STARTED = True

    def _poll():
        # Small initial delay so app start-up isn't slowed by an immediate scan
        time.sleep(min(15, INCIDENT_POLLER_S))
        while True:
            try:
                status()
            except Exception:
                pass
            time.sleep(max(5, INCIDENT_POLLER_S))

    t = threading.Thread(target=_poll, daemon=True, name="health-incident-poller")
    t.start()


# ---------------- ASGI middleware ----------------

# Surface tagging: route prefix -> surface label. Order matters (most specific first).
SURFACE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("/api/ads-management",     "ads_management"),
    ("/api/confirmation/admin", "confirmation_admin"),
    ("/api/confirmation",       "confirmation"),
    ("/api/page-builder",       "page_builder"),
    ("/api/theme-editor",       "theme_editor"),
    ("/api/wholesale",          "wholesale"),
    ("/api/profit_campaign",    "profit"),
    ("/api/profit_cards",       "profit"),
    ("/api/profit_costs",       "profit"),
    ("/api/profit_calculator",  "profit"),
    ("/api/campaign",           "campaign_analyzer"),
    ("/api/agent",              "agent"),
    ("/api/agentbuilder",       "agent"),
    ("/api/agents",             "agent"),
    ("/api/llm",                "llm"),
    ("/api/gemini",             "gemini_api"),
    ("/api/clarity",            "clarity_api"),
    ("/api/chatkit",            "chatkit"),
    ("/api/meta",               "meta_api"),
    ("/api/shopify",            "shopify_api"),
    ("/api/flows",              "flows"),
    ("/api/tests",              "tests"),
    ("/api/translate",          "llm"),
    ("/api/uploads",            "uploads"),
    ("/api/prompts",            "prompts"),
    ("/api/page-builder",       "page_builder"),
    ("/api/exchange",           "exchange"),
    ("/api/campaign_mappings",  "campaign_meta"),
    ("/api/campaign_meta",      "campaign_meta"),
    ("/api/system-health",      "system_health"),
)


def _classify_surface(path: str) -> str:
    for prefix, label in SURFACE_PATTERNS:
        if path.startswith(prefix):
            return label
    return "other"


def _is_excluded(path: str) -> bool:
    for p in EXCLUDE_ROUTES:
        if path.startswith(p):
            return True
    return False


class HealthMiddleware:
    """Pure ASGI middleware; records request latency per (surface, route)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        if _is_excluded(path):
            await self.app(scope, receive, send)
            return

        method = scope.get("method") or "GET"
        surface = _classify_surface(path)
        op = f"{method} {path}"
        started = time.perf_counter()
        status_code_holder: dict[str, int] = {}
        ok = True
        err: Optional[str] = None

        async def _send(message):
            try:
                if message.get("type") == "http.response.start":
                    status_code_holder["status"] = int(message.get("status") or 0)
            except Exception:
                pass
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except BaseException as e:
            ok = False
            err = f"{type(e).__name__}: {e}"
            raise
        finally:
            try:
                sc = status_code_holder.get("status") or 0
                if sc >= 500:
                    ok = False
                ms = (time.perf_counter() - started) * 1000.0
                # route is "surface:METHOD path" so the surface bucket can extract it
                record("request", op, ms, ok, route=f"{surface}:{op}", error=err)
            except Exception:
                pass
