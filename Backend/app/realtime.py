"""
Realtime WebSocket manager and helper notifications.
"""

import json
import logging
import time
from typing import Dict, Optional, Set, Iterable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from .database import SessionLocal
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
