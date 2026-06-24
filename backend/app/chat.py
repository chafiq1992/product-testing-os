"""Minimal internal chat / inbox.

A self-contained, WhatsApp-inbox-style direct-messaging system for the app's own
accounts (wholesale vendors today; a customer dashboard later). It does NOT use the
WhatsApp API. Every account has a string id/handle; anyone can DM anyone else by id.

Features
--------
- Account directory + search-by-handle (Telegram/WhatsApp style).
- 1:1 conversations with text, image, video, audio and generic file messages.
- Realtime over WebSocket (delivery + read receipts + presence + typing).
- Separate "chat-media" blob store (mirrors the upload-blob cross-instance fallback).

Everything lives behind ``/api/chat`` and ``/chat-media`` and is mounted from main.py
via ``app.include_router(chat.router)``.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Set
from uuid import uuid4

from fastapi import APIRouter, File, Form, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Index, String, Text, desc, or_

from app import db

log = logging.getLogger("app.chat")

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ChatAccount(db.Base):
    """A participant that can send/receive messages (vendor, agent, customer...)."""

    __tablename__ = "chat_accounts"

    id = Column(String, primary_key=True)           # canonical id / handle (lowercased)
    handle = Column(String, nullable=False)          # searchable handle (lowercased)
    display_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    kind = Column(String, nullable=True)             # 'vendor' | 'agent' | 'customer'
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen = Column(DateTime, nullable=True)


Index("ix_chat_accounts_handle", ChatAccount.handle)


class ChatMessage(db.Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True)            # uuid
    conversation_id = Column(String, nullable=False, index=True)  # sorted "a|b"
    sender_id = Column(String, nullable=False, index=True)
    recipient_id = Column(String, nullable=False, index=True)
    msg_type = Column(String, nullable=False, default="text")     # text|image|video|audio|file
    text = Column(Text, nullable=True)
    media_url = Column(String, nullable=True)
    media_mime = Column(String, nullable=True)
    media_name = Column(String, nullable=True)
    duration = Column(String, nullable=True)         # audio length (seconds, as string)
    status = Column(String, nullable=False, default="sent")       # sent|delivered|read
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    read_at = Column(DateTime, nullable=True)


Index("ix_chat_messages_conv_created", ChatMessage.conversation_id, ChatMessage.created_at)

db.Base.metadata.create_all(db.engine)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MEDIA_TYPES = {"image", "video", "audio", "file"}


def _norm_id(value: Any) -> str:
    return str(value or "").strip().lower()


def conversation_id(a: str, b: str) -> str:
    x, y = _norm_id(a), _norm_id(b)
    return "|".join(sorted([x, y]))


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"


def _account_dict(acc: ChatAccount) -> Dict[str, Any]:
    return {
        "id": acc.id,
        "handle": acc.handle,
        "name": acc.display_name or acc.handle or acc.id,
        "avatar": acc.avatar_url or "",
        "kind": acc.kind or "",
        "online": manager.is_online(acc.id),
        "last_seen": _iso(acc.last_seen),
    }


def _message_dict(m: ChatMessage) -> Dict[str, Any]:
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "sender_id": m.sender_id,
        "recipient_id": m.recipient_id,
        "type": m.msg_type,
        "text": m.text,
        "media_url": m.media_url,
        "media_mime": m.media_mime,
        "media_name": m.media_name,
        "duration": m.duration,
        "status": m.status,
        "created_at": _iso(m.created_at),
        "read_at": _iso(m.read_at),
    }


def upsert_account(
    account_id: str,
    *,
    handle: str | None = None,
    name: str | None = None,
    avatar: str | None = None,
    kind: str | None = None,
    touch: bool = False,
) -> Dict[str, Any]:
    aid = _norm_id(account_id)
    if not aid:
        raise ValueError("account id required")
    with db.SessionLocal() as session:
        acc = session.get(ChatAccount, aid)
        if not acc:
            acc = ChatAccount(id=aid, handle=_norm_id(handle) or aid, created_at=datetime.utcnow())
            session.add(acc)
        if handle:
            acc.handle = _norm_id(handle)
        if name is not None:
            acc.display_name = name
        if avatar is not None:
            acc.avatar_url = avatar
        if kind is not None:
            acc.kind = kind
        if touch:
            acc.last_seen = datetime.utcnow()
        session.commit()
        return _account_dict(acc)


def get_account(account_id: str) -> Optional[Dict[str, Any]]:
    with db.SessionLocal() as session:
        acc = session.get(ChatAccount, _norm_id(account_id))
        return _account_dict(acc) if acc else None


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    def is_online(self, account_id: str) -> bool:
        return bool(self.connections.get(_norm_id(account_id)))

    def online_ids(self) -> List[str]:
        return [aid for aid, conns in self.connections.items() if conns]

    async def connect(self, ws: WebSocket, account_id: str) -> None:
        await ws.accept()
        aid = _norm_id(account_id)
        async with self._lock:
            self.connections[aid].add(ws)

    def disconnect(self, ws: WebSocket, account_id: str) -> None:
        aid = _norm_id(account_id)
        conns = self.connections.get(aid)
        if conns:
            conns.discard(ws)
            if not conns:
                self.connections.pop(aid, None)

    async def send_to(self, account_id: str, payload: dict) -> bool:
        """Send a JSON payload to all live sockets of an account. Returns True if delivered."""
        aid = _norm_id(account_id)
        conns = list(self.connections.get(aid) or [])
        delivered = False
        for ws in conns:
            try:
                await ws.send_json(payload)
                delivered = True
            except Exception:
                self.disconnect(ws, aid)
        return delivered

    async def broadcast_presence(self, account_id: str, online: bool) -> None:
        payload = {"type": "presence", "data": {"id": _norm_id(account_id), "online": online}}
        for aid in list(self.connections.keys()):
            if aid == _norm_id(account_id):
                continue
            await self.send_to(aid, payload)


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Directory providers
# ---------------------------------------------------------------------------
# Other modules (e.g. the wholesale vendor registry, a future customer dashboard)
# can expose their accounts to chat search without this module knowing about them.
# A provider is ``fn(term: str) -> list[dict]`` returning account dicts that look
# like {"id", "handle", "name", "avatar", "kind"}.
_directory_providers: List[Any] = []


def register_directory_provider(fn) -> None:
    if fn not in _directory_providers:
        _directory_providers.append(fn)


def _provider_accounts(term: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for fn in _directory_providers:
        try:
            for acc in fn(term) or []:
                aid = _norm_id(acc.get("id") or acc.get("handle"))
                if not aid:
                    continue
                out.append({
                    "id": aid,
                    "handle": _norm_id(acc.get("handle") or aid),
                    "name": acc.get("name") or acc.get("handle") or aid,
                    "avatar": acc.get("avatar") or "",
                    "kind": acc.get("kind") or "",
                    "online": manager.is_online(aid),
                    "last_seen": None,
                })
        except Exception as e:
            log.warning("chat directory provider failed: %s", e)
    return out


# ---------------------------------------------------------------------------
# Core: persist + deliver a message
# ---------------------------------------------------------------------------


async def persist_and_deliver(
    *,
    sender: str,
    recipient: str,
    msg_type: str = "text",
    text: str | None = None,
    media_url: str | None = None,
    media_mime: str | None = None,
    media_name: str | None = None,
    duration: str | None = None,
    client_id: str | None = None,
) -> Dict[str, Any]:
    sender_id = _norm_id(sender)
    recipient_id = _norm_id(recipient)
    if not sender_id or not recipient_id:
        raise ValueError("sender and recipient required")
    mtype = (msg_type or "text").strip().lower()
    if mtype not in MEDIA_TYPES and mtype != "text":
        mtype = "text"
    if mtype == "text" and not (text or "").strip():
        raise ValueError("empty message")
    if mtype in MEDIA_TYPES and not media_url:
        raise ValueError("media_url required")

    # Ensure both accounts exist (so a fresh DM target shows up in directories).
    upsert_account(sender_id, touch=True)
    upsert_account(recipient_id)

    recipient_online = manager.is_online(recipient_id)
    msg = ChatMessage(
        id=str(uuid4()),
        conversation_id=conversation_id(sender_id, recipient_id),
        sender_id=sender_id,
        recipient_id=recipient_id,
        msg_type=mtype,
        text=text,
        media_url=media_url,
        media_mime=media_mime,
        media_name=media_name,
        duration=duration,
        status="delivered" if recipient_online else "sent",
        created_at=datetime.utcnow(),
    )
    with db.SessionLocal() as session:
        session.add(msg)
        session.commit()
        payload = _message_dict(msg)

    if client_id:
        payload["client_id"] = client_id

    event = {"type": "message", "data": payload}
    # Deliver to recipient's other tabs + echo to sender's other tabs.
    await manager.send_to(recipient_id, event)
    await manager.send_to(sender_id, event)
    return payload


async def mark_read(me: str, peer: str) -> int:
    me_id, peer_id = _norm_id(me), _norm_id(peer)
    now = datetime.utcnow()
    ids: List[str] = []
    with db.SessionLocal() as session:
        rows = (
            session.query(ChatMessage)
            .filter(
                ChatMessage.recipient_id == me_id,
                ChatMessage.sender_id == peer_id,
                ChatMessage.status != "read",
            )
            .all()
        )
        for r in rows:
            r.status = "read"
            r.read_at = now
            ids.append(r.id)
        if ids:
            session.commit()
    if ids:
        await manager.send_to(
            peer_id,
            {"type": "read", "data": {"peer": me_id, "message_ids": ids, "read_at": _iso(now)}},
        )
    return len(ids)


# ---------------------------------------------------------------------------
# Separate chat-media store (mirrors the upload-blob cross-instance fallback)
# ---------------------------------------------------------------------------


def _media_blob_key(filename: str) -> str:
    return f"chat_media:{filename}"


def _persist_media_blob(filename: str, data: bytes, content_type: str | None) -> None:
    try:
        db.set_app_setting(
            None,
            _media_blob_key(filename),
            {
                "filename": filename,
                "content_type": content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream",
                "data_b64": base64.b64encode(data).decode("ascii"),
                "created_at": datetime.utcnow().isoformat() + "Z",
            },
        )
    except Exception as e:
        log.warning("Failed to persist chat media blob %s: %s", filename, e)


def _load_media_blob(filename: str):
    try:
        payload = db.get_app_setting(None, _media_blob_key(filename))
        if not isinstance(payload, dict):
            return None
        raw = base64.b64decode(str(payload.get("data_b64") or ""))
        if not raw:
            return None
        ct = str(payload.get("content_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream")
        return raw, ct
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


class RegisterReq(BaseModel):
    id: str
    handle: Optional[str] = None
    name: Optional[str] = None
    avatar: Optional[str] = None
    kind: Optional[str] = None


class SendReq(BaseModel):
    sender: str
    recipient: str
    type: Optional[str] = "text"
    text: Optional[str] = None
    media_url: Optional[str] = None
    media_mime: Optional[str] = None
    media_name: Optional[str] = None
    duration: Optional[str] = None
    client_id: Optional[str] = None


class ReadReq(BaseModel):
    me: str
    peer: str


@router.post("/api/chat/register")
async def chat_register(req: RegisterReq):
    try:
        acc = upsert_account(
            req.id, handle=req.handle or req.id, name=req.name, avatar=req.avatar, kind=req.kind, touch=True
        )
        return {"data": acc}
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/chat/search")
async def chat_search(q: str = "", me: str = "", limit: int = 20):
    term = _norm_id(q).lstrip("@")
    me_id = _norm_id(me)
    cap = max(1, min(limit, 50))

    merged: Dict[str, Dict[str, Any]] = {}
    # 1) Registered chat accounts (authoritative — keep real avatar/presence).
    with db.SessionLocal() as session:
        query = session.query(ChatAccount)
        if term:
            like = f"%{term}%"
            query = query.filter(or_(ChatAccount.handle.like(like), ChatAccount.display_name.ilike(like)))
        rows = query.order_by(ChatAccount.handle).limit(cap * 2).all()
    for a in rows:
        if a.id != me_id:
            merged[a.id] = _account_dict(a)

    # 2) Accounts known to other modules (vendors, customers...) not yet registered.
    for acc in _provider_accounts(term):
        if acc["id"] != me_id and acc["id"] not in merged:
            merged[acc["id"]] = acc

    out = sorted(merged.values(), key=lambda a: a.get("handle") or "")
    return {"data": out[:cap]}


@router.get("/api/chat/account/{account_id}")
async def chat_account(account_id: str):
    acc = get_account(account_id)
    if not acc:
        return {"error": "not_found"}
    return {"data": acc}


@router.get("/api/chat/conversations")
async def chat_conversations(me: str, limit: int = 100):
    me_id = _norm_id(me)
    if not me_id:
        return {"error": "me required"}
    with db.SessionLocal() as session:
        rows = (
            session.query(ChatMessage)
            .filter(or_(ChatMessage.sender_id == me_id, ChatMessage.recipient_id == me_id))
            .order_by(desc(ChatMessage.created_at))
            .limit(2000)
            .all()
        )
        convos: Dict[str, Dict[str, Any]] = {}
        for m in rows:
            peer_id = m.recipient_id if m.sender_id == me_id else m.sender_id
            entry = convos.get(peer_id)
            if entry is None:
                entry = {"peer_id": peer_id, "last_message": _message_dict(m), "unread": 0}
                convos[peer_id] = entry
            # rows are newest-first, so the first one seen is the last_message
            if m.recipient_id == me_id and m.status != "read":
                entry["unread"] += 1
        peer_ids = list(convos.keys())
        accounts = {a.id: a for a in session.query(ChatAccount).filter(ChatAccount.id.in_(peer_ids)).all()} if peer_ids else {}

    result = []
    for peer_id, entry in convos.items():
        acc = accounts.get(peer_id)
        peer = _account_dict(acc) if acc else {
            "id": peer_id, "handle": peer_id, "name": peer_id, "avatar": "", "kind": "",
            "online": manager.is_online(peer_id), "last_seen": None,
        }
        result.append({"peer": peer, "last_message": entry["last_message"], "unread": entry["unread"]})
    result.sort(key=lambda r: (r["last_message"] or {}).get("created_at") or "", reverse=True)
    return {"data": result[: max(1, min(limit, 200))]}


@router.get("/api/chat/messages")
async def chat_messages(me: str, peer: str, before: str | None = None, limit: int = 40):
    cid = conversation_id(me, peer)
    with db.SessionLocal() as session:
        query = session.query(ChatMessage).filter(ChatMessage.conversation_id == cid)
        if before:
            try:
                bdt = datetime.fromisoformat(before.replace("Z", ""))
                query = query.filter(ChatMessage.created_at < bdt)
            except Exception:
                pass
        rows = query.order_by(desc(ChatMessage.created_at)).limit(max(1, min(limit, 100))).all()
    rows.reverse()  # chronological asc
    return {"data": [_message_dict(m) for m in rows]}


@router.post("/api/chat/send")
async def chat_send(req: SendReq):
    try:
        msg = await persist_and_deliver(
            sender=req.sender,
            recipient=req.recipient,
            msg_type=req.type or "text",
            text=req.text,
            media_url=req.media_url,
            media_mime=req.media_mime,
            media_name=req.media_name,
            duration=req.duration,
            client_id=req.client_id,
        )
        return {"data": msg}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        log.exception("chat_send failed")
        return {"error": str(e)}


@router.post("/api/chat/read")
async def chat_read(req: ReadReq):
    n = await mark_read(req.me, req.peer)
    return {"data": {"updated": n}}


@router.post("/api/chat/upload")
async def chat_upload(file: UploadFile = File(...), kind: str = Form("file")):
    try:
        data = await file.read()
        if not data:
            return {"error": "empty file"}
        safe_name = (file.filename or "media").replace("/", "_").replace("\\", "_")
        filename = f"chat_{uuid4().hex}_{safe_name}"
        content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        _persist_media_blob(filename, data, content_type)
        return {
            "data": {
                "url": f"/chat-media/{filename}",
                "filename": filename,
                "mime": content_type,
                "name": safe_name,
                "size": len(data),
            }
        }
    except Exception as e:
        log.exception("chat_upload failed")
        return {"error": str(e)}


@router.api_route("/chat-media/{filename:path}", methods=["GET", "HEAD"])
async def chat_media_file(filename: str, request: Request):
    safe_name = (filename or "").replace("\\", "/").split("/")[-1]
    if not safe_name or safe_name in {".", ".."}:
        return Response(status_code=404)
    blob = _load_media_blob(safe_name)
    if not blob:
        return Response(status_code=404)
    data, content_type = blob
    body = b"" if request.method == "HEAD" else data
    return Response(content=body, media_type=content_type, headers={"Cache-Control": "public, max-age=31536000"})


@router.websocket("/api/chat/ws/{account_id}")
async def chat_ws(websocket: WebSocket, account_id: str):
    aid = _norm_id(account_id)
    if not aid:
        await websocket.close(code=4400)
        return
    was_online = manager.is_online(aid)
    await manager.connect(websocket, aid)
    upsert_account(aid, touch=True)
    if not was_online:
        await manager.broadcast_presence(aid, True)
    # Tell the freshly-connected client who is currently online.
    try:
        await websocket.send_json({"type": "presence_snapshot", "data": {"online": manager.online_ids()}})
    except Exception:
        pass

    idle_timeout = 150.0
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=idle_timeout)
            except asyncio.TimeoutError:
                await websocket.close(code=1001)
                break
            except (WebSocketDisconnect, RuntimeError):
                break

            mtype = data.get("type")
            payload = data.get("data") or {}

            if mtype == "ping":
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:
                    break
            elif mtype == "send_message":
                try:
                    await persist_and_deliver(
                        sender=aid,
                        recipient=payload.get("recipient") or payload.get("peer"),
                        msg_type=payload.get("type") or "text",
                        text=payload.get("text"),
                        media_url=payload.get("media_url"),
                        media_mime=payload.get("media_mime"),
                        media_name=payload.get("media_name"),
                        duration=payload.get("duration"),
                        client_id=payload.get("client_id"),
                    )
                except Exception as e:
                    try:
                        await websocket.send_json({"type": "error", "data": {"message": str(e), "client_id": payload.get("client_id")}})
                    except Exception:
                        break
            elif mtype == "read":
                await mark_read(aid, payload.get("peer") or "")
            elif mtype == "typing":
                peer = _norm_id(payload.get("peer"))
                if peer:
                    await manager.send_to(peer, {"type": "typing", "data": {"peer": aid, "typing": bool(payload.get("typing", True))}})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("chat_ws error for %s: %s", aid, e)
    finally:
        manager.disconnect(websocket, aid)
        upsert_account(aid, touch=True)
        if not manager.is_online(aid):
            try:
                await manager.broadcast_presence(aid, False)
            except Exception:
                pass
