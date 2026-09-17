"""The single switch that decides whether this process runs scheduled work.

Background work in this app is unguarded: the wholesale batch recovery loop
creates Shopify products, and the social-agent scheduler tick publishes posts to
Meta and Instagram. Neither holds an advisory lock, so two deployments pointed at
the same database will duplicate both. While more than one deployment is live
(Cloud Run and the Netcup box during the migration's parallel run), exactly one
of them may have this enabled.

**Unset means enabled.** That is deliberate: Cloud Run does not set this variable
and must keep behaving exactly as it does today. Opting *out* is the explicit
act, and it is done in `/opt/pto/compose.yaml`, which sets the value on every
service rather than relying on any default.
"""
from __future__ import annotations

import os

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def worker_loops_enabled() -> bool:
    """True when this process is the one allowed to run scheduled work."""
    raw = (os.getenv("WORKER_LOOPS") or "").strip().lower()
    if raw in _FALSE:
        return False
    if raw in _TRUE:
        return True
    # Unset or unrecognised: preserve the Cloud Run behaviour.
    return True


def worker_loops_state() -> str:
    """How the switch reads right now, for /health and the deploy ledger."""
    raw = (os.getenv("WORKER_LOOPS") or "").strip()
    if not raw:
        return "enabled (default; WORKER_LOOPS unset)"
    return f"{'enabled' if worker_loops_enabled() else 'disabled'} (WORKER_LOOPS={raw})"
