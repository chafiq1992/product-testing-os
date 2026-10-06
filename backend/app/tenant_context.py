"""Which Sendo merchant workspace the current request acts for, if any.

Set by the auth gate for requests carrying a workspace session; read by the
Meta and Shopify clients so a merchant workspace can never fall back to this
app's own environment credentials (which belong to the operator's stores).
Kept dependency-free so the integration clients can import it.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

_workspace: ContextVar[Optional[str]] = ContextVar("sendo_workspace", default=None)


def current_workspace() -> Optional[str]:
    return _workspace.get()


@contextmanager
def workspace_scope(label: Optional[str]) -> Iterator[None]:
    marker = _workspace.set(label)
    try:
        yield
    finally:
        _workspace.reset(marker)
