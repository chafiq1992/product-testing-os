"""Customer-owned sessions, merchant invitations and portal order ownership.

An invitation grants a new merchant link, never access to historical merchant
records merely because a phone number matches. Customer sessions are separate
from employee sessions and carry no merchant credentials.
"""
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, StrictInt, field_validator, model_validator
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, select
from sqlalchemy.exc import IntegrityError

from app import db

router = APIRouter(prefix="/api/customers", tags=["customer portal"])
CUSTOMER_COOKIE = "ptos_customer"
SESSION_DAYS = 7
_LOGIN_FAILS = {}
_LOGIN_LOCK = threading.Lock()
_PASSWORD_SLOTS = threading.BoundedSemaphore(4)


class CustomerAccount(db.Base):
    __tablename__ = "portal_customer_accounts"
    id = Column(String(36), primary_key=True)
    phone = Column(String(24), unique=True, nullable=False)
    name = Column(String(160), nullable=False)
    password_hash = Column(String(256), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class CustomerSession(db.Base):
    __tablename__ = "portal_customer_sessions"
    token_hash = Column(String(64), primary_key=True)
    customer_id = Column(String(36), ForeignKey("portal_customer_accounts.id"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)


class MerchantIdentity(db.Base):
    __tablename__ = "portal_merchant_identities"
    ref = Column(String(36), primary_key=True)
    kind = Column(String(8), nullable=False)
    account_id = Column(String(64), nullable=False)
    locator = Column(String(255), nullable=True)
    __table_args__ = (UniqueConstraint("kind", "account_id", name="uq_portal_merchant_lifetime"),)


class MerchantInvitation(db.Base):
    __tablename__ = "portal_merchant_invitations"
    id = Column(String(36), primary_key=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    merchant_ref = Column(String(36), ForeignKey("portal_merchant_identities.ref"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class CustomerMerchantLink(db.Base):
    __tablename__ = "portal_customer_merchant_links"
    id = Column(String(36), primary_key=True)
    customer_id = Column(String(36), ForeignKey("portal_customer_accounts.id"), nullable=False, index=True)
    merchant_ref = Column(String(36), ForeignKey("portal_merchant_identities.ref"), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("customer_id", "merchant_ref", name="uq_portal_customer_merchant"),)


class CustomerOrder(db.Base):
    __tablename__ = "portal_customer_orders"
    id = Column(String(36), primary_key=True)
    customer_id = Column(String(36), ForeignKey("portal_customer_accounts.id"), nullable=False, index=True)
    merchant_ref = Column(String(36), ForeignKey("portal_merchant_identities.ref"), nullable=False, index=True)
    request_id = Column(String(36), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    status = Column(String(24), nullable=False)
    external_id = Column(String(100), nullable=True)
    receipt = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("customer_id", "request_id", name="uq_portal_customer_order_request"),)


class CustomerPortalConfig(db.Base):
    __tablename__ = "portal_customer_config"
    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)


TABLES = [CustomerAccount.__table__, CustomerSession.__table__, MerchantIdentity.__table__,
    MerchantInvitation.__table__, CustomerMerchantLink.__table__, CustomerOrder.__table__, CustomerPortalConfig.__table__]
db.Base.metadata.create_all(db.engine, tables=TABLES)


def fail(code, status=400, **extra):
    raise HTTPException(status, {"error": code, **extra})


def normalize_phone(value):
    import re
    raw = str(value or "").strip()
    if not re.fullmatch(r"[+0-9() .-]{8,30}", raw):
        raise ValueError("Enter a valid phone number")
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("0") and digits[1] in "567":
        digits = "212"+digits[1:]
    elif len(digits) == 9 and digits[0] in "567":
        digits = "212"+digits
    if not 8 <= len(digits) <= 15 or digits.startswith("0"):
        raise ValueError("Enter a valid phone number")
    return "+"+digits


def _hash_password(password):
    salt = secrets.token_bytes(16)
    with _PASSWORD_SLOTS:
        digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return "scrypt$"+base64.b64encode(salt).decode()+"$"+base64.b64encode(digest).decode()


def _password_matches(password, encoded):
    try:
        algorithm, salt, digest = encoded.split("$")
        if algorithm != "scrypt":
            return False
        with _PASSWORD_SLOTS:
            candidate = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(candidate, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def _public_account(account):
    return {"id": account.id, "name": account.name, "phone": account.phone,
            "chat_id": "customer:"+account.id, "phone_verified": False}


def _token_hash(token):
    return hashlib.sha256(str(token).encode()).hexdigest()


def issue_session(session, customer_id):
    token = secrets.token_urlsafe(32)
    session.add(CustomerSession(token_hash=_token_hash(token), customer_id=customer_id,
                                expires_at=datetime.utcnow()+timedelta(days=SESSION_DAYS)))
    return token


def verify_session_token(token):
    if not token or len(str(token)) > 200:
        return None
    with db.SessionLocal() as session:
        auth = session.get(CustomerSession, _token_hash(token))
        account = session.get(CustomerAccount, auth.customer_id) if auth and auth.expires_at > datetime.utcnow() else None
        return {"sub": account.id, **_public_account(account)} if account and account.active else None


def _origin(request):
    from app import auth_gate
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not auth_gate._origin_ok(dict(request.headers)):
        fail("forbidden_origin", 403)


def require_customer(request: Request):
    _origin(request)
    principal = verify_session_token(request.cookies.get(CUSTOMER_COOKIE))
    if not principal:
        fail("customer_sign_in_required", 401)
    return principal


def _set_cookie(request, response, token):
    from app import auth_gate
    auth_gate.set_session_cookie(response, request, CUSTOMER_COOKIE, token, SESSION_DAYS*86400)


def _adapter():
    from app import customer_merchants
    return customer_merchants


def _merchant(identity):
    merchant = _adapter().resolve_merchant(identity.kind, identity.account_id, identity.locator)
    if not merchant:
        fail("merchant_unavailable", 404)
    return {**merchant, "ref": identity.ref, "merchant_ref": identity.ref}


def _public_merchant(merchant):
    return {"ref": merchant["ref"], "id": merchant["ref"], "merchant_ref": merchant["ref"],
            "name": str(merchant.get("name") or "Merchant"), "kind": merchant["kind"],
            "account_type": merchant.get("account_type") or merchant["kind"],
            "chat_id": merchant.get("chat_id") or "", "avatar": merchant.get("avatar") or "",
            "requires_delivery": bool(merchant.get("requires_delivery"))}


def ensure_merchant_ref(kind, account_id, locator=None):
    if kind not in {"vendor", "seller"}:
        fail("invalid_merchant", 422)
    resolved = _adapter().resolve_merchant(kind, str(account_id), locator)
    if not resolved:
        fail("merchant_unavailable", 404)
    with db.SessionLocal() as session:
        existing = session.scalar(select(MerchantIdentity).where(MerchantIdentity.kind == kind, MerchantIdentity.account_id == str(account_id)))
        if existing:
            return existing.ref
        row = MerchantIdentity(ref=str(uuid4()), kind=kind, account_id=str(account_id), locator=locator or resolved.get("locator") or resolved.get("vendor_id"))
        session.add(row)
        try:
            session.commit()
            return row.ref
        except IntegrityError:
            session.rollback()
            return session.scalar(select(MerchantIdentity.ref).where(MerchantIdentity.kind == kind, MerchantIdentity.account_id == str(account_id)))


def _invite_secret(session):
    row = session.get(CustomerPortalConfig, "invite-signing-key")
    if row:
        return row.value.encode()
    if session.get_bind().dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    session.execute(insert(CustomerPortalConfig).values(key="invite-signing-key", value=secrets.token_hex(32)).on_conflict_do_nothing(index_elements=["key"]))
    return session.get(CustomerPortalConfig, "invite-signing-key").value.encode()


def _invite_token(session, invitation_id):
    signature = hmac.new(_invite_secret(session), ("customer-invite:"+invitation_id).encode(), hashlib.sha256).digest()
    return invitation_id+"."+base64.urlsafe_b64encode(signature).decode().rstrip("=")


def make_invite(kind, account_id, locator=None, *, rotate=False, days=90):
    ref = ensure_merchant_ref(kind, account_id, locator)
    with db.SessionLocal() as session:
        identity = session.get(MerchantIdentity, ref)
        merchant = _merchant(identity)
        rows = session.scalars(select(MerchantInvitation).where(MerchantInvitation.merchant_ref == ref,
            MerchantInvitation.revoked_at.is_(None), MerchantInvitation.expires_at > datetime.utcnow()).order_by(MerchantInvitation.created_at)).all()
        if rows and not rotate:
            row = rows[0]
            token = _invite_token(session, row.id)
        else:
            for previous in rows:
                previous.revoked_at = datetime.utcnow()
            iid = str(uuid4())
            token = _invite_token(session, iid)
            row = MerchantInvitation(id=iid, token_hash=_token_hash(token), merchant_ref=ref,
                expires_at=datetime.utcnow()+timedelta(days=max(1, min(days, 365))))
            session.add(row)
        session.commit()
        return {"invite": token, "token": token, "merchant": _public_merchant(merchant),
                "expires_at": row.expires_at.isoformat()+"Z", "registration_path": "/customer/?invite="+token}


def _valid_invitation(session, token):
    row = session.scalar(select(MerchantInvitation).where(MerchantInvitation.token_hash == _token_hash(token)))
    if not row or row.revoked_at or row.expires_at <= datetime.utcnow():
        fail("invalid_invitation", 404)
    identity = session.get(MerchantIdentity, row.merchant_ref)
    return row, _merchant(identity)


def _attach(session, customer_id, merchant_ref):
    if session.scalar(select(CustomerMerchantLink).where(CustomerMerchantLink.customer_id == customer_id, CustomerMerchantLink.merchant_ref == merchant_ref)):
        return
    if session.get_bind().dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    session.execute(insert(CustomerMerchantLink).values(id=str(uuid4()), customer_id=customer_id,
        merchant_ref=merchant_ref).on_conflict_do_nothing(index_elements=["customer_id", "merchant_ref"]))


class Registration(BaseModel):
    phone: str
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=160)
    invite: str = Field(min_length=20, max_length=200)

    @field_validator("phone")
    @classmethod
    def phone_value(cls, value):
        return normalize_phone(value)

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.password_confirm:
            raise ValueError("Passwords do not match")
        return self


class Login(BaseModel):
    phone: str
    password: str = Field(min_length=1, max_length=128)
    invite: str | None = Field(default=None, max_length=200)

    @field_validator("phone")
    @classmethod
    def phone_value(cls, value):
        return normalize_phone(value)


class LinkRequest(BaseModel):
    invite: str = Field(min_length=20, max_length=200)


@router.get("/invites/{token}")
@router.get("/invitations/{token}")
def invitation_info(token: str):
    if len(token) > 200:
        fail("invalid_invitation", 404)
    with db.SessionLocal() as session:
        row, merchant = _valid_invitation(session, token)
        public = _public_merchant(merchant)
        # Invitation holders receive merchant information, never customer data.
        return {"data": {"merchant": public, "expires_at": row.expires_at.isoformat()+"Z"}}


@router.post("/register")
def register(body: Registration, request: Request, response: Response):
    _origin(request)
    with db.SessionLocal() as session:
        invitation, _ = _valid_invitation(session, body.invite)
        if session.scalar(select(CustomerAccount.id).where(CustomerAccount.phone == body.phone)):
            fail("phone_already_registered", 409, message="Sign in to connect this merchant to your existing customer account.")
        account = CustomerAccount(id=str(uuid4()), phone=body.phone, name=body.name.strip() or "Customer",
                                  password_hash=_hash_password(body.password), active=True)
        session.add(account)
        try:
            session.flush()
            _attach(session, account.id, invitation.merchant_ref)
            token = issue_session(session, account.id)
            session.commit()
        except IntegrityError:
            session.rollback()
            fail("phone_already_registered", 409)
        public = _public_account(account)
    _set_cookie(request, response, token)
    return {"data": public}


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    _origin(request)
    key = ((request.client.host if request.client else "")+"|"+body.phone)
    with _LOGIN_LOCK:
        failures = [stamp for stamp in _LOGIN_FAILS.get(key, []) if stamp > time.monotonic()-900]
        if len(failures) >= 10:
            fail("too_many_attempts", 429)
    with db.SessionLocal() as session:
        account = session.scalar(select(CustomerAccount).where(CustomerAccount.phone == body.phone))
        if not account or not account.active or not _password_matches(body.password, account.password_hash):
            if not account:
                _hash_password(body.password)  # Keep nonexistent-phone timing comparable.
            with _LOGIN_LOCK:
                _LOGIN_FAILS[key] = [*failures, time.monotonic()]
            fail("invalid_credentials", 401)
        if body.invite:
            invitation, _ = _valid_invitation(session, body.invite)
            _attach(session, account.id, invitation.merchant_ref)
        token = issue_session(session, account.id)
        session.commit()
        public = _public_account(account)
    with _LOGIN_LOCK:
        _LOGIN_FAILS.pop(key, None)
    _set_cookie(request, response, token)
    return {"data": public}


@router.post("/logout")
def logout(request: Request, response: Response):
    _origin(request)
    token = request.cookies.get(CUSTOMER_COOKIE)
    with db.SessionLocal() as session:
        row = session.get(CustomerSession, _token_hash(token)) if token else None
        if row:
            session.delete(row)
            session.commit()
    response.delete_cookie(CUSTOMER_COOKIE, path="/")
    return {"data": {"logged_out": True}}


@router.get("/me")
def me(customer=Depends(require_customer)):
    return {"data": {key: customer[key] for key in ("id", "name", "phone", "chat_id", "phone_verified")}}


@router.post("/links")
def link_merchant(body: LinkRequest, customer=Depends(require_customer)):
    with db.SessionLocal() as session:
        invitation, merchant = _valid_invitation(session, body.invite)
        _attach(session, customer["sub"], invitation.merchant_ref)
        session.commit()
    return {"data": _public_merchant(merchant)}


@router.get("/merchants")
def merchants(customer=Depends(require_customer)):
    with db.SessionLocal() as session:
        identities = session.scalars(select(MerchantIdentity).join(CustomerMerchantLink,
            CustomerMerchantLink.merchant_ref == MerchantIdentity.ref).where(CustomerMerchantLink.customer_id == customer["sub"])).all()
        result = []
        for identity in identities:
            try:
                result.append(_public_merchant(_merchant(identity)))
            except HTTPException:
                continue
    return {"data": result}


def _linked(customer_id, merchant_ref, session):
    identity = session.scalar(select(MerchantIdentity).join(CustomerMerchantLink,
        CustomerMerchantLink.merchant_ref == MerchantIdentity.ref).where(
        CustomerMerchantLink.customer_id == customer_id, MerchantIdentity.ref == str(merchant_ref)))
    if not identity:
        fail("merchant_not_linked", 404)
    return identity, _merchant(identity)


def public_catalog(raw, merchant):
    """Whitelist even trusted adapters: costs and seller economics stay private."""
    raw = raw.get("data", raw) if isinstance(raw, dict) else {}
    products = []
    for row in raw.get("products") or []:
        variants = []
        for variant in row.get("variants") or []:
            variants.append({key: variant[key] for key in (
                "id", "product_id", "title", "price", "available", "inventory_available", "inventory_quantity",
                "unit_type", "unit", "stock_grams", "sku", "barcode", "short_code", "image") if key in variant})
        product = {key: row[key] for key in ("id", "title", "name", "description", "image", "images",
            "product_type", "collection_ids", "unit_type", "price_unit", "stock_grams", "short_code", "section", "price", "price_min", "currency", "fulfillment_group") if key in row}
        product["variants"] = variants
        product.setdefault("collection_ids", [])
        products.append(product)
    collections = [{"id": str(row.get("id") or ""), "title": str(row.get("title") or row.get("name") or "Collection")}
                   for row in raw.get("collections") or []]
    return {"merchant": _public_merchant(merchant), "collections": collections, "products": products,
            **{key: raw[key] for key in ("currency", "delivery_fee", "delivery_fees", "delivery_cities") if key in raw}}


@router.get("/merchants/{merchant_ref}/catalog")
def catalog(merchant_ref: str, customer=Depends(require_customer)):
    with db.SessionLocal() as session:
        _, merchant = _linked(customer["sub"], merchant_ref, session)
    return {"data": public_catalog(_adapter().catalog(merchant), merchant)}


class PortalLine(BaseModel):
    model_config = {"extra": "forbid"}
    product_id: str | None = None
    variant_id: str | None = None
    quantity: StrictInt | None = Field(default=None, gt=0, le=1000000)
    grams: StrictInt | None = Field(default=None, gt=0, le=2000000000)

    @field_validator("product_id", "variant_id", mode="before")
    @classmethod
    def identifier(cls, value):
        import re
        if value is None:
            return None
        if isinstance(value, bool) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", str(value)):
            raise ValueError("Invalid product identity")
        return str(value)

    @model_validator(mode="after")
    def line_mode(self):
        if not (self.product_id or self.variant_id) or (self.quantity is None) == (self.grams is None):
            raise ValueError("Supply a product identity and units or grams")
        return self


class PortalAddress(BaseModel):
    address1: str = Field(default="", max_length=500)
    city: str = Field(default="", max_length=120)
    province: str = Field(default="", max_length=120)
    zip: str = Field(default="", max_length=24)
    country: str = Field(default="MA", max_length=2)


class PortalOrderInput(BaseModel):
    model_config = {"extra": "forbid"}
    request_id: UUID
    merchant_ref: UUID
    line_items: list[PortalLine] = Field(min_length=1, max_length=100)
    customer_name: str = Field(default="", max_length=160)
    address: PortalAddress = Field(default_factory=PortalAddress)
    note: str = Field(default="", max_length=1000)
    expected_total: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2, allow_inf_nan=False)


def _public_order(raw, row, merchant):
    """Never forward raw employee receipts containing costs or commissions."""
    raw = raw.get("data", raw) if isinstance(raw, dict) else {}
    lines = []
    for line in raw.get("line_items") or raw.get("items") or []:
        lines.append({key: line[key] for key in ("product_id", "variant_id", "title", "name", "variant_title",
            "quantity", "grams", "unit_type", "unit", "price", "line_total", "image", "short_code", "sku") if key in line})
    total = str(raw.get("total_price") if raw.get("total_price") is not None else raw.get("total") or "0.00")
    return {"id": row.id, "name": str(raw.get("name") or "Order"), "merchant_ref": row.merchant_ref,
            "merchant_name": str(merchant.get("name") or "Merchant"), "merchant_chat_id": merchant.get("chat_id") or "",
            "status": "cancelled" if raw.get("is_cancelled") or raw.get("cancelled_at") else str(raw.get("order_status") or raw.get("status") or "pending"),
            "payment_status": str(raw.get("payment_status") or raw.get("financial_status") or "pending"),
            "total": total, "total_price": total, "currency": str(raw.get("currency") or "MAD"),
            "created_at": str(raw.get("created_at") or row.created_at.isoformat()+"Z"),
            "line_items": lines, "portal_state": row.status}


def _request_fingerprint(body):
    return hashlib.sha256(body.model_dump_json().encode()).hexdigest()


def _order_replay(row, fingerprint):
    if row.fingerprint != fingerprint:
        fail("request_conflict", 409)
    if row.status == "completed":
        return {"data": json.loads(row.receipt)}
    if row.status == "failed":
        saved = json.loads(row.error or "{}")
        raise HTTPException(saved.get("status", 422), saved.get("detail", {"error": "order_rejected"}))
    fail("order_needs_review", 409, message="This order was already submitted. Check your order history before submitting again.")


def _portal_order_row(customer, body, fingerprint):
    return CustomerOrder(id=str(uuid4()), customer_id=customer["sub"], merchant_ref=str(body.merchant_ref),
        request_id=str(body.request_id), fingerprint=fingerprint, status="processing", created_at=datetime.utcnow())


@router.post("/orders")
def create_order(body: PortalOrderInput, customer=Depends(require_customer)):
    fingerprint = _request_fingerprint(body)
    with db.SessionLocal() as session:
        _, merchant = _linked(customer["sub"], body.merchant_ref, session)
        previous = session.scalar(select(CustomerOrder).where(CustomerOrder.customer_id == customer["sub"], CustomerOrder.request_id == str(body.request_id)))
        if previous:
            return _order_replay(previous, fingerprint)
    payload = body.model_dump(mode="json")
    # A customer can choose a recipient name; their phone always comes from
    # their own account. Customers cannot mark an uncollected sale as paid.
    payload["customer_name"] = body.customer_name.strip() or customer["name"]
    payload["customer_phone"] = customer["phone"]
    if merchant.get("account_type") == "grocery":
        from app import grocery
        lines = []
        for line in body.line_items:
            try:
                if line.product_id and line.variant_id and line.product_id != line.variant_id:
                    raise ValueError()
                pid = int(line.product_id or line.variant_id)
                if pid <= 0:
                    raise ValueError()
            except (ValueError, TypeError):
                fail("invalid_product", 422)
            lines.append({"product_id": pid, **({"grams": line.grams} if line.grams is not None else {"quantity": line.quantity})})
        trusted_id = uuid5(UUID(customer["sub"]), str(body.request_id))
        req = grocery.OrderInput(request_id=trusted_id, line_items=lines,
            customer_name=payload["customer_name"], customer_phone=customer["phone"], payment_status="unpaid", amount_paid=Decimal(0))
        portal = _portal_order_row(customer, body, fingerprint)
        def receipt_hook(session, result):
            if body.expected_total is not None and Decimal(str(result["data"]["total_price"])) != body.expected_total:
                fail("price_changed", 422, total_price=str(result["data"]["total_price"]),
                     message="The price changed. Refresh your cart and confirm the new total.")
            existing = session.scalar(select(CustomerOrder).where(CustomerOrder.customer_id == customer["sub"], CustomerOrder.request_id == str(body.request_id)))
            if existing:
                _order_replay(existing, fingerprint)
                portal.receipt = existing.receipt
                return
            portal.status = "completed"
            portal.external_id = str(result["data"]["id"])
            portal.receipt = json.dumps(_public_order(result, portal, merchant), default=str)
            session.add(portal)
            session.flush()  # A conflict rolls back the grocery sale as well.
        try:
            grocery.place_order(merchant.get("vendor_id") or merchant.get("locator"), merchant["vendor"], req, receipt_hook=receipt_hook)
        except IntegrityError:
            with db.SessionLocal() as session:
                existing = session.scalar(select(CustomerOrder).where(CustomerOrder.customer_id == customer["sub"], CustomerOrder.request_id == str(body.request_id)))
                if existing:
                    return _order_replay(existing, fingerprint)
            raise
        return {"data": json.loads(portal.receipt)}
    portal = _portal_order_row(customer, body, fingerprint)
    with db.SessionLocal() as session:
        session.add(portal)
        try:
            session.commit()  # Durable before any external merchant mutation.
        except IntegrityError:
            session.rollback()
            existing = session.scalar(select(CustomerOrder).where(CustomerOrder.customer_id == customer["sub"], CustomerOrder.request_id == str(body.request_id)))
            return _order_replay(existing, fingerprint)
    try:
        result = _adapter().place_order(merchant, payload, customer)
        raw = result.get("data", result) if isinstance(result, dict) else {}
        if not raw.get("id") or (isinstance(result, dict) and result.get("error")):
            fail("order_needs_review", 409)
        portal.status, portal.external_id = "completed", str(raw["id"])
        receipt = _public_order(result, portal, merchant)
        with db.SessionLocal() as session:
            stored = session.get(CustomerOrder, portal.id)
            stored.status, stored.external_id, stored.receipt = "completed", portal.external_id, json.dumps(receipt, default=str)
            session.commit()
        return {"data": receipt}
    except Exception as error:
        definite = isinstance(error, HTTPException) and error.status_code in (400, 401, 403, 404, 422)
        with db.SessionLocal() as session:
            stored = session.get(CustomerOrder, portal.id)
            stored.status = "failed" if definite else "needs_review"
            stored.error = json.dumps({"status": error.status_code, "detail": error.detail}) if definite else json.dumps({"error": "order_needs_review"})
            session.commit()
        if definite:
            raise
        fail("order_needs_review", 409, message="The merchant could not confirm this order yet. Do not submit a second order.")


@router.get("/orders")
def orders(customer=Depends(require_customer)):
    with db.SessionLocal() as session:
        rows = session.scalars(select(CustomerOrder).where(CustomerOrder.customer_id == customer["sub"]).order_by(CustomerOrder.created_at.desc())).all()
        result = []
        for row in rows:
            receipt = json.loads(row.receipt) if row.receipt else {"id": row.id, "name": "Order", "merchant_ref": row.merchant_ref,
                "created_at": row.created_at.isoformat()+"Z", "line_items": [], "status": row.status, "portal_state": row.status}
            if row.status == "completed":
                identity = session.get(MerchantIdentity, row.merchant_ref)
                try:
                    merchant = _merchant(identity)
                    if merchant.get("account_type") == "grocery":
                        from app.grocery import get_order
                        receipt = _public_order(get_order(merchant.get("vendor_id") or merchant.get("locator"), row.external_id), row, merchant)
                    elif hasattr(_adapter(), "refresh_order"):
                        refreshed = _adapter().refresh_order(merchant, row.external_id)
                        if refreshed:
                            if "financial_status" in refreshed and "payment_status" not in refreshed:
                                refreshed = {**refreshed, "payment_status": refreshed["financial_status"]}
                            receipt = _public_order({**receipt, **refreshed}, row, merchant)
                except Exception:
                    pass  # Preserve the customer's own receipt if a merchant closes.
            result.append(receipt)
    return {"data": result}


def _operator(request):
    from app import auth_gate
    _origin(request)
    operator = auth_gate.resolve_principals(dict(request.headers)).get("operator")
    if not operator:
        fail("operator_sign_in_required", 401)
    return operator


class MerchantSelection(BaseModel):
    kind: Literal["vendor", "seller"] | None = None
    account_id: str | None = Field(default=None, max_length=64)
    locator: str | None = Field(default=None, max_length=255)
    rotate: bool = False


def _acting_merchant(request, selection):
    from app import auth_gate
    _origin(request)
    principals = auth_gate.resolve_principals(dict(request.headers))
    operator = principals.get("operator")
    if operator and selection.kind and selection.account_id:
        return selection.kind, selection.account_id, selection.locator
    if operator and (selection.kind or selection.account_id):
        fail("merchant_selection_required", 422)
    vendor = principals.get("vendor")
    if request.headers.get("authorization", "").lower().startswith("bearer "):
        from app.affiliates import identity, active_seller
        seller = active_seller(identity(request))
        kind, account_id, locator = "seller", seller["id"], seller["id"]
    elif vendor:
        kind, account_id, locator = "vendor", vendor.get("aid"), vendor["sub"]
        if not account_id:
            fail("account_setup_required", 409)
    else:
        if operator:
            fail("merchant_selection_required", 422)
        fail("merchant_sign_in_required", 401)
    if (selection.kind and selection.kind != kind) or (selection.account_id and selection.account_id != account_id) or (selection.locator and selection.locator != locator):
        fail("merchant_forbidden", 403)
    return kind, account_id, locator


@router.post("/merchant/invites")
def merchant_invite(request: Request, body: MerchantSelection = None):
    body = body or MerchantSelection()
    return {"data": make_invite(*_acting_merchant(request, body), rotate=body.rotate)}


@router.get("/merchant/invites")
def merchant_invite_existing(request: Request, kind: Literal["vendor", "seller"] | None = None,
                             account_id: str | None = Query(default=None, max_length=64),
                             locator: str | None = Query(default=None, max_length=255)):
    selection = MerchantSelection(kind=kind, account_id=account_id, locator=locator)
    return {"data": make_invite(*_acting_merchant(request, selection))}


@router.post("/merchant/chat-session")
def merchant_chat_session(request: Request, response: Response):
    from app import auth_gate
    _origin(request)
    if request.headers.get("authorization", "").lower().startswith("bearer "):
        from app.affiliates import active_seller, identity
        return {"data": auth_gate.issue_seller_chat_cookie(response, request, active_seller(identity(request)))}
    vendor = auth_gate.resolve_principals(dict(request.headers)).get("vendor")
    if vendor:
        from app.main import WHOLESALE_STORE, _wholesale_vendor_key
        record = db.get_app_setting(WHOLESALE_STORE, _wholesale_vendor_key(vendor["sub"])) or {}
        return {"data": {"id": vendor["chat_id"], "chat_id": vendor["chat_id"], "name": record.get("name") or vendor["sub"],
                         "handle": vendor["sub"], "kind": "vendor"}}
    fail("merchant_sign_in_required", 401)


class AdminAccount(BaseModel):
    phone: str
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=160)
    merchant_refs: list[UUID] = Field(default_factory=list, max_length=100)

    @field_validator("phone")
    @classmethod
    def phone_value(cls, value):
        return normalize_phone(value)

    @model_validator(mode="after")
    def match(self):
        if self.password != self.password_confirm:
            raise ValueError("Passwords do not match")
        return self


@router.post("/admin/accounts")
def admin_create_account(body: AdminAccount, request: Request):
    _operator(request)
    with db.SessionLocal() as session:
        if session.scalar(select(CustomerAccount.id).where(CustomerAccount.phone == body.phone)):
            fail("phone_already_registered", 409)
        for ref in body.merchant_refs:
            merchant = session.get(MerchantIdentity, str(ref))
            if not merchant:
                fail("merchant_unavailable", 404)
            _merchant(merchant)
        account = CustomerAccount(id=str(uuid4()), phone=body.phone, name=body.name.strip() or "Customer", password_hash=_hash_password(body.password), active=True)
        session.add(account)
        try:
            session.flush()
            for ref in set(body.merchant_refs):
                _attach(session, account.id, str(ref))
            session.commit()
        except IntegrityError:
            session.rollback()
            fail("phone_already_registered", 409)
        return {"data": _public_account(account)}


@router.get("/admin/accounts")
def admin_accounts(request: Request):
    _operator(request)
    with db.SessionLocal() as session:
        return {"data": [_public_account(row) for row in session.scalars(select(CustomerAccount).order_by(CustomerAccount.created_at.desc())).all()]}


@router.get("/admin/merchants")
def admin_merchants(request: Request):
    _operator(request)
    result = []
    for merchant in _adapter().list_merchants():
        try:
            ref = ensure_merchant_ref(merchant["kind"], merchant["account_id"], merchant.get("locator"))
            result.append({**_public_merchant({**merchant, "ref": ref}),
                           "account_id": merchant["account_id"], "locator": merchant.get("locator") or merchant.get("vendor_id")})
        except HTTPException:
            continue
    return {"data": result}


def linked_chat_ids(customer_id):
    with db.SessionLocal() as session:
        customer = session.get(CustomerAccount, str(customer_id))
        if not customer or not customer.active:
            return []
        identities = session.scalars(select(MerchantIdentity).join(CustomerMerchantLink,
            CustomerMerchantLink.merchant_ref == MerchantIdentity.ref).where(CustomerMerchantLink.customer_id == str(customer_id))).all()
        result = []
        for identity in identities:
            try:
                chat_id = _merchant(identity).get("chat_id")
                if chat_id:
                    result.append(chat_id)
            except HTTPException:
                continue
        return result


def chat_peer_allowed(actor_id, peer_id):
    actor, peer = str(actor_id).lower(), str(peer_id).lower()
    if actor.startswith("customer:"):
        return peer in linked_chat_ids(actor.split(":", 1)[1])
    if peer.startswith("customer:"):
        return actor in linked_chat_ids(peer.split(":", 1)[1])
    return True


def customer_catalog_allowed(customer_id, vendor_username):
    with db.SessionLocal() as session:
        identities = session.scalars(select(MerchantIdentity).join(CustomerMerchantLink,
            CustomerMerchantLink.merchant_ref == MerchantIdentity.ref).where(CustomerMerchantLink.customer_id == str(customer_id), MerchantIdentity.kind == "vendor")).all()
        for identity in identities:
            try:
                merchant = _merchant(identity)
                if str(merchant.get("vendor_id") or merchant.get("locator") or identity.locator).lower() == str(vendor_username).lower():
                    return True
            except HTTPException:
                continue
    return False


def directory_for(actor_id, term=""):
    actor, needle = str(actor_id).lower(), str(term).lower().strip()
    with db.SessionLocal() as session:
        result = []
        if actor.startswith("customer:"):
            identities = session.scalars(select(MerchantIdentity).join(CustomerMerchantLink,
                CustomerMerchantLink.merchant_ref == MerchantIdentity.ref).where(CustomerMerchantLink.customer_id == actor.split(":", 1)[1])).all()
            for identity in identities:
                try:
                    merchant = _merchant(identity)
                    result.append({"id": merchant["chat_id"], "name": merchant["name"], "handle": merchant.get("locator") or merchant.get("vendor_id") or identity.ref,
                        "avatar": merchant.get("avatar") or "", "kind": merchant["kind"]})
                except HTTPException:
                    continue
        else:
            for identity in session.scalars(select(MerchantIdentity)).all():
                try:
                    if _merchant(identity).get("chat_id") != actor:
                        continue
                except HTTPException:
                    continue
                accounts = session.scalars(select(CustomerAccount).join(CustomerMerchantLink,
                    CustomerMerchantLink.customer_id == CustomerAccount.id).where(CustomerMerchantLink.merchant_ref == identity.ref, CustomerAccount.active.is_(True))).all()
                result.extend({"id": "customer:"+account.id, "name": account.name, "handle": "customer-"+account.id[:8], "avatar": "", "kind": "customer"} for account in accounts)
    return [row for row in result if not needle or needle in row["name"].lower() or needle in row["handle"].lower() or needle in row["id"]]
