"""
Realtime WebSocket manager and helper notifications.
"""

import json
import logging
import time
from typing import Dict, Optional, Set, Iterable

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session

from .config import SECRET_KEY, ALGORITHM, ADMIN_EMAILS
from .database import SessionLocal
from .models import User, UserAuth
from .services.auth_service import AuthService

logger = logging.getLogger(__name__)
router = APIRouter()


class RealtimeManager:
    def __init__(self) -> None:
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        self.admin_connections: Set[WebSocket] = set()
        # throttle map: (user_id, resource) -> last_sent_ts
        self.last_sent: Dict[tuple, float] = {}

    async def connect(self, websocket: WebSocket, token: str) -> Optional[int]:
        """Validate token and register websocket. Returns user_id or None."""
        db = SessionLocal()
        try:
            auth_service = AuthService(db)
            session = auth_service.load_session(token)
            if not session:
                session = self._load_user_from_access_token(db, token)
            if not session:
                logger.warning("Realtime auth failed for websocket connection")
                await websocket.close(code=4401)
                return None
            user_id = int(session["user"]["id"])
            is_admin = bool(session["user"].get("is_admin"))
            await websocket.accept()
            self.active_connections.setdefault(user_id, set()).add(websocket)
            if is_admin:
                self.admin_connections.add(websocket)
            try:
                await websocket.send_json({
                    "type": "connected",
                    "user_id": user_id,
                    "is_admin": is_admin,
                })
            except Exception:
                pass
            return user_id
        finally:
            db.close()

    def _load_user_from_access_token(self, db: Session, token: str) -> Optional[Dict]:
        """Fallback for websocket auth when the API uses raw access JWTs instead of session rows."""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            token_type = payload.get("type")
            if token_type and token_type != "access":
                return None

            raw_user_id = payload.get("sub") or payload.get("user_id")
            if raw_user_id is None:
                return None

            try:
                user_id = int(raw_user_id)
            except (TypeError, ValueError):
                return None

            user = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
            email = (payload.get("email") or "").strip().lower()
            user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
            if not user_auth and email:
                user_auth = db.query(UserAuth).filter(UserAuth.email == email).first()
            if not user or not user_auth:
                return None

            is_admin = user_auth.email.lower() in ADMIN_EMAILS if ADMIN_EMAILS else False
            logger.info(
                "Realtime websocket authenticated via JWT fallback for user_id=%s token_type=%s",
                user_id,
                token_type or "missing",
            )
            return {
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user_auth.email,
                    "age": user.age,
                    "gender": user.gender,
                    "emergency_contact": user.emergency_contact,
                    "medical_conditions": user.medical_conditions,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "is_active": user.is_active,
                    "is_admin": is_admin,
                },
                "token": token,
            }
        except Exception as exc:
            logger.warning(f"Realtime JWT fallback auth failed: {exc}")
            return None

    def disconnect(self, websocket: WebSocket, user_id: Optional[int]) -> None:
        self.admin_connections.discard(websocket)
        if not user_id:
            return
        connections = self.active_connections.get(user_id)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self.active_connections.pop(user_id, None)

    async def broadcast_user(
        self,
        user_id: int,
        event: Dict,
        throttle_seconds: Optional[float] = None,
    ) -> None:
        connections = self.active_connections.get(user_id)
        if not connections:
            return

        resource = event.get("resource")
        if throttle_seconds and resource:
            key = (user_id, resource)
            now = time.time()
            last = self.last_sent.get(key, 0)
            if now - last < throttle_seconds:
                return
            self.last_sent[key] = now

        dead: Set[WebSocket] = set()
        payload = json.dumps(event)
        for ws in connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            connections.discard(ws)

    async def broadcast_admin(
        self,
        event: Dict,
        throttle_seconds: Optional[float] = None,
    ) -> None:
        if not self.admin_connections:
            return

        resource = event.get("resource")
        if throttle_seconds and resource:
            key = ("admin", resource)
            now = time.time()
            last = self.last_sent.get(key, 0)
            if now - last < throttle_seconds:
                return
            self.last_sent[key] = now

        dead: Set[WebSocket] = set()
        payload = json.dumps(event)
        for ws in self.admin_connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.admin_connections.discard(ws)

    async def broadcast_users(
        self,
        user_ids: Iterable[int],
        event: Dict,
        throttle_seconds: Optional[float] = None,
    ) -> None:
        for user_id in set(int(uid) for uid in user_ids if uid is not None):
            await self.broadcast_user(user_id, event, throttle_seconds=throttle_seconds)


realtime_manager = RealtimeManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query("")):
    user_id: Optional[int] = None
    try:
        user_id = await realtime_manager.connect(websocket, token)
        if not user_id:
            return
        while True:
            # Keep connection alive; we don't require client messages.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        realtime_manager.disconnect(websocket, user_id)
    except Exception as exc:
        logger.error(f"Realtime websocket error: {exc}")
        realtime_manager.disconnect(websocket, user_id)


async def notify_user(
    user_id: int,
    resource: str,
    action: str = "updated",
    payload: Optional[Dict] = None,
    throttle_seconds: Optional[float] = None,
) -> None:
    event = {
        "type": "data",
        "resource": resource,
        "action": action,
        "user_id": user_id,
        "timestamp": time.time(),
    }
    if payload is not None:
        event["payload"] = payload
    await realtime_manager.broadcast_user(user_id, event, throttle_seconds=throttle_seconds)


async def notify_users(
    user_ids: Iterable[int],
    resource: str,
    action: str = "updated",
    payload: Optional[Dict] = None,
    throttle_seconds: Optional[float] = None,
) -> None:
    event = {
        "type": "data",
        "resource": resource,
        "action": action,
        "timestamp": time.time(),
    }
    if payload is not None:
        event["payload"] = payload
    await realtime_manager.broadcast_users(user_ids, event, throttle_seconds=throttle_seconds)


async def notify_admins(
    resource: str,
    action: str = "updated",
    payload: Optional[Dict] = None,
    throttle_seconds: Optional[float] = None,
) -> None:
    event = {
        "type": "data",
        "resource": resource,
        "action": action,
        "timestamp": time.time(),
    }
    if payload is not None:
        event["payload"] = payload
    await realtime_manager.broadcast_admin(event, throttle_seconds=throttle_seconds)
