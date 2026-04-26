from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Iterable, Optional, Tuple

from .models import Device, UserSession


DEVICE_ONLINE_WINDOW_SECONDS = int(os.getenv("DEVICE_ONLINE_WINDOW_SECONDS", "120"))


def get_device_online_cutoff(now: Optional[datetime] = None) -> datetime:
    current = now or datetime.utcnow()
    return current - timedelta(seconds=DEVICE_ONLINE_WINDOW_SECONDS)


def is_device_online(device: Optional[Device], now: Optional[datetime] = None) -> bool:
    if not device or not bool(getattr(device, "is_connected", False)):
        return False

    last_seen = getattr(device, "last_seen", None)
    if not last_seen:
        return False

    return last_seen >= get_device_online_cutoff(now)


def get_device_connection_state(device: Optional[Device], now: Optional[datetime] = None) -> str:
    if not device:
        return "offline"
    if bool(getattr(device, "is_archived", False)):
        return "archived"
    if is_device_online(device, now):
        return "connected"
    return "disconnected"


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
