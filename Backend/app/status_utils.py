from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, Optional, Tuple

from .models import Device, UserSession


DEVICE_ONLINE_WINDOW_SECONDS = int(os.getenv("DEVICE_ONLINE_WINDOW_SECONDS", "120"))
DEVICE_DATA_ACTIVE_WINDOW_SECONDS = int(os.getenv("DEVICE_DATA_ACTIVE_WINDOW_SECONDS", "90"))


def get_device_online_cutoff(now: Optional[datetime] = None) -> datetime:
    current = now or datetime.utcnow()
    return current - timedelta(seconds=DEVICE_ONLINE_WINDOW_SECONDS)


def get_device_data_cutoff(now: Optional[datetime] = None) -> datetime:
    current = now or datetime.utcnow()
    return current - timedelta(seconds=DEVICE_DATA_ACTIVE_WINDOW_SECONDS)


def is_device_online(device: Optional[Device], now: Optional[datetime] = None) -> bool:
    if not device or not bool(getattr(device, "is_connected", False)):
        return False

    last_seen = getattr(device, "last_seen", None)
    if not last_seen:
        return False

    return last_seen >= get_device_online_cutoff(now)


def is_device_streaming(latest_data_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    if not latest_data_at:
        return False
    return latest_data_at >= get_device_data_cutoff(now)


def get_device_connection_state(device: Optional[Device], now: Optional[datetime] = None) -> str:
    if not device:
        return "offline"
    if bool(getattr(device, "is_archived", False)):
        return "archived"
    if is_device_online(device, now):
        return "connected"
    return "disconnected"


def get_device_data_state(
    latest_data_at: Optional[datetime],
    now: Optional[datetime] = None,
) -> str:
    if not latest_data_at:
        return "no_data"
    if is_device_streaming(latest_data_at, now):
        return "streaming"
    return "stale"


def get_device_operational_status(
    device: Optional[Device],
    latest_data_at: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> str:
    connection_state = get_device_connection_state(device, now)
    if connection_state in {"archived", "disconnected"}:
        return connection_state
    if connection_state == "connected":
        return "active" if is_device_streaming(latest_data_at, now) else "connected_no_data"
    return "offline"


def get_device_status_label(device_status: str) -> str:
    return {
        "active": "Active",
        "connected_no_data": "Connected, no data",
        "connected": "Connected",
        "disconnected": "Disconnected",
        "offline": "Offline",
        "archived": "Archived",
    }.get(device_status, "Offline")


def build_device_status_payload(
    device: Optional[Device],
    latest_data_at: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    current = now or datetime.utcnow()
    connection_state = get_device_connection_state(device, current)
    data_state = get_device_data_state(latest_data_at, current)
    device_status = get_device_operational_status(device, latest_data_at, current)
    return {
        "is_online": connection_state == "connected",
        "connection_state": connection_state,
        "data_state": data_state,
        "device_status": device_status,
        "device_status_label": get_device_status_label(device_status),
        "latest_data_at": latest_data_at.isoformat() if latest_data_at else None,
    }


def is_session_active(session: Optional[UserSession], now: Optional[datetime] = None) -> bool:
    if not session:
        return False

    # Treat any persisted session row as logged-in presence until the user
    # explicitly logs out and the session is deleted. This keeps the admin
    # dashboard aligned with the product expectation that "Login" remains
    # visible while the account is still signed in on the phone.
    return bool(getattr(session, "token", None) and getattr(session, "refresh_token", None))


def get_user_presence_status(
    has_active_session: bool,
    has_online_devices: bool,
) -> str:
    if not has_active_session:
        return "logout"
    if has_online_devices:
        return "active"
    return "login"


def summarize_user_presence(
    devices: Iterable[Device],
    sessions: Iterable[UserSession],
    now: Optional[datetime] = None,
) -> Tuple[str, int]:
    current = now or datetime.utcnow()
    online_devices = sum(1 for device in devices if is_device_online(device, current))
    has_active_session = any(is_session_active(session, current) for session in sessions)
    return get_user_presence_status(has_active_session, online_devices > 0), online_devices
