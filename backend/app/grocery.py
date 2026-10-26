"""Grocery barcode workflows, using the existing wholesale Shopify store.

Every write is claimed durably before contacting Shopify. An interrupted or
ambiguous write is never replayed automatically: its request needs review.
"""
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime
from decimal import Decimal
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, StrictInt, field_validator
from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.exc import IntegrityError

from app import db

router = APIRouter(prefix="/api/wholesale/vendors/{vendor_id}/grocery", tags=["grocery"])


class GroceryOperation(db.Base):
    __tablename__ = "grocery_operations"
    id = Column(String, primary_key=True)
    fingerprint = Column(String, nullable=False)
    status = Column(String, nullable=False)
    response = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GroceryBarcode(db.Base):
    __tablename__ = "grocery_barcodes"
    id = Column(String, primary_key=True)
    product_id = Column(String, nullable=True)
    operation_id = Column(String, nullable=False)


GroceryOperation.__table__.create(db.engine, checkfirst=True)
GroceryBarcode.__table__.create(db.engine, checkfirst=True)


def fail(code, status=409, **extra):
    raise HTTPException(status, {"error": code, **extra})


def is_grocery(vendor):
    return isinstance(vendor, dict) and vendor.get("account_type") == "grocery"


def issue_token(vendor):
    """A password change revokes these time-limited, account-bound tokens."""
    body = base64.urlsafe_b64encode(json.dumps({
        "v": vendor["id"], "exp": int(time.time()) + 7 * 86400,
        "nonce": secrets.token_hex(12),
    }, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(vendor["password_hash"].encode(), ("grocery:" + body).encode(), hashlib.sha256).hexdigest()
    return body + "." + signature


def authorize(vendor_id, authorization):
    from app.main import WHOLESALE_STORE, _wholesale_vendor_key
    vid = vendor_id.strip().lower()
    vendor = db.get_app_setting(WHOLESALE_STORE, _wholesale_vendor_key(vid))
    if not is_grocery(vendor):
        fail("grocery_only", 403)
    try:
        scheme, token = str(authorization or "").split(" ", 1)
        body, signature = token.split(".", 1)
        expected = hmac.new(vendor["password_hash"].encode(), ("grocery:" + body).encode(), hashlib.sha256).hexdigest()
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        valid = scheme.lower() == "bearer" and hmac.compare_digest(signature, expected)
        valid = valid and payload["v"] == vid and payload["exp"] > time.time()
        if not valid:
            raise ValueError()
    except Exception:
        fail("invalid_session", 401)
    return vid, vendor


def canonical_barcode(value):
    code = str(value or "").strip()
    if not re.fullmatch(r"[!-~]{4,64}", code):
        raise ValueError("Invalid barcode")
    if code.isdigit() and len(code) in (8, 12, 13, 14):
        digits = [int(c) for c in code]
        checksum = sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(reversed(digits[:-1])))
        if (10 - checksum % 10) % 10 != digits[-1]:
            raise ValueError("Invalid GTIN check digit")
        if len(code) == 12:
            code = "0" + code
    return code


Money = Decimal


class ProductInput(BaseModel):
    request_id: UUID
    barcode: str
    name: str = Field(min_length=1, max_length=255)
    price: Money = Field(ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    stock: StrictInt = Field(ge=0, le=10000000)
    cost_price: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)

    @field_validator("barcode")
    @classmethod
    def validate_barcode(cls, value):
        return canonical_barcode(value)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value):
        if not value.strip():
            raise ValueError("Product name is required")
        return value.strip()


class OrderLine(BaseModel):
    variant_id: StrictInt = Field(gt=0)
    quantity: StrictInt = Field(gt=0, le=10000000)


class OrderInput(BaseModel):
    request_id: UUID
    line_items: list[OrderLine] = Field(min_length=1, max_length=500)
    customer_name: str = Field(default="", max_length=255)
    customer_phone: str = Field(default="", max_length=40)
    amount_paid: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    payment_status: Literal["paid", "unpaid"] = "paid"


def _operation_key(vid, request_id):
    return vid + ":" + str(request_id)


def _claim(vid, kind, req):
    oid = _operation_key(vid, req.request_id)
    fingerprint = hashlib.sha256((kind + req.model_dump_json()).encode()).hexdigest()
    with db.SessionLocal() as session:
        row = GroceryOperation(id=oid, fingerprint=fingerprint, status="processing")
        session.add(row)
        try:
            session.commit()
            return oid, None
        except IntegrityError:
            session.rollback()
        existing = session.get(GroceryOperation, oid)
        if existing.fingerprint != fingerprint:
            fail("request_conflict")
        if existing.status == "completed":
            return oid, json.loads(existing.response)
        fail("needs_review", message="This request was already started. Check inventory or order history before proceeding.")


def _finish(oid, response, status="completed"):
    with db.SessionLocal() as session:
        row = session.get(GroceryOperation, oid)
        row.status = status
        row.response = json.dumps(response, default=str)
        session.commit()
    return response


def _record_sale(vid, oid, response, paid):
    """Commit the receipt and the existing wholesale debt ledger together."""
    from app.main import WHOLESALE_STORE
    order = response["data"]
    key = f"wholesale_order_payment:{vid}:{order['id']}"
    payment = {"payment_status": "paid" if paid else "unpaid",
               "amount_paid": str(order["total_price"]) if paid else "0.00",
               "payment_note": "Grocery cash sale" if paid else "Grocery credit sale",
               "updated_at": datetime.utcnow().isoformat() + "Z"}
    with db.SessionLocal() as session:
        row = session.get(GroceryOperation, oid)
        row.status, row.response = "completed", json.dumps(response, default=str)
        pk = db._mk_setting_pk(WHOLESALE_STORE, key)
        setting = session.get(db.AppSetting, pk)
        if setting is None:
            setting = db.AppSetting(pk=pk, store=WHOLESALE_STORE, key=key)
            session.add(setting)
        setting.value, setting.updated_at = json.dumps(payment), datetime.utcnow()
        session.commit()
    return response


def _replay(vid, kind, req):
    with db.SessionLocal() as session:
        exists = session.get(GroceryOperation, _operation_key(vid, req.request_id)) is not None
    if exists:
        return _claim(vid, kind, req)[1]
    return None


def _request(method, path, payload=None):
    """One HTTP attempt only, including writes; never follow credential redirects."""
    from app.main import WHOLESALE_STORE
    from app.integrations.shopify_client import _get_store_config, _timed_request
    cfg = _get_store_config(WHOLESALE_STORE)
    auth = None
    if not cfg["TOKEN"]:
        if not (cfg["API_KEY"] and cfg["PASSWORD"]):
            raise RuntimeError("Wholesale store is not configured")
        auth = (cfg["API_KEY"], cfg["PASSWORD"])
    response = _timed_request(method, cfg["BASE"] + path, headers=cfg["HEADERS"], json=payload,
                              timeout=(5, 25), auth=auth, allow_redirects=False)
    response.raise_for_status()
    if not 200 <= response.status_code < 300:
        raise RuntimeError("Unexpected Shopify response")
    return response


def _owns(product, vid):
    from app.main import _wholesale_tags_set, _wholesale_vendor_id_tag
    return _wholesale_vendor_id_tag(vid).lower() in _wholesale_tags_set(product.get("tags"))


def _products(vid, vendor):
    """Fetch every page and fail closed. The older list helper truncates at 250."""
    from app.main import _wholesale_enrich_products_inventory
    from app.integrations.shopify_client import _get_store_config
    from app.main import WHOLESALE_STORE
    base = _get_store_config(WHOLESALE_STORE)["BASE"]
    path = "/products.json?" + urlencode({"vendor": vendor["name"], "limit": 250})
    products, visited = [], set()
    while path:
        if path in visited or len(visited) > 1000:
            raise RuntimeError("Invalid product pagination")
        visited.add(path)
        response = _request("GET", path)
        products.extend(p for p in response.json().get("products", []) if _owns(p, vid))
        next_url = (response.links.get("next") or {}).get("url")
        if next_url and not next_url.startswith(base + "/"):
            raise RuntimeError("Unexpected product pagination origin")
        path = next_url[len(base):] if next_url else ""
    return _wholesale_enrich_products_inventory(products)


def _read_product(vid, product_id):
    pid = str(product_id)
    if not pid.isdigit():
        fail("product_not_found", 404)
    product = _request("GET", f"/products/{pid}.json").json().get("product") or {}
    if not _owns(product, vid):
        fail("product_not_found", 404)
    return product


def _find_barcode(products, code):
    matches = []
    for product in products:
        for variant in product.get("variants") or []:
            try:
                candidate = canonical_barcode(variant.get("barcode") or variant.get("sku"))
            except ValueError:
                continue
            if candidate == code:
                matches.append(product)
    if len(matches) > 1:
        fail("duplicate_barcode", message="More than one product uses this barcode. Correct the catalog first.")
    return matches[0] if matches else None


def _reserve_barcode(vid, code, oid, product_id=None):
    bid = vid + ":" + code
    with db.SessionLocal() as session:
        row = GroceryBarcode(id=bid, operation_id=oid, product_id=product_id)
        session.add(row)
        try:
            session.commit()
            return
        except IntegrityError:
            session.rollback()
        row = session.get(GroceryBarcode, bid)
        if product_id and row.product_id == str(product_id):
            return
        fail("needs_review" if not row.product_id else "duplicate_barcode",
             message="This barcode was already reserved. Refresh the catalog before proceeding.")


def _stock_location(product):
    """Single-variant grocery stock; do not silently overwrite multiple locations."""
    from app.main import WHOLESALE_STORE
    from app.integrations.shopify_client import _get_primary_location_id
    variants = product.get("variants") or []
    if len(variants) != 1:
        fail("multiple_variants", message="Use a separate barcode for each grocery product.")
    variant = variants[0]
    item = variant.get("inventory_item_id")
    if not item:
        raise RuntimeError("Missing inventory item")
    levels = _request("GET", "/inventory_levels.json?" + urlencode({"inventory_item_ids": item})).json().get("inventory_levels") or []
    if len(levels) > 1:
        fail("multiple_inventory_locations", message="This product has stock at multiple locations. Update it in Shopify.")
    location = levels[0]["location_id"] if levels else _get_primary_location_id(WHOLESALE_STORE)
    if not location:
        raise RuntimeError("Missing inventory location")
    return int(location)


def _set_product_stock(product, req, location=None):
    location = location or _stock_location(product)
    variant = product["variants"][0]
    item = variant["inventory_item_id"]
    item_fields = {"id": item, "tracked": True}
    if req.cost_price is not None:
        item_fields["cost"] = str(req.cost_price)
    _request("PUT", f"/inventory_items/{item}.json", {"inventory_item": item_fields})
    _request("PUT", f"/variants/{variant['id']}.json", {"variant": {
        "id": variant["id"], "price": str(req.price), "barcode": req.barcode,
        "sku": req.barcode, "inventory_policy": "deny",
    }})
    result = _request("POST", "/inventory_levels/set.json", {
        "inventory_item_id": item, "location_id": int(location), "available": req.stock,
    }).json()
    if (result.get("inventory_level") or {}).get("available") != req.stock:
        raise RuntimeError("Stock update was not confirmed")


def _invalidate(vid):
    from app.main import _chat_catalog_cache
    _chat_catalog_cache.pop(vid, None)


@router.get("/products")
def products(vendor_id: str, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    try:
        return {"data": _products(vid, vendor)}
    except HTTPException:
        raise
    except Exception:
        fail("catalog_unavailable", 503, message="Catalog could not be loaded. Try again.")


@router.post("/products")
def create_product(vendor_id: str, req: ProductInput, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    replay = _replay(vid, "product:create", req)
    if replay is not None:
        return replay
    try:
        existing = _find_barcode(_products(vid, vendor), req.barcode)
    except HTTPException:
        raise
    except Exception:
        fail("catalog_unavailable", 503, message="Catalog could not be checked. Try again.")
    oid, prior = _claim(vid, "product:create", req)
    if prior is not None:
        return prior
    try:
        if existing:
            return _finish(oid, {"data": existing, "existing": True})
        _reserve_barcode(vid, req.barcode, oid)
        from app.main import _wholesale_tags_csv
        response = _request("POST", "/products.json", {"product": {
            "title": req.name, "vendor": vendor["name"], "product_type": "Grocery",
            "status": "active", "tags": _wholesale_tags_csv(vendor["name"], vid) + ", grocery",
            "variants": [{"price": str(req.price), "barcode": req.barcode, "sku": req.barcode,
                          "inventory_management": "shopify", "inventory_policy": "deny"}],
        }}).json()
        product = response.get("product") or {}
        if not product.get("id"):
            raise RuntimeError("Product creation was not confirmed")
        with db.SessionLocal() as session:
            reservation = session.get(GroceryBarcode, vid + ":" + req.barcode)
            reservation.product_id = str(product["id"])
            session.commit()
        _set_product_stock(product, req)
        product = _read_product(vid, product["id"])
        _invalidate(vid)
        return _finish(oid, {"data": product})
    except Exception as exc:
        _finish(oid, {"error": "needs_review"}, "needs_review")
        if isinstance(exc, HTTPException):
            raise
        fail("needs_review", message="Product save could not be confirmed. Refresh inventory before trying again.")


@router.patch("/products/{product_id}")
def update_product(vendor_id: str, product_id: str, req: ProductInput, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    replay = _replay(vid, "product:update:" + str(product_id), req)
    if replay is not None:
        return replay
    product = _read_product(vid, product_id)
    match = _find_barcode(_products(vid, vendor), req.barcode)
    if match and str(match["id"]) != str(product["id"]):
        fail("duplicate_barcode")
    # Barcodes identify products permanently. Editing names/prices/stock cannot
    # transfer another barcode's reservation or make a stale label ambiguous.
    old_code = canonical_barcode((product.get("variants") or [{}])[0].get("barcode"))
    if old_code != req.barcode:
        fail("barcode_change_not_allowed", 422)
    location = _stock_location(product)
    oid, prior = _claim(vid, "product:update:" + str(product_id), req)
    if prior is not None:
        return prior
    try:
        _reserve_barcode(vid, req.barcode, oid, str(product["id"]))
        _request("PUT", f"/products/{product['id']}.json", {"product": {"id": product["id"], "title": req.name}})
        _set_product_stock(product, req, location)
        product = _read_product(vid, product["id"])
        _invalidate(vid)
        return _finish(oid, {"data": product})
    except Exception as exc:
        _finish(oid, {"error": "needs_review"}, "needs_review")
        if isinstance(exc, HTTPException):
            raise
        fail("needs_review", message="Update could not be confirmed. Refresh inventory before trying again.")


@router.post("/orders")
def create_order(vendor_id: str, req: OrderInput, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    # Completed requests must replay even if this sale consumed the last item.
    replay = _replay(vid, "order:create", req)
    if replay is not None:
        return replay
    if req.payment_status == "unpaid" and not (req.customer_name.strip() and req.customer_phone.strip()):
        fail("unpaid_customer_required", 422, message="Enter the customer's name and phone for an unpaid sale.")
    requested = {}
    for line in req.line_items:
        requested[line.variant_id] = requested.get(line.variant_id, 0) + line.quantity
    from app.main import _wholesale_variant_availability, _wholesale_tags_csv
    stock = _wholesale_variant_availability(list(requested))
    total, items = Decimal("0.00"), []
    for variant_id, quantity in requested.items():
        entry = stock.get(variant_id) or {}
        variant = entry.get("variant") or {}
        if not variant.get("product_id"):
            fail("product_not_found", 404)
        _read_product(vid, variant["product_id"])
        if variant.get("inventory_policy") != "deny" or variant.get("inventory_management") != "shopify":
            fail("untracked_inventory", message="Enable tracked inventory with overselling disabled for this product.")
        if quantity > int(entry.get("available") or 0):
            fail("insufficient_inventory", details=[{"variant_id": variant_id, "available": int(entry.get("available") or 0), "requested": quantity}])
        price = Decimal(str(variant["price"]))
        if not price.is_finite() or price < 0:
            fail("invalid_price", 422)
        total += price * quantity
        items.append({"variant_id": variant_id, "quantity": quantity, "price": str(price)})
    total = total.quantize(Decimal("0.01"))
    tendered = req.amount_paid if req.amount_paid is not None else total
    if req.payment_status == "paid" and tendered < total:
        fail("insufficient_payment", 422, total_price=str(total))
    if req.payment_status == "unpaid" and req.amount_paid not in (None, Decimal(0)):
        fail("unpaid_amount_must_be_zero", 422)
    oid, prior = _claim(vid, "order:create", req)
    if prior is not None:
        return prior
    try:
        order = {
            "line_items": items, "financial_status": "paid" if req.payment_status == "paid" else "pending",
            "inventory_behaviour": "decrement_obeying_policy", "send_receipt": False,
            "send_fulfillment_receipt": False, "tags": _wholesale_tags_csv(vendor["name"], vid) + ", grocery",
            "note_attributes": [{"name": "grocery_request_id", "value": str(req.request_id)},
                                {"name": "grocery_amount_paid", "value": str(tendered if req.payment_status == "paid" else Decimal(0))},
                                {"name": "grocery_customer_name", "value": req.customer_name.strip() or "Walk-in"},
                                {"name": "grocery_customer_phone", "value": req.customer_phone.strip()}],
        }
        customer_name, phone = req.customer_name.strip(), req.customer_phone.strip()
        if customer_name or phone:
            parts = (customer_name or "Walk-in").split(" ", 1)
            order["billing_address"] = {"name": customer_name or "Walk-in", "first_name": parts[0], "last_name": parts[1] if len(parts) > 1 else "", "phone": phone}
            # An unpaid sale must be recoverable in the existing customer ledger.
            order["customer"] = {"first_name": parts[0], "last_name": parts[1] if len(parts) > 1 else ""}
        if req.payment_status == "paid":
            order["transactions"] = [{"kind": "sale", "status": "success", "amount": str(total), "gateway": "manual"}]
        response = _request("POST", "/orders.json", {"order": order}).json().get("order") or {}
        if not response.get("id"):
            raise RuntimeError("Order creation was not confirmed")
        actual_total = Decimal(str(response.get("total_price")))
        if actual_total != total or response.get("financial_status") != order["financial_status"]:
            fail("needs_review", message="Order was created with a different total or payment state. Review order history.", order_id=response["id"])
        _invalidate(vid)
        return _record_sale(vid, oid, {"data": {**response, "change": str((tendered - total).quantize(Decimal("0.01"))) if req.payment_status == "paid" else "0.00"}}, req.payment_status == "paid")
    except Exception as exc:
        _finish(oid, {"error": "needs_review"}, "needs_review")
        if isinstance(exc, HTTPException):
            raise
        fail("needs_review", message="Sale could not be confirmed. Check order history before creating another sale.")
