"""Seller marketplace using the same Shopify OAuth registry as Connections.

Seller identity, catalog authorization and payout reservations are enforced here,
not by browser-supplied seller IDs or product prices.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from urllib.parse import urlencode
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint, update
from sqlalchemy.exc import IntegrityError
import requests

from app import db
from app.integrations import shopify_client as shopify
from app.shopify_store_registry import build_store_registry
from app.system_health_routes import _get_admin

router = APIRouter(prefix="/api/affiliates", tags=["affiliates"])
log = logging.getLogger(__name__)


class Seller(db.Base):
    __tablename__ = "affiliate_sellers"
    id = Column(String, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    access = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    reviewed_by = Column(String)


class SellerSession(db.Base):
    __tablename__ = "affiliate_sessions"
    token_hash = Column(String, primary_key=True)
    seller_id = Column(String, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)


class SellerOrder(db.Base):
    __tablename__ = "affiliate_orders"
    id = Column(String, primary_key=True)
    seller_id = Column(String, nullable=False, index=True)
    request_id = Column(String, nullable=False)
    fingerprint = Column(String, nullable=False)
    store = Column(String, nullable=False)
    shopify_id = Column(String)
    state = Column(String, nullable=False, default="submitting")
    cost_cents = Column(Integer, nullable=False)
    currency = Column(String, nullable=False)
    snapshot = Column(Text, nullable=False, default="{}")
    delivery = Column(Text, nullable=False, default="{}")
    synced_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("seller_id", "request_id"), UniqueConstraint("store", "shopify_id"))


class Payout(db.Base):
    __tablename__ = "affiliate_payouts"
    id = Column(String, primary_key=True)
    seller_id = Column(String, nullable=False, index=True)
    currency = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    destination = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    reference = Column(String)
    reviewed_by = Column(String)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ProductCost(db.Base):
    __tablename__ = "affiliate_product_costs"
    store = Column(String, primary_key=True)
    variant_id = Column(String, primary_key=True)
    product_id = Column(String, nullable=False)
    currency = Column(String, nullable=False)
    unit_cost_cents = Column(Integer, nullable=False)
    updated_by = Column(String)


for table in (Seller, SellerSession, SellerOrder, Payout, ProductCost):
    table.__table__.create(db.engine, checkfirst=True)


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 240000).hex()
    return f"{salt}:{digest}"


def _public_seller(row):
    return {"id": row.id, "username": row.username, "name": row.name, "phone": row.phone,
            "status": row.status, "access": json.loads(row.access),
            "created_at": row.created_at.isoformat()}


def require_admin(request: Request):
    admin = _get_admin(request)
    if not admin:
        raise HTTPException(401, "Administrator sign in required")
    return admin


def identity(request: Request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    with db.SessionLocal() as session:
        auth = session.get(SellerSession, hashlib.sha256(token.encode()).hexdigest())
        seller = session.get(Seller, auth.seller_id) if auth and auth.expires_at > datetime.utcnow() else None
        if not seller:
            raise HTTPException(401, "Seller sign in required")
        return _public_seller(seller)


def active_seller(seller=Depends(identity)):
    if seller["status"] != "approved":
        raise HTTPException(403, "Your seller account must be approved")
    return seller


class Application(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=120, pattern=r"^[a-zA-Z0-9@._+\-]+$")
    phone: str = Field(min_length=6, max_length=40)
    password: str = Field(min_length=8, max_length=200)


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)


@router.post("/apply")
def apply(body: Application):
    if not body.name.strip() or not body.phone.strip():
        raise HTTPException(422, "Name and phone are required")
    with db.SessionLocal() as session:
        row = Seller(id=uuid4().hex, username=body.username.lower(), name=body.name.strip(),
                     phone=body.phone.strip(), password_hash=_hash_password(body.password), status="pending", access="{}")
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "This username is already registered")
        return {"data": _public_seller(row)}


@router.post("/login")
def login(body: Login):
    with db.SessionLocal() as session:
        row = session.query(Seller).filter_by(username=body.username.strip().lower()).first()
        # Do the expensive hash even for unknown users to avoid a timing oracle.
        salt = row.password_hash.split(":")[0] if row else "00" * 16
        computed = _hash_password(body.password, salt)
        if not row or not hmac.compare_digest(computed, row.password_hash):
            raise HTTPException(401, "Invalid username or password")
        token = secrets.token_urlsafe(48)
        session.add(SellerSession(token_hash=hashlib.sha256(token.encode()).hexdigest(), seller_id=row.id,
                                  expires_at=datetime.utcnow() + timedelta(days=7)))
        session.commit()
        return {"data": {"token": token, "seller": _public_seller(row)}}


@router.post("/logout")
def logout(request: Request, seller=Depends(identity)):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    with db.SessionLocal() as session:
        session.query(SellerSession).filter_by(token_hash=hashlib.sha256(token.encode()).hexdigest()).delete()
        session.commit()
    return {"data": {"ok": True}}


@router.get("/me")
def me(seller=Depends(identity)):
    return {"data": seller}


def connected_stores():
    return [item for item in build_store_registry(db) if item["connected"]]


def read_shopify(store, path):
    try:
        connection = next((s for s in connected_stores() if s["label"] == store), None)
        if not connection or shopify._get_store_config(store)["SHOP"].lower() != connection["shop"].lower():
            raise HTTPException(409, "Store credentials do not match the connected Shopify shop")
        response = shopify._rest_get_store_raw_once(store, path, timeout=20)
        return response.json()
    except HTTPException:
        raise
    except Exception:
        log.exception("Affiliate Shopify read failed for %s", store)
        raise HTTPException(502, "The store could not be reached. Check its connection and API permissions.")


def catalog(access=None):
    products, stores, warnings = [], [], []
    with db.SessionLocal() as session:
        costs = {(c.store, c.variant_id): c for c in session.query(ProductCost).all()}
    for connection in connected_stores():
        label = connection["label"]
        allowed = None if access is None else access.get(label, [])
        if allowed == []:
            continue
        try:
            currency = read_shopify(label, "/shop.json")["shop"]["currency"]
            # Monetary accounting is stored in hundredths; avoid silently rounding
            # currencies with different minor-unit rules.
            if currency not in {"MAD", "USD", "EUR", "GBP", "CAD", "AED", "SAR"}:
                raise ValueError("Unsupported settlement currency")
            store_products, since = [], 0
            while True:
                params = {"limit": 250, "since_id": since, "status": "active",
                          "fields": "id,title,vendor,handle,status,variants,images,product_type"}
                page = read_shopify(label, "/products.json?" + urlencode(params)).get("products", [])
                if not page:
                    break
                for product in page:
                    if allowed is not None and product.get("vendor") not in allowed:
                        continue
                    store_products.append({"id": str(product["id"]), "store": label, "currency": currency,
                        "title": product["title"], "vendor": product.get("vendor", ""),
                        "image": next((im.get("src") for im in product.get("images", []) if im.get("src")), None),
                        "url": f"https://{connection['shop']}/products/{product.get('handle', '')}",
                        "variants": [{"id": str(v["id"]), "title": v.get("title", "Default"),
                            "price": v.get("price", "0"), "inventory_quantity": v.get("inventory_quantity", 0),
                            "unit_cost": costs[(label, str(v["id"]))].unit_cost_cents / 100 if (label, str(v["id"])) in costs and costs[(label, str(v["id"]))].currency == currency else None,
                            "available": v.get("inventory_management") is None or v.get("inventory_policy") == "continue" or int(v.get("inventory_quantity") or 0) > 0}
                            for v in product.get("variants", [])]})
                next_id = max(int(p["id"]) for p in page)
                if next_id <= since:
                    raise ValueError("Invalid catalog pagination")
                since = next_id
                if len(page) < 250:
                    break
            products.extend(store_products)
            stores.append({"label": label, "shop": connection["shop"], "currency": currency,
                           "vendors": sorted({p["vendor"] for p in store_products})})
        except Exception:
            log.exception("Affiliate catalog unavailable for %s", label)
            warnings.append(f"Could not load {label}; check its connection and product permissions.")
    return {"products": products, "stores": stores, "warnings": warnings}


@router.get("/products")
def products(seller=Depends(active_seller)):
    data = catalog(seller["access"])
    return {"data": data}


def cents(value):
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def order_view(row):
    snap, delivery = json.loads(row.snapshot), json.loads(row.delivery)
    tags = {t.strip().lower() for t in str(snap.get("tags") or "").split(",")}
    fulfillment = snap.get("fulfillments") or []
    shipment = next((f.get("shipment_status") for f in reversed(fulfillment) if f.get("shipment_status")), None)
    status = delivery.get("status") or shipment or ("delivered" if "delivered" in tags else snap.get("fulfillment_status")) or "pending"
    for candidate in ("returned", "failed", "in_transit", "out_for_delivery"):
        if not delivery and candidate in tags:
            status = candidate
            break
    if snap.get("cancelled_at"):
        status = "cancelled"
    financial = snap.get("financial_status", "pending")
    subtotal = max(0, cents(snap.get("subtotal_price")))
    refunds = sum(cents(li.get("subtotal")) for refund in snap.get("refunds", []) for li in refund.get("refund_line_items", []))
    # Refund transactions may include adjustments without refund line items.
    refunded_cash = sum(cents(tx.get("amount")) for refund in snap.get("refunds", []) for tx in refund.get("transactions", []) if tx.get("kind") == "refund" and tx.get("status") == "success")
    eligible_subtotal = max(0, subtotal - max(refunds, refunded_cash))
    if delivery.get("cash_collected") and delivery.get("cash_amount") is not None:
        # Partial deliveries may collect less than the original Shopify total.
        non_product_total = max(0, cents(snap.get("total_price")) - subtotal)
        eligible_subtotal = min(eligible_subtotal, max(0, cents(delivery["cash_amount"]) - non_product_total))
    expected = max(0, eligible_subtotal - row.cost_cents)
    settled = status == "delivered" and (delivery.get("cash_collected") is True or financial in {"paid", "partially_refunded"} or "delivered" in tags)
    if delivery.get("settlement_pending"):
        settled = False
    if status in {"cancelled", "returned", "failed"} or financial in {"refunded", "voided"}:
        expected, settled = 0, False
    shipping = snap.get("shipping_address") or {}
    return {"id": row.id, "store": row.store, "shopify_id": row.shopify_id, "name": snap.get("name") or row.id[:8],
            "state": row.state, "currency": row.currency, "total": cents(snap.get("total_price")) / 100,
            "net_sales": eligible_subtotal / 100 if settled else 0,
            "profit": expected / 100 if settled else 0, "pending_profit": expected / 100 if not settled and row.state == "created" else 0,
            "status": status, "financial_status": financial, "customer": shipping.get("name", ""),
            "items": [{"title": li.get("title"), "quantity": li.get("quantity")} for li in snap.get("line_items", [])],
            "tracking_number": delivery.get("tracking_number") or next((f.get("tracking_number") for f in reversed(fulfillment) if f.get("tracking_number")), None),
            "cost": row.cost_cents / 100, "delivery_status": delivery.get("raw_status"),
            "status_source": "delivery_app" if delivery else "shopify", "delivery_updated_at": delivery.get("updated_at"),
            "synced_at": row.synced_at.isoformat() if row.synced_at else None, "created_at": row.created_at.isoformat()}


class OrderLine(BaseModel):
    product_id: str = Field(pattern=r"^\d+$")
    variant_id: str = Field(pattern=r"^\d+$")
    quantity: int = Field(ge=1, le=100)
    sale_price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


class NewOrder(BaseModel):
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    store: str = Field(min_length=1, max_length=63)
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str = Field(min_length=6, max_length=40)
    address: str = Field(min_length=3, max_length=250)
    city: str = Field(min_length=2, max_length=100)
    country: str = Field(default="MA", pattern=r"^[A-Z]{2}$")
    note: str = Field(default="", max_length=1000)
    items: list[OrderLine] = Field(min_length=1, max_length=50)


@router.post("/orders")
def create_order(body: NewOrder, seller=Depends(active_seller)):
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    with db.SessionLocal() as session:
        prior = session.query(SellerOrder).filter_by(seller_id=seller["id"], request_id=body.request_id).first()
        if prior:
            if prior.fingerprint != fingerprint:
                raise HTTPException(409, "This submission ID was already used for a different order")
            if prior.state != "created":
                raise HTTPException(409, "Order submission needs administrator reconciliation; do not resubmit")
            return {"data": order_view(prior)}
    allowed = seller["access"].get(body.store, [])
    if not allowed or body.store not in {s["label"] for s in connected_stores()}:
        raise HTTPException(403, "Store is not approved for this seller")
    currency = read_shopify(body.store, "/shop.json")["shop"]["currency"]
    if currency not in {"MAD", "USD", "EUR", "GBP", "CAD", "AED", "SAR"}:
        raise HTTPException(422, "Store currency is not supported for settlement")
    quantities, selected, prices = {}, {}, {}
    for item in body.items:
        product = selected.get(item.product_id)
        if product is None:
            product = read_shopify(body.store, f"/products/{item.product_id}.json").get("product", {})
            selected[item.product_id] = product
        if product.get("vendor") not in allowed or product.get("status") != "active":
            raise HTTPException(403, "Product vendor is not approved or product is inactive")
        variant = next((v for v in product.get("variants", []) if str(v["id"]) == item.variant_id), None)
        if not variant:
            raise HTTPException(422, "Variant does not belong to this product")
        if item.variant_id in prices and prices[item.variant_id] != cents(item.sale_price):
            raise HTTPException(422, "Use one sale price per variant")
        prices[item.variant_id] = cents(item.sale_price)
        quantities[item.variant_id] = quantities.get(item.variant_id, 0) + item.quantity
        if variant.get("inventory_management") and variant.get("inventory_policy") != "continue" and quantities[item.variant_id] > int(variant.get("inventory_quantity") or 0):
            raise HTTPException(409, "Insufficient stock for the selected variant")
    oid = uuid4().hex
    with db.SessionLocal() as session:
        # Serialize with seller approval changes; never trust stale browser access.
        session.execute(update(Seller).where(Seller.id == seller["id"]).values(reviewed_by=Seller.reviewed_by))
        current = session.get(Seller, seller["id"])
        current_access = json.loads(current.access)
        if current.status != "approved" or any(p.get("vendor") not in current_access.get(body.store, []) for p in selected.values()):
            raise HTTPException(403, "Seller access has changed; refresh your account")
        total_cost = 0
        for item in body.items:
            cost = session.get(ProductCost, (body.store, item.variant_id))
            if not cost or cost.product_id != item.product_id or cost.currency != currency:
                raise HTTPException(422, "The administrator must set a product cost before it can be sold")
            if cents(item.sale_price) <= cost.unit_cost_cents:
                raise HTTPException(422, "Sale price must be above the approved product cost")
            total_cost += cost.unit_cost_cents * item.quantity
        row = SellerOrder(id=oid, seller_id=seller["id"], request_id=body.request_id, fingerprint=fingerprint,
                          store=body.store, currency=currency, cost_cents=total_cost, state="submitting",
                          snapshot=json.dumps({"submission": body.model_dump(mode="json")}))
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Order is already being submitted; refresh orders")
    first, _, last = body.customer_name.strip().partition(" ")
    address = {"first_name": first, "last_name": last, "name": body.customer_name.strip(),
               "phone": body.customer_phone.strip(), "address1": body.address.strip(), "city": body.city.strip(), "country_code": body.country}
    try:
        snapshot = shopify._rest_post_store(body.store, "/orders.json", {"order": {
            "line_items": [{"variant_id": int(vid), "quantity": qty, "price": str(Decimal(prices[vid]) / 100)} for vid, qty in quantities.items()],
            "shipping_address": address, "billing_address": address, "phone": body.customer_phone.strip(),
            "tags": f"affiliate,affiliate_seller:{seller['id']},affiliate_request:{body.request_id}",
            "note": body.note, "financial_status": "pending", "inventory_behaviour": "decrement_obeying_policy",
            "send_receipt": False, "send_fulfillment_receipt": False}}).get("order")
        if not snapshot or not snapshot.get("id"):
            raise ValueError("Shopify returned no order")
        with db.SessionLocal() as session:
            row = session.get(SellerOrder, oid)
            row.shopify_id, row.snapshot, row.state = str(snapshot["id"]), json.dumps(snapshot), "created"
            row.synced_at = datetime.utcnow()
            session.commit()
            return {"data": order_view(row)}
    except Exception:
        log.exception("Affiliate order %s requires reconciliation", oid)
        with db.SessionLocal() as session:
            row = session.get(SellerOrder, oid)
            row.state = "needs_review"
            session.commit()
        raise HTTPException(502, "Shopify submission could not be confirmed. The administrator must reconcile it before another attempt.")


def sync_orders(seller_id, force=False):
    warnings = []
    config = db.get_app_setting(None, "affiliate_delivery_connection") or {}
    shops = {s["label"]: s["shop"] for s in build_store_registry(db)}
    with db.SessionLocal() as session:
        rows = session.query(SellerOrder).filter_by(seller_id=seller_id, state="created").all()
    if not force:
        cutoff = datetime.utcnow() - timedelta(seconds=30)
        rows = [row for row in rows if not row.synced_at or row.synced_at < cutoff]
    snapshots, deliveries = {}, {}
    # Network calls run outside database transactions, bounded in store batches.
    for store in {row.store for row in rows}:
        own = [row for row in rows if row.store == store]
        for offset in range(0, len(own), 250):
            batch = own[offset:offset + 250]
            try:
                result = read_shopify(store, "/orders.json?" + urlencode({
                    "ids": ",".join(row.shopify_id for row in batch), "status": "any", "limit": 250}))
                found = {str(order["id"]): order for order in result.get("orders", [])}
                for row in batch:
                    if row.shopify_id in found:
                        snapshots[row.id] = found[row.shopify_id]
                    else:
                        warnings.append(f"Order {row.shopify_id} in {store} could not be refreshed.")
            except Exception:
                log.exception("Affiliate order batch sync failed for %s", store)
                warnings.append(f"Orders in {store} could not be refreshed.")
    if config.get("base_url") and config.get("api_key"):
        try:
            for offset in range(0, len(rows), 100):
                batch = rows[offset:offset + 100]
                result = requests.post(config["base_url"] + "/api/integrations/affiliate-tracking/orders",
                    headers={"Authorization": "Bearer " + config["api_key"]},
                    json={"orders": [{"shop": shops.get(row.store), "order_id": row.shopify_id} for row in batch]}, timeout=20, allow_redirects=False)
                result.raise_for_status()
                if result.status_code != 200:
                    raise ValueError("Unexpected delivery response")
                events = {(event["shop"].lower(), str(event["order_id"])): event for event in result.json()["data"]["orders"]}
                for row in batch:
                    event = events.get((str(shops.get(row.store)).lower(), row.shopify_id))
                    if event:
                        deliveries[row.id] = event
                    elif json.loads(row.delivery):
                        warnings.append(f"Delivery app could not locate {row.shopify_id} in {row.store}.")
        except Exception:
            log.exception("Affiliate delivery tracking unavailable")
            warnings.append("Delivery app statuses could not be refreshed. Payouts require a successful refresh.")
    with db.SessionLocal() as session:
        for detached in rows:
            row = session.get(SellerOrder, detached.id)
            if detached.id in snapshots:
                row.snapshot = json.dumps(snapshots[detached.id])
                if not config.get("base_url") or detached.id in deliveries or not json.loads(row.delivery):
                    row.synced_at = datetime.utcnow()
            if detached.id in deliveries:
                row.delivery = json.dumps(deliveries[detached.id])
        session.commit()
    return warnings


def payout_view(row):
    return {"id": row.id, "currency": row.currency, "amount": row.amount_cents / 100, "status": row.status,
            "destination": row.destination, "reference": row.reference, "created_at": row.created_at.isoformat()}


def dashboard(seller_id):
    with db.SessionLocal() as session:
        orders = [order_view(row) for row in session.query(SellerOrder).filter_by(seller_id=seller_id).order_by(SellerOrder.created_at.desc()).all()]
        payouts = [payout_view(row) for row in session.query(Payout).filter_by(seller_id=seller_id).order_by(Payout.created_at.desc()).all()]
    analytics = {}
    for currency in sorted({o["currency"] for o in orders} | {p["currency"] for p in payouts}):
        own = [o for o in orders if o["currency"] == currency]
        paid = sum(cents(p["amount"]) for p in payouts if p["currency"] == currency and p["status"] == "paid")
        reserved = sum(cents(p["amount"]) for p in payouts if p["currency"] == currency and p["status"] in {"pending", "approved"})
        earned = sum(cents(o["profit"]) for o in own)
        analytics[currency] = {"orders": len(own), "delivered": sum(o["status"] == "delivered" for o in own),
            "sales": sum(cents(o["net_sales"]) for o in own) / 100, "profit": earned / 100,
            "pending_profit": sum(cents(o["pending_profit"]) for o in own) / 100,
            "paid": paid / 100, "reserved": reserved / 100, "available": (earned - paid - reserved) / 100}
    return {"orders": orders, "payouts": payouts, "analytics": analytics}


@router.get("/dashboard")
def seller_dashboard(seller=Depends(active_seller)):
    warnings = sync_orders(seller["id"])
    return {"data": {**dashboard(seller["id"]), "warnings": warnings}}


class PayoutRequest(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    destination: str = Field(min_length=5, max_length=500)


def lock_seller(session, sid):
    # An UPDATE provides a DB transaction lock on both SQLite and PostgreSQL.
    session.execute(update(Seller).where(Seller.id == sid).values(reviewed_by=Seller.reviewed_by))
    row = session.get(Seller, sid)
    if not row:
        raise HTTPException(404, "Seller not found")
    return row


def balance(session, sid, currency, excluding=None):
    earned = sum(cents(order_view(o)["profit"]) for o in session.query(SellerOrder).filter_by(seller_id=sid, currency=currency).all())
    committed = sum(p.amount_cents for p in session.query(Payout).filter_by(seller_id=sid, currency=currency).all()
                    if p.id != excluding and p.status in {"pending", "approved", "paid"})
    return earned - committed


@router.post("/payouts")
def request_payout(body: PayoutRequest, seller=Depends(active_seller)):
    if sync_orders(seller["id"], force=True):
        raise HTTPException(409, "Refresh order statuses before requesting a payout")
    with db.SessionLocal() as session:
        if lock_seller(session, seller["id"]).status != "approved":
            raise HTTPException(403, "Seller account is not approved")
        amount = cents(body.amount)
        if amount > balance(session, seller["id"], body.currency):
            raise HTTPException(409, "Amount exceeds available delivered-order earnings")
        row = Payout(id=uuid4().hex, seller_id=seller["id"], currency=body.currency, amount_cents=amount, destination=body.destination.strip())
        session.add(row)
        session.commit()
        return {"data": payout_view(row)}


@router.get("/admin")
def admin_dashboard(admin=Depends(require_admin)):
    with db.SessionLocal() as session:
        sellers = [_public_seller(s) for s in session.query(Seller).order_by(Seller.created_at.desc()).all()]
    for seller in sellers:
        seller.update(dashboard(seller["id"]))
    return {"data": {"sellers": sellers, "connections": build_store_registry(db),
                     "delivery": delivery_connection_view()}}


def delivery_connection_view():
    config = db.get_app_setting(None, "affiliate_delivery_connection") or {}
    return {"base_url": config.get("base_url", ""), "configured": bool(config.get("base_url") and config.get("api_key"))}


@router.get("/admin/delivery-connection")
def get_delivery_connection(admin=Depends(require_admin)):
    return {"data": delivery_connection_view()}


class DeliveryConnection(BaseModel):
    base_url: str = Field(max_length=300)
    api_key: str = Field(default="", max_length=500)


@router.put("/admin/delivery-connection")
def save_delivery_connection(body: DeliveryConnection, admin=Depends(require_admin)):
    url = body.base_url.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise HTTPException(422, "Use the delivery app's HTTPS origin, for example https://apex-maroc.com")
    previous = db.get_app_setting(None, "affiliate_delivery_connection") or {}
    key = body.api_key.strip() or previous.get("api_key", "")
    if not key:
        raise HTTPException(422, "Delivery tracking API key is required")
    try:
        response = requests.post(url + "/api/integrations/affiliate-tracking/orders",
            headers={"Authorization": "Bearer " + key}, json={"orders": []}, timeout=20, allow_redirects=False)
        if response.status_code != 200 or "orders" not in response.json().get("data", {}):
            raise ValueError("Invalid response")
    except Exception:
        raise HTTPException(422, "Delivery connection test failed; check the deployed tracking endpoint and API key")
    db.set_app_setting(None, "affiliate_delivery_connection", {"base_url": url, "api_key": key, "updated_by": admin.get("sub")})
    return {"data": delivery_connection_view()}


@router.get("/admin/catalog")
def admin_catalog(admin=Depends(require_admin)):
    return {"data": catalog()}


class SellerReview(BaseModel):
    status: Literal["approved", "rejected", "suspended", "pending"]
    access: dict[str, list[str]]


@router.patch("/admin/sellers/{sid}")
def review_seller(sid: str, body: SellerReview, admin=Depends(require_admin)):
    registry = {s["label"] for s in connected_stores()}
    if body.status == "approved" and any(store not in registry for store, vendors in body.access.items() if vendors):
        raise HTTPException(422, "Access can only be granted to connected stores")
    if any(not vendor.strip() for vendors in body.access.values() for vendor in vendors):
        raise HTTPException(422, "Vendor names cannot be empty")
    if body.status == "approved" and not any(body.access.values()):
        raise HTTPException(422, "Select at least one Shopify vendor before approval")
    with db.SessionLocal() as session:
        row = lock_seller(session, sid)
        row.status, row.access = body.status, json.dumps({k: sorted(set(v)) for k, v in body.access.items() if v})
        row.reviewed_by = admin.get("sub")
        session.commit()
        return {"data": _public_seller(row)}


class CostUpdate(BaseModel):
    store: str
    product_id: str = Field(pattern=r"^\d+$")
    variant_id: str = Field(pattern=r"^\d+$")
    unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


@router.put("/admin/costs")
def set_cost(body: CostUpdate, admin=Depends(require_admin)):
    if body.store not in {s["label"] for s in connected_stores()}:
        raise HTTPException(422, "Store must be connected")
    product = read_shopify(body.store, f"/products/{body.product_id}.json").get("product", {})
    if not any(str(v["id"]) == body.variant_id for v in product.get("variants", [])):
        raise HTTPException(422, "Variant does not belong to this product")
    currency = read_shopify(body.store, "/shop.json")["shop"]["currency"]
    with db.SessionLocal() as session:
        row = session.get(ProductCost, (body.store, body.variant_id))
        if not row:
            row = ProductCost(store=body.store, variant_id=body.variant_id, product_id=body.product_id)
            session.add(row)
        row.unit_cost_cents, row.currency, row.updated_by = cents(body.unit_cost), currency, admin.get("sub")
        session.commit()
    return {"data": {"unit_cost": float(body.unit_cost), "currency": currency}}


@router.post("/admin/sellers/{sid}/sync")
def admin_sync(sid: str, admin=Depends(require_admin)):
    with db.SessionLocal() as session:
        if not session.get(Seller, sid):
            raise HTTPException(404, "Seller not found")
    return {"data": {**dashboard_after_sync(sid)}}


def dashboard_after_sync(sid):
    warnings = sync_orders(sid, force=True)
    return {**dashboard(sid), "warnings": warnings}


class PayoutReview(BaseModel):
    status: Literal["approved", "rejected", "paid"]
    reference: str = Field(default="", max_length=250)


@router.patch("/admin/payouts/{pid}")
def review_payout(pid: str, body: PayoutReview, admin=Depends(require_admin)):
    with db.SessionLocal() as session:
        payout = session.get(Payout, pid)
        if not payout:
            raise HTTPException(404, "Payout not found")
        sid = payout.seller_id
    if body.status != "rejected" and sync_orders(sid, force=True):
        raise HTTPException(409, "Live order statuses must refresh before payout approval")
    with db.SessionLocal() as session:
        seller = lock_seller(session, sid)
        row = session.get(Payout, pid)
        if row.status == body.status:
            return {"data": payout_view(row)}
        transitions = {"pending": {"approved", "rejected"}, "approved": {"paid", "rejected"}}
        if body.status not in transitions.get(row.status, set()):
            raise HTTPException(409, "Invalid payout status transition")
        if body.status != "rejected":
            if seller.status != "approved" or row.amount_cents > balance(session, sid, row.currency, excluding=pid):
                raise HTTPException(409, "Seller is not approved or earnings no longer cover this payout")
        if body.status == "paid" and not body.reference.strip():
            raise HTTPException(422, "Payment transfer reference is required")
        row.status, row.reference, row.reviewed_by = body.status, body.reference.strip() or None, admin.get("sub")
        session.commit()
        return {"data": payout_view(row)}



class ReconcileOrder(BaseModel):
    shopify_id: str = Field(pattern=r"^\d+$")


@router.post("/admin/orders/{oid}/reconcile")
def reconcile_order(oid: str, body: ReconcileOrder, admin=Depends(require_admin)):
    with db.SessionLocal() as session:
        row = session.get(SellerOrder, oid)
        if not row:
            raise HTTPException(404, "Seller order not found")
        if row.state == "created":
            raise HTTPException(409, "Order is already linked")
        snapshot = read_shopify(row.store, f"/orders/{body.shopify_id}.json").get("order", {})
        tags = {t.strip() for t in str(snapshot.get("tags", "")).split(",")}
        if not {f"affiliate_seller:{row.seller_id}", f"affiliate_request:{row.request_id}"}.issubset(tags):
            raise HTTPException(422, "Shopify order does not match this seller submission")
        row.snapshot, row.shopify_id, row.state, row.synced_at = json.dumps(snapshot), body.shopify_id, "created", datetime.utcnow()
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Shopify order is already linked")
        return {"data": order_view(row)}
