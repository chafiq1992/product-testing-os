"""Seller marketplace using the same Shopify OAuth registry as Connections.

Seller identity, catalog authorization and payout reservations are enforced here,
not by browser-supplied seller IDs or product prices.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
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
from app.affiliate_marketplace import collection_memberships, discount_for, paginate, present_product, variant_cost
from app import affiliate_catalog_cache as catalog_cache

router = APIRouter(prefix="/api/affiliates", tags=["affiliates"])
log = logging.getLogger(__name__)
CUSTOMER_TAGS_QUERY = (Path(__file__).parent / "graphql" / "affiliate_customer_tags.graphql").read_text(encoding="utf-8")


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


class BankAccount(db.Base):
    __tablename__ = "affiliate_bank_accounts"
    id = Column(String, primary_key=True)
    seller_id = Column(String, nullable=False, index=True)
    bank = Column(String, nullable=False)
    rib = Column(String(24), nullable=False)
    __table_args__ = (UniqueConstraint("seller_id", "bank"),)


class PayoutMethod(db.Base):
    __tablename__ = "affiliate_payout_methods"
    payout_id = Column(String, primary_key=True)
    method = Column(String, nullable=False)
    bank = Column(String)
    rib = Column(String(24))


class OrderTerms(db.Base):
    __tablename__ = "affiliate_order_terms"
    order_id = Column(String, primary_key=True)
    delivery_fee_cents = Column(Integer, nullable=False)
    customer_id = Column(String)


class ProductMark(db.Base):
    __tablename__ = "affiliate_product_marks"
    seller_id = Column(String, primary_key=True)
    store = Column(String, primary_key=True)
    product_id = Column(String, primary_key=True)


class Customer(db.Base):
    __tablename__ = "affiliate_customers"
    id = Column(String, primary_key=True)
    seller_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    address = Column(String, nullable=False)
    city = Column(String, nullable=False)
    country = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("seller_id", "phone"),)


class CustomerLink(db.Base):
    __tablename__ = "affiliate_customer_shopify_links"
    customer_id = Column(String, primary_key=True)
    store = Column(String, primary_key=True)
    shopify_id = Column(String, nullable=False)


class OrderReceipt(db.Base):
    __tablename__ = "affiliate_order_receipts"
    order_id = Column(String, primary_key=True)
    data = Column(Text, nullable=False)


for table in (Seller, SellerSession, SellerOrder, Payout, ProductCost, OrderTerms, ProductMark, Customer, CustomerLink, OrderReceipt, BankAccount, PayoutMethod):
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


def pricing_settings():
    saved = db.get_app_setting(None, "affiliate_marketplace_pricing") or {}
    return {"discount_percent": saved.get("discount_percent", 35), "rules": saved.get("rules", []),
            "delivery_fees": saved.get("delivery_fees", {"MAD": 33})}


def pricing_memberships(store, settings):
    try:
        return collection_memberships(read_shopify, store, settings)
    except Exception:
        log.exception("Affiliate collection pricing could not be verified")
        raise HTTPException(502, "Collection pricing could not be verified. Try again after refreshing the Marketplace.")


def catalog(access=None):
    products, stores, warnings, refreshing = [], [], [], False
    settings = pricing_settings()
    connections = [c for c in connected_stores() if access is None or access.get(c['label'])]
    def load_store(connection):
        return catalog_cache.load(connection, settings, read_shopify, pricing_memberships)
    # Store reads are independent; don't make every seller wait for them in series.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {c['label']: pool.submit(load_store, c) for c in connections}

    for connection in connections:
        label = connection["label"]
        allowed = None if access is None else access.get(label, [])
        if allowed == []:
            continue
        try:
            snapshot = futures[label].result()
            currency = snapshot['currency']
            # Monetary accounting is stored in hundredths; avoid silently rounding
            # currencies with different minor-unit rules.
            if currency not in {"MAD", "USD", "EUR", "GBP", "CAD", "AED", "SAR"}:
                raise ValueError("Unsupported settlement currency")
            store_products = []
            memberships = snapshot['memberships']
            refreshing = refreshing or snapshot['refreshing']
            for product in snapshot['products']:
                if allowed is not None and product.get('vendor') not in allowed:
                    continue
                store_products.append(present_product(product, label, currency,
                    discount_for(product['id'], label, settings, memberships)))
            products.extend(store_products)
            stores.append({"label": label, "shop": connection["shop"], "currency": currency,
                           "vendors": sorted({p["vendor"] for p in store_products})})
        except Exception:
            log.exception("Affiliate catalog unavailable for %s", label)
            warnings.append(f"Could not load {label}; check its connection and product permissions.")
    return {"products": products, "stores": stores, "warnings": warnings, "pricing": settings, "refreshing": refreshing}


@router.get("/products")
def products(seller=Depends(active_seller)):
    data = catalog(seller["access"])
    with db.SessionLocal() as session:
        marks = {(m.store, m.product_id) for m in session.query(ProductMark).filter_by(seller_id=seller["id"]).all()}
    for product in data["products"]:
        product["marked"] = (product["store"], product["id"]) in marks
    data["warnings"] = ["Some products are temporarily unavailable. Try refreshing the Marketplace." for _ in data["warnings"]]
    data.pop("stores", None)
    data["pricing"] = {"delivery_fees": data["pricing"]["delivery_fees"]}
    # Store keys are used internally for order routing; vendor names are admin-only.
    for product in data["products"]:
        product.pop("vendor", None)
    return {"data": data}


class MarkUpdate(BaseModel):
    store: str
    product_id: str = Field(pattern=r"^\d+$")
    marked: bool


@router.put("/marks")
def mark_product(body: MarkUpdate, seller=Depends(active_seller)):
    if body.marked:
        if not seller["access"].get(body.store):
            raise HTTPException(403, "Product is not available to this seller")
        product = read_shopify(body.store, f"/products/{body.product_id}.json").get("product", {})
        if product.get("status") != "active" or product.get("vendor") not in seller["access"].get(body.store, []):
            raise HTTPException(403, "Product is not available to this seller")
    with db.SessionLocal() as session:
        key = (seller["id"], body.store, body.product_id)
        row = session.get(ProductMark, key)
        if body.marked and not row:
            session.add(ProductMark(seller_id=seller["id"], store=body.store, product_id=body.product_id))
        elif not body.marked and row:
            session.delete(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()  # An identical concurrent mark is already saved.
    return {"data": {"marked": body.marked}}


def cents(value):
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def order_view(row, delivery_fee_cents=None):
    if delivery_fee_cents is None:
        with db.SessionLocal() as session:
            terms = session.get(OrderTerms, row.id)
            delivery_fee_cents = terms.delivery_fee_cents if terms else 0
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
    expected = max(0, eligible_subtotal - row.cost_cents - delivery_fee_cents)
    settled = status == "delivered" and (delivery.get("cash_collected") is True or financial in {"paid", "partially_refunded"} or "delivered" in tags)
    if delivery.get("settlement_pending"):
        settled = False
    if status in {"cancelled", "returned", "failed"} or financial in {"refunded", "voided"}:
        expected, settled = 0, False
    shipping = snap.get("shipping_address") or {}
    return {"id": row.id, "store": row.store, "shopify_id": row.shopify_id, "name": snap.get("name") or row.id[:8],
            "state": row.state, "currency": row.currency, "total": cents(snap.get("total_price")) / 100,
            "net_sales": eligible_subtotal / 100 if settled else 0,
            "profit": expected / 100 if settled else 0, "profit_earned": settled, "pending_profit": expected / 100 if not settled and row.state == "created" else 0,
            "status": status, "financial_status": financial, "customer": shipping.get("name", ""),
            "items": [{"title": li.get("title"), "quantity": li.get("quantity")} for li in snap.get("line_items", [])],
            "tracking_number": delivery.get("tracking_number") or next((f.get("tracking_number") for f in reversed(fulfillment) if f.get("tracking_number")), None),
            "cost": row.cost_cents / 100, "delivery_fee": delivery_fee_cents / 100, "delivery_status": delivery.get("raw_status"),
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
    customer_id: str | None = None
    items: list[OrderLine] = Field(min_length=1, max_length=50)


class CustomerInput(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str = Field(min_length=6, max_length=40)
    address: str = Field(min_length=3, max_length=250)
    city: str = Field(min_length=2, max_length=100)
    country: str = Field(default="MA", pattern=r"^[A-Z]{2}$")


def normalized_phone(phone, country="MA"):
    import re
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("00"): digits = digits[2:]
    if country == "MA":
        if len(digits) == 10 and digits.startswith("0"): digits = "212" + digits[1:]
        elif len(digits) == 9 and digits[0] in "567": digits = "212" + digits
    if not 8 <= len(digits) <= 15:
        raise HTTPException(422, "Enter a valid customer phone number with its country code")
    return "+" + digits


def customer_view(row):
    return {"id": row.id, "customer_name": row.name, "customer_phone": row.phone,
            "address": row.address, "city": row.city, "country": row.country,
            "created_at": row.created_at.isoformat()}


def save_customer(body, seller_id):
    phone = normalized_phone(body.customer_phone, body.country)
    with db.SessionLocal() as session:
        if getattr(body, "customer_id", None):
            chosen = session.get(Customer, body.customer_id)
            if not chosen or chosen.seller_id != seller_id:
                raise HTTPException(403, "Customer does not belong to your account")
        row = session.query(Customer).filter_by(seller_id=seller_id, phone=phone).first()
        if not row:
            row = Customer(id=uuid4().hex, seller_id=seller_id, phone=phone)
            session.add(row)
        row.name, row.address, row.city, row.country = body.customer_name.strip(), body.address.strip(), body.city.strip(), body.country
        if not all((row.name, row.address, row.city)):
            raise HTTPException(422, "Customer name and address are required")
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            row = session.query(Customer).filter_by(seller_id=seller_id, phone=phone).one()
        return customer_view(row)


def shopify_customer(store, customer, seller_id):
    tag = f"affiliate_seller:{seller_id}"
    try:
        with db.SessionLocal() as session:
            link = session.get(CustomerLink, (customer["id"], store))
        if link:
            existing = read_shopify(store, f"/customers/{link.shopify_id}.json").get("customer", {})
        else:
            existing = {}
        if not existing or not existing.get("phone") or normalized_phone(existing["phone"], customer["country"]) != customer["customer_phone"]:
            response = read_shopify(store, "/customers/search.json?" + urlencode({"query": f"phone:{customer['customer_phone']}", "limit": 100}))
            matches = [row for row in response.get("customers", []) if row.get("phone") and normalized_phone(row["phone"], customer["country"]) == customer["customer_phone"]]
            if len(matches) > 1:
                raise HTTPException(409, "Customer phone matches multiple Shopify records; an administrator must resolve it")
            existing = matches[0] if matches else {}
        if existing:
            tags = {t.strip() for t in str(existing.get("tags", "")).split(",") if t.strip()}
            if tag not in tags:
                # Atomic additions preserve other affiliates' tags during concurrent orders.
                result = shopify._gql_store(store, CUSTOMER_TAGS_QUERY, {"id": f"gid://shopify/Customer/{existing['id']}", "tags": ["affiliate", tag]}).get("tagsAdd", {})
                if result.get("userErrors") or not result.get("node", {}).get("id"):
                    raise ValueError("Shopify customer tags were not confirmed")
            cid = str(existing["id"])
        else:
            first, _, last = customer["customer_name"].partition(" ")
            created = shopify._rest_post_store(store, "/customers.json", {"customer": {
                "first_name": first, "last_name": last, "phone": customer["customer_phone"],
                "tags": f"affiliate,{tag}", "send_email_invite": False,
                "addresses": [{"first_name": first, "last_name": last, "phone": customer["customer_phone"],
                    "address1": customer["address"], "city": customer["city"], "country_code": customer["country"]}]}}).get("customer", {})
            if not created.get("id"): raise ValueError("Shopify returned no customer")
            cid = str(created["id"])
        with db.SessionLocal() as session:
            if not session.get(CustomerLink, (customer["id"], store)):
                session.add(CustomerLink(customer_id=customer["id"], store=store, shopify_id=cid))
                try: session.commit()
                except IntegrityError: session.rollback()
        return cid
    except HTTPException:
        raise
    except Exception:
        log.exception("Affiliate customer sync failed")
        raise HTTPException(502, "Customer could not be synced. Check Shopify customer permissions, then try again; no order was submitted.")


@router.get("/customers")
def customers(seller=Depends(active_seller)):
    with db.SessionLocal() as session:
        own = [customer_view(c) for c in session.query(Customer).filter_by(seller_id=seller["id"]).order_by(Customer.created_at.desc()).all()]
        rows = session.query(SellerOrder, OrderTerms).join(OrderTerms, SellerOrder.id == OrderTerms.order_id).filter(SellerOrder.seller_id == seller["id"]).all()
    for customer in own:
        orders = [order_view(order, terms.delivery_fee_cents) for order, terms in rows if terms.customer_id == customer["id"]]
        customer["orders"] = orders
        customer["orders_count"] = len(orders)
    return {"data": own}


def delivery_cities(force=False):
    import time
    config = db.get_app_setting(None, 'affiliate_delivery_connection') or {}
    if not config.get('base_url') or not config.get('api_key'):
        raise HTTPException(503, 'Connect the delivery app in Connections to load its active routing cities.')
    signature = hashlib.sha256((config['base_url'] + config['api_key']).encode()).hexdigest()
    saved = db.get_app_setting(None, 'affiliate_routing_cities') or {}
    if not force and saved.get('signature') == signature and time.time() - saved.get('timestamp', 0) < 300:
        return saved['cities']
    try:
        response = requests.get(config['base_url'] + '/api/integrations/affiliate-tracking/cities',
            headers={'Authorization': 'Bearer ' + config['api_key']}, timeout=10, allow_redirects=False)
        response.raise_for_status()
        cities = response.json()['data']['cities']
        if not isinstance(cities, list): raise ValueError('Invalid city response')
        result = sorted({str(c['id']): {'id': str(c['id']), 'name': str(c['name']), 'country': 'MA'}
            for c in cities if c.get('country') == 'MA' and c.get('name')}.values(), key=lambda c: c['name'])
    except Exception:
        raise HTTPException(502, 'Active routing cities could not be loaded. Check the delivery connection and update its integration, then try again.')
    db.set_app_setting(None, 'affiliate_routing_cities', {'signature': signature, 'timestamp': time.time(), 'cities': result})
    return result


@router.get('/cities')
def seller_cities(seller=Depends(active_seller)):
    return {'data': {'cities': delivery_cities()}}


@router.get('/order-details')
def order_details(order_id: str, seller=Depends(active_seller)):
    with db.SessionLocal() as session:
        row = session.get(SellerOrder, order_id)
        if not row or row.seller_id != seller['id']:
            raise HTTPException(404, 'Order not found')
        stored = session.get(OrderReceipt, order_id)
        snap = json.loads(row.snapshot)
        shipping = snap.get('shipping_address') or {}
        receipt = json.loads(stored.data) if stored else {
            'customer_name': shipping.get('name', ''), 'customer_phone': shipping.get('phone') or snap.get('phone', ''),
            'city': shipping.get('city', ''), 'address': shipping.get('address1', ''), 'note': snap.get('note', ''),
            'currency': row.currency, 'total': float(snap.get('total_price') or 0),
            'items': [{'title': li.get('title', ''), 'variant': li.get('variant_title', ''), 'quantity': li.get('quantity', 0),
                'unit_price': float(li.get('price') or 0), 'total': float(li.get('price') or 0) * int(li.get('quantity') or 0)}
                for li in snap.get('line_items', [])]}
        receipt['name'] = snap.get('name') or 'Order awaiting confirmation'
        if 'delivery_fee' not in receipt:
            terms = session.get(OrderTerms, order_id)
            receipt['delivery_fee'] = (terms.delivery_fee_cents if terms else 0) / 100
        receipt['delivery_included'] = True
        return {'data': {'order': order_view(row), 'receipt': receipt}}


@router.post("/customers")
def create_customer(body: CustomerInput, seller=Depends(active_seller)):
    return {"data": save_customer(body, seller["id"])}


@router.post("/orders")
def create_order(body: NewOrder, seller=Depends(active_seller)):
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    with db.SessionLocal() as session:
        prior = session.query(SellerOrder).filter_by(seller_id=seller["id"], request_id=body.request_id).first()
        if prior:
            if prior.fingerprint != fingerprint:
                raise HTTPException(409, "This submission ID was already used for a different order")
            if prior.state == "rejected":
                raise HTTPException(422, json.loads(prior.snapshot).get('submission_error') or "Shopify rejected this order. Correct its details before trying again.")
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
    settings = pricing_settings()
    if currency not in settings["delivery_fees"]:
        raise HTTPException(422, "An administrator must configure a delivery fee for this currency")
    fee = cents(settings["delivery_fees"][currency])
    cities = delivery_cities(force=True)
    city = next((c['name'] for c in cities if c['name'].casefold() == body.city.strip().casefold()), None)
    if not city or body.country != 'MA':
        raise HTTPException(422, 'Choose a city from the delivery app’s active routing cities.')
    body.city = city
    memberships = pricing_memberships(body.store, settings)
    approved_costs = {}
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
        cost = variant_cost(variant, discount_for(item.product_id, body.store, settings, memberships))
        if cost is None:
            raise HTTPException(422, "Product must have a valid Shopify selling price")
        approved_costs[item.variant_id] = cost
        if item.variant_id in prices and prices[item.variant_id] != cents(item.sale_price):
            raise HTTPException(422, "Use one sale price per variant")
        prices[item.variant_id] = cents(item.sale_price)
        quantities[item.variant_id] = quantities.get(item.variant_id, 0) + item.quantity
        if variant.get("inventory_management") and quantities[item.variant_id] > int(variant.get("inventory_quantity") or 0):
            raise HTTPException(409, "Insufficient stock for the selected variant")
    total_cost = sum(approved_costs[item.variant_id] * item.quantity for item in body.items)
    if any(cents(item.sale_price) <= approved_costs[item.variant_id] for item in body.items):
        raise HTTPException(422, "Sale price must be above the affiliate product cost")
    if sum(cents(item.sale_price) * item.quantity for item in body.items) <= total_cost + fee:
        raise HTTPException(422, "Order total must cover product costs and the delivery fee to earn profit")
    customer = save_customer(body, seller["id"])
    cid = shopify_customer(body.store, customer, seller["id"])
    oid = uuid4().hex
    with db.SessionLocal() as session:
        # Serialize with seller approval changes; never trust stale browser access.
        session.execute(update(Seller).where(Seller.id == seller["id"]).values(reviewed_by=Seller.reviewed_by))
        current = session.get(Seller, seller["id"])
        current_access = json.loads(current.access)
        if current.status != "approved" or any(p.get("vendor") not in current_access.get(body.store, []) for p in selected.values()):
            raise HTTPException(403, "Seller access has changed; refresh your account")
        row = SellerOrder(id=oid, seller_id=seller["id"], request_id=body.request_id, fingerprint=fingerprint,
                          store=body.store, currency=currency, cost_cents=total_cost, state="submitting",
                          snapshot=json.dumps({"submission": body.model_dump(mode="json")}))
        session.add(row)
        session.add(OrderTerms(order_id=oid, delivery_fee_cents=fee, customer_id=customer["id"]))
        receipt_items = []
        for item in body.items:
            product = selected[item.product_id]
            variant = next(v for v in product['variants'] if str(v['id']) == item.variant_id)
            image = next((im.get('src') for im in product.get('images', []) if im.get('id') == variant.get('image_id')), None)
            image = image or next((im.get('src') for im in product.get('images', []) if im.get('src')), None)
            options = {str(o.get('name', '')).casefold(): variant.get(f"option{o.get('position', 1)}", '') for o in product.get('options', [])}
            color = next((value for key, value in options.items() if key in {'color', 'colour', 'couleur', 'اللون'}), '')
            size = next((value for key, value in options.items() if key in {'size', 'taille', 'pointure', 'المقاس'}), '')
            receipt_items.append({'title': product['title'], 'variant': variant.get('title', ''), 'image': image, 'color': color, 'size': size,
                'quantity': item.quantity, 'unit_price': prices[item.variant_id] / 100,
                'total': prices[item.variant_id] * item.quantity / 100})
        session.add(OrderReceipt(order_id=oid, data=json.dumps({
            'customer_name': customer['customer_name'], 'customer_phone': customer['customer_phone'],
            'city': body.city, 'address': customer['address'], 'note': body.note, 'currency': currency,
            'items': receipt_items, 'delivery_fee': fee / 100, 'delivery_included': True,
            'total': sum(prices[vid] * qty for vid, qty in quantities.items()) / 100})))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Order is already being submitted; refresh orders")
    first, _, last = body.customer_name.strip().partition(" ")
    address = {"first_name": first, "last_name": last, "name": body.customer_name.strip(),
               "phone": customer['customer_phone'], "address1": body.address.strip(), "city": body.city.strip(), "country_code": 'MA'}
    try:
        snapshot = shopify._rest_post_store(body.store, "/orders.json", {"order": {
            "line_items": [{"variant_id": int(vid), "quantity": qty, "price": str(Decimal(prices[vid]) / 100)} for vid, qty in quantities.items()],
            "shipping_address": address, "billing_address": address,
            "customer": {"id": int(cid)},
            # Shopify order tags have a 40-character limit. Keep full UUIDs
            # using short prefixes; the original submission ID stays in the
            # database and order attributes for audit and duplicate protection.
            "tags": f"affiliate,aff_s:{seller['id']},aff_o:{oid}",
            "note_attributes": [{"name": "affiliate_seller_id", "value": seller['id']},
                                {"name": "affiliate_request_id", "value": body.request_id}],
            "note": body.note, "financial_status": "pending", "inventory_behaviour": "decrement_obeying_policy",
            "send_receipt": False, "send_fulfillment_receipt": False}}).get("order")
        if not snapshot or not snapshot.get("id"):
            raise ValueError("Shopify returned no order")
        with db.SessionLocal() as session:
            row = session.get(SellerOrder, oid)
            row.shopify_id, row.snapshot, row.state = str(snapshot["id"]), json.dumps(snapshot), "created"
            row.synced_at = datetime.utcnow()
            session.commit()
            result = order_view(row)
        try:
            connection = next(c for c in connected_stores() if c['label'] == body.store)
            catalog_cache.invalidate(connection, settings)
        except Exception:
            log.exception('Affiliate catalog invalidation failed after order creation')
        return {"data": result}
    except Exception as exc:
        response = exc.response if isinstance(exc, requests.HTTPError) else None
        # Explicit validation/auth rejection confirms no order was created. Other
        # failures remain uncertain; never automatically repeat a Shopify write.
        rejected = response is not None and response.status_code in {400, 401, 403, 404, 422}
        reason = 'Shopify rejected this order. Check customer details, stock and store permissions.'
        if rejected:
            try:
                errors = response.json().get('errors', {})
                if isinstance(errors, dict):
                    reason = 'Shopify rejected this order: ' + '; '.join(
                        f"{field}: {', '.join(str(v) for v in values) if isinstance(values, list) else str(values)}"
                        for field, values in errors.items())[:500]
            except Exception: pass
        log.exception("Affiliate order %s %s", oid, "was rejected" if rejected else "requires reconciliation")
        with db.SessionLocal() as session:
            row = session.get(SellerOrder, oid)
            row.state = 'rejected' if rejected else "needs_review"
            if rejected:
                snap = json.loads(row.snapshot)
                row.snapshot = json.dumps({**snap, 'submission_error': reason})
            session.commit()
        if rejected: raise HTTPException(422, reason)
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


def payout_view(row, details=None):
    return {"id": row.id, "currency": row.currency, "amount": row.amount_cents / 100, "status": row.status,
            "destination": row.destination, "method": details.method if details else "legacy",
            "bank": details.bank if details else None, "rib": details.rib if details else None,
            "reference": row.reference, "created_at": row.created_at.isoformat()}


def dashboard(seller_id):
    with db.SessionLocal() as session:
        fees = {terms.order_id: terms.delivery_fee_cents for terms in session.query(OrderTerms).join(SellerOrder, SellerOrder.id == OrderTerms.order_id).filter(SellerOrder.seller_id == seller_id).all()}
        orders = [order_view(row, fees.get(row.id, 0)) for row in session.query(SellerOrder).filter_by(seller_id=seller_id).order_by(SellerOrder.created_at.desc()).all()]
        methods = {method.payout_id: method for method in session.query(PayoutMethod).join(Payout, Payout.id == PayoutMethod.payout_id).filter(Payout.seller_id == seller_id).all()}
        payouts = [payout_view(row, methods.get(row.id)) for row in session.query(Payout).filter_by(seller_id=seller_id).order_by(Payout.created_at.desc()).all()]
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
    destination: str | None = Field(default=None, min_length=5, max_length=500)
    method: Literal["bank", "cash"] | None = None
    account_id: str | None = Field(default=None, max_length=64)


class BankAccountInput(BaseModel):
    bank: Literal["cih", "attijari"]
    rib: str = Field(min_length=24, max_length=60)


class BankAccountsInput(BaseModel):
    accounts: list[BankAccountInput] = Field(max_length=2)


def bank_accounts_view(session, sid):
    return [{"id": row.id, "bank": row.bank, "rib": row.rib} for row in session.query(BankAccount).filter_by(seller_id=sid).order_by(BankAccount.bank).all()]


@router.get("/bank-accounts")
def get_bank_accounts(seller=Depends(active_seller)):
    with db.SessionLocal() as session:
        return {"data": bank_accounts_view(session, seller["id"])}


@router.put("/bank-accounts")
def save_bank_accounts(body: BankAccountsInput, seller=Depends(active_seller)):
    accounts = {}
    for account in body.accounts:
        rib = re.sub(r"[\s-]", "", account.rib)
        if not re.fullmatch(r"[0-9]{24}", rib):
            raise HTTPException(422, "RIB must contain exactly 24 digits")
        if account.bank in accounts:
            raise HTTPException(422, "Save only one account per bank")
        accounts[account.bank] = rib
    with db.SessionLocal() as session:
        if lock_seller(session, seller["id"]).status != "approved":
            raise HTTPException(403, "Seller account is not approved")
        existing = {row.bank: row for row in session.query(BankAccount).filter_by(seller_id=seller["id"]).all()}
        for bank, row in existing.items():
            if bank not in accounts:
                session.delete(row)
        for bank, rib in accounts.items():
            if bank in existing:
                existing[bank].rib = rib
            else:
                session.add(BankAccount(id=uuid4().hex, seller_id=seller["id"], bank=bank, rib=rib))
        session.commit()
        return {"data": bank_accounts_view(session, seller["id"])}


def lock_seller(session, sid):
    # An UPDATE provides a DB transaction lock on both SQLite and PostgreSQL.
    session.execute(update(Seller).where(Seller.id == sid).values(reviewed_by=Seller.reviewed_by))
    row = session.get(Seller, sid)
    if not row:
        raise HTTPException(404, "Seller not found")
    return row


def balance(session, sid, currency, excluding=None):
    fees = {terms.order_id: terms.delivery_fee_cents for terms in session.query(OrderTerms).join(SellerOrder, SellerOrder.id == OrderTerms.order_id).filter(SellerOrder.seller_id == sid).all()}
    earned = sum(cents(order_view(o, fees.get(o.id, 0))["profit"]) for o in session.query(SellerOrder).filter_by(seller_id=sid, currency=currency).all())
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
        account = None
        if body.method == "bank":
            account = session.get(BankAccount, body.account_id) if body.account_id else None
            if not account or account.seller_id != seller["id"]:
                raise HTTPException(422, "Choose a saved bank account belonging to you")
            destination = ("CIH" if account.bank == "cih" else "Attijariwafa bank") + " · " + account.rib
        elif body.method == "cash":
            destination = "Cash"
        elif body.destination and body.destination.strip():
            destination = body.destination.strip()
        else:
            raise HTTPException(422, "Choose bank transfer or cash")
        row = Payout(id=uuid4().hex, seller_id=seller["id"], currency=body.currency, amount_cents=amount, destination=destination)
        session.add(row)
        details = PayoutMethod(payout_id=row.id, method=body.method or "legacy", bank=account.bank if account else None, rib=account.rib if account else None)
        session.add(details)
        session.commit()
        return {"data": payout_view(row, details)}


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


def collection_index(store):
    result = []
    for resource in ("custom_collections", "smart_collections"):
        for row in paginate(read_shopify, store, resource, {"fields": "id,title"}):
            result.append({"store": store, "id": str(row["id"]), "title": row["title"]})
    return result


class CollectionPriceRule(BaseModel):
    store: str = Field(min_length=1, max_length=63)
    collection_id: str = Field(pattern=r"^\d+$")
    discount_percent: Decimal = Field(ge=0, le=100, max_digits=5, decimal_places=2)


class PricingUpdate(BaseModel):
    discount_percent: Decimal = Field(ge=0, le=100, max_digits=5, decimal_places=2)
    rules: list[CollectionPriceRule] = Field(default_factory=list, max_length=50)
    delivery_fees: dict[str, Decimal] = Field(default_factory=lambda: {"MAD": Decimal(33)})


@router.get("/admin/pricing")
def get_pricing(admin=Depends(require_admin)):
    collections, warnings = [], []
    for connection in connected_stores():
        try:
            collections.extend(collection_index(connection["label"]))
        except Exception:
            warnings.append(f"Could not load collections for {connection['label']}.")
    return {"data": {"settings": pricing_settings(), "collections": collections, "warnings": warnings}}


@router.put("/admin/pricing")
def set_pricing(body: PricingUpdate, admin=Depends(require_admin)):
    if not body.delivery_fees or any(currency not in {"MAD", "USD", "EUR", "GBP", "CAD", "AED", "SAR"}
            or not fee.is_finite() or fee < 0 or fee > 100000 or fee.as_tuple().exponent < -2
            for currency, fee in body.delivery_fees.items()):
        raise HTTPException(422, "Set non-negative delivery fees with at most two decimal places")
    valid_stores = {s["label"] for s in connected_stores()}
    if any(rule.store not in valid_stores for rule in body.rules):
        raise HTTPException(422, "Collection rules require a connected store")
    if len({(r.store, r.collection_id) for r in body.rules}) != len(body.rules):
        raise HTTPException(422, "Use one rule per collection")
    for store in {r.store for r in body.rules}:
        try:
            ids = {collection["id"] for collection in collection_index(store)}
        except Exception:
            log.exception("Affiliate pricing collections could not be verified")
            raise HTTPException(502, "Collections could not be verified. Refresh and try again.")
        if any(r.collection_id not in ids for r in body.rules if r.store == store):
            raise HTTPException(422, "Collection does not belong to the selected store")
    settings = body.model_dump(mode="json")
    settings["updated_by"] = admin.get("sub")
    db.set_app_setting(None, "affiliate_marketplace_pricing", settings)
    return {"data": {"settings": settings}}


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
    raise HTTPException(409, "Product costs now use percentage pricing. Update Marketplace pricing rules instead.")


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
            return {"data": payout_view(row, session.get(PayoutMethod, row.id))}
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
        return {"data": payout_view(row, session.get(PayoutMethod, row.id))}



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
        current_tags = {f"aff_s:{row.seller_id}", f"aff_o:{row.id}"}
        legacy_tags = {f"affiliate_seller:{row.seller_id}", f"affiliate_request:{row.request_id}"}
        if not (current_tags.issubset(tags) or legacy_tags.issubset(tags)):
            raise HTTPException(422, "Shopify order does not match this seller submission")
        row.snapshot, row.shopify_id, row.state, row.synced_at = json.dumps(snapshot), body.shopify_id, "created", datetime.utcnow()
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Shopify order is already linked")
        return {"data": order_view(row)}
