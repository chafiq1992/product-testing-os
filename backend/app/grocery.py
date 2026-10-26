"""Local grocery storage: Decimal money, integer grams, atomic replayable checkout."""
import base64
import hashlib
import hmac
import io
import json
import re
import secrets
import time
import warnings
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field, StrictInt, field_validator, model_validator
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, select, update, text
from app import db

router = APIRouter(prefix="/api/wholesale/vendors/{vendor_id}/grocery", tags=["grocery"])
CENT = Decimal("0.01")


class GroceryAccount(db.Base):
    __tablename__ = "grocery_local_accounts"
    id = Column(String(36), primary_key=True)
    vendor_id = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GrocerySection(db.Base):
    __tablename__ = "grocery_local_sections"
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), primary_key=True)
    section = Column(String(8), primary_key=True)
    next_number = Column(Integer, nullable=False, default=1)


class GroceryProduct(db.Base):
    __tablename__ = "grocery_local_products"
    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), nullable=False, index=True)
    barcode = Column(String(80), nullable=True)
    short_code = Column(String(24), nullable=False)
    section = Column(String(8), nullable=False)
    name = Column(String(255), nullable=False)
    price = Column(Numeric(14, 2), nullable=False)
    cost_price = Column(Numeric(14, 2), nullable=True)
    unit_type = Column(String(8), nullable=False)
    stock = Column(Integer, nullable=False, default=0)
    stock_grams = Column(Integer, nullable=False, default=0)
    pack_count = Column(Integer, nullable=True)
    pack_weight_kg = Column(Numeric(14, 3), nullable=True)
    image_url = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("account_id", "barcode", name="uq_grocery_local_barcode"),
        UniqueConstraint("account_id", "short_code", name="uq_grocery_local_short_code"),
        CheckConstraint("stock >= 0 AND stock_grams >= 0", name="ck_grocery_local_stock"))


class GroceryCustomer(db.Base):
    __tablename__ = "grocery_local_customers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), nullable=False, index=True)
    identity_key = Column(String(300), nullable=False)
    name = Column(String(255), nullable=False)
    phone = Column(String(40), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("account_id", "identity_key", name="uq_grocery_local_customer"),)


class GroceryAlias(db.Base):
    __tablename__ = "grocery_local_aliases"
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), primary_key=True)
    alias = Column(String(80), primary_key=True)
    product_id = Column(Integer, ForeignKey("grocery_local_products.id"), nullable=False)


class GroceryOrder(db.Base):
    __tablename__ = "grocery_local_orders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("grocery_local_customers.id"), nullable=True)
    customer_name = Column(String(255), nullable=False)
    customer_phone = Column(String(40), nullable=False)
    total_price = Column(Numeric(14, 2), nullable=False)
    amount_paid = Column(Numeric(14, 2), nullable=False)
    cash_tendered = Column(Numeric(14, 2), nullable=False)
    change = Column(Numeric(14, 2), nullable=False)
    payment_status = Column(String(20), nullable=False)
    payment_note = Column(Text, nullable=False, default="")
    order_status = Column(String(20), nullable=False, default="new")
    status_note = Column(Text, nullable=False, default="")
    cancel_reason = Column(String(40), nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GroceryOrderLine(db.Base):
    __tablename__ = "grocery_local_order_lines"
    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("grocery_local_orders.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("grocery_local_products.id"), nullable=False)
    name = Column(String(255), nullable=False)
    short_code = Column(String(24), nullable=False)
    barcode = Column(String(80), nullable=True)
    unit_type = Column(String(8), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    grams = Column(Integer, nullable=False, default=0)
    price = Column(Numeric(14, 2), nullable=False)
    line_total = Column(Numeric(14, 2), nullable=False)


class GroceryOperation(db.Base):
    __tablename__ = "grocery_local_operations"
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), primary_key=True)
    request_id = Column(String(36), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    response = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GroceryImage(db.Base):
    __tablename__ = "grocery_local_images"
    path = Column(String(255), primary_key=True)
    account_id = Column(String(36), ForeignKey("grocery_local_accounts.id"), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


TABLES = [GroceryAccount.__table__, GrocerySection.__table__, GroceryProduct.__table__, GroceryCustomer.__table__,
    GroceryAlias.__table__, GroceryOrder.__table__, GroceryOrderLine.__table__, GroceryOperation.__table__, GroceryImage.__table__]
db.Base.metadata.create_all(db.engine, tables=TABLES)


def fail(code, status=409, **extra):
    raise HTTPException(status, {"error": code, **extra})


def is_grocery(vendor):
    return isinstance(vendor, dict) and vendor.get("account_type") == "grocery"


def _scope(vendor):
    try:
        return str(UUID(str(vendor.get("account_id"))))
    except (ValueError, TypeError, AttributeError):
        fail("account_setup_required", message="Sign in again to initialize this grocery account.")


def _vendor(vendor_id):
    from app.main import WHOLESALE_STORE, _wholesale_vendor_key
    vid = str(vendor_id).strip().lower()
    vendor = db.get_app_setting(WHOLESALE_STORE, _wholesale_vendor_key(vid))
    if not is_grocery(vendor):
        fail("grocery_only", 403)
    _scope(vendor)
    return vid, vendor


def issue_token(vendor):
    body = base64.urlsafe_b64encode(json.dumps({"v": vendor["id"], "a": _scope(vendor),
        "exp": int(time.time()) + 7 * 86400, "nonce": secrets.token_hex(12)}, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(vendor["password_hash"].encode(), ("grocery:" + body).encode(), hashlib.sha256).hexdigest()
    return body + "." + signature


def authorize(vendor_id, authorization):
    vid, vendor = _vendor(vendor_id)
    try:
        scheme, token = str(authorization or "").split(" ", 1)
        body, signature = token.split(".", 1)
        expected = hmac.new(vendor["password_hash"].encode(), ("grocery:" + body).encode(), hashlib.sha256).hexdigest()
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        valid = scheme.lower() == "bearer" and hmac.compare_digest(signature, expected)
        if not (valid and payload["v"] == vid and payload["a"] == _scope(vendor) and payload["exp"] > time.time()):
            raise ValueError()
    except Exception:
        fail("invalid_session", 401)
    return vid, vendor


def canonical_short_code(value):
    match = re.fullmatch(r"\s*([A-Za-z]{1,8})\s*-?\s*(\d{1,10})\s*", str(value or ""))
    if not match:
        raise ValueError("Invalid short code")
    return f"{match[1].upper()}-{int(match[2]):02d}"


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


def _money(value):
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _alias(value):
    try:
        return canonical_short_code(value)
    except ValueError:
        return canonical_barcode(value)


class ProductInput(BaseModel):
    request_id: UUID
    barcode: str | None = None
    name: str = Field(min_length=1, max_length=255)
    price: Decimal = Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    stock: StrictInt | None = Field(default=None, ge=0, le=10000000)
    stock_grams: StrictInt | None = Field(default=None, ge=0, le=2000000000)
    cost_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    unit_type: Literal["unit", "weight"] = "unit"
    section: str | None = None
    pack_count: StrictInt | None = Field(default=None, ge=1, le=1000000)
    pack_weight_kg: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3, allow_inf_nan=False)
    image_url: str | None = Field(default=None, max_length=255)

    @field_validator("barcode")
    @classmethod
    def barcode_value(cls, value):
        return canonical_barcode(value) if value and value.strip() else None

    @field_validator("name")
    @classmethod
    def name_value(cls, value):
        if not value.strip():
            raise ValueError("Product name is required")
        return value.strip()

    @field_validator("section")
    @classmethod
    def section_value(cls, value):
        if value is None or not value.strip():
            return None
        if not re.fullmatch(r"[A-Za-z]{1,8}", value.strip()):
            raise ValueError("Use a section letter such as L")
        return value.strip().upper()

    @model_validator(mode="after")
    def valid_weight(self):
        if (self.pack_count is None) != (self.pack_weight_kg is None):
            raise ValueError("Provide both pack count and weight per pack")
        if self.unit_type == "unit" and (self.stock_grams is not None or self.pack_count is not None):
            raise ValueError("Unit products use unit stock")
        if self.unit_type == "weight" and self.stock not in (None, 0):
            raise ValueError("Weight products use grams or pack weights")
        if self.stock_grams is not None and self.pack_count is not None:
            raise ValueError("Use absolute grams or pack replenishment, not both")
        if self.pack_count is not None and self.pack_count*self.pack_weight_kg*1000 > 2000000000:
            raise ValueError("Weight is too large")
        return self


class OrderLine(BaseModel):
    variant_id: StrictInt | None = Field(default=None, gt=0)
    product_id: StrictInt | None = Field(default=None, gt=0)
    quantity: StrictInt | None = Field(default=None, gt=0, le=10000000)
    grams: StrictInt | None = Field(default=None, gt=0, le=2000000000)

    @model_validator(mode="after")
    def identity(self):
        if not (self.variant_id or self.product_id) or (self.variant_id and self.product_id and self.variant_id != self.product_id):
            raise ValueError("Supply one matching product identity")
        if self.quantity is not None and self.grams is not None:
            raise ValueError("Use units or grams")
        return self


class OrderInput(BaseModel):
    request_id: UUID
    line_items: list[OrderLine] = Field(min_length=1, max_length=500)
    customer_name: str = Field(default="", max_length=255)
    customer_phone: str = Field(default="", max_length=40)
    amount_paid: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    payment_status: Literal["paid", "unpaid"] = "paid"


@contextmanager
def _transaction(vid, vendor):
    """Account row locks serialize short writes; no external calls inside."""
    scope = _scope(vendor)
    with db.SessionLocal() as session:
        try:
            if session.get_bind().dialect.name == "sqlite":
                session.execute(text("BEGIN IMMEDIATE"))
                from sqlalchemy.dialects.sqlite import insert
            else:
                from sqlalchemy.dialects.postgresql import insert
            session.execute(insert(GroceryAccount).values(id=scope, vendor_id=vid).on_conflict_do_nothing(index_elements=["id"]))
            session.execute(select(GroceryAccount).where(GroceryAccount.id == scope).with_for_update()).scalar_one()
            yield session, scope
            session.commit()
        except BaseException:
            session.rollback()
            raise


def _replay(session, scope, kind, req):
    fingerprint = hashlib.sha256((kind + req.model_dump_json()).encode()).hexdigest()
    row = session.get(GroceryOperation, (scope, str(req.request_id)))
    if row:
        if row.fingerprint != fingerprint:
            fail("request_conflict")
        return fingerprint, json.loads(row.response)
    return fingerprint, None


def _receipt(session, scope, req, fingerprint, response):
    session.add(GroceryOperation(account_id=scope, request_id=str(req.request_id), fingerprint=fingerprint,
        response=json.dumps(response, default=str)))
    return response


def _product_view(product):
    weight = product.unit_type == "weight"
    available = float(Decimal(product.stock_grams)/1000) if weight else product.stock
    variant = {"id": product.id, "product_id": product.id, "title": "Kilogram" if weight else "Unit",
        "sku": product.barcode or product.short_code, "barcode": product.barcode or "", "short_code": product.short_code,
        "price": str(_money(product.price)), "inventory_quantity": available, "inventory_available": available,
        "inventory_on_hand": available, "stock_grams": product.stock_grams, "unit_type": product.unit_type,
        "unit": "kg" if weight else "unit", "inventory_management": "local", "inventory_policy": "deny"}
    return {"id": product.id, "title": product.name, "name": product.name, "barcode": product.barcode,
        "short_code": product.short_code, "section": product.section, "unit_type": product.unit_type,
        "price": str(_money(product.price)), "price_unit": "kg" if weight else "unit",
        "cost_price": str(_money(product.cost_price)) if product.cost_price is not None else None,
        "stock": product.stock, "stock_grams": product.stock_grams, "pack_count": product.pack_count,
        "pack_weight_kg": str(product.pack_weight_kg) if product.pack_weight_kg is not None else None,
        "image_url": product.image_url, "images": [{"src": product.image_url}] if product.image_url else [],
        "image": {"src": product.image_url} if product.image_url else None, "variants": [variant],
        "created_at": product.created_at.isoformat()+"Z", "updated_at": product.updated_at.isoformat()+"Z"}


def _products(vid, vendor):
    with db.SessionLocal() as session:
        rows = session.scalars(select(GroceryProduct).where(GroceryProduct.account_id == _scope(vendor)).order_by(GroceryProduct.id.desc())).all()
        return [_product_view(row) for row in rows]


def list_products(vendor_id):
    return {"data": _products(*_vendor(vendor_id))}


@router.get("/products")
def products(vendor_id: str, search: str = "", authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    result = _products(vid, vendor)
    if search.strip():
        term = search.strip().lower()
        try:
            normalized = canonical_short_code(term).lower()
        except ValueError:
            normalized = term
        result = [p for p in result if term in p["name"].lower() or normalized in p["short_code"].lower() or term in str(p["barcode"] or "").lower()]
    return {"data": result}


def _owned_product(session, scope, product_id):
    if isinstance(product_id, bool) or not str(product_id).isdigit():
        fail("product_not_found", 404)
    row = session.scalar(select(GroceryProduct).where(GroceryProduct.account_id == scope, GroceryProduct.id == int(product_id)).with_for_update())
    if row is None:
        fail("product_not_found", 404)
    return row


def _image_owned(session, scope, path):
    if path and not session.scalar(select(GroceryImage).where(GroceryImage.account_id == scope, GroceryImage.path == path)):
        fail("image_not_found", 422)


def _next_code(session, scope, section):
    counter = session.get(GrocerySection, (scope, section))
    if counter is None:
        counter = GrocerySection(account_id=scope, section=section, next_number=1)
        session.add(counter)
    while True:
        code = f"{section}-{counter.next_number:02d}"
        counter.next_number += 1
        if session.get(GroceryAlias, (scope, code)) is None:
            return code


def _apply_product(product, req, creating=False):
    if not creating and product.unit_type != req.unit_type:
        fail("unit_type_change_not_allowed", 422)
    product.name, product.price, product.unit_type = req.name, req.price, req.unit_type
    if req.cost_price is not None:
        product.cost_price = req.cost_price
    if "image_url" in req.model_fields_set:
        product.image_url = req.image_url or None
    if req.unit_type == "weight":
        if req.stock_grams is not None:
            product.stock_grams = req.stock_grams
        elif req.pack_count is not None:
            grams = int(req.pack_count*req.pack_weight_kg*1000)
            product.stock_grams = grams if creating else product.stock_grams+grams
            if product.stock_grams > 2000000000:
                fail("stock_too_large", 422)
            product.pack_count, product.pack_weight_kg = req.pack_count, req.pack_weight_kg
        elif creating:
            product.stock_grams = 0
        product.stock = 0
    else:
        if req.stock is not None:
            product.stock = req.stock
        elif creating:
            product.stock = 0
        product.stock_grams = 0
    product.updated_at = datetime.utcnow()


@router.post("/products")
def create_product(vendor_id: str, req: ProductInput, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    with _transaction(vid, vendor) as (session, scope):
        fingerprint, prior = _replay(session, scope, "product:create", req)
        if prior is not None:
            return prior
        if req.barcode:
            alias = session.get(GroceryAlias, (scope, _alias(req.barcode)))
            if alias:
                existing = _owned_product(session, scope, alias.product_id)
                if not existing.barcode or _alias(existing.barcode) != _alias(req.barcode):
                    fail("alias_conflict", message="This barcode matches another product's short code.")
                return _receipt(session, scope, req, fingerprint, {"data": _product_view(existing), "existing": True})
        if not req.barcode and not req.section:
            fail("section_required", 422)
        _image_owned(session, scope, req.image_url)
        section = req.section or "G"
        row = GroceryProduct(account_id=scope, barcode=req.barcode, short_code=_next_code(session, scope, section), section=section, stock=0, stock_grams=0)
        _apply_product(row, req, True)
        session.add(row)
        session.flush()
        aliases = {row.short_code}
        if row.barcode:
            aliases.add(_alias(row.barcode))
        for alias in aliases:
            session.add(GroceryAlias(account_id=scope, alias=alias, product_id=row.id))
        return _receipt(session, scope, req, fingerprint, {"data": _product_view(row)})


def _phone(value):
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("212") and len(digits) == 12:
        digits = "0"+digits[3:]
    if len(digits) == 9 and digits[0] in "567":
        digits = "0"+digits
    return digits


def _line_view(line):
    weight = line.unit_type == "weight"
    return {"product_id": line.product_id, "variant_id": line.product_id, "title": line.name,
        "variant_title": line.short_code, "sku": line.barcode or line.short_code, "short_code": line.short_code,
        "unit_type": line.unit_type, "unit": "kg" if weight else "unit", "grams": line.grams,
        "quantity": float(Decimal(line.grams)/1000) if weight else line.quantity,
        "price": str(_money(line.price)), "line_total": str(_money(line.line_total))}


def _order_view(session, order):
    lines = session.scalars(select(GroceryOrderLine).where(GroceryOrderLine.account_id == order.account_id, GroceryOrderLine.order_id == order.id).order_by(GroceryOrderLine.id)).all()
    cancelled = order.cancelled_at is not None
    return {"id": order.id, "name": f"#G{order.id}", "order_number": order.id,
        "total_price": str(_money(order.total_price)), "amount_paid": str(_money(order.amount_paid)),
        "cash_tendered": str(_money(order.cash_tendered)), "change": str(_money(order.change)),
        "payment_status": "cancelled" if cancelled else order.payment_status,
        "financial_status": "paid" if order.payment_status == "paid" else "partially_paid" if order.payment_status == "partially_paid" else "pending",
        "payment_note": order.payment_note, "order_status": order.order_status, "order_status_note": order.status_note,
        "order_status_updated_at": order.updated_at.isoformat()+"Z", "fulfillment_warning": "",
        "fulfillment_status": "fulfilled" if order.order_status == "fulfilled" else None,
        "cancelled_at": order.cancelled_at.isoformat()+"Z" if cancelled else None, "is_cancelled": cancelled,
        "cancel_reason": order.cancel_reason, "customer_id": order.customer_id, "customer_name": order.customer_name,
        "customer_phone": order.customer_phone, "customer_phone_normalized": _phone(order.customer_phone),
        "customer_address1": "", "customer_city": "", "customer_province": "", "customer_zip": "", "customer_country": "MA",
        "items_count": len(lines), "units": sum(line.quantity for line in lines), "weight_grams": sum(line.grams for line in lines),
        "line_items": [_line_view(line) for line in lines], "created_at": order.created_at.isoformat()+"Z", "tags": "grocery,local"}


@router.post("/orders")
def create_order(vendor_id: str, req: OrderInput, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    with _transaction(vid, vendor) as (session, scope):
        fingerprint, prior = _replay(session, scope, "order:create", req)
        if prior is not None:
            return prior
        name, phone = req.customer_name.strip(), req.customer_phone.strip()
        if req.payment_status == "unpaid" and not (name and _phone(phone)):
            fail("unpaid_customer_required", 422)
        requested = {}
        for item in req.line_items:
            pid = item.product_id or item.variant_id
            rec = requested.setdefault(pid, {"quantity": 0, "grams": 0})
            rec["quantity"] += item.quantity or 0
            rec["grams"] += item.grams or 0
        prepared, total = [], Decimal("0.00")
        for pid in sorted(requested):
            row = _owned_product(session, scope, pid)
            amount = requested[pid]
            if row.unit_type == "weight":
                if amount["grams"] <= 0 or amount["quantity"]:
                    fail("grams_required", 422)
                count, available, field = amount["grams"], row.stock_grams, GroceryProduct.stock_grams
                line_total = _money(row.price*Decimal(count)/1000)
            else:
                if amount["quantity"] <= 0 or amount["grams"]:
                    fail("quantity_required", 422)
                count, available, field = amount["quantity"], row.stock, GroceryProduct.stock
                line_total = _money(row.price*count)
            if line_total > Decimal("999999999999.99"):
                fail("order_total_too_large", 422)
            if count > available:
                fail("insufficient_inventory", details=[{"variant_id": pid, "available": available, "requested": count, "unit_type": row.unit_type}])
            changed = session.execute(update(GroceryProduct).where(GroceryProduct.account_id == scope, GroceryProduct.id == pid, field >= count).values({field: field-count, GroceryProduct.updated_at: datetime.utcnow()}))
            if changed.rowcount != 1:
                fail("insufficient_inventory")
            prepared.append((row, amount, line_total))
            total += line_total
        total = _money(total)
        if total > Decimal("999999999999.99"):
            fail("order_total_too_large", 422)
        paid = req.payment_status == "paid"
        tendered = req.amount_paid if req.amount_paid is not None else total if paid else Decimal("0.00")
        if paid and tendered < total:
            fail("insufficient_payment", 422, total_price=str(total))
        if not paid and tendered != 0:
            fail("unpaid_amount_must_be_zero", 422)
        customer = None
        if name or phone:
            key = _phone(phone) or "name:"+name.casefold()
            customer = session.scalar(select(GroceryCustomer).where(GroceryCustomer.account_id == scope, GroceryCustomer.identity_key == key))
            if customer is None:
                customer = GroceryCustomer(account_id=scope, identity_key=key, name=name or "Customer", phone=phone)
                session.add(customer)
                session.flush()
            elif name:
                customer.name, customer.phone = name, phone or customer.phone
        order = GroceryOrder(account_id=scope, customer_id=customer.id if customer else None,
            customer_name=name or "Walk-in", customer_phone=phone, total_price=total,
            amount_paid=total if paid else Decimal("0.00"), cash_tendered=tendered,
            change=_money(tendered-total) if paid else Decimal("0.00"), payment_status=req.payment_status,
            payment_note="", order_status="new", status_note="")
        session.add(order)
        session.flush()
        for row, amount, line_total in prepared:
            session.add(GroceryOrderLine(account_id=scope, order_id=order.id, product_id=row.id,
                name=row.name, short_code=row.short_code, barcode=row.barcode, unit_type=row.unit_type,
                quantity=amount["quantity"], grams=amount["grams"], price=row.price, line_total=line_total))
        session.flush()
        changed_products = [_product_view(row) for row, _, _ in prepared]
        response = {"data": _order_view(session, order), "products": changed_products,
            "inventory_updates": [{"product_id": p["id"], "stock": p["stock"], "stock_grams": p["stock_grams"], "inventory_quantity": p["variants"][0]["inventory_quantity"]} for p in changed_products]}
        return _receipt(session, scope, req, fingerprint, response)


def _orders(session, scope):
    rows = session.scalars(select(GroceryOrder).where(GroceryOrder.account_id == scope).order_by(GroceryOrder.created_at.desc(), GroceryOrder.id.desc())).all()
    return [_order_view(session, row) for row in rows]


def _orders_stats(orders):
    active = [o for o in orders if not o["is_cancelled"]]
    return {"total_orders": len(orders), "total_units_sold": sum(o["units"] for o in active),
        "total_weight_grams": sum(o["weight_grams"] for o in active),
        "total_revenue": str(_money(sum((Decimal(o["total_price"]) for o in active), Decimal(0)))),
        "recent_orders": orders[:10], "all_orders": orders}


def list_orders(vendor_id):
    _, vendor = _vendor(vendor_id)
    with db.SessionLocal() as session:
        return {"data": _orders_stats(_orders(session, _scope(vendor)))}


def _customer_ledger(orders):
    records = {}
    for order in orders:
        if order["is_cancelled"]:
            continue
        key = str(order["customer_id"]) if order["customer_id"] else "walk-in"
        rec = records.setdefault(key, {"id": order["customer_id"], "key": key,
            "customer_name": order["customer_name"], "customer_phone": order["customer_phone"],
            "customer_phone_normalized": order["customer_phone_normalized"], "customer_address1": "",
            "customer_city": "", "customer_province": "", "customer_zip": "", "customer_country": "MA",
            "orders_count": 0, "total_unpaid": Decimal(0), "total_paid": Decimal(0), "total_orders_value": Decimal(0), "orders": []})
        total, paid = Decimal(order["total_price"]), Decimal(order["amount_paid"])
        rec["orders_count"] += 1
        rec["total_unpaid"] += total-paid
        rec["total_paid"] += paid
        rec["total_orders_value"] += total
        rec["orders"].append({"id": order["id"], "name": order["name"], "created_at": order["created_at"],
            "total_price": str(total), "amount_paid": str(paid), "pending_amount": str(_money(total-paid)), "payment_status": order["payment_status"]})
    customers = list(records.values())
    customers.sort(key=lambda c: (-c["total_unpaid"], -c["orders_count"]))
    total_unpaid = sum((c["total_unpaid"] for c in customers), Decimal(0))
    for customer in customers:
        for field in ("total_unpaid", "total_paid", "total_orders_value"):
            customer[field] = str(_money(customer[field]))
    return {"total_customers": len(customers), "total_unpaid": str(_money(total_unpaid)), "customers": customers}


def list_customers(vendor_id):
    _, vendor = _vendor(vendor_id)
    with db.SessionLocal() as session:
        return {"data": _customer_ledger(_orders(session, _scope(vendor)))}


@router.get("/workspace")
def workspace(vendor_id: str, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    with db.SessionLocal() as session:
        orders = _orders(session, _scope(vendor))
        return {"data": {"products": _products(vid, vendor), "orders_stats": _orders_stats(orders), "customers": _customer_ledger(orders)}}


def _owned_order(session, scope, order_id):
    if isinstance(order_id, bool) or not str(order_id).isdigit():
        fail("order_not_found", 404)
    order = session.scalar(select(GroceryOrder).where(GroceryOrder.account_id == scope, GroceryOrder.id == int(order_id)).with_for_update())
    if order is None:
        fail("order_not_found", 404)
    return order


def _payload(req):
    return req.model_dump() if isinstance(req, BaseModel) else req or {}


def cancel_order(vendor_id, order_id, req=None):
    vid, vendor = _vendor(vendor_id)
    with _transaction(vid, vendor) as (session, scope):
        order = _owned_order(session, scope, order_id)
        if order.cancelled_at:
            return {"data": {**_order_view(session, order), "already_cancelled": True}}
        lines = session.scalars(select(GroceryOrderLine).where(GroceryOrderLine.account_id == scope, GroceryOrderLine.order_id == order.id).order_by(GroceryOrderLine.product_id)).all()
        for line in lines:
            row = _owned_product(session, scope, line.product_id)
            row.stock += line.quantity
            row.stock_grams += line.grams
            row.updated_at = datetime.utcnow()
        order.cancelled_at, order.updated_at = datetime.utcnow(), datetime.utcnow()
        order.cancel_reason = str(_payload(req).get("reason") or "customer")[:40]
        session.flush()
        return {"data": _order_view(session, order)}


def update_status(vendor_id, order_id, req):
    values = _payload(req)
    status = values.get("order_status")
    if status not in {"new", "processing", "fulfilled"}:
        fail("invalid_status", 422)
    vid, vendor = _vendor(vendor_id)
    with _transaction(vid, vendor) as (session, scope):
        order = _owned_order(session, scope, order_id)
        if order.cancelled_at:
            fail("order_cancelled")
        order.order_status, order.status_note = status, str(values.get("note") or "")[:2000]
        order.updated_at = datetime.utcnow()
        return {"data": {"order_status": status, "note": order.status_note, "updated_at": order.updated_at.isoformat()+"Z", "fulfillment_warning": ""}}


def update_payment(vendor_id, order_id, req):
    values = _payload(req)
    try:
        amount = Decimal(str(values.get("amount_paid", 0)))
        if not amount.is_finite() or amount < 0 or amount != _money(amount):
            raise ValueError()
    except Exception:
        fail("invalid_payment", 422)
    vid, vendor = _vendor(vendor_id)
    with _transaction(vid, vendor) as (session, scope):
        order = _owned_order(session, scope, order_id)
        if order.cancelled_at:
            fail("order_cancelled")
        if amount > order.total_price:
            fail("invalid_payment", 422)
        expected = "paid" if amount == order.total_price else "unpaid" if amount == 0 else "partially_paid"
        if values.get("payment_status", expected) != expected:
            fail("payment_status_mismatch", 422)
        order.amount_paid, order.payment_status = amount, expected
        order.payment_note, order.updated_at = str(values.get("payment_note") or "")[:2000], datetime.utcnow()
        return {"data": {"payment_status": expected, "amount_paid": str(_money(amount)), "payment_note": order.payment_note, "updated_at": order.updated_at.isoformat()+"Z"}}


def update_inventory(vendor_id, product_id, variant_id, quantity):
    if str(product_id) != str(variant_id):
        fail("product_not_found", 404)
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
        fail("invalid_quantity", 422)
    vid, vendor = _vendor(vendor_id)
    with _transaction(vid, vendor) as (session, scope):
        row = _owned_product(session, scope, product_id)
        if row.unit_type != "unit":
            fail("grams_required", 422)
        row.stock, row.updated_at = quantity, datetime.utcnow()
        return {"data": {"product_id": row.id, "variant_id": row.id, "available": quantity, "on_hand": quantity}}


@router.post("/images")
async def upload_image(vendor_id: str, image: UploadFile = File(...), authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    limit = 8*1024*1024
    data = await image.read(limit+1)
    if not data or len(data) > limit:
        fail("image_too_large", 413, message="Upload an image up to 8 MB.")
    types = {"image/jpeg": ("JPEG", ".jpg"), "image/png": ("PNG", ".png"), "image/webp": ("WEBP", ".webp")}
    expected = types.get(str(image.content_type or "").lower())
    if expected is None:
        fail("invalid_image", 422)
    try:
        from PIL import Image
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as picture:
                if picture.format != expected[0] or picture.width*picture.height > 40000000 or max(picture.size) > 10000:
                    raise ValueError()
                picture.load()
    except Exception:
        fail("invalid_image", 422, message="Use a valid JPEG, PNG or WebP image.")
    from app.main import _upload_blob_key
    from app.storage import save_file
    filename = "grocery_"+uuid4().hex+expected[1]
    path = "/uploads/"+filename
    payload = {"filename": filename, "content_type": image.content_type,
               "data_b64": base64.b64encode(data).decode("ascii"), "created_at": datetime.utcnow().isoformat()+"Z"}
    with _transaction(vid, vendor) as (session, scope):
        session.add(GroceryImage(path=path, account_id=scope))
        key = _upload_blob_key(filename)
        session.add(db.AppSetting(pk=db._mk_setting_pk(None, key), store=None, key=key, value=json.dumps(payload)))
    # The database is durable and /uploads already reads its blob fallback.
    # Local disk only caches it; a restart or another instance remains safe.
    try:
        save_file(filename, data)
    except OSError:
        pass
    return {"data": {"url": path, "image_url": path}}


@router.patch("/products/{product_id}")
def update_product(vendor_id: str, product_id: str, req: ProductInput, authorization: str | None = Header(default=None)):
    vid, vendor = authorize(vendor_id, authorization)
    with _transaction(vid, vendor) as (session, scope):
        fingerprint, prior = _replay(session, scope, "product:update:"+str(product_id), req)
        if prior is not None:
            return prior
        row = _owned_product(session, scope, product_id)
        if "barcode" in req.model_fields_set and req.barcode != row.barcode:
            old_alias = _alias(row.barcode) if row.barcode else None
            new_alias = _alias(req.barcode) if req.barcode else None
            existing = session.get(GroceryAlias, (scope, new_alias)) if new_alias else None
            if existing and existing.product_id != row.id:
                fail("alias_conflict", message="Another product already uses this barcode or short code.")
            if old_alias and old_alias != row.short_code and old_alias != new_alias:
                previous = session.get(GroceryAlias, (scope, old_alias))
                if previous and previous.product_id == row.id:
                    session.delete(previous)
            if new_alias and existing is None:
                session.add(GroceryAlias(account_id=scope, alias=new_alias, product_id=row.id))
            row.barcode = req.barcode
        if req.section and req.section != row.section:
            fail("section_change_not_allowed", 422)
        _image_owned(session, scope, req.image_url)
        _apply_product(row, req)
        session.flush()
        return _receipt(session, scope, req, fingerprint, {"data": _product_view(row)})
