"""Safe, runtime Shopify store discovery for backend and frontend clients."""

from __future__ import annotations

import os
import re
from typing import Any


DEFAULT_SHOPIFY_STORES = ("irrakids", "irranova", "mmd")
_STORE_LABEL_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,62}$")


def canonical_store_label(value: str | None) -> str | None:
    label = str(value or "").strip().lower()
    if not label:
        return None
    if label == "nouralibas":
        return "irrakids"
    if not _STORE_LABEL_RE.fullmatch(label):
        return None
    return label


def configured_store_labels(raw: str | None = None) -> list[str]:
    """Return configured labels in stable order, including the legacy defaults."""
    source = os.getenv("SHOPIFY_OAUTH_STORES", "") if raw is None else raw
    labels: list[str] = []
    seen: set[str] = set()
    for value in [*(str(source or "").split(",")), *DEFAULT_SHOPIFY_STORES]:
        label = canonical_store_label(value)
        if label and label not in seen:
            seen.add(label)
            labels.append(label)
    return labels


def store_env_suffix(store: str) -> str:
    label = canonical_store_label(store)
    if not label:
        raise ValueError("invalid Shopify store label")
    return re.sub(r"[^A-Z0-9]", "_", label.upper())


def store_env_names(store: str) -> dict[str, str]:
    suffix = store_env_suffix(store)
    return {
        "shop_domain": f"SHOPIFY_SHOP_DOMAIN_{suffix}",
        "client_id": f"SHOPIFY_CLIENT_ID_{suffix}",
        "client_secret": f"SHOPIFY_CLIENT_SECRET_{suffix}",
    }


def store_env_value(base: str, store: str) -> tuple[str, str | None]:
    """Read the canonical env name, then a lowercase legacy name for migration."""
    suffix = store_env_suffix(store)
    canonical_name = f"{base}_{suffix}"
    canonical_value = str(os.getenv(canonical_name, "") or "").strip()
    if canonical_value:
        return canonical_value, canonical_name

    legacy_name = f"{base}_{suffix.lower()}"
    legacy_value = str(os.getenv(legacy_name, "") or "").strip()
    if legacy_value:
        return legacy_value, legacy_name
    return "", None


def build_store_registry(db_module: Any | None = None) -> list[dict[str, Any]]:
    """Build a secret-free registry suitable for returning to browser clients."""
    stores: list[dict[str, Any]] = []
    for label in configured_store_labels():
        env_names = store_env_names(label)
        shop, shop_source = store_env_value("SHOPIFY_SHOP_DOMAIN", label)
        client_id, client_id_source = store_env_value("SHOPIFY_CLIENT_ID", label)
        client_secret, client_secret_source = store_env_value("SHOPIFY_CLIENT_SECRET", label)

        record: dict[str, Any] = {}
        if db_module is not None:
            try:
                value = db_module.get_app_setting(label, "shopify_oauth") or {}
                if isinstance(value, dict):
                    record = value
            except Exception:
                record = {}

        connected_shop = str(record.get("shop") or "").strip().lower()
        connected = bool(connected_shop and str(record.get("access_token") or "").strip())
        if not shop:
            shop = connected_shop

        missing = [
            env_names[key]
            for key, value in (("client_id", client_id), ("client_secret", client_secret))
            if not value
        ]
        legacy_names = [
            source
            for source in (shop_source, client_id_source, client_secret_source)
            if source and source.rsplit("_", 1)[-1] == store_env_suffix(label).lower()
        ]
        warnings: list[str] = []
        if legacy_names:
            warnings.append(
                "Environment variable names are case-sensitive; rename "
                + ", ".join(legacy_names)
                + " to their uppercase store suffixes."
            )

        stores.append(
            {
                "label": label,
                "shop": shop or None,
                "connected": connected,
                "credentials_configured": not missing,
                "required_env": list(env_names.values()),
                "missing_env": missing,
                "warnings": warnings,
            }
        )
    return stores
