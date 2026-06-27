"""
Main API routes for the Fall Detection system - FIXED WITH PROPER HTTP STATUS CODES
"""

import logging
import asyncio
import re
import io
import json
import os
import jwt
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query, Header, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import text, func, or_
import math
import time

from ..database import get_db, SessionLocal
from ..services.ai_model import append_raw_sample, load_model_and_scaler, predict_fall, get_raw_buffer_size, clear_raw_buffer
from .. import crud, schemas, models
from ..services.auth_service import AuthService
from ..models import User, UserAuth, Alert, Prediction, Device, DeletedDevice, CareLink, VitalSensorData, EmergencyLog, UserPushToken
from ..device_auth import device_auth
from ..config import SECRET_KEY, ALGORITHM, ADMIN_EMAILS, MIN_REALTIME_SAMPLES_FOR_ALERT, AI_PREDICTION_INTERVAL_SECONDS
from ..double_verification import DoubleVerificationSystem
from ..services.notification_service import NotificationService
from ..services.mqtt_service import publish_device_command
from ..services.wrist_fall_detector import update_wrist_fall_detector
from ..realtime import notify_user, notify_users, notify_admins
from ..status_utils import build_device_status_payload, is_device_online, summarize_user_presence

logger = logging.getLogger(__name__)
router = APIRouter()
notification_service = NotificationService()
_last_ai_prediction_at_by_stream: Dict[str, float] = {}
_caregiver_push_sent_alert_ids: set[int] = set()

# ======================
# Helper functions
# ======================

def _should_run_periodic_ai(buffer_key: str, now: Optional[float] = None) -> bool:
    """Throttle neural inference for normal telemetry streams."""
    now = time.monotonic() if now is None else now
    last = _last_ai_prediction_at_by_stream.get(buffer_key, 0.0)
    if now - last < AI_PREDICTION_INTERVAL_SECONDS:
        return False
    _last_ai_prediction_at_by_stream[buffer_key] = now
    return True

def _utc_iso_z(value: Any) -> Optional[str]:
    """Serialize datetimes as explicit UTC so mobile clients do not shift by local timezone."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z") or re.search(r"[+-]\d{2}:?\d{2}$", text):
            return text
        return f"{text}Z"
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return None

def _utc_now_iso_z() -> str:
    return _utc_iso_z(datetime.utcnow()) or datetime.utcnow().isoformat() + "Z"

def _json_safe_optional(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (dict, list)):
        return value
    if hasattr(value, "isoformat"):
        return _utc_iso_z(value)
    return None

def _get_column_value(model: Any, attr: str) -> Any:
    if not hasattr(model, "__table__"):
        return None
    if attr not in model.__table__.columns:
        return None
    return _json_safe_optional(getattr(model, attr, None))

def _serialize_alert(alert: Alert) -> Dict[str, Any]:
    return {
        "id": alert.id,
        "user_id": alert.user_id,
        "prediction_id": alert.prediction_id,
        "device_id": getattr(alert, "device_id", None),
        "type": alert.alert_type,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "message": alert.message,
        "status": alert.status,
        "timestamp": _utc_iso_z(alert.timestamp),
        "resolved_at": _utc_iso_z(getattr(alert, "resolved_at", None)),
        "location": _get_column_value(alert, "location"),
        "response_notes": _get_column_value(alert, "response_notes"),
        "metadata": _get_column_value(alert, "metadata"),
        "acknowledged_by": getattr(alert, "acknowledged_by", None),
        "acknowledged_at": _utc_iso_z(getattr(alert, "acknowledged_at", None)),
    }


def _get_caregiver_ids_for_patient(db: Session, patient_id: Optional[int]) -> List[int]:
    if not patient_id:
        return []

    try:
        links = crud.get_care_links_by_patient(db, patient_id)
    except Exception as exc:
        logger.warning("Failed to load caregiver links for realtime fanout patient_id=%s: %s", patient_id, exc)
        return []

    caregiver_ids: List[int] = []
    for link in links or []:
        caregiver_id = getattr(link, "caregiver_id", None)
        if caregiver_id and caregiver_id not in caregiver_ids:
            caregiver_ids.append(int(caregiver_id))
    return caregiver_ids


async def _notify_patient_and_caregivers(
    db: Session,
    patient_id: Optional[int],
    resource: str,
    action: str = "updated",
    payload: Optional[Dict[str, Any]] = None,
    throttle_seconds: Optional[float] = None,
) -> None:
    if not patient_id:
        return

    target_ids = [int(patient_id), *_get_caregiver_ids_for_patient(db, patient_id)]
    await notify_users(
        target_ids,
        resource,
        action=action,
        payload=payload,
        throttle_seconds=throttle_seconds,
    )

def _notify_caregivers_push_once(db: Session, alert: Optional[Alert], reason: Optional[str] = None) -> None:
    if not alert or not getattr(alert, "id", None) or not getattr(alert, "user_id", None):
        return

    alert_id = int(alert.id)
    if alert_id in _caregiver_push_sent_alert_ids:
        return

    _caregiver_push_sent_alert_ids.add(alert_id)
    notification_service.notify_caregivers_alert(
        db=db,
        patient_id=int(alert.user_id),
        alert=alert,
        reason=reason or getattr(alert, "alert_type", None),
    )

def _notify_caregivers_push_for_alert_id(alert_id: int, reason: Optional[str] = None) -> None:
    db = SessionLocal()
    try:
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        _notify_caregivers_push_once(db, alert, reason=reason)
    except Exception as exc:
        logger.warning("Caregiver push notification failed for alert_id=%s: %s", alert_id, exc)
    finally:
        db.close()

def _get_latest_motion_timestamp(db: Session, device_id: str) -> Optional[datetime]:
    return (
        db.query(func.max(models.MotionSensorData.timestamp))
        .filter(models.MotionSensorData.device_id == device_id)
        .scalar()
    )


def _find_deleted_device(db: Session, device_id: str) -> Optional[DeletedDevice]:
    return db.query(DeletedDevice).filter(DeletedDevice.device_id == device_id).first()


def _assert_device_not_deleted(
    db: Session,
    device_id: str,
    reconnecting_user_id: Optional[int] = None,
) -> None:
    deleted_device = _find_deleted_device(db, device_id)
    if deleted_device is not None:
        # Allow the same user who previously removed the device to reclaim it.
        if reconnecting_user_id is not None and deleted_device.user_id == reconnecting_user_id:
            db.delete(deleted_device)
            db.commit()
            logger.info(
                "Reclaimed previously deleted device_id=%s for user_id=%s",
                device_id,
                reconnecting_user_id,
            )
            return

        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={
                "success": False,
                "error": "Device was permanently blocked and cannot reconnect automatically",
            },
        )


def _serialize_device(
    db: Session,
    device: Device,
    latest_data_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    buffer_key = f"{device.user_id}:{device.device_id}" if device and device.user_id and device.device_id else ""
    ai_samples_collected = get_raw_buffer_size(buffer_key) if buffer_key else 0
    ai_warmup = 0 < ai_samples_collected < MIN_REALTIME_SAMPLES_FOR_ALERT
    status_payload = build_device_status_payload(
        device,
        latest_data_at=latest_data_at or _get_latest_motion_timestamp(db, device.device_id),
        ai_warmup=ai_warmup,
        ai_samples_collected=ai_samples_collected,
        ai_min_samples_for_alert=MIN_REALTIME_SAMPLES_FOR_ALERT,
    )
    return {
        "id": device.id,
        "user_id": device.user_id,
        "device_id": device.device_id,
        "mac_address": device.mac_address,
        "firmware_version": device.firmware_version,
        "battery_level": device.battery_level,
        "is_connected": device.is_connected,
        "is_archived": device.is_archived,
        "last_seen": _utc_iso_z(device.last_seen),
        "created_at": _utc_iso_z(device.created_at),
        **status_payload,
    }

def _serialize_motion(motion: models.MotionSensorData) -> Dict[str, Any]:
    return {
        "id": motion.id,
        "user_id": motion.user_id,
        "device_id": motion.device_id,
        "acc_x": motion.acc_x,
        "acc_y": motion.acc_y,
        "acc_z": motion.acc_z,
        "acc_mag": motion.acc_mag,
        "gyro_x": motion.gyro_x,
        "gyro_y": motion.gyro_y,
        "gyro_z": motion.gyro_z,
        "gyro_mag": motion.gyro_mag,
        "temperature": motion.temperature,
        "is_fall_suspected": motion.is_fall_suspected,
        "timestamp": _utc_iso_z(motion.timestamp),
    }

def _serialize_user_profile(user: User) -> Dict[str, Any]:
    devices = list(getattr(user, "devices", []) or [])
    sessions = list(getattr(user, "sessions", []) or [])
    last_seen = None
    for device in devices:
        if device.last_seen and (last_seen is None or device.last_seen > last_seen):
            last_seen = device.last_seen
    presence_status, online_devices = summarize_user_presence(devices, sessions)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.auth.email if getattr(user, "auth", None) else None,
        "phone": getattr(user, "phone", None),
        "age": user.age,
        "gender": user.gender,
        "weight": user.weight,
        "height": user.height,
        "medical_conditions": user.medical_conditions,
        "emergency_contact": user.emergency_contact,
        "is_active": user.is_active,
        "presence_status": presence_status,
        "online_devices": online_devices,
        "created_at": _utc_iso_z(user.created_at),
        "updated_at": _utc_iso_z(user.updated_at),
        "devices": len(devices),
        "last_seen": _utc_iso_z(last_seen),
    }

def _serialize_vital(vital: VitalSensorData) -> Dict[str, Any]:
    return {
        "id": vital.id,
        "user_id": vital.user_id,
        "device_id": getattr(vital, "device_id", None),
        "heart_rate": vital.heart_rate,
        "blood_pressure_systolic": vital.blood_pressure_systolic,
        "blood_pressure_diastolic": vital.blood_pressure_diastolic,
        "oxygen_saturation": vital.oxygen_saturation,
        "body_temperature": vital.body_temperature,
        "respiration_rate": vital.respiration_rate,
        "is_abnormal": bool(vital.is_abnormal),
        "abnormality_type": vital.abnormality_type,
        "timestamp": _utc_iso_z(vital.timestamp),
    }


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return parsed


def _safe_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    if value is None:
        return fallback
    return bool(value)


def _store_telemetry_vitals_fallback(
    db: Session,
    *,
    user_id: int,
    device_id: str,
    vitals: Dict[str, Any],
    timestamp: Optional[datetime] = None,
) -> Optional[VitalSensorData]:
    """Persist one useful fallback reading from legacy motion telemetry vitals."""
    if _safe_bool(vitals.get("max_powered"), fallback=True):
        return None

    heart_rate = _safe_float(vitals.get("heart_rate"))
    spo2 = _safe_float(vitals.get("spo2", vitals.get("oxygen_saturation")))

    heart_rate = heart_rate if heart_rate is not None and 35 <= heart_rate <= 220 else None
    spo2 = spo2 if spo2 is not None and 70 <= spo2 <= 100 else None

    # Legacy motion telemetry repeats one device timestamp across a whole batch.
    # Use server receive time so a final fallback snapshot behaves like one
    # measurement result instead of many identical historical rows.
    vital_timestamp = datetime.utcnow()

    if heart_rate is None and spo2 is None:
        return None

    latest_vital = (
        db.query(VitalSensorData)
        .filter(VitalSensorData.user_id == user_id)
        .filter(VitalSensorData.device_id == device_id)
        .order_by(VitalSensorData.timestamp.desc(), VitalSensorData.id.desc())
        .first()
    )
    if latest_vital and latest_vital.timestamp:
        seconds_since_latest = (vital_timestamp - latest_vital.timestamp).total_seconds()
        if seconds_since_latest <= 600:
            latest_vital.heart_rate = heart_rate
            latest_vital.oxygen_saturation = spo2
            latest_vital.body_temperature = None
            latest_vital.respiration_rate = None
            latest_vital.timestamp = vital_timestamp
            abnormalities: List[str] = []
            if heart_rate is not None and (heart_rate < 55 or heart_rate > 120):
                abnormalities.append("heart_rate")
            if spo2 is not None and spo2 < 92:
                abnormalities.append("oxygen_saturation")
            latest_vital.is_abnormal = bool(abnormalities)
            latest_vital.abnormality_type = ", ".join(abnormalities) if abnormalities else None
            db.commit()
            db.refresh(latest_vital)
            return latest_vital

    vital_data = schemas.VitalDataCreate(
        user_id=user_id,
        device_id=device_id,
        heart_rate=heart_rate,
        oxygen_saturation=spo2,
        timestamp=vital_timestamp,
    )
    return crud.create_vital_data(db, vital_data)


def _normalize_vitals_status_payload(payload: Dict[str, Any], device: Optional[Device] = None) -> Dict[str, Any]:
    heart_rate = _safe_float(payload.get("heart_rate"))
    spo2 = _safe_float(payload.get("spo2", payload.get("oxygen_saturation")))
    last_heart_rate = _safe_float(payload.get("last_heart_rate"))
    last_spo2 = _safe_float(payload.get("last_spo2"))

    if (heart_rate is None or heart_rate <= 0) and last_heart_rate is not None and last_heart_rate > 0:
        heart_rate = last_heart_rate
    if (spo2 is None or spo2 <= 0) and last_spo2 is not None and last_spo2 > 0:
        spo2 = last_spo2

    hr_valid = _safe_bool(payload.get("heart_rate_valid"), heart_rate is not None and heart_rate > 0)
    spo2_valid = _safe_bool(payload.get("spo2_valid"), spo2 is not None and spo2 > 0)
    return {
        "message_type": "vitals_status",
        "device_id": payload.get("device_id") or (device.device_id if device else None),
        "user_id": payload.get("user_id") or (device.user_id if device else None),
        "request_id": payload.get("request_id"),
        "vitals_trigger": payload.get("vitals_trigger") or "manual",
        "state": payload.get("state") or "unknown",
        "progress_percent": payload.get("progress_percent", 0),
        "finger_detected": _safe_bool(payload.get("finger_detected")),
        "heart_rate": heart_rate,
        "spo2": spo2,
        "heart_rate_valid": hr_valid and heart_rate is not None and heart_rate > 0,
        "spo2_valid": spo2_valid and spo2 is not None and spo2 > 0,
        "max_powered": _safe_bool(payload.get("max_powered")),
        "signal_status": payload.get("signal_status"),
        "timestamp": _utc_iso_z(payload.get("timestamp")) or _utc_now_iso_z(),
    }


def _serialize_vitals_measurement(measurement: models.VitalsMeasurement) -> Dict[str, Any]:
    return {
        "id": measurement.id,
        "request_id": measurement.request_id,
        "device_id": measurement.device_id,
        "user_id": measurement.user_id,
        "vital_id": measurement.vital_id,
        "vitals_trigger": measurement.vitals_trigger,
        "state": measurement.state,
        "progress_percent": measurement.progress_percent,
        "finger_detected": bool(measurement.finger_detected),
        "heart_rate": measurement.heart_rate,
        "spo2": measurement.oxygen_saturation,
        "heart_rate_valid": bool(measurement.heart_rate_valid),
        "spo2_valid": bool(measurement.spo2_valid),
        "max_powered": bool(measurement.max_powered),
        "signal_status": measurement.signal_status,
        "started_at": _utc_iso_z(measurement.started_at),
        "completed_at": _utc_iso_z(measurement.completed_at),
        "updated_at": _utc_iso_z(measurement.updated_at),
    }

def _serialize_prediction(pred: Prediction) -> Dict[str, Any]:
    return {
        "id": pred.id,
        "user_id": pred.user_id,
        "motion_data_id": pred.motion_data_id,
        "fall_now_probability": pred.fall_now_probability,
        "fall_soon_probability": pred.fall_soon_probability,
        "fall_now_prediction": pred.fall_now_prediction,
        "fall_soon_prediction": pred.fall_soon_prediction,
        "vital_check_performed": pred.vital_check_performed,
        "vital_check_result": pred.vital_check_result,
        "final_verdict": pred.final_verdict,
        "confidence_score": pred.confidence_score,
        "timestamp": _utc_iso_z(pred.timestamp),
    }

def _build_emergency_message(
    emergency_type: str,
    user_name: str,
    language: str = "en",
    location: Optional[Dict[str, Any]] = None,
    fall_data: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    safe_name = user_name.strip() or "User"
    message = ""
    severity = "high"
    is_ar = str(language or "en").lower().startswith("ar")

    if emergency_type == "fall":
        message = (
            f"طوارئ: قد يكون {safe_name} تعرّض للسقوط!"
            if is_ar
            else f"EMERGENCY: {safe_name} may have fallen!"
        )
        severity = "critical"
        confidence = fall_data.get("confidence") if isinstance(fall_data, dict) else None
        if isinstance(confidence, (int, float)):
            message += (
                f" نسبة الثقة: {round(float(confidence) * 100)}%"
                if is_ar
                else f" Confidence: {round(float(confidence) * 100)}%"
            )
    elif emergency_type == "manual":
        message = (
            f"طوارئ: {safe_name} يطلب المساعدة فورًا!"
            if is_ar
            else f"EMERGENCY: {safe_name} is requesting immediate help!"
        )
        severity = "critical"
    elif emergency_type == "vital_abnormal":
        message = (
            f"طوارئ: تم اكتشاف مؤشرات حيوية غير طبيعية لدى {safe_name}."
            if is_ar
            else f"EMERGENCY: Abnormal vital signs detected for {safe_name}."
        )
        severity = "high"
    elif emergency_type == "inactivity":
        message = (
            f"طوارئ: لا توجد حركة من {safe_name} منذ فترة طويلة."
            if is_ar
            else f"EMERGENCY: No activity detected for {safe_name} for an extended period."
        )
        severity = "medium"
    else:
        message = (
            f"طوارئ: {safe_name} يحتاج إلى تدخل فوري."
            if is_ar
            else f"EMERGENCY: {safe_name} needs immediate attention."
        )

    if location and location.get("latitude") is not None and location.get("longitude") is not None:
        message += (
            f"\n{'الموقع' if is_ar else 'Location'}: https://maps.google.com/?q="
            f"{location['latitude']},{location['longitude']}"
        )

    message += f"\n{'الوقت' if is_ar else 'Time'}: {datetime.utcnow().strftime('%I:%M:%S %p')}"
    message += "\nمرسلة من تطبيق كشف السقوط" if is_ar else "\nSent from Fall Detection App"
    return message, severity

def _ensure_device_for_ingest(
    db: Session,
    device_id: str,
    user_id: Optional[int],
    battery_level: Optional[float] = None,
    firmware_version: Optional[str] = None
) -> Device:
    """Ensure device exists and belongs to user."""
    _assert_device_not_deleted(db, device_id)
    device = crud.get_device_by_id(db, device_id)
    if device is None:
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "user_id is required for new device"}
            )
        device_payload = schemas.DeviceCreate(
            user_id=user_id,
            device_id=device_id,
            firmware_version=firmware_version,
            battery_level=battery_level,
        )
        device = crud.create_device(db, device_payload)
    else:
        if user_id and device.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Device ID already registered to another user"}
            )

    # Update device metadata if provided and always refresh presence on ingest.
    updated = False
    if battery_level is not None:
        device.battery_level = battery_level
        updated = True
    if firmware_version:
        device.firmware_version = firmware_version
        updated = True
    if device.is_archived:
        device.is_archived = False
        updated = True

    presence_changed = not bool(device.is_connected)
    device.is_connected = True
    device.last_seen = datetime.utcnow()

    if updated or presence_changed:
        db.commit()
        db.refresh(device)
    else:
        db.commit()
        db.refresh(device)

    return device

def _handle_device_payload(
    payload: schemas.DeviceIngestPayload,
    db: Session
) -> Dict[str, Any]:
    """Process a single device payload (motion + vitals)."""
    device = _ensure_device_for_ingest(
        db,
        device_id=payload.device_id,
        user_id=payload.user_id,
        battery_level=payload.battery_level,
        firmware_version=payload.firmware_version,
    )

    user_id = payload.user_id or device.user_id
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "error": "user_id could not be resolved"}
        )

    result: Dict[str, Any] = {
        "device_id": device.device_id,
        "user_id": user_id,
        "motion": None,
        "vitals": None,
        "vitals_ignored": False,
    }

    if payload.motion:
        motion_dict = payload.motion.dict(exclude_none=True)
        motion_dict["user_id"] = user_id
        motion_dict["device_id"] = device.device_id
        for field in (
            "event_type",
            "alert_type",
            "fall_detected",
            "prediction",
            "confidence",
            "source",
            "requires_ai_confirmation",
            "local_fall_alert",
            "local_activity",
        ):
            value = getattr(payload, field, None)
            if value is not None:
                motion_dict[field] = value
        if payload.timestamp and not motion_dict.get("timestamp"):
            motion_dict["timestamp"] = payload.timestamp
        response, _, _, _ = _process_motion_data_internal(motion_dict, db)
        result["motion"] = response

    if payload.vitals:
        # Regular motion telemetry may carry stale/held MAX30102 values. Persist
        # official vitals through /device-data/vitals-status when an on-demand
        # measurement completes. Some deployed firmware versions still include
        # useful HR/SpO2 here, so store a throttled fallback for dashboards.
        result["vitals_ignored"] = True
        stored_vital = _store_telemetry_vitals_fallback(
            db,
            user_id=user_id,
            device_id=device.device_id,
            vitals=payload.vitals,
            timestamp=payload.timestamp,
        )
        if stored_vital:
            result["vitals"] = _serialize_vital(stored_vital)
            result["vitals_fallback_stored"] = True

    return result


def _parse_iso_datetime(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "error": f"Invalid date format: {value}"}
        ) from e
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def _require_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Authorization token required"}
        )

    auth = AuthService(db)
    session = auth.verify_token(token)
    if session and session.get("user"):
        return session

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except Exception as exc:
        logger.warning(f"JWT fallback verification failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid or expired token"}
        )

    user = db.query(User).filter(User.id == user_id).first()
    user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
    if not user or not user_auth:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid or expired token"}
        )

    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user_auth.email,
        },
        "token": token,
        "auth_mode": "jwt_fallback",
    }


def _build_report_data(
    db: Session,
    user_id: int,
    start_date: datetime,
    end_date: Optional[datetime] = None,
) -> Dict[str, Any]:
    if end_date is None:
        end_date = datetime.utcnow()

    alerts = db.query(Alert).filter(
        Alert.user_id == user_id,
        Alert.timestamp >= start_date,
        Alert.timestamp <= end_date,
    ).all()

    vitals = db.query(VitalSensorData).filter(
        VitalSensorData.user_id == user_id,
        VitalSensorData.timestamp >= start_date,
        VitalSensorData.timestamp <= end_date,
    ).all()

    by_type: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    by_status: Dict[str, int] = {}
    daily_counts: Dict[str, int] = {}
    hour_counts: Dict[int, int] = {}

    for alert in alerts:
        by_type[alert.alert_type] = by_type.get(alert.alert_type, 0) + 1
        by_severity[alert.severity] = by_severity.get(alert.severity, 0) + 1
        by_status[alert.status] = by_status.get(alert.status, 0) + 1
        if alert.timestamp:
            day_key = alert.timestamp.strftime("%Y-%m-%d")
            daily_counts[day_key] = daily_counts.get(day_key, 0) + 1
            hour_counts[alert.timestamp.hour] = hour_counts.get(alert.timestamp.hour, 0) + 1

    falls_count = by_type.get("fall", 0)
    abnormal_count = sum(1 for v in vitals if v.is_abnormal)
    abnormal_rate = (abnormal_count / len(vitals)) if vitals else 0.0

    def avg(values: List[Optional[float]]) -> Optional[float]:
        filtered = [v for v in values if v is not None]
        if not filtered:
            return None
        return sum(filtered) / len(filtered)

    avg_hr = avg([v.heart_rate for v in vitals])
    avg_ox = avg([v.oxygen_saturation for v in vitals])
    avg_temp = avg([v.body_temperature for v in vitals])

    most_common_hour = None
    if hour_counts:
        most_common_hour = max(hour_counts.items(), key=lambda x: x[1])[0]

    recommendations: List[str] = []
    if falls_count >= 2:
        recommendations.append("High fall risk detected. Consider more frequent checks.")
    if abnormal_rate >= 0.2:
        recommendations.append("Frequent abnormal vitals. Consider medical review.")
    if avg_ox is not None and avg_ox < 92:
        recommendations.append("Low oxygen levels detected. Monitor closely.")
    if avg_hr is not None and avg_hr > 100:
        recommendations.append("Elevated heart rate on average. Consider rest and follow-up.")
    if not recommendations:
        recommendations.append("No critical issues detected. Keep up the good routine.")

    daily_series = [
        {"date": k, "count": v}
        for k, v in sorted(daily_counts.items(), key=lambda x: x[0])
    ]

    period_days = max((end_date - start_date).days, 1)

    return {
        "user_id": user_id,
        "period_days": period_days,
        "alerts": {
            "total": len(alerts),
            "by_type": by_type,
            "by_severity": by_severity,
            "by_status": by_status,
            "daily_counts": daily_series,
            "most_common_hour": most_common_hour,
        },
        "vitals": {
            "total": len(vitals),
            "abnormal_rate": abnormal_rate,
            "avg_heart_rate": avg_hr,
            "avg_oxygen": avg_ox,
            "avg_temperature": avg_temp,
        },
        "recommendations": recommendations,
    }

# ======================
# Notifications
# ======================

@router.post("/notifications/register", response_model=Dict[str, Any])
async def register_push_token(
    payload: schemas.PushTokenRegister,
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """Register or update a push token for the authenticated user."""
    user = session.get("user") or {}
    try:
        user_id = int(user.get("id"))
    except Exception as e:
        logger.error(f"Invalid user in session: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid session user"},
        )

    existing = (
        db.query(UserPushToken)
        .filter(UserPushToken.user_id == user_id, UserPushToken.token == payload.token)
        .first()
    )
    now = datetime.utcnow()
    if existing:
        existing.platform = payload.platform or existing.platform
        existing.device_id = payload.device_id or existing.device_id
        existing.is_active = True
        existing.last_seen = now
    else:
        record = UserPushToken(
            user_id=user_id,
            token=payload.token,
            platform=payload.platform or "unknown",
            device_id=payload.device_id,
            is_active=True,
            last_seen=now,
        )
        db.add(record)

    db.commit()

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "message": "Push token registered",
            "timestamp": _utc_iso_z(now),
        },
    )

# ======================
# Health & System Routes
# ======================

@router.get("/health", response_model=Dict[str, Any])
async def health_check(db: Session = Depends(get_db)):
    """Check system health with proper status codes"""
    try:
        # Check database connection
        try:
            db.execute(text("SELECT 1"))
            database_connected = True
        except Exception as db_error:
            logger.error(f"Database connection failed: {db_error}")
            database_connected = False
        
        # Check model availability
        try:
            model, scaler = load_model_and_scaler()
            model_loaded = True
        except Exception as model_error:
            logger.warning(f"Model loading failed: {model_error}")
            model_loaded = False
        
        # Get system statistics
        total_users = db.query(User).count()
        total_alerts = db.query(Alert).count()
        
        health_status = "healthy" if database_connected and model_loaded else "degraded"
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "status": health_status,
                "timestamp": _utc_now_iso_z(),
                "components": {
                    "database": {
                        "connected": database_connected,
                        "status": "ok" if database_connected else "error"
                    },
                    "ai_model": {
                        "loaded": model_loaded,
                        "status": "ok" if model_loaded else "warning"
                    },
                    "notification_service": {
                        "available": notification_service.is_available(),
                        "status": "ok" if notification_service.is_available() else "warning"
                    }
                },
                "statistics": {
                    "total_users": total_users,
                    "total_alerts": total_alerts,
                    "uptime": 0.0  # This would come from a monitoring system
                },
                "version": "2.0.0",
                "service": "fall_detection_api"
            }
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "success": False,
                "error": f"System health check failed: {str(e)}",
                "status": "unhealthy"
            }
        )

@router.get("/", response_model=Dict[str, Any])
async def root():
    """API root endpoint"""
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "name": "Fall Detection API",
            "version": "2.0.0",
            "description": "AI-powered fall detection with double verification system",
            "documentation": "/docs",
            "endpoints": {
                "health": "/health",
                "authentication": "/api/v1/auth/*",
                "motion_data": "/api/v1/motion",
                "motion_history": "/api/v1/motion/{user_id}",
                "vital_signs": "/api/v1/vitals",
                "vital_history": "/api/v1/vitals/{user_id}",
                "predictions": "/api/v1/predictions/{user_id}",
                "alerts": "/api/v1/alerts",
                "users": "/api/v1/users",
                "emergency": "/api/v1/emergency/*",
                "care_links": "/api/v1/care/links"
            },
            "status": "operational",
            "timestamp": _utc_now_iso_z()
        }
    )

# ======================
# Authentication Routes - WITH PROPER STATUS CODES
# ======================

@router.post("/auth/login", response_model=Dict[str, Any])
async def login(
    login_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """User login endpoint with proper HTTP status codes"""
    try:
        email = login_data.get("email", "").lower().strip()
        password = login_data.get("password", "")
        
        logger.info(f"Login attempt for: {email}")
        
        if not email or not password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Email and password are required"
                }
            )
        
        # Use real auth service
        auth = AuthService(db)
        
        try:
            # Check database connection
            db_check = auth.check_database_connection()
            if not db_check.get("connected", False):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "success": False,
                        "error": "Database connection failed"
                    }
                )
            
            # Verify user exists
            email_exists = auth.check_email_exists(email)
            if not email_exists:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "success": False,
                        "error": "User not found"
                    }
                )
            
            # Attempt login
            result = auth.login_user(email, password)
            
            if not result or "access_token" not in result:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "success": False,
                        "error": "Invalid credentials"
                    }
                )
            
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "access_token": result["access_token"],
                    "refresh_token": result["refresh_token"],
                    "token_type": "bearer",
                    "expires_in": 3600,  # 1 hour
                    "user": result["user"],
                    "message": "Login successful"
                }
            )
            
        except HTTPException:
            raise
        except Exception as auth_error:
            logger.error(f"Auth service error: {auth_error}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "success": False,
                    "error": "Authentication failed"
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Login failed: {str(e)}"
            }
        )

@router.post("/auth/register", response_model=Dict[str, Any])
async def register(
    register_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """User registration with proper status codes"""
    try:
        email = register_data.get("email", "").lower().strip()
        password = register_data.get("password", "")
        name = register_data.get("name", "")
        confirm_password = register_data.get("confirm_password", "")
        
        logger.info(f"Registration attempt: {email}")
        
        # Validation
        if not email or not password or not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Email, password, and name are required"
                }
            )
        
        if password != confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Passwords do not match"
                }
            )
        
        # Email validation
        if "@" not in email or "." not in email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Invalid email format"
                }
            )
        
        # Use auth service
        auth = AuthService(db)
        
        try:
            # Check database
            db_check = auth.check_database_connection()
            if not db_check.get("connected", False):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "success": False,
                        "error": "Database connection failed"
                    }
                )
            
            # Check if email exists
            email_exists = auth.check_email_exists(email)
            if email_exists:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "success": False,
                        "error": "Email already registered"
                    }
                )
            
            # Prepare user data
            user_data = {
                'name': name,
                'email': email,
                'password': password,
                'confirm_password': confirm_password,
                'phone': register_data.get('phone', ''),
                'age': register_data.get('age'),
                'gender': register_data.get('gender', 'male'),
                'weight': register_data.get('weight'),
                'height': register_data.get('height'),
                'medical_conditions': register_data.get('medical_conditions'),
                'emergency_contact': register_data.get('emergency_contact')
            }
            
            # Register user
            result = auth.register_user(user_data)
            
            if not result.get("success", False):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "success": False,
                        "error": result.get("message", "Registration failed")
                    }
                )
            
            return JSONResponse(
                status_code=status.HTTP_201_CREATED,
                content={
                    "success": True,
                    "message": "Registration successful",
                    "user": result.get("user"),
                    "requires_login": True,
                    "instructions": "Please login with your credentials"
                }
            )
            
        except HTTPException:
            raise
        except Exception as auth_error:
            logger.error(f"Registration error: {auth_error}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": str(auth_error)
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Registration failed: {str(e)}"
            }
        )

@router.post("/auth/refresh", response_model=Dict[str, Any])
async def refresh_token(
    refresh_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Refresh authentication token"""
    try:
        refresh_token = refresh_data.get("refresh_token")
        
        if not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Refresh token is required"
                }
            )
        
        auth = AuthService(db)
        result = auth.refresh_token(refresh_token)
        
        if not result.get("success", False):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "success": False,
                    "error": result.get("message", "Invalid refresh token")
                }
            )
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=result
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token refresh error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Token refresh failed: {str(e)}"
            }
        )

@router.post("/auth/logout", response_model=Dict[str, Any])
async def logout(
    logout_data: Dict[str, Any],
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Logout user and invalidate token"""
    try:
        token = logout_data.get("token") or (authorization.split(" ")[1] if authorization else None)
        
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Token is required"
                }
            )
        
        auth = AuthService(db)
        result = auth.logout_user(token)
        
        if not result:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Logout failed"
                }
            )
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Logged out successfully"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Logout failed: {str(e)}"
            }
        )

@router.post("/auth/check-email", response_model=Dict[str, Any])
async def check_email(
    email_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Check if email exists in database"""
    try:
        email = email_data.get("email", "").lower().strip()
        
        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Email is required"
                }
            )
        
        # Basic email validation
        if "@" not in email or "." not in email:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "exists": False,
                    "email": email,
                    "message": "Invalid email format",
                    "valid_format": False
                }
            )
        
        auth = AuthService(db)
        exists = auth.check_email_exists(email)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "exists": exists,
                "email": email,
                "valid_format": True,
                "message": "Email found in database" if exists else "Email not found in database"
            }
        )
        
    except Exception as e:
        logger.error(f"Check email error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Email check failed: {str(e)}"
            }
        )

@router.post("/auth/check-phone", response_model=Dict[str, Any])
async def check_phone(
    phone_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Check if phone exists in database"""
    try:
        phone = phone_data.get("phone", "").strip()

        if not phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Phone is required"
                }
            )

        normalized = re.sub(r'[\s\-\(\)]', '', phone).strip()
        if not normalized:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "exists": False,
                    "phone": phone,
                    "valid_format": False,
                    "message": "Invalid phone format"
                }
            )

        exists = crud.get_user_by_phone(db, normalized) is not None

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "exists": exists,
                "phone": normalized,
                "valid_format": True,
                "message": "Phone found in database" if exists else "Phone not found in database"
            }
        )

    except Exception as e:
        logger.error(f"Check phone error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Phone check failed: {str(e)}"
            }
        )

# ======================
# Motion Data Routes - WITH PROPER STATUS CODES
# ======================

def _boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "fall", "fall_now"}
    return False


def _extract_local_fall_hint(data: Dict[str, Any]) -> Dict[str, Any]:
    """Read fast fall evidence coming from the ESP local detector."""
    nested = data.get("local_fall_alert")
    if not isinstance(nested, dict):
        nested = {}

    event_type = str(data.get("event_type") or "").lower()
    alert_type = str(data.get("alert_type") or nested.get("label") or "").lower()
    prediction = str(data.get("prediction") or "").lower()
    source = str(data.get("source") or "").lower()

    confidence_raw = (
        data.get("local_fall_confidence")
        if data.get("local_fall_confidence") is not None
        else data.get("confidence")
    )
    if confidence_raw is None:
        confidence_raw = nested.get("confidence")

    try:
        confidence = float(confidence_raw)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    reason = str(data.get("local_fall_reason") or nested.get("reason") or "esp_local_detector")
    candidate = (
        event_type == "fall_candidate" or
        alert_type == "fall_candidate" or
        prediction == "fall_candidate"
    )
    detected = (
        (not candidate and _boolish(data.get("local_fall_alert"))) or
        _boolish(data.get("fall_detected")) or
        (event_type == "fall_alert" and not candidate) or
        alert_type == "fall_now" or
        prediction == "fall_now" or
        (source == "esp_local_detector" and not candidate)
    )

    if detected and confidence <= 0.0:
        confidence = 0.88
    if candidate and confidence <= 0.0:
        confidence = 0.66

    return {
        "detected": detected,
        "candidate": candidate,
        "confidence": confidence,
        "reason": reason,
        "requires_ai_confirmation": _boolish(data.get("requires_ai_confirmation")),
    }


def _motion_dict_from_local_fall_alert(payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
    device_id = payload.get("device_id")
    if not device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "error": "device_id is required"}
        )

    device = crud.get_device_by_id(db, str(device_id))
    user_id = payload.get("user_id") or (device.user_id if device else None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "error": "user_id could not be resolved"}
        )

    motion = payload.get("motion") if isinstance(payload.get("motion"), dict) else {}
    timestamp = payload.get("timestamp") or motion.get("timestamp")
    alert_type = payload.get("alert_type") or "fall_now"
    prediction = payload.get("prediction") or ("fall_candidate" if alert_type == "fall_candidate" else "fall_now")

    return {
        "user_id": int(user_id),
        "device_id": str(device_id),
        "acc_x": motion.get("acc_x", motion.get("ax", 0.0)),
        "acc_y": motion.get("acc_y", motion.get("ay", 0.0)),
        "acc_z": motion.get("acc_z", motion.get("az", 9.81)),
        "gyro_x": motion.get("gyro_x", motion.get("gx", 0.0)),
        "gyro_y": motion.get("gyro_y", motion.get("gy", 0.0)),
        "gyro_z": motion.get("gyro_z", motion.get("gz", 0.0)),
        "temperature": motion.get("temperature", payload.get("temperature", 36.5)),
        "timestamp": timestamp,
        "sampled_at_ms": motion.get("sampled_at_ms", payload.get("sampled_at_ms")),
        "battery_level": payload.get("battery_level"),
        "firmware_version": payload.get("firmware_version"),
        "event_type": payload.get("message_type") or payload.get("event_type") or "fall_alert",
        "alert_type": alert_type,
        "fall_detected": payload.get("fall_detected", alert_type != "fall_candidate"),
        "prediction": prediction,
        "confidence": payload.get("confidence"),
        "source": payload.get("source") or "esp_local_detector",
        "requires_ai_confirmation": payload.get("requires_ai_confirmation"),
        "local_fall_reason": payload.get("reason"),
        "local_fall_confidence": payload.get("confidence"),
        "local_activity": payload.get("activity") or payload.get("local_activity"),
    }


def _run_fall_alert_side_effects(device_id: str, user_id: int, alert_id: int, alert_type: str) -> None:
    """Send post-alert commands/notifications without blocking fast fall ingest."""
    try:
        publish_device_command(
            device_id,
            {
                "message_type": "device_command",
                "command": "vitals_start",
                "request_id": f"{alert_type}-{alert_id}",
                "duration_ms": 60000,
                "source": "fall_alert",
                "vitals_trigger": alert_type,
            },
        )
    except Exception as exc:
        logger.warning("Fall alert vitals command failed in background: %s", exc)

    db = SessionLocal()
    try:
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if alert:
            _notify_caregivers_push_once(
                db,
                alert,
                reason="possible_fall" if alert_type == "fall_candidate" else "fall",
            )
    except Exception as exc:
        logger.warning("Fall alert caregiver notification failed in background: %s", exc)
    finally:
        db.close()


async def _notify_fast_fall_realtime_background(
    user_id: int,
    motion_payload: Optional[Dict[str, Any]],
    prediction_payload: Optional[Dict[str, Any]],
    alert_payload: Optional[Dict[str, Any]],
) -> None:
    db = SessionLocal()
    try:
        if motion_payload:
            await _notify_patient_and_caregivers(db, user_id, "motions", action="created", payload=motion_payload, throttle_seconds=1.0)
            await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=1.0)
        if prediction_payload:
            await _notify_patient_and_caregivers(db, user_id, "predictions", action="created", payload=prediction_payload, throttle_seconds=1.0)
            await notify_admins("predictions", action="created", payload=prediction_payload, throttle_seconds=1.0)
        if alert_payload:
            await _notify_patient_and_caregivers(db, user_id, "alerts", action="created", payload=alert_payload)
            await notify_admins("alerts", action="created", payload=alert_payload)
    except Exception as exc:
        logger.warning("Fast fall realtime notification failed in background: %s", exc)
    finally:
        db.close()


def _motion_rows_to_raw_window(rows: List[models.MotionSensorData]) -> List[List[float]]:
    return [
        [
            float(row.acc_x or 0.0),
            float(row.acc_y or 0.0),
            float(row.acc_z or 0.0),
            float(row.gyro_x or 0.0),
            float(row.gyro_y or 0.0),
            float(row.gyro_z or 0.0),
        ]
        for row in rows
    ]


async def _review_fall_candidate_with_ai_background(alert_id: int, delay_seconds: float = 6.0) -> None:
    """Confirm or auto-resolve fast algorithm candidates using later AI context."""
    await asyncio.sleep(delay_seconds)

    db = SessionLocal()
    try:
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if not alert:
            return
        if alert.alert_type != "fall_candidate" or alert.status not in {"pending", "sent"}:
            return

        since = alert.timestamp - timedelta(seconds=2)
        recent_confirmed = (
            db.query(Prediction)
            .join(models.MotionSensorData, Prediction.motion_data_id == models.MotionSensorData.id)
            .filter(Prediction.user_id == alert.user_id)
            .filter(Prediction.timestamp >= since)
            .filter(models.MotionSensorData.device_id == alert.device_id if alert.device_id else text("1=1"))
            .filter(or_(Prediction.final_verdict == True, Prediction.fall_now_prediction == True))
            .order_by(Prediction.timestamp.desc())
            .first()
        )

        if recent_confirmed:
            alert.alert_type = "fall_now"
            alert.severity = "critical"
            alert.status = "pending"
            alert.prediction_id = recent_confirmed.id
            alert.message = f"Confirmed fall detected by AI after fast bracelet alert. Confidence: {recent_confirmed.confidence_score:.2%}"
            alert.timestamp = datetime.utcnow()
            db.commit()
            db.refresh(alert)
            payload = _serialize_alert(alert)
            await _notify_patient_and_caregivers(db, alert.user_id, "alerts", action="updated", payload=payload)
            await notify_admins("alerts", action="updated", payload=payload)
            return

        rows_query = (
            db.query(models.MotionSensorData)
            .filter(models.MotionSensorData.user_id == alert.user_id)
        )
        if alert.device_id:
            rows_query = rows_query.filter(models.MotionSensorData.device_id == alert.device_id)
        rows = rows_query.order_by(models.MotionSensorData.timestamp.desc()).limit(100).all()
        rows = list(reversed(rows))

        ai_result: Dict[str, Any] = {"success": False}
        if len(rows) >= 20:
            ai_result = predict_fall(_motion_rows_to_raw_window(rows))

        ai_confirms = bool(ai_result.get("success")) and (
            bool(ai_result.get("fall_now_prediction")) or
            float(ai_result.get("fall_now_probability", 0.0) or 0.0) >= 0.75
        )

        latest_motion_id = rows[-1].id if rows else None
        review_prediction = None
        if latest_motion_id and ai_result.get("success"):
            review_prediction = Prediction(
                user_id=alert.user_id,
                motion_data_id=latest_motion_id,
                fall_now_probability=float(ai_result.get("fall_now_probability", 0.0) or 0.0),
                fall_soon_probability=float(ai_result.get("fall_soon_probability", 0.0) or 0.0),
                fall_now_prediction=bool(ai_result.get("fall_now_prediction", False)),
                fall_soon_prediction=bool(ai_result.get("fall_soon_prediction", False)),
                vital_check_performed=False,
                vital_check_result=None,
                final_verdict=ai_confirms,
                confidence_score=float(ai_result.get("confidence_score", 0.0) or 0.0),
                timestamp=datetime.utcnow(),
            )
            db.add(review_prediction)
            db.flush()

        if ai_confirms:
            alert.alert_type = "fall_now"
            alert.severity = "critical"
            alert.status = "pending"
            alert.prediction_id = review_prediction.id if review_prediction else alert.prediction_id
            alert.message = f"Confirmed fall detected by AI after fast bracelet alert. Confidence: {float(ai_result.get('confidence_score', 0.0) or 0.0):.2%}"
            alert.timestamp = datetime.utcnow()
        else:
            alert.status = "resolved"
            alert.resolved_at = datetime.utcnow()
            if review_prediction:
                alert.prediction_id = review_prediction.id
            alert.message = "Possible fall auto-resolved after AI review did not confirm a fall."

        db.commit()
        db.refresh(alert)
        payload = _serialize_alert(alert)
        await _notify_patient_and_caregivers(db, alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)

        if ai_confirms:
            await asyncio.to_thread(
                _run_fall_alert_side_effects,
                alert.device_id or "",
                alert.user_id,
                alert.id,
                "fall_now",
            )
    except Exception as exc:
        logger.warning("Fast fall candidate AI review failed: %s", exc)
    finally:
        db.close()


def _process_motion_data_internal(
    data: Dict[str, Any],
    db: Session,
    background_tasks: Optional[BackgroundTasks] = None,
) -> Tuple[Dict[str, Any], models.MotionSensorData, Optional[Prediction], Optional[Alert]]:
    """Core motion processing logic without realtime notifications."""
    logger.debug("Processing motion data: %s", data)

    required_fields = ['user_id', 'device_id', 'acc_x', 'acc_y', 'acc_z', 'gyro_x', 'gyro_y', 'gyro_z']
    for field in required_fields:
        if field not in data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required field: {field}"
            )

    acc_x = float(data.get('acc_x', 0.0))
    acc_y = float(data.get('acc_y', 0.0))
    acc_z = float(data.get('acc_z', 0.0))
    gyro_x = float(data.get('gyro_x', 0.0))
    gyro_y = float(data.get('gyro_y', 0.0))
    gyro_z = float(data.get('gyro_z', 0.0))
    acc_mag = (acc_x ** 2 + acc_y ** 2 + acc_z ** 2) ** 0.5
    gyro_mag = (gyro_x ** 2 + gyro_y ** 2 + gyro_z ** 2) ** 0.5
    local_fall_hint = _extract_local_fall_hint(data)
    severe_motion_fall = (
        (acc_mag >= 25.0 and gyro_mag >= 180.0) or
        acc_mag >= 35.0 or
        (gyro_mag >= 420.0 and acc_mag >= 15.0)
    )
    fast_fall_candidate_motion = (
        (acc_mag >= 20.0 and gyro_mag >= 105.0) or
        acc_mag >= 28.0 or
        (gyro_mag >= 300.0 and acc_mag >= 12.0)
    )
    raw_temperature = data.get('temperature', 36.5)
    temperature = float(36.5 if raw_temperature is None else raw_temperature)
    user_id = int(data.get('user_id'))
    device_id = data.get('device_id')
    detector_timestamp = None
    raw_sampled_at_ms = data.get('sampled_at_ms')
    if raw_sampled_at_ms is not None:
        try:
            detector_timestamp = float(raw_sampled_at_ms) / 1000.0
        except (TypeError, ValueError):
            detector_timestamp = None

    _assert_device_not_deleted(db, device_id)
    device = crud.get_device_by_id(db, device_id)
    if device is None:
        device_payload = schemas.DeviceCreate(
            user_id=user_id,
            device_id=device_id,
            mac_address=data.get('mac_address'),
            firmware_version=data.get('firmware_version'),
            battery_level=data.get('battery_level')
        )
        device = crud.create_device(db, device_payload)
    elif device.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "success": False,
                "error": "Device ID already registered to another user"
            }
        )

    buffer_key = f"{user_id}:{device_id}"
    raw_seq = append_raw_sample(buffer_key, acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z)
    current_sample_count = int(min(len(raw_seq), MIN_REALTIME_SAMPLES_FOR_ALERT))
    wrist_result = update_wrist_fall_detector(
        buffer_key,
        ax=acc_x,
        ay=acc_y,
        az=acc_z,
        gx=gyro_x,
        gy=gyro_y,
        gz=gyro_z,
        timestamp=detector_timestamp,
    )
    wrist_fall_detected = bool(wrist_result.get("fall_detected"))
    wrist_possible_fall = bool(wrist_result.get("possible_fall"))
    fast_physical_alert = (
        bool(local_fall_hint.get("detected")) or
        bool(local_fall_hint.get("candidate")) or
        severe_motion_fall or
        fast_fall_candidate_motion or
        wrist_fall_detected or
        wrist_possible_fall
    )

    if fast_physical_alert:
        confidence_hint = max(
            float(local_fall_hint.get("confidence", 0.0) or 0.0),
            float(wrist_result.get("confidence", 0.0) or 0.0),
            min(0.88, max(acc_mag / 35.0, gyro_mag / 420.0)),
            0.62,
        )
        ai_result = {
            "success": True,
            "fall_now_probability": confidence_hint if (severe_motion_fall or wrist_fall_detected or local_fall_hint.get("detected")) else 0.0,
            "fall_soon_probability": confidence_hint,
            "fall_now_prediction": bool(severe_motion_fall or wrist_fall_detected or local_fall_hint.get("detected")),
            "fall_soon_prediction": True,
            "confidence_score": confidence_hint,
            "vital_check_performed": False,
            "vital_check_result": None,
            "is_mock": False,
            "metadata": {
                "fast_physical_bypass": True,
                "samples": MIN_REALTIME_SAMPLES_FOR_ALERT,
                "warmup": False,
                "reason": "physical_fall_signal_before_ai",
            },
        }
        ai_was_run = False
    else:
        should_run_ai = len(raw_seq) >= MIN_REALTIME_SAMPLES_FOR_ALERT and _should_run_periodic_ai(buffer_key)
        if should_run_ai:
            ai_result = predict_fall(raw_seq)
            ai_was_run = True
        else:
            ai_result = {
                "success": True,
                "fall_now_probability": 0.0,
                "fall_soon_probability": 0.0,
                "fall_now_prediction": False,
                "fall_soon_prediction": False,
                "confidence_score": 0.0,
                "vital_check_performed": False,
                "vital_check_result": None,
                "is_mock": False,
                "metadata": {
                    "prediction_skipped": True,
                    "samples": current_sample_count,
                    "warmup": len(raw_seq) < MIN_REALTIME_SAMPLES_FOR_ALERT,
                    "reason": "ai_throttled_for_normal_motion",
                },
            }
            ai_was_run = False

    if not ai_result.get("success", False):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": "AI prediction failed",
                "details": ai_result.get("error")
            }
        )

    motion_data_schema = schemas.MotionDataCreate(
        user_id=user_id,
        device_id=device_id,
        acc_x=acc_x,
        acc_y=acc_y,
        acc_z=acc_z,
        gyro_x=gyro_x,
        gyro_y=gyro_y,
        gyro_z=gyro_z,
        temperature=temperature,
        timestamp=data.get('timestamp')
    )
    stored_motion = crud.create_motion_data(db, motion_data_schema)

    prediction_metadata = ai_result.get("metadata", {}) or {}
    sample_count = int(prediction_metadata.get("samples", 0) or 0)
    warmup = bool(prediction_metadata.get("warmup", False))
    prediction_skipped = bool(prediction_metadata.get("prediction_skipped", False))
    alert_eligible = (not prediction_skipped) and sample_count >= MIN_REALTIME_SAMPLES_FOR_ALERT
    ai_fall_now_prob = float(ai_result.get("fall_now_probability", 0.0) or 0.0)
    ai_fall_soon_prob = float(ai_result.get("fall_soon_probability", 0.0) or 0.0)
    ai_motion_supported_fall = alert_eligible and wrist_possible_fall and (
        ai_fall_now_prob >= 0.62 or ai_fall_soon_prob >= 0.78
    )
    local_detector_fall = bool(local_fall_hint.get("detected"))
    fast_fall_candidate = (not local_detector_fall) and (not severe_motion_fall) and (
        bool(local_fall_hint.get("candidate")) or
        fast_fall_candidate_motion or wrist_possible_fall
    )
    rule_based_fall = local_detector_fall or severe_motion_fall or wrist_fall_detected

    if alert_eligible or rule_based_fall or fast_fall_candidate:
        verification_system = DoubleVerificationSystem(db)
        if local_detector_fall:
            local_confidence = float(local_fall_hint.get("confidence", 0.0) or 0.0)
            verified = {
                **ai_result,
                "fall_now_prediction": True,
                "fall_now_probability": max(ai_fall_now_prob, local_confidence, 0.94),
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": True,
                "confidence_score": max(float(ai_result.get("confidence_score", 0.0) or 0.0), local_confidence, 0.94),
                "decision_reason": str(local_fall_hint.get("reason") or "esp_local_detector"),
            }
        elif wrist_fall_detected:
            wrist_confidence = float(wrist_result.get("confidence", 0.0) or 0.0)
            verified = {
                **ai_result,
                "fall_now_prediction": True,
                "fall_now_probability": max(float(ai_result.get("fall_now_probability", 0.0) or 0.0), wrist_confidence, 0.90),
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": True,
                "confidence_score": max(float(ai_result.get("confidence_score", 0.0) or 0.0), wrist_confidence, 0.90),
                "decision_reason": str(wrist_result.get("reason") or "wrist_fall_detector"),
            }
        elif ai_motion_supported_fall:
            confidence = max(
                ai_fall_now_prob,
                ai_fall_soon_prob * 0.85,
                float(wrist_result.get("confidence", 0.0) or 0.0),
            )
            verified = {
                **ai_result,
                "fall_now_prediction": True,
                "fall_now_probability": max(ai_fall_now_prob, confidence, 0.90),
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": True,
                "confidence_score": max(float(ai_result.get("confidence_score", 0.0) or 0.0), confidence, 0.88),
                "decision_reason": "ai_motion_fusion_high_recall",
            }
        elif severe_motion_fall and not ai_result.get("fall_now_prediction", False):
            verified = {
                **ai_result,
                "fall_now_prediction": True,
                "fall_now_probability": max(float(ai_result.get("fall_now_probability", 0.0) or 0.0), 0.92),
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": True,
                "confidence_score": max(float(ai_result.get("confidence_score", 0.0) or 0.0), 0.92),
                "decision_reason": "severe_motion_rule",
            }
        elif fast_fall_candidate:
            candidate_confidence = max(
                float(wrist_result.get("confidence", 0.0) or 0.0),
                min(0.82, max(acc_mag / 35.0, gyro_mag / 420.0)),
                0.62,
            )
            verified = {
                **ai_result,
                "fall_now_prediction": False,
                "fall_soon_prediction": False,
                "fall_now_probability": max(ai_fall_now_prob, candidate_confidence),
                "fall_soon_probability": max(ai_fall_soon_prob, candidate_confidence * 0.85),
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": False,
                "fall_candidate": True,
                "confidence_score": max(float(ai_result.get("confidence_score", 0.0) or 0.0), candidate_confidence),
                "decision_reason": "fast_motion_candidate_waiting_for_confirmation",
            }
        else:
            verified = verification_system.verify_fall_with_vitals(
                user_id=user_id,
                fall_prediction=ai_result,
                current_vitals=None
            )
            if rule_based_fall:
                verified["final_verdict"] = True
                verified["fall_now_prediction"] = True
                verified["fall_now_probability"] = max(float(verified.get("fall_now_probability", 0.0) or 0.0), 0.92)
                verified["confidence_score"] = max(float(verified.get("confidence_score", 0.0) or 0.0), 0.92)
                verified["decision_reason"] = "severe_motion_rule"
            else:
                # The AI model can produce very high risk probabilities while the
                # bracelet is lying still. Alerts must be backed by physical
                # evidence from the wrist detector or severe-motion rule.
                verified["final_verdict"] = False
                verified["fall_now_prediction"] = False
                verified["fall_soon_prediction"] = False
                verified["confidence_score"] = 0.0
                verified["decision_reason"] = "ai_only_suppressed_requires_motion_confirmation"

            if fast_fall_candidate and not verified.get("final_verdict"):
                candidate_confidence = max(
                    float(wrist_result.get("confidence", 0.0) or 0.0),
                    min(0.82, max(acc_mag / 35.0, gyro_mag / 420.0)),
                    float(verified.get("confidence_score", 0.0) or 0.0),
                    0.62,
                )
                verified["fall_candidate"] = True
                verified["fall_now_prediction"] = False
                verified["fall_soon_prediction"] = False
                verified["fall_now_probability"] = max(float(verified.get("fall_now_probability", 0.0) or 0.0), candidate_confidence)
                verified["fall_soon_probability"] = max(float(verified.get("fall_soon_probability", 0.0) or 0.0), candidate_confidence * 0.85)
                verified["confidence_score"] = candidate_confidence
                verified["decision_reason"] = "fast_motion_candidate_waiting_for_confirmation"
    else:
        verification_system = None
        verified = {
            "fall_now_probability": ai_result.get("fall_now_probability", 0.0),
            "fall_soon_probability": ai_result.get("fall_soon_probability", 0.0),
            "fall_now_prediction": False,
            "fall_soon_prediction": False,
            "vital_check_performed": False,
            "vital_check_result": None,
            "final_verdict": False,
            "confidence_score": ai_result.get("confidence_score", 0.0),
        }

    should_store_prediction = bool(ai_was_run or rule_based_fall or fast_fall_candidate or verified.get("final_verdict"))
    db_pred = None
    if should_store_prediction:
        db_pred = Prediction(
            user_id=user_id,
            motion_data_id=stored_motion.id,
            fall_now_probability=verified.get("fall_now_probability", 0.0),
            fall_soon_probability=verified.get("fall_soon_probability", 0.0),
            fall_now_prediction=verified.get("fall_now_prediction", False),
            fall_soon_prediction=verified.get("fall_soon_prediction", False),
            vital_check_performed=verified.get("vital_check_performed", False),
            vital_check_result=verified.get("vital_check_result"),
            final_verdict=verified.get("final_verdict", False),
            confidence_score=verified.get("confidence_score", 0.0),
            timestamp=datetime.utcnow()
        )
        db.add(db_pred)
        db.commit()
        db.refresh(db_pred)

    alert = None
    if verification_system is not None and db_pred is not None:
        alert = verification_system.create_alert_if_needed(
            user_id=user_id,
            prediction_id=db_pred.id,
            verification_result=verified
        )
    if alert and alert.alert_type in {"fall_candidate", "fall_now"}:
        if background_tasks is not None:
            if alert.alert_type == "fall_candidate":
                background_tasks.add_task(_review_fall_candidate_with_ai_background, alert.id)
            else:
                background_tasks.add_task(
                    _run_fall_alert_side_effects,
                    device_id,
                    user_id,
                    alert.id,
                    alert.alert_type,
                )
        else:
            if alert.alert_type == "fall_now":
                _run_fall_alert_side_effects(device_id, user_id, alert.id, alert.alert_type)

    response = {
        "success": True,
        "message": "Prediction completed",
        "prediction": {
            "fall_now_probability": verified.get("fall_now_probability", 0.0),
            "fall_soon_probability": verified.get("fall_soon_probability", 0.0),
            "fall_now_prediction": verified.get("fall_now_prediction", False),
            "fall_soon_prediction": verified.get("fall_soon_prediction", False),
            "fall_candidate": verified.get("fall_candidate", False),
            "confidence_score": verified.get("confidence_score", 0.0),
            "final_verdict": verified.get("final_verdict", False),
            "vital_check_performed": verified.get("vital_check_performed", False),
            "vital_check_result": verified.get("vital_check_result"),
            "timestamp": _utc_now_iso_z(),
            "is_mock": ai_result.get("is_mock", False),
            "model_type": "dual_output" if "fall_soon_probability" in ai_result else "single_output",
            "warmup": warmup,
            "samples_collected": sample_count,
            "min_samples_for_alert": MIN_REALTIME_SAMPLES_FOR_ALERT,
            "alert_eligible": alert_eligible,
            "prediction_skipped": prediction_skipped,
            "ai_prediction_interval_seconds": AI_PREDICTION_INTERVAL_SECONDS,
            "rule_based_fall": rule_based_fall,
            "fast_fall_candidate": fast_fall_candidate,
            "local_detector_fall": local_detector_fall,
            "local_detector_reason": local_fall_hint.get("reason"),
            "local_detector_confidence": local_fall_hint.get("confidence"),
            "wrist_possible_fall": wrist_possible_fall,
            "wrist_detector_state": wrist_result.get("state"),
            "wrist_detector_reason": wrist_result.get("reason"),
            "wrist_detector_confidence": wrist_result.get("confidence"),
            "wrist_detector_jerk": wrist_result.get("jerk"),
            "acc_magnitude": acc_mag,
            "gyro_magnitude": gyro_mag,
            "warmup_reason": None if (alert_eligible or rule_based_fall or fast_fall_candidate) else "collecting_motion_context",
        },
        "is_test_data": ai_result.get("is_mock", False),
        "timestamp": datetime.utcnow().isoformat(),
        "database_stored": True,
        "motion_id": stored_motion.id,
        "prediction_id": db_pred.id if db_pred else None,
        "alert_generated": alert is not None,
        "alert_id": alert.id if alert else None
    }

    return response, stored_motion, db_pred, alert


@router.post("/motion", response_model=Dict[str, Any])
async def process_motion_data(
    data: Dict[str, Any],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Process motion data and return prediction.
    Now supports dual output (fall_now and fall_soon).
    """
    try:
        response, stored_motion, db_pred, alert = _process_motion_data_internal(data, db)

        prediction_payload = _serialize_prediction(db_pred) if db_pred else None
        motion_payload = _serialize_motion(stored_motion)
        await _notify_patient_and_caregivers(db, stored_motion.user_id, "motions", action="created", payload=motion_payload, throttle_seconds=2.0)
        await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=2.0)
        if prediction_payload:
            await _notify_patient_and_caregivers(db, stored_motion.user_id, "predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)
            await notify_admins("predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)

        if alert:
            alert_payload = _serialize_alert(alert)
            await _notify_patient_and_caregivers(db, alert.user_id, "alerts", action="created", payload=alert_payload)
            await notify_admins("alerts", action="created", payload=alert_payload)
            background_tasks.add_task(_notify_caregivers_push_for_alert_id, alert.id, alert.alert_type)

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing motion data: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error processing motion data: {str(e)}"
        )

# ======================
# Device Ingest Routes (ESP32 WiFi / BLE Gateway)
# ======================

@router.post("/device-data", response_model=Dict[str, Any])
async def ingest_device_data(
    payload: schemas.DeviceIngestPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Ingest combined device data (motion + vitals)."""
    try:
        result = _handle_device_payload(payload, db)
        user_id = result.get("user_id")
        if user_id:
            latest_prediction = db.query(Prediction).filter(Prediction.user_id == user_id).order_by(Prediction.timestamp.desc()).first()
            latest_vital = db.query(VitalSensorData).filter(VitalSensorData.user_id == user_id).order_by(VitalSensorData.timestamp.desc()).first()
            latest_alert = db.query(Alert).filter(Alert.user_id == user_id).order_by(Alert.timestamp.desc()).first()
            latest_motion = db.query(models.MotionSensorData).filter(models.MotionSensorData.user_id == user_id).order_by(models.MotionSensorData.timestamp.desc()).first()
            device_obj = db.query(Device).filter(Device.user_id == user_id).order_by(Device.created_at.desc()).first()

            prediction_payload = _serialize_prediction(latest_prediction) if latest_prediction else None
            vital_payload = _serialize_vital(latest_vital) if latest_vital else None
            alert_payload = _serialize_alert(latest_alert) if latest_alert else None
            motion_payload = _serialize_motion(latest_motion) if latest_motion else None
            device_payload = (
                _serialize_device(
                    db,
                    device_obj,
                    latest_data_at=latest_motion.timestamp if latest_motion and device_obj and latest_motion.device_id == device_obj.device_id else None,
                )
                if device_obj else None
            )

            if result.get("motion"):
                if motion_payload:
                    await _notify_patient_and_caregivers(db, user_id, "motions", action="created", payload=motion_payload, throttle_seconds=2.0)
                    await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=2.0)
                if prediction_payload:
                    await _notify_patient_and_caregivers(db, user_id, "predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)
                    await notify_admins("predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)
            if result.get("vitals"):
                await _notify_patient_and_caregivers(db, user_id, "vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
                await notify_admins("vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
            motion_alert_id = (result.get("motion") or {}).get("alert_id")
            vital_alert_id = (result.get("vitals") or {}).get("alert_id")
            if motion_alert_id or vital_alert_id:
                await _notify_patient_and_caregivers(db, user_id, "alerts", action="created", payload=alert_payload)
                await notify_admins("alerts", action="created", payload=alert_payload)
                latest_alert_id = motion_alert_id or vital_alert_id
                if latest_alert_id:
                    background_tasks.add_task(_notify_caregivers_push_for_alert_id, int(latest_alert_id), "fall")
            if device_payload:
                await _notify_patient_and_caregivers(db, user_id, "devices", action="updated", payload=device_payload, throttle_seconds=10.0)
                await notify_admins("devices", action="updated", payload=device_payload, throttle_seconds=10.0)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device data ingested",
                "data": result,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ingesting device data: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error ingesting device data: {str(e)}"
        )

@router.post("/device-data/fall-alert", response_model=Dict[str, Any])
async def ingest_device_fall_alert(
    payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Ingest immediate ESP local fall alerts and run them through the same fusion pipeline."""
    try:
        motion_dict = _motion_dict_from_local_fall_alert(payload, db)
        _ensure_device_for_ingest(
            db,
            device_id=motion_dict["device_id"],
            user_id=motion_dict["user_id"],
            battery_level=motion_dict.get("battery_level"),
            firmware_version=motion_dict.get("firmware_version"),
        )

        response, stored_motion, db_pred, alert = _process_motion_data_internal(
            motion_dict,
            db,
            background_tasks=background_tasks,
        )

        motion_payload = _serialize_motion(stored_motion)
        prediction_payload = _serialize_prediction(db_pred) if db_pred else None
        alert_payload = _serialize_alert(alert) if alert else None
        background_tasks.add_task(
            _notify_fast_fall_realtime_background,
            stored_motion.user_id,
            motion_payload,
            prediction_payload,
            alert_payload,
        )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Local fall alert ingested",
                "data": response,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ingesting local fall alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error ingesting local fall alert: {str(e)}"
        )

@router.post("/device-data/batch", response_model=Dict[str, Any])
async def ingest_device_data_batch(
    batch: schemas.DeviceIngestBatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Ingest batch device data for offline sync."""
    results = []
    errors = []
    touched_users = set()
    alerts_users = set()
    motion_users = set()
    vitals_users = set()

    for idx, item in enumerate(batch.items):
        try:
            res = _handle_device_payload(item, db)
            results.append(res)
            user_id = res.get("user_id")
            if user_id:
                touched_users.add(user_id)
                if res.get("motion"):
                    motion_users.add(user_id)
                if res.get("vitals"):
                    vitals_users.add(user_id)
                motion_alert_id = (res.get("motion") or {}).get("alert_id")
                vital_alert_id = (res.get("vitals") or {}).get("alert_id")
                if motion_alert_id or vital_alert_id:
                    alerts_users.add(user_id)
        except HTTPException as e:
            detail = e.detail
            if isinstance(detail, (dict, list)):
                error_text = json.dumps(detail)
            else:
                error_text = str(detail)
            errors.append({"index": idx, "error": error_text})
        except Exception as e:
            error_text = str(e) or repr(e)
            errors.append({"index": idx, "error": error_text})

    for uid in motion_users:
        latest_motion = db.query(models.MotionSensorData).filter(models.MotionSensorData.user_id == uid).order_by(models.MotionSensorData.timestamp.desc()).first()
        motion_payload = _serialize_motion(latest_motion) if latest_motion else None
        if motion_payload:
            await _notify_patient_and_caregivers(db, uid, "motions", action="created", payload=motion_payload, throttle_seconds=2.0)
            await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=2.0)
        latest_prediction = db.query(Prediction).filter(Prediction.user_id == uid).order_by(Prediction.timestamp.desc()).first()
        payload = _serialize_prediction(latest_prediction) if latest_prediction else None
        if payload:
            await _notify_patient_and_caregivers(db, uid, "predictions", action="created", payload=payload, throttle_seconds=2.0)
            await notify_admins("predictions", action="created", payload=payload, throttle_seconds=2.0)
    for uid in vitals_users:
        latest_vital = db.query(VitalSensorData).filter(VitalSensorData.user_id == uid).order_by(VitalSensorData.timestamp.desc()).first()
        payload = _serialize_vital(latest_vital) if latest_vital else None
        await _notify_patient_and_caregivers(db, uid, "vitals", action="created", payload=payload, throttle_seconds=5.0)
        await notify_admins("vitals", action="created", payload=payload, throttle_seconds=5.0)
    for uid in alerts_users:
        latest_alert = db.query(Alert).filter(Alert.user_id == uid).order_by(Alert.timestamp.desc()).first()
        payload = _serialize_alert(latest_alert) if latest_alert else None
        await _notify_patient_and_caregivers(db, uid, "alerts", action="created", payload=payload)
        await notify_admins("alerts", action="created", payload=payload)
        if latest_alert:
            background_tasks.add_task(_notify_caregivers_push_for_alert_id, latest_alert.id, latest_alert.alert_type)
    for uid in touched_users:
        device_obj = db.query(Device).filter(Device.user_id == uid).order_by(Device.created_at.desc()).first()
        payload = (
            _serialize_device(
                db,
                device_obj,
                latest_data_at=_get_latest_motion_timestamp(db, device_obj.device_id),
            )
            if device_obj else None
        )
        await _notify_patient_and_caregivers(db, uid, "devices", action="updated", payload=payload, throttle_seconds=10.0)
        await notify_admins("devices", action="updated", payload=payload, throttle_seconds=10.0)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": len(errors) == 0,
            "received": len(batch.items),
            "stored": len(results),
            "errors": errors,
            "timestamp": _utc_now_iso_z()
        }
    )


@router.post("/device-data/vitals-status", response_model=Dict[str, Any])
async def ingest_vitals_status(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Receive live vitals measurement status from MQTT/device."""
    device_id = str(payload.get("device_id") or "").strip()
    if not device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "error": "device_id is required"},
        )

    device = crud.get_device_by_id(db, device_id)
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": f"Device {device_id} not found"},
        )

    device.is_connected = True
    device.last_seen = datetime.utcnow()
    db.commit()
    db.refresh(device)

    status_payload = _normalize_vitals_status_payload(payload, device)
    stored_vital = None
    measurement = None
    request_id = str(status_payload.get("request_id") or "").strip()

    if request_id:
        measurement = (
            db.query(models.VitalsMeasurement)
            .filter(models.VitalsMeasurement.request_id == request_id)
            .first()
        )
        if measurement is None:
            measurement = models.VitalsMeasurement(
                request_id=request_id,
                user_id=device.user_id,
                device_id=device.device_id,
                started_at=datetime.utcnow(),
            )
            db.add(measurement)

        measurement.user_id = device.user_id
        measurement.device_id = device.device_id
        measurement.vitals_trigger = str(status_payload.get("vitals_trigger") or "manual")
        measurement.state = str(status_payload.get("state") or "unknown")
        measurement.progress_percent = max(0, min(100, int(status_payload.get("progress_percent") or 0)))
        measurement.finger_detected = bool(status_payload.get("finger_detected"))
        measurement.signal_status = status_payload.get("signal_status")
        measurement.heart_rate = status_payload.get("heart_rate") if status_payload.get("heart_rate_valid") else measurement.heart_rate
        measurement.oxygen_saturation = status_payload.get("spo2") if status_payload.get("spo2_valid") else measurement.oxygen_saturation
        measurement.heart_rate_valid = bool(status_payload.get("heart_rate_valid"))
        measurement.spo2_valid = bool(status_payload.get("spo2_valid"))
        measurement.max_powered = bool(status_payload.get("max_powered"))
        measurement.updated_at = datetime.utcnow()
        if measurement.state in {"complete", "stopped", "error"}:
            measurement.completed_at = datetime.utcnow()
        db.commit()
        db.refresh(measurement)

    if (
        status_payload["state"] == "complete"
        and (status_payload["heart_rate_valid"] or status_payload["spo2_valid"])
        and (measurement is None or measurement.vital_id is None)
    ):
        vital_data = schemas.VitalDataCreate(
            user_id=device.user_id,
            device_id=device.device_id,
            heart_rate=status_payload["heart_rate"] if status_payload["heart_rate_valid"] else None,
            oxygen_saturation=status_payload["spo2"] if status_payload["spo2_valid"] else None,
            timestamp=_parse_iso_datetime(status_payload["timestamp"])
            if isinstance(status_payload.get("timestamp"), str)
            else datetime.utcnow(),
        )
        stored_vital = crud.create_vital_data(db, vital_data)
        if measurement is not None:
            measurement.vital_id = stored_vital.id
            db.commit()
            db.refresh(measurement)

    await _notify_patient_and_caregivers(
        db,
        device.user_id,
        "vitals_status",
        action=str(status_payload["state"]),
        payload=status_payload,
        throttle_seconds=1.0,
    )
    await notify_admins("vitals_status", action=str(status_payload["state"]), payload=status_payload, throttle_seconds=1.0)

    if stored_vital:
        vital_payload = _serialize_vital(stored_vital)
        await _notify_patient_and_caregivers(db, device.user_id, "vitals", action="created", payload=vital_payload, throttle_seconds=2.0)
        await notify_admins("vitals", action="created", payload=vital_payload, throttle_seconds=2.0)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "message": "Vitals status ingested",
            "data": {
                "status": status_payload,
                "vital_id": stored_vital.id if stored_vital else None,
                "measurement_id": measurement.id if measurement else None,
            },
            "timestamp": datetime.utcnow().isoformat(),
        },
    )

# ======================
# Vital Signs Routes - WITH PROPER STATUS CODES
# ======================

@router.post("/vitals", response_model=Dict[str, Any])
async def process_vital_data(
    data: Dict[str, Any],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Process vital signs data with proper status codes"""
    try:
        logger.info(f"Processing vital data: {data}")
        
        # Validate required fields
        if 'user_id' not in data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "User ID is required"
                }
            )
        
        user_id = int(data.get('user_id'))
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {user_id} not found"
                }
            )
        
        # Extract vital data with validation (real values only)
        vital_fields = [
            'heart_rate',
            'blood_pressure_systolic',
            'blood_pressure_diastolic',
            'oxygen_saturation',
            'body_temperature',
            'respiration_rate'
        ]
        vital_readings = {}
        try:
            for field in vital_fields:
                val = data.get(field, None)
                if val is not None:
                    vital_readings[field] = float(val)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": f"Invalid vital data format: {str(e)}"
                }
            )

        if not vital_readings:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "At least one vital field is required"
                }
            )
        
        try:
            # Store in database
            vital_data = schemas.VitalDataCreate(
                user_id=user_id,
                device_id=data.get('device_id'),
                **vital_readings,
                timestamp=data.get('timestamp')
            )
            
            stored_vital = crud.create_vital_data(db, vital_data)

            is_abnormal = bool(stored_vital.is_abnormal)
            abnormality_type = stored_vital.abnormality_type

            alert_id = None
            if is_abnormal:
                # Create vital alert
                alert = Alert(
                    user_id=user_id,
                    device_id=data.get('device_id'),
                    alert_type="vital_abnormal",
                    severity="high",
                    message=f"Abnormal {abnormality_type.replace('_', ' ')} detected",
                    status="active",
                    timestamp=datetime.utcnow()
                )
                db.add(alert)
                db.commit()
                db.refresh(alert)
                alert_id = alert.id
                
                # Notify about vital abnormality
                background_tasks.add_task(
                    notification_service.notify_vital_abnormality,
                    user_id=user_id,
                    vitals=vital_readings,
                    message=alert.message
                )
                notification_service.notify_caregivers_alert(
                    db=db,
                    patient_id=user_id,
                    alert=alert,
                    reason="vital_abnormal",
                )
            
            response_data = {
                "success": True,
                "message": "Abnormal vital signs detected!" if is_abnormal else "Normal vital signs",
                "vital_data": {
                    **{k: round(v, 1) for k, v in vital_readings.items()},
                    "blood_pressure": (
                        f"{round(vital_readings['blood_pressure_systolic'], 0)}/{round(vital_readings['blood_pressure_diastolic'], 0)}"
                        if "blood_pressure_systolic" in vital_readings and "blood_pressure_diastolic" in vital_readings
                        else None
                    ),
                    "is_abnormal": is_abnormal,
                    "abnormality_type": abnormality_type,
                    "database_stored": True,
                    "vital_id": stored_vital.id,
                    "alert_generated": is_abnormal,
                    "alert_id": alert_id
                },
                "user": {
                    "id": user.id,
                    "name": user.name
                },
                "is_test_data": False,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            status_code = status.HTTP_200_OK if not is_abnormal else status.HTTP_202_ACCEPTED

            vital_payload = _serialize_vital(stored_vital)
            await _notify_patient_and_caregivers(db, user_id, "vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
            await notify_admins("vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
            if alert_id:
                alert = db.query(Alert).filter(Alert.id == alert_id).first()
                alert_payload = _serialize_alert(alert) if alert else None
                await _notify_patient_and_caregivers(db, user_id, "alerts", action="created", payload=alert_payload)
                await notify_admins("alerts", action="created", payload=alert_payload)
            
            return JSONResponse(
                status_code=status_code,
                content=response_data
            )
            
        except Exception as db_error:
            logger.error(f"Database error: {db_error}")
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "message": "Abnormal vital signs detected!" if is_abnormal else "Normal vital signs",
                    "vital_data": {
                        **{k: round(v, 1) for k, v in vital_readings.items()},
                        "blood_pressure": f"{round(vital_readings['blood_pressure_systolic'], 0)}/{round(vital_readings['blood_pressure_diastolic'], 0)}",
                        "is_abnormal": is_abnormal,
                        "abnormality_type": abnormality_type,
                        "database_stored": False
                    },
                    "warning": "Data not stored in database",
                    "is_test_data": False,
                    "timestamp": _utc_now_iso_z()
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing vital data: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to process vital data: {str(e)}"
            }
        )

# ======================
# Data Retrieval Routes
# ======================

@router.get("/motion/{user_id}", response_model=Dict[str, Any])
async def get_motion_history(
    user_id: int,
    limit: int = Query(100, ge=1, le=500, description="Number of motion records to return"),
    db: Session = Depends(get_db)
):
    """Get recent motion data for a user."""
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": f"User with ID {user_id} not found"}
        )

    motions = crud.get_recent_motion_data(db, user_id, limit=limit)
    formatted = [
        {
            "id": m.id,
            "device_id": m.device_id,
            "acc_x": m.acc_x,
            "acc_y": m.acc_y,
            "acc_z": m.acc_z,
            "gyro_x": m.gyro_x,
            "gyro_y": m.gyro_y,
            "gyro_z": m.gyro_z,
            "acc_mag": m.acc_mag,
            "gyro_mag": m.gyro_mag,
            "temperature": m.temperature,
            "is_fall_suspected": m.is_fall_suspected,
            "timestamp": _utc_iso_z(m.timestamp)
        }
        for m in motions
    ]

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "user_id": user_id,
            "count": len(formatted),
            "data": formatted,
            "timestamp": _utc_now_iso_z()
        }
    )


@router.get("/vitals/{user_id}", response_model=Dict[str, Any])
async def get_vitals_history(
    user_id: int,
    limit: int = Query(50, ge=1, le=200, description="Number of vital records to return"),
    db: Session = Depends(get_db)
):
    """Get recent vital signs for a user."""
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": f"User with ID {user_id} not found"}
        )

    vitals = crud.get_recent_vital_data(db, user_id, limit=limit)
    formatted = [
        {
            "id": v.id,
            "heart_rate": v.heart_rate,
            "blood_pressure_systolic": v.blood_pressure_systolic,
            "blood_pressure_diastolic": v.blood_pressure_diastolic,
            "oxygen_saturation": v.oxygen_saturation,
            "body_temperature": v.body_temperature,
            "respiration_rate": v.respiration_rate,
            "is_abnormal": v.is_abnormal,
            "abnormality_type": v.abnormality_type,
            "timestamp": _utc_iso_z(v.timestamp)
        }
        for v in vitals
    ]

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "user_id": user_id,
            "count": len(formatted),
            "data": formatted,
            "timestamp": _utc_now_iso_z()
        }
    )


@router.get("/predictions/{user_id}", response_model=Dict[str, Any])
async def get_prediction_history(
    user_id: int,
    limit: int = Query(50, ge=1, le=200, description="Number of prediction records to return"),
    db: Session = Depends(get_db)
):
    """Get recent predictions for a user."""
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": f"User with ID {user_id} not found"}
        )

    preds = crud.get_user_predictions(db, user_id, limit=limit)
    formatted = [
        {
            "id": p.id,
            "motion_data_id": p.motion_data_id,
            "fall_now_probability": p.fall_now_probability,
            "fall_soon_probability": p.fall_soon_probability,
            "fall_now_prediction": p.fall_now_prediction,
            "fall_soon_prediction": p.fall_soon_prediction,
            "vital_check_performed": p.vital_check_performed,
            "vital_check_result": p.vital_check_result,
            "final_verdict": p.final_verdict,
            "confidence_score": p.confidence_score,
            "timestamp": _utc_iso_z(p.timestamp)
        }
        for p in preds
    ]

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "user_id": user_id,
            "count": len(formatted),
            "data": formatted,
            "timestamp": _utc_now_iso_z()
        }
    )

# ======================
# Alerts Routes - WITH PROPER STATUS CODES
# ======================

@router.get("/alerts/{user_id}", response_model=Dict[str, Any])
async def get_user_alerts(
    user_id: int,
    limit: int = Query(20, ge=1, le=100, description="Number of alerts to return"),
    days: int = Query(7, ge=1, le=365, description="Number of days to look back"),
    alert_status: Optional[str] = Query(None, description="Filter by alert status"),
    severity: Optional[str] = Query(None, description="Filter by alert severity"),
    db: Session = Depends(get_db)
):
    """Get alerts for a specific user with filtering options"""
    try:
        # Validate user exists
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {user_id} not found"
                }
            )
        
        # Calculate date range
        start_date = datetime.utcnow() - timedelta(days=days)
        
        # Build query
        query = db.query(Alert).filter(
            Alert.user_id == user_id,
            Alert.timestamp >= start_date
        )
        
        # Apply filters
        if alert_status:
            query = query.filter(Alert.status == alert_status)
        if severity:
            query = query.filter(Alert.severity == severity)
        
        # Execute query
        alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
        
        # Format alerts
        formatted_alerts = []
        for alert in alerts:
            formatted_alerts.append(_serialize_alert(alert))
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "user_id": user_id,
                "user_name": user.name,
                "alerts": formatted_alerts,
                "count": len(formatted_alerts),
                "total_unresolved": len([a for a in formatted_alerts if a["status"] == "active"]),
                "filters_applied": {
                    "days": days,
                    "limit": limit,
                    "status": alert_status,
                    "severity": severity
                },
                "timestamp": _utc_now_iso_z()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting alerts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get alerts: {str(e)}"
            }
        )

@router.put("/alerts/{alert_id}/status", response_model=Dict[str, Any])
async def update_alert_status(
    alert_id: str,
    status_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Update alert status"""
    try:
        new_status = status_data.get("status")
        notes = status_data.get("notes", "")
        
        if not new_status:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Status is required"
                }
            )
        
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Alert with ID {alert_id} not found"
                }
            )
        
        # Update alert
        alert.status = new_status
        alert.response_notes = notes
        
        if new_status == "resolved":
            alert.resolved_at = datetime.utcnow()
        
        db.commit()

        payload = _serialize_alert(alert)
        await _notify_patient_and_caregivers(db, alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": f"Alert status updated to {new_status}",
                "alert_id": alert_id,
                "status": new_status,
                "resolved_at": _utc_iso_z(alert.resolved_at),
                "timestamp": _utc_now_iso_z()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating alert status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to update alert status: {str(e)}"
            }
        )

@router.post("/alerts/{alert_id}/acknowledge", response_model=Dict[str, Any])
async def acknowledge_alert(
    alert_id: int,
    ack_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Acknowledge an alert (compatibility endpoint for mobile app)."""
    try:
        acknowledged_by = ack_data.get("acknowledged_by", "")

        alert = crud.update_alert_status(
            db,
            alert_id=alert_id,
            status="acknowledged",
            acknowledged_by=acknowledged_by
        )

        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Alert with ID {alert_id} not found"
                }
            )

        payload = _serialize_alert(alert)
        await _notify_patient_and_caregivers(db, alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Alert acknowledged",
                "alert_id": alert_id,
                "status": alert.status,
                "acknowledged_by": alert.acknowledged_by,
                "acknowledged_at": _utc_iso_z(alert.acknowledged_at),
                "timestamp": _utc_now_iso_z()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error acknowledging alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to acknowledge alert: {str(e)}"
            }
        )

@router.post("/alerts/{alert_id}/resolve", response_model=Dict[str, Any])
async def resolve_alert(
    alert_id: int,
    db: Session = Depends(get_db)
):
    """Resolve an alert (compatibility endpoint for mobile app)."""
    try:
        alert = crud.update_alert_status(db, alert_id=alert_id, status="resolved")

        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Alert with ID {alert_id} not found"
                }
            )

        payload = _serialize_alert(alert)
        await _notify_patient_and_caregivers(db, alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Alert resolved",
                "alert_id": alert_id,
                "status": alert.status,
                "resolved_at": _utc_iso_z(alert.resolved_at),
                "timestamp": _utc_now_iso_z()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resolving alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to resolve alert: {str(e)}"
            }
        )

@router.post("/alerts/{user_id}/clear", response_model=Dict[str, Any])
async def clear_user_alerts(
    user_id: int,
    clear_data: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db)
):
    """Clear all alerts for a user. Default mode deletes; mode='resolve' keeps history as resolved."""
    try:
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": f"User with ID {user_id} not found"}
            )

        mode = str((clear_data or {}).get("mode", "delete")).strip().lower()
        query = db.query(Alert).filter(Alert.user_id == user_id)
        count = query.count()

        if count == 0:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "message": "No alerts to clear",
                    "user_id": user_id,
                    "cleared_count": 0,
                    "mode": mode,
                    "timestamp": _utc_now_iso_z(),
                },
            )

        if mode == "resolve":
            now = datetime.utcnow()
            updated = query.update(
                {
                    Alert.status: "resolved",
                    Alert.resolved_at: now,
                },
                synchronize_session=False,
            )
            db.commit()
            payload = {
                "user_id": user_id,
                "cleared_count": updated,
                "mode": "resolve",
                "timestamp": _utc_now_iso_z(),
            }
            await _notify_patient_and_caregivers(db, user_id, "alerts", action="cleared", payload=payload)
            await notify_admins("alerts", action="cleared", payload=payload)
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "message": f"Resolved {updated} alerts",
                    **payload,
                },
            )

        if mode != "delete":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "mode must be 'delete' or 'resolve'"}
            )

        deleted = query.delete(synchronize_session=False)
        db.commit()
        payload = {
            "user_id": user_id,
            "cleared_count": deleted,
            "mode": "delete",
            "timestamp": _utc_now_iso_z(),
        }
        await _notify_patient_and_caregivers(db, user_id, "alerts", action="cleared", payload=payload)
        await notify_admins("alerts", action="cleared", payload=payload)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": f"Deleted {deleted} alerts",
                **payload,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing alerts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to clear alerts: {str(e)}"
            }
        )

@router.get("/alerts/{user_id}/stats", response_model=Dict[str, Any])
async def get_alert_statistics(
    user_id: int,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db)
):
    """Get alert statistics for a user"""
    try:
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {user_id} not found"
                }
            )
        
        start_date = datetime.utcnow() - timedelta(days=days)
        
        alerts = db.query(Alert).filter(
            Alert.user_id == user_id,
            Alert.timestamp >= start_date
        ).all()
        
        stats = {
            "total": len(alerts),
            "by_type": {},
            "by_severity": {
                "critical": 0,
                "high": 0,
                "medium": 0,
                "low": 0
            },
            "by_status": {
                "active": 0,
                "resolved": 0,
                "cancelled": 0
            },
            "average_response_time_hours": None,
            "most_common_day": None
        }
        
        for alert in alerts:
            # Count by type
            alert_type = alert.alert_type or "unknown"
            stats["by_type"][alert_type] = stats["by_type"].get(alert_type, 0) + 1
            
            # Count by severity
            severity = alert.severity or "medium"
            stats["by_severity"][severity] = stats["by_severity"].get(severity, 0) + 1
            
            # Count by status
            status = alert.status or "active"
            stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "user_id": user_id,
                "user_name": user.name,
                "period_days": days,
                "stats": stats,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
    except Exception as e:
        logger.error(f"Error getting alert stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get alert statistics: {str(e)}"
            }
        )

# ======================
# User Routes - Mobile App Support
# ======================

@router.get("/users/{user_id}", response_model=Dict[str, Any])
async def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db)
):
    """Get user profile by ID."""
    try:
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {user_id} not found"
                }
            )

        user_data = {
            "id": user.id,
            "name": user.name,
            "email": user.auth.email if getattr(user, "auth", None) else None,
            "phone": getattr(user, "phone", None),
            "age": user.age,
            "gender": user.gender,
            "weight": user.weight,
            "height": user.height,
            "medical_conditions": user.medical_conditions,
            "emergency_contact": user.emergency_contact,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "updated_at": user.updated_at.isoformat() if user.updated_at else None
        }

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": user_data,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user profile: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get user profile: {str(e)}"
            }
        )

@router.put("/users/{user_id}", response_model=Dict[str, Any])
async def update_user_profile(
    user_id: int,
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_db)
):
    """Update user profile by ID."""
    try:
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {user_id} not found"
                }
            )

        update_data = user_update.dict(exclude_unset=True)
        if not update_data:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "message": "No changes provided",
                    "data": {
                        "id": user.id,
                        "name": user.name,
                        "phone": getattr(user, "phone", None),
                        "age": user.age,
                        "gender": user.gender,
                        "weight": user.weight,
                        "height": user.height,
                        "medical_conditions": user.medical_conditions,
                        "emergency_contact": user.emergency_contact,
                        "is_active": user.is_active,
                        "created_at": user.created_at.isoformat() if user.created_at else None,
                        "updated_at": user.updated_at.isoformat() if user.updated_at else None
                    }
                }
            )

        for field, value in update_data.items():
            setattr(user, field, value)

        user.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(user)

        payload = _serialize_user_profile(user)
        await _notify_patient_and_caregivers(db, user.id, "profile", action="updated", payload=payload)
        await notify_admins("users", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "User updated successfully",
                "data": payload,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user profile: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to update user profile: {str(e)}"
            }
        )

# ======================
# Caregiver / Monitoring Routes
# ======================

@router.post("/care/links", response_model=Dict[str, Any])
async def create_care_link(
    link_data: schemas.CareLinkCreate,
    db: Session = Depends(get_db)
):
    """Create caregiver to patient link."""
    try:
        caregiver = crud.get_user(db, link_data.caregiver_id)
        if not caregiver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Caregiver not found"}
            )

        patient = None
        if link_data.patient_id:
            patient = crud.get_user(db, link_data.patient_id)
        elif link_data.patient_email:
            patient = crud.get_user_by_email(db, link_data.patient_email)
        elif link_data.patient_phone:
            patient = crud.get_user_by_phone(db, link_data.patient_phone)

        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Patient not found"}
            )

        if caregiver.id == patient.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Cannot link self"}
            )

        link = crud.create_care_link(
            db,
            caregiver_id=caregiver.id,
            patient_id=patient.id,
            relationship=link_data.relationship
        )

        patient_email = patient.auth.email if getattr(patient, "auth", None) else None

        payload = {
            "id": link.id,
            "caregiver_id": link.caregiver_id,
            "patient_id": link.patient_id,
            "relationship": link.relationship_type,
            "is_active": link.is_active,
            "created_at": link.created_at.isoformat() if link.created_at else None,
            "patient": {
                "id": patient.id,
                "name": patient.name,
                "email": patient_email,
                "age": patient.age,
                "gender": patient.gender,
            },
        }

        await notify_users([caregiver.id, patient.id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content={
                "success": True,
                "message": "Link created successfully",
                "data": payload,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating care link: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to create care link: {str(e)}"}
        )


@router.post("/care/requests", response_model=Dict[str, Any])
async def create_care_link_request(
    request_data: schemas.CareLinkRequestCreate,
    db: Session = Depends(get_db)
):
    """Create a caregiver->patient link request (patient must approve)."""
    try:
        caregiver = crud.get_user(db, request_data.caregiver_id)
        if not caregiver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Caregiver not found"}
            )

        patient = None
        if request_data.patient_id:
            patient = crud.get_user(db, request_data.patient_id)
        elif request_data.patient_email:
            patient = crud.get_user_by_email(db, request_data.patient_email)
        elif request_data.patient_phone:
            patient = crud.get_user_by_phone(db, request_data.patient_phone)

        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Patient not found"}
            )

        if caregiver.id == patient.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Cannot link self"}
            )

        # If already linked, return error
        existing_link = db.query(CareLink).filter(
            CareLink.caregiver_id == caregiver.id,
            CareLink.patient_id == patient.id,
            CareLink.is_active == True
        ).first()
        if existing_link:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Already linked to this patient"}
            )

        # If pending request exists, return it
        existing_request = db.query(models.CareLinkRequest).filter(
            models.CareLinkRequest.caregiver_id == caregiver.id,
            models.CareLinkRequest.patient_id == patient.id,
            models.CareLinkRequest.status == "pending"
        ).first()

        if existing_request:
            patient_email = patient.auth.email if getattr(patient, "auth", None) else None
            payload = {
                "id": existing_request.id,
                "caregiver_id": existing_request.caregiver_id,
                "patient_id": existing_request.patient_id,
                "relationship": existing_request.relationship_type,
                "message": existing_request.message,
                "status": existing_request.status,
                "created_at": existing_request.created_at.isoformat() if existing_request.created_at else None,
                "patient": {
                    "id": patient.id,
                    "name": patient.name,
                    "email": patient_email,
                    "age": patient.age,
                    "gender": patient.gender,
                },
            }
            await notify_users([caregiver.id, patient.id], "care", action="updated", payload=payload)
            await notify_admins("care", action="updated", payload=payload)
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "message": "Request already pending",
                    "data": payload,
                },
            )

        created = crud.create_care_link_request(
            db,
            caregiver_id=caregiver.id,
            patient_id=patient.id,
            relationship=request_data.relationship,
            message=request_data.message,
        )

        patient_email = patient.auth.email if getattr(patient, "auth", None) else None
        payload = {
            "id": created.id,
            "caregiver_id": created.caregiver_id,
            "patient_id": created.patient_id,
            "relationship": created.relationship_type,
            "message": created.message,
            "status": created.status,
            "created_at": created.created_at.isoformat() if created.created_at else None,
            "patient": {
                "id": patient.id,
                "name": patient.name,
                "email": patient_email,
                "age": patient.age,
                "gender": patient.gender,
            },
        }

        await notify_users([caregiver.id, patient.id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)
        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content={
                "success": True,
                "message": "Request created",
                "data": payload,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating care link request: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to create request: {str(e)}"}
        )


@router.get("/care/requests/incoming/{patient_id}", response_model=Dict[str, Any])
async def list_incoming_care_requests(
    patient_id: int,
    db: Session = Depends(get_db)
):
    """List pending care link requests for a patient."""
    try:
        patient = crud.get_user(db, patient_id)
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Patient not found"}
            )

        requests = crud.list_care_link_requests_for_patient(db, patient_id)
        data = []
        for req in requests:
            caregiver = req.caregiver
            caregiver_email = caregiver.auth.email if getattr(caregiver, "auth", None) else None
            data.append({
                "id": req.id,
                "caregiver_id": req.caregiver_id,
                "patient_id": req.patient_id,
                "relationship": req.relationship_type,
                "message": req.message,
                "status": req.status,
                "created_at": req.created_at.isoformat() if req.created_at else None,
                "caregiver": {
                    "id": caregiver.id,
                    "name": caregiver.name,
                    "email": caregiver_email,
                    "age": caregiver.age,
                    "gender": caregiver.gender,
                },
            })

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": data, "timestamp": datetime.utcnow().isoformat()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing incoming care requests: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to list requests: {str(e)}"}
        )


def _encode_care_request_message(
    request_type: str,
    initiated_by: str,
    user_message: Optional[str] = None,
) -> str:
    suffix = f" {user_message.strip()}" if user_message and user_message.strip() else ""
    return f"[care:{request_type}:{initiated_by}]{suffix}"


def _decode_care_request_message(raw_message: Optional[str]) -> Dict[str, Optional[str]]:
    message = raw_message or ""
    if message.startswith("[care:"):
        try:
            prefix, rest = message.split("]", 1)
            _, request_type, initiated_by = prefix[1:].split(":")
            return {
                "request_type": request_type or "link",
                "initiated_by": initiated_by or "caregiver",
                "message": rest.strip() or None,
            }
        except ValueError:
            pass
    return {
        "request_type": "link",
        "initiated_by": "caregiver",
        "message": raw_message,
    }


def _serialize_care_user(user_obj: Optional[User]) -> Optional[Dict[str, Any]]:
    if not user_obj:
        return None
    user_email = user_obj.auth.email if getattr(user_obj, "auth", None) else None
    return {
        "id": user_obj.id,
        "name": user_obj.name,
        "email": user_email,
        "age": user_obj.age,
        "gender": user_obj.gender,
    }


def _care_request_requires_approval(req: models.CareLinkRequest, user_id: int) -> bool:
    meta = _decode_care_request_message(req.message)
    request_type = meta["request_type"]
    initiated_by = meta["initiated_by"]

    if request_type == "unlink":
        approver_id = req.patient_id if initiated_by == "caregiver" else req.caregiver_id
        return approver_id == user_id

    return req.patient_id == user_id


def _care_request_initiated_by_user(req: models.CareLinkRequest, user_id: int) -> bool:
    meta = _decode_care_request_message(req.message)
    request_type = meta["request_type"]
    initiated_by = meta["initiated_by"]

    if request_type == "unlink":
        initiator_id = req.caregiver_id if initiated_by == "caregiver" else req.patient_id
        return initiator_id == user_id

    return req.caregiver_id == user_id


def _serialize_care_request(req: models.CareLinkRequest) -> Dict[str, Any]:
    meta = _decode_care_request_message(req.message)
    return {
        "id": req.id,
        "caregiver_id": req.caregiver_id,
        "patient_id": req.patient_id,
        "relationship": req.relationship_type,
        "message": meta["message"],
        "request_type": meta["request_type"],
        "initiated_by": meta["initiated_by"],
        "status": req.status,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "responded_at": req.responded_at.isoformat() if req.responded_at else None,
        "caregiver": _serialize_care_user(req.caregiver),
        "patient": _serialize_care_user(req.patient),
    }


@router.get("/care/requests/outgoing/{caregiver_id}", response_model=Dict[str, Any])
async def list_outgoing_care_requests(
    caregiver_id: int,
    db: Session = Depends(get_db)
):
    """List care link requests created by caregiver."""
    try:
        caregiver = crud.get_user(db, caregiver_id)
        if not caregiver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Caregiver not found"}
            )

        requests = crud.list_care_link_requests_for_caregiver(db, caregiver_id)
        data = []
        for req in requests:
            patient = req.patient
            patient_email = patient.auth.email if getattr(patient, "auth", None) else None
            data.append({
                "id": req.id,
                "caregiver_id": req.caregiver_id,
                "patient_id": req.patient_id,
                "relationship": req.relationship_type,
                "message": req.message,
                "status": req.status,
                "created_at": req.created_at.isoformat() if req.created_at else None,
                "responded_at": req.responded_at.isoformat() if req.responded_at else None,
                "patient": {
                    "id": patient.id,
                    "name": patient.name,
                    "email": patient_email,
                    "age": patient.age,
                    "gender": patient.gender,
                },
            })

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": data, "timestamp": datetime.utcnow().isoformat()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing outgoing care requests: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to list requests: {str(e)}"}
        )


@router.get("/care/requests/approvals/{user_id}", response_model=Dict[str, Any])
async def list_care_requests_for_approval(
    user_id: int,
    db: Session = Depends(get_db)
):
    """List pending care requests that require this user's approval."""
    try:
        user_obj = crud.get_user(db, user_id)
        if not user_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "User not found"}
            )

        requests = db.query(models.CareLinkRequest).filter(
            models.CareLinkRequest.status == "pending",
            or_(
                models.CareLinkRequest.patient_id == user_id,
                models.CareLinkRequest.caregiver_id == user_id,
            )
        ).order_by(models.CareLinkRequest.created_at.desc()).all()

        data = [_serialize_care_request(req) for req in requests if _care_request_requires_approval(req, user_id)]
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": data, "timestamp": datetime.utcnow().isoformat()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing care approvals: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to list approvals: {str(e)}"}
        )


@router.get("/care/requests/sent/{user_id}", response_model=Dict[str, Any])
async def list_sent_care_requests(
    user_id: int,
    db: Session = Depends(get_db)
):
    """List care requests initiated by this user."""
    try:
        user_obj = crud.get_user(db, user_id)
        if not user_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "User not found"}
            )

        requests = db.query(models.CareLinkRequest).filter(
            or_(
                models.CareLinkRequest.patient_id == user_id,
                models.CareLinkRequest.caregiver_id == user_id,
            )
        ).order_by(models.CareLinkRequest.created_at.desc()).all()

        data = [_serialize_care_request(req) for req in requests if _care_request_initiated_by_user(req, user_id)]
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": data, "timestamp": datetime.utcnow().isoformat()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing sent care requests: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to list sent requests: {str(e)}"}
        )


@router.post("/care/requests/{request_id}/accept", response_model=Dict[str, Any])
async def accept_care_link_request(
    request_id: int,
    action: schemas.CareLinkRequestAction,
    db: Session = Depends(get_db)
):
    """Patient accepts a care link request."""
    try:
        req = crud.get_care_link_request(db, request_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Request not found"}
            )

        request_meta = _decode_care_request_message(req.message)
        request_type = request_meta["request_type"]
        initiated_by = request_meta["initiated_by"]

        approver_id = req.patient_id if request_type == "link" or initiated_by == "caregiver" else req.caregiver_id
        actor_id = action.patient_id or action.caregiver_id or action.requester_id
        if actor_id and approver_id != actor_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"success": False, "error": "Not authorized to accept this request"}
            )

        if req.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Request already processed"}
            )

        link_payload = None
        if request_type == "unlink":
            link = db.query(CareLink).filter(
                CareLink.caregiver_id == req.caregiver_id,
                CareLink.patient_id == req.patient_id,
                CareLink.is_active == True
            ).first()
            if link:
                link_payload = {
                    "id": link.id,
                    "caregiver_id": link.caregiver_id,
                    "patient_id": link.patient_id,
                    "relationship": link.relationship_type,
                    "is_active": False,
                    "created_at": link.created_at.isoformat() if link.created_at else None,
                }
                crud.delete_care_link(db, link.id)
        else:
            existing_link = db.query(CareLink).filter(
                CareLink.caregiver_id == req.caregiver_id,
                CareLink.patient_id == req.patient_id,
                CareLink.is_active == True
            ).first()
            if not existing_link:
                crud.create_care_link(
                    db,
                    caregiver_id=req.caregiver_id,
                    patient_id=req.patient_id,
                    relationship=req.relationship_type
                )
            link = db.query(CareLink).filter(
                CareLink.caregiver_id == req.caregiver_id,
                CareLink.patient_id == req.patient_id,
                CareLink.is_active == True
            ).first()
            if link and link.patient:
                patient = link.patient
                patient_email = patient.auth.email if getattr(patient, "auth", None) else None
                link_payload = {
                    "id": link.id,
                    "caregiver_id": link.caregiver_id,
                    "patient_id": link.patient_id,
                    "relationship": link.relationship_type,
                    "is_active": link.is_active,
                    "created_at": link.created_at.isoformat() if link.created_at else None,
                    "patient": {
                        "id": patient.id,
                        "name": patient.name,
                        "email": patient_email,
                        "age": patient.age,
                        "gender": patient.gender,
                    },
                }

        req = crud.update_care_link_request_status(db, req, "accepted")

        payload = {
            "id": req.id,
            "status": req.status,
            "request_type": request_type,
            "initiated_by": initiated_by,
            "responded_at": req.responded_at.isoformat() if req.responded_at else None,
            "caregiver_id": req.caregiver_id,
            "patient_id": req.patient_id,
        }
        await notify_users([req.caregiver_id, req.patient_id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)

        if link_payload:
            await notify_users([req.caregiver_id, req.patient_id], "care", action="updated", payload=link_payload)
            await notify_admins("care", action="updated", payload=link_payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "message": "Request accepted", "data": {
                "id": req.id,
                "status": req.status,
                "request_type": request_type,
                "responded_at": req.responded_at.isoformat() if req.responded_at else None
            }},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error accepting care request: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to accept request: {str(e)}"}
        )


@router.post("/care/requests/{request_id}/reject", response_model=Dict[str, Any])
async def reject_care_link_request(
    request_id: int,
    action: schemas.CareLinkRequestAction,
    db: Session = Depends(get_db)
):
    """Patient rejects a care link request."""
    try:
        req = crud.get_care_link_request(db, request_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Request not found"}
            )

        request_meta = _decode_care_request_message(req.message)
        request_type = request_meta["request_type"]
        initiated_by = request_meta["initiated_by"]
        approver_id = req.patient_id if request_type == "link" or initiated_by == "caregiver" else req.caregiver_id
        actor_id = action.patient_id or action.caregiver_id or action.requester_id
        if actor_id and approver_id != actor_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"success": False, "error": "Not authorized to reject this request"}
            )

        if req.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Request already processed"}
            )

        req = crud.update_care_link_request_status(db, req, "rejected")

        payload = {
            "id": req.id,
            "status": req.status,
            "request_type": request_type,
            "initiated_by": initiated_by,
            "responded_at": req.responded_at.isoformat() if req.responded_at else None,
            "caregiver_id": req.caregiver_id,
            "patient_id": req.patient_id,
        }
        await notify_users([req.caregiver_id, req.patient_id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "message": "Request rejected", "data": {
                "id": req.id,
                "status": req.status,
                "responded_at": req.responded_at.isoformat() if req.responded_at else None
            }},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error rejecting care request: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to reject request: {str(e)}"}
        )


@router.post("/care/requests/{request_id}/cancel", response_model=Dict[str, Any])
async def cancel_care_link_request(
    request_id: int,
    action: schemas.CareLinkRequestAction,
    db: Session = Depends(get_db)
):
    """Caregiver cancels their request."""
    try:
        req = crud.get_care_link_request(db, request_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Request not found"}
            )

        request_meta = _decode_care_request_message(req.message)
        request_type = request_meta["request_type"]
        initiated_by = request_meta["initiated_by"]
        creator_id = req.caregiver_id if request_type == "link" or initiated_by == "caregiver" else req.patient_id
        actor_id = action.requester_id or action.caregiver_id or action.patient_id

        if actor_id and creator_id != actor_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"success": False, "error": "Not authorized to cancel this request"}
            )

        if req.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Request already processed"}
            )

        req = crud.update_care_link_request_status(db, req, "cancelled")

        payload = {
            "id": req.id,
            "status": req.status,
            "request_type": request_type,
            "initiated_by": initiated_by,
            "responded_at": req.responded_at.isoformat() if req.responded_at else None,
            "caregiver_id": req.caregiver_id,
            "patient_id": req.patient_id,
        }
        await notify_users([req.caregiver_id, req.patient_id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "message": "Request cancelled", "data": {
                "id": req.id,
                "status": req.status,
                "responded_at": req.responded_at.isoformat() if req.responded_at else None
            }},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling care request: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to cancel request: {str(e)}"}
        )


@router.get("/care/links/{caregiver_id}", response_model=Dict[str, Any])
async def list_care_links(
    caregiver_id: int,
    db: Session = Depends(get_db)
):
    """List caregiver links."""
    try:
        caregiver = crud.get_user(db, caregiver_id)
        if not caregiver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Caregiver not found"}
            )

        links = crud.get_care_links_by_caregiver(db, caregiver_id)
        data = []
        for link in links:
            patient = link.patient
            patient_email = patient.auth.email if getattr(patient, "auth", None) else None
            data.append({
                "id": link.id,
                "caregiver_id": link.caregiver_id,
                "patient_id": link.patient_id,
                "relationship": link.relationship_type,
                "is_active": link.is_active,
                "created_at": link.created_at.isoformat() if link.created_at else None,
                "patient": {
                    "id": patient.id,
                    "name": patient.name,
                    "email": patient_email,
                    "age": patient.age,
                    "gender": patient.gender,
                },
            })

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": data,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing care links: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to list care links: {str(e)}"}
        )


@router.get("/care/links/patient/{patient_id}", response_model=Dict[str, Any])
async def list_care_links_for_patient(
    patient_id: int,
    db: Session = Depends(get_db)
):
    """List users who monitor this patient."""
    try:
        patient = crud.get_user(db, patient_id)
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Patient not found"}
            )

        links = crud.get_care_links_by_patient(db, patient_id)
        data = []
        for link in links:
            caregiver = link.caregiver
            caregiver_email = caregiver.auth.email if getattr(caregiver, "auth", None) else None
            data.append({
                "id": link.id,
                "caregiver_id": link.caregiver_id,
                "patient_id": link.patient_id,
                "relationship": link.relationship_type,
                "is_active": link.is_active,
                "created_at": link.created_at.isoformat() if link.created_at else None,
                "caregiver": {
                    "id": caregiver.id,
                    "name": caregiver.name,
                    "email": caregiver_email,
                    "age": caregiver.age,
                    "gender": caregiver.gender,
                },
            })

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "data": data, "timestamp": datetime.utcnow().isoformat()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing patient care links: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to list patient links: {str(e)}"}
        )


@router.post("/care/links/{link_id}/request-unlink", response_model=Dict[str, Any])
async def request_care_unlink(
    link_id: int,
    request_data: schemas.CareLinkUnlinkRequestCreate,
    db: Session = Depends(get_db)
):
    """Create a pending unlink request that requires the other party's approval."""
    try:
        link = db.query(CareLink).filter(CareLink.id == link_id, CareLink.is_active == True).first()
        if not link:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Link not found"}
            )

        if request_data.requester_id not in {link.caregiver_id, link.patient_id}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"success": False, "error": "Not authorized to request unlink"}
            )

        initiated_by = "caregiver" if request_data.requester_id == link.caregiver_id else "patient"
        existing_request = db.query(models.CareLinkRequest).filter(
            models.CareLinkRequest.caregiver_id == link.caregiver_id,
            models.CareLinkRequest.patient_id == link.patient_id,
            models.CareLinkRequest.status == "pending"
        ).order_by(models.CareLinkRequest.created_at.desc()).all()

        for req in existing_request:
            meta = _decode_care_request_message(req.message)
            if meta["request_type"] == "unlink":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"success": False, "error": "An unlink request is already pending"}
                )

        request = crud.create_care_link_request(
            db,
            caregiver_id=link.caregiver_id,
            patient_id=link.patient_id,
            relationship=link.relationship_type,
            message=_encode_care_request_message("unlink", initiated_by, request_data.message),
        )

        payload = _serialize_care_request(request)
        await notify_users([link.caregiver_id, link.patient_id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "message": "Unlink request sent", "data": payload},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating unlink request: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to create unlink request: {str(e)}"}
        )


@router.get("/care/dashboard/{caregiver_id}", response_model=Dict[str, Any])
async def care_dashboard(
    caregiver_id: int,
    db: Session = Depends(get_db)
):
    """Return aggregated dashboard data for all linked patients."""
    try:
        caregiver = crud.get_user(db, caregiver_id)
        if not caregiver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Caregiver not found"}
            )

        links = crud.get_care_links_by_caregiver(db, caregiver_id)
        items = []

        for link in links:
            patient = link.patient
            if not patient:
                continue

            latest_vitals = db.query(VitalSensorData).filter(
                VitalSensorData.user_id == patient.id
            ).order_by(VitalSensorData.timestamp.desc()).first()

            last_alert = db.query(Alert).filter(
                Alert.user_id == patient.id
            ).order_by(Alert.timestamp.desc()).first()

            pending_count = db.query(Alert).filter(
                Alert.user_id == patient.id,
                Alert.status.in_(["pending", "sent", "active"])
            ).count()

            last_location = db.query(EmergencyLog).filter(
                EmergencyLog.user_id == patient.id,
                EmergencyLog.location_lat.isnot(None),
                EmergencyLog.location_lng.isnot(None)
            ).order_by(EmergencyLog.timestamp.desc()).first()

            patient_email = patient.auth.email if getattr(patient, "auth", None) else None

            items.append({
                "patient": {
                    "id": patient.id,
                    "name": patient.name,
                    "email": patient_email,
                    "age": patient.age,
                    "gender": patient.gender,
                },
                "relationship": link.relationship_type,
                "vitals": {
                    "heart_rate": latest_vitals.heart_rate if latest_vitals else None,
                    "oxygen_saturation": latest_vitals.oxygen_saturation if latest_vitals else None,
                    "blood_pressure_systolic": latest_vitals.blood_pressure_systolic if latest_vitals else None,
                    "blood_pressure_diastolic": latest_vitals.blood_pressure_diastolic if latest_vitals else None,
                    "body_temperature": latest_vitals.body_temperature if latest_vitals else None,
                    "timestamp": latest_vitals.timestamp.isoformat() if latest_vitals and latest_vitals.timestamp else None,
                    "is_abnormal": bool(latest_vitals.is_abnormal) if latest_vitals else False,
                    "abnormality_type": latest_vitals.abnormality_type if latest_vitals else None,
                },
                "alerts": {
                    "pending": pending_count,
                    "last": {
                        "id": last_alert.id,
                        "type": last_alert.alert_type,
                        "severity": last_alert.severity,
                        "message": last_alert.message,
                        "status": last_alert.status,
                        "timestamp": last_alert.timestamp.isoformat() if last_alert.timestamp else None,
                    } if last_alert else None
                },
                "location": {
                    "lat": last_location.location_lat,
                    "lng": last_location.location_lng,
                    "accuracy": last_location.location_accuracy,
                    "timestamp": last_location.timestamp.isoformat() if last_location.timestamp else None,
                    "emergency_type": last_location.emergency_type
                } if last_location else None,
            })

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": items,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error building care dashboard: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to build care dashboard: {str(e)}"}
        )


@router.get("/care/reports/{caregiver_id}", response_model=Dict[str, Any])
async def care_reports(
    caregiver_id: int,
    period: str = Query("weekly", description="daily|weekly|monthly"),
    patient_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Generate reports for caregiver-linked patients."""
    try:
        caregiver = crud.get_user(db, caregiver_id)
        if not caregiver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Caregiver not found"},
            )

        links = crud.get_care_links_by_caregiver(db, caregiver_id)
        if patient_id:
            links = [link for link in links if link.patient_id == patient_id]
            if not links:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"success": False, "error": "Patient not linked to caregiver"},
                )

        if start_date or end_date:
            if start_date:
                start_dt = _parse_iso_datetime(start_date)
            else:
                start_dt = datetime.utcnow() - timedelta(days=7)
            if end_date:
                end_dt = _parse_iso_datetime(end_date)
            else:
                end_dt = datetime.utcnow()
        else:
            period_map = {"daily": 1, "weekly": 7, "monthly": 30}
            days = period_map.get(period, 7)
            start_dt = datetime.utcnow() - timedelta(days=days)
            end_dt = datetime.utcnow()

        data: List[Dict[str, Any]] = []
        for link in links:
            patient = link.patient
            if not patient:
                continue

            report = _build_report_data(db, patient.id, start_dt, end_dt)
            patient_email = patient.auth.email if getattr(patient, "auth", None) else None
            data.append(
                {
                    "patient": {
                        "id": patient.id,
                        "name": patient.name,
                        "email": patient_email,
                        "age": patient.age,
                        "gender": patient.gender,
                    },
                    "relationship": link.relationship_type,
                    "report": report,
                }
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "period": period,
                "start_date": start_dt.isoformat(),
                "end_date": end_dt.isoformat(),
                "data": data,
                "timestamp": datetime.utcnow().isoformat(),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating caregiver reports: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to generate caregiver reports: {str(e)}"},
        )


@router.get("/care/reports/{caregiver_id}/export")
async def care_reports_export_pdf(
    caregiver_id: int,
    period: str = Query("weekly", description="daily|weekly|monthly"),
    patient_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Export caregiver reports as PDF."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"success": False, "error": "PDF export not available. Install reportlab."}
        )

    caregiver = crud.get_user(db, caregiver_id)
    if not caregiver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "Caregiver not found"},
        )

    links = crud.get_care_links_by_caregiver(db, caregiver_id)
    if patient_id:
        links = [link for link in links if link.patient_id == patient_id]
        if not links:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Patient not linked to caregiver"},
            )

    if start_date or end_date:
        start_dt = _parse_iso_datetime(start_date) if start_date else datetime.utcnow() - timedelta(days=7)
        end_dt = _parse_iso_datetime(end_date) if end_date else datetime.utcnow()
    else:
        period_map = {"daily": 1, "weekly": 7, "monthly": 30}
        days = period_map.get(period, 7)
        start_dt = datetime.utcnow() - timedelta(days=days)
        end_dt = datetime.utcnow()

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 72

    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, y, "Caregiver Report")
    y -= 22
    c.setFont("Helvetica", 10)
    c.drawString(72, y, f"Caregiver ID: {caregiver_id}")
    y -= 14
    c.drawString(72, y, f"Period: {period}")
    y -= 14
    c.drawString(72, y, f"From: {start_dt.isoformat()}  To: {end_dt.isoformat()}")
    y -= 22

    for link in links:
        patient = link.patient
        if not patient:
            continue
        report = _build_report_data(db, patient.id, start_dt, end_dt)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(72, y, f"Patient: {patient.name} (ID {patient.id})")
        y -= 16
        c.setFont("Helvetica", 10)
        c.drawString(80, y, f"Relationship: {link.relationship_type or 'unknown'}")
        y -= 14
        c.drawString(80, y, f"Alerts: {report['alerts']['total']} | Vitals: {report['vitals']['total']}")
        y -= 14
        c.drawString(80, y, f"Abnormal rate: {round(report['vitals']['abnormal_rate'] * 100, 1)}%")
        y -= 14
        recs = report.get("recommendations", [])
        if recs:
            c.drawString(80, y, "Recommendations:")
            y -= 12
            for rec in recs[:3]:
                c.drawString(92, y, f"- {rec}")
                y -= 12
        y -= 6
        if y < 120:
            c.showPage()
            y = height - 72

    c.showPage()
    c.save()
    pdf = buffer.getvalue()
    buffer.close()

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=caregiver_{caregiver_id}_report.pdf"
        }
    )


@router.delete("/care/links/{link_id}", response_model=Dict[str, Any])
async def remove_care_link(
    link_id: int,
    caregiver_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """Delete care link."""
    try:
        link = db.query(CareLink).filter(CareLink.id == link_id).first()
        deleted = crud.delete_care_link(db, link_id, caregiver_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Link not found"}
            )

        if link:
            payload = {
                "id": link.id,
                "caregiver_id": link.caregiver_id,
                "patient_id": link.patient_id,
                "relationship": link.relationship_type,
                "is_active": link.is_active,
                "created_at": link.created_at.isoformat() if link.created_at else None,
            }
            await notify_users([link.caregiver_id, link.patient_id], "care", action="updated", payload=payload)
            await notify_admins("care", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Link deleted successfully",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting care link: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to delete care link: {str(e)}"}
        )


# ======================
# Reports & Analytics
# ======================

@router.get("/reports/{user_id}", response_model=Dict[str, Any])
async def get_user_report(
    user_id: int,
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db)
):
    """Generate daily/weekly report for a user."""
    try:
        user = crud.get_user(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "User not found"}
            )

        start_date = datetime.utcnow() - timedelta(days=days)
        report = _build_report_data(db, user_id, start_date)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                **report,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating report: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to generate report: {str(e)}"}
        )

# ======================
# Device Routes - Mobile App Support
# ======================

@router.post("/devices/connect", response_model=Dict[str, Any])
async def connect_device(
    payload: schemas.DeviceConnect,
    db: Session = Depends(get_db)
):
    """Link a device to a user and mark it connected."""
    try:
        _assert_device_not_deleted(db, payload.device_id)
        user = db.query(User).filter(User.id == payload.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {payload.user_id} not found"
                }
            )

        device = crud.get_device_by_id(db, payload.device_id)

        if device:
            if device.user_id != payload.user_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "success": False,
                        "error": "Device ID already registered to another user"
                    }
                )
            device.user_id = payload.user_id
            device.mac_address = payload.mac_address or device.mac_address
            device.firmware_version = payload.firmware_version or device.firmware_version
            if payload.battery_level is not None:
                device.battery_level = payload.battery_level
            device.is_connected = True
            device.is_archived = False
            device.last_seen = datetime.utcnow()
            db.commit()
            db.refresh(device)
        else:
            device = Device(
                user_id=payload.user_id,
                device_id=payload.device_id,
                mac_address=payload.mac_address,
                firmware_version=payload.firmware_version,
                battery_level=payload.battery_level,
                is_connected=True,
                is_archived=False,
                last_seen=datetime.utcnow()
            )
            db.add(device)
            db.commit()
            db.refresh(device)

        device_token = device_auth.generate_device_token(device.device_id, device.user_id)

        payload = _serialize_device(db, device)
        await _notify_patient_and_caregivers(db, device.user_id, "devices", action="updated", payload=payload)
        await notify_admins("devices", action="updated", payload=payload)
        user = db.query(User).filter(User.id == device.user_id).first()
        if user:
            user_payload = _serialize_user_profile(user)
            await notify_admins("users", action="updated", payload=user_payload, throttle_seconds=10.0)
        user = db.query(User).filter(User.id == device.user_id).first()
        if user:
            user_payload = _serialize_user_profile(user)
            await notify_admins("users", action="updated", payload=user_payload, throttle_seconds=10.0)
        user = db.query(User).filter(User.id == device.user_id).first()
        if user:
            user_payload = _serialize_user_profile(user)
            await notify_admins("users", action="updated", payload=user_payload, throttle_seconds=10.0)
        user_payload = _serialize_user_profile(user)
        await notify_admins("users", action="updated", payload=user_payload, throttle_seconds=10.0)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device connected successfully",
                "data": {
                    "id": device.id,
                    "user_id": device.user_id,
                    "device_id": device.device_id,
                    "mac_address": device.mac_address,
                    "firmware_version": device.firmware_version,
                    "battery_level": device.battery_level,
                    "is_connected": device.is_connected,
                    "is_archived": device.is_archived,
                    "last_seen": device.last_seen.isoformat() if device.last_seen else None,
                    "created_at": device.created_at.isoformat() if device.created_at else None
                },
                "device_token": device_token,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error connecting device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to connect device: {str(e)}"
            }
        )

@router.post("/devices/request-pairing-token", response_model=schemas.DevicePairingTokenResponse)
async def request_device_pairing_token(
    payload: schemas.DevicePairingTokenRequest,
    request: Request,
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """Issue a pairing token and provisioning config for BLE onboarding."""
    try:
        user = session.get("user") or {}
        user_id = int(user.get("id"))
    except Exception as e:
        logger.error(f"Invalid session user for pairing token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid session user"},
        )

    _assert_device_not_deleted(db, payload.device_id, reconnecting_user_id=user_id)
    device = crud.get_device_by_id(db, payload.device_id)
    if device and device.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "success": False,
                "error": "Device ID already registered to another user",
            },
        )

    if device:
        device.firmware_version = payload.firmware_version or device.firmware_version
        device.is_archived = False
        db.commit()
        db.refresh(device)
    else:
        device = Device(
            user_id=user_id,
            device_id=payload.device_id,
            firmware_version=payload.firmware_version,
            is_connected=False,
            is_archived=False,
            last_seen=datetime.utcnow(),
        )
        db.add(device)
        db.commit()
        db.refresh(device)

    pairing_token = device_auth.generate_device_token(device.device_id, user_id)
    mqtt_topics = os.getenv("MQTT_TOPICS", "fall-detection/device-data")
    mqtt_topic = mqtt_topics.split(",")[0].strip() if mqtt_topics else "fall-detection/device-data"
    api_base_url = f"{str(request.base_url).rstrip('/')}/api/v1"

    serialized = _serialize_device(db, device)
    await _notify_patient_and_caregivers(db, user_id, "devices", action="updated", payload=serialized)

    return schemas.DevicePairingTokenResponse(
        success=True,
        device_id=device.device_id,
        user_id=user_id,
        pairing_token=pairing_token,
        expires_in=2592000,
        mqtt={
            "host": os.getenv("MQTT_BROKER", "broker.hivemq.com"),
            "port": int(os.getenv("MQTT_PORT", "1883")),
            "topic": mqtt_topic,
        },
        api={
            "base_url": api_base_url,
        },
        message="Pairing token generated successfully",
    )


@router.post("/devices/{device_id}/vitals/start", response_model=Dict[str, Any])
async def start_device_vitals_measurement(
    device_id: str,
    payload: Dict[str, Any] = None,
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """Ask a device to start a MAX30102 vitals measurement window."""
    payload = payload or {}
    user = session.get("user") or {}
    user_id = int(user.get("id") or 0)
    device = crud.get_device_by_id(db, device_id)

    if not device or device.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "Device not found for this user"},
        )

    device_reachable = is_device_online(device)

    duration_ms = int(payload.get("duration_ms") or 60000)
    duration_ms = max(10000, min(duration_ms, 120000))
    request_id = str(payload.get("request_id") or uuid.uuid4())

    command_payload = {
        "message_type": "device_command",
        "command": "vitals_start",
        "request_id": request_id,
        "duration_ms": duration_ms,
        "source": "mobile_app",
    }

    if not publish_device_command(device.device_id, command_payload):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"success": False, "error": "MQTT command channel is not available"},
        )

    status_payload = _normalize_vitals_status_payload(
        {
            "device_id": device.device_id,
            "user_id": device.user_id,
            "request_id": request_id,
            "vitals_trigger": "manual",
            "state": "requested",
            "progress_percent": 0,
            "finger_detected": False,
            "heart_rate_valid": False,
            "spo2_valid": False,
            "max_powered": False,
            "signal_status": "command_sent" if device_reachable else "command_sent_unconfirmed",
            "timestamp": datetime.utcnow().isoformat(),
        },
        device,
    )
    await _notify_patient_and_caregivers(db, device.user_id, "vitals_status", action="requested", payload=status_payload)

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "success": True,
            "message": "Vitals measurement requested" if device_reachable else "Vitals command sent, waiting for bracelet confirmation",
            "data": status_payload,
            "device_reachable": device_reachable,
        },
    )


@router.post("/devices/{device_id}/vitals/stop", response_model=Dict[str, Any])
async def stop_device_vitals_measurement(
    device_id: str,
    payload: Dict[str, Any] = None,
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """Ask a device to stop an active vitals measurement."""
    payload = payload or {}
    user = session.get("user") or {}
    user_id = int(user.get("id") or 0)
    device = crud.get_device_by_id(db, device_id)

    if not device or device.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "Device not found for this user"},
        )

    request_id = str(payload.get("request_id") or uuid.uuid4())
    command_payload = {
        "message_type": "device_command",
        "command": "vitals_stop",
        "request_id": request_id,
        "source": "mobile_app",
    }

    if not publish_device_command(device.device_id, command_payload):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"success": False, "error": "MQTT command channel is not available"},
        )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "success": True,
            "message": "Vitals stop requested",
            "data": {"device_id": device.device_id, "request_id": request_id},
        },
    )


@router.get("/devices/{device_id}/vitals/latest", response_model=Dict[str, Any])
async def get_latest_device_vitals_measurement(
    device_id: str,
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """Return the latest on-demand vitals measurement for a device."""
    user = session.get("user") or {}
    user_id = int(user.get("id") or 0)
    device = crud.get_device_by_id(db, device_id)

    if not device or device.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "Device not found for this user"},
        )

    measurement = (
        db.query(models.VitalsMeasurement)
        .filter(models.VitalsMeasurement.device_id == device.device_id)
        .order_by(models.VitalsMeasurement.updated_at.desc())
        .first()
    )

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "data": _serialize_vitals_measurement(measurement) if measurement else None,
        },
    )

@router.post("/devices/disconnect", response_model=Dict[str, Any])
async def disconnect_device(
    payload: schemas.DeviceDisconnect,
    db: Session = Depends(get_db)
):
    """Mark device as disconnected."""
    try:
        device = crud.get_device_by_id(db, payload.device_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Device with ID {payload.device_id} not found"
                }
            )

        device.is_connected = False
        db.commit()
        db.refresh(device)

        payload = _serialize_device(db, device)
        await _notify_patient_and_caregivers(db, device.user_id, "devices", action="updated", payload=payload)
        await notify_admins("devices", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device disconnected",
                "data": {
                    "id": device.id,
                    "user_id": device.user_id,
                    "device_id": device.device_id,
                    "mac_address": device.mac_address,
                    "firmware_version": device.firmware_version,
                    "battery_level": device.battery_level,
                    "is_connected": device.is_connected,
                    "is_archived": device.is_archived,
                    "last_seen": device.last_seen.isoformat() if device.last_seen else None,
                    "created_at": device.created_at.isoformat() if device.created_at else None
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error disconnecting device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to disconnect device: {str(e)}"
            }
        )

@router.delete("/devices/{device_id}", response_model=Dict[str, Any])
async def remove_device(
    device_id: str,
    user_id: Optional[int] = Query(None),
    permanent: bool = Query(False),
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db)
):
    """Remove a device from the account and optionally block it from future pairing."""
    try:
        device = crud.get_device_by_id(db, device_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Device with ID {device_id} not found"
                }
            )

        session_user = session.get("user") or {}
        session_user_id = int(session_user.get("id"))
        session_user_email = str(session_user.get("email") or "").strip().lower()
        is_admin = session_user_email in ADMIN_EMAILS if ADMIN_EMAILS else False

        if not is_admin and device.user_id != session_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": "Not authorized to delete this device"
                }
            )

        if user_id is not None and device.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": "Device does not belong to this user"
                }
            )

        user_active_devices = crud.get_devices_by_user(db, device.user_id)
        remaining_active_devices = [
            user_device for user_device in user_active_devices if user_device.device_id != device.device_id
        ]
        should_purge_user_level_sensor_data = len(remaining_active_devices) == 0

        payload = {
            "id": device.id,
            "user_id": device.user_id,
            "device_id": device.device_id,
            "mac_address": device.mac_address,
            "firmware_version": device.firmware_version,
            "battery_level": device.battery_level,
            "is_connected": False,
            "is_archived": True,
            "last_seen": datetime.utcnow().isoformat(),
            "created_at": device.created_at.isoformat() if device.created_at else None,
            "purged_user_level_sensor_data": should_purge_user_level_sensor_data,
            "permanent": permanent,
        }

        deleted_device = _find_deleted_device(db, device.device_id)
        if permanent:
            if deleted_device is None:
                db.add(
                    DeletedDevice(
                        device_id=device.device_id,
                        user_id=device.user_id,
                        mac_address=device.mac_address,
                    )
                )
                db.commit()
        elif deleted_device is not None:
            db.delete(deleted_device)
            db.commit()
            logger.info(
                "Removed deleted-device tombstone for device_id=%s during standard account unlink",
                device.device_id,
            )

        device_auth.device_tokens.pop(device.device_id, None)
        deleted_user_id = device.user_id

        db.query(VitalSensorData).filter(
            VitalSensorData.device_id == device.device_id
        ).delete(synchronize_session=False)
        db.query(Alert).filter(
            Alert.device_id == device.device_id
        ).delete(synchronize_session=False)
        db.query(EmergencyLog).filter(
            EmergencyLog.device_id == device.device_id
        ).delete(synchronize_session=False)

        if should_purge_user_level_sensor_data:
            db.query(VitalSensorData).filter(
                VitalSensorData.user_id == deleted_user_id,
                VitalSensorData.device_id.is_(None),
            ).delete(synchronize_session=False)
            db.query(Alert).filter(
                Alert.user_id == deleted_user_id,
                Alert.device_id.is_(None),
                Alert.alert_type == "vital_abnormal",
            ).delete(synchronize_session=False)
            db.query(EmergencyLog).filter(
                EmergencyLog.user_id == deleted_user_id,
                EmergencyLog.device_id.is_(None),
                EmergencyLog.emergency_type.in_(["fall", "vital_abnormal", "inactivity"]),
            ).delete(synchronize_session=False)
            db.commit()

        crud.delete_device(db, device)

        await _notify_patient_and_caregivers(db, deleted_user_id, "devices", action="deleted", payload=payload)
        await notify_admins("devices", action="deleted", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device deleted permanently" if permanent else "Device removed from account",
                "data": payload,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to remove device: {str(e)}"
            }
        )


@router.post("/devices/{device_id}/reset", response_model=Dict[str, Any])
async def reset_device_data(
    device_id: str,
    user_id: Optional[int] = Query(None),
    session: Dict[str, Any] = Depends(_require_user),
    db: Session = Depends(get_db)
):
    """Clear stored telemetry/history for a device without deleting the device itself."""
    try:
        device = crud.get_device_by_id(db, device_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Device with ID {device_id} not found"
                }
            )

        session_user = session.get("user") or {}
        session_user_id = int(session_user.get("id"))
        session_user_email = str(session_user.get("email") or "").strip().lower()
        is_admin = session_user_email in ADMIN_EMAILS if ADMIN_EMAILS else False

        if not is_admin and device.user_id != session_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": "Not authorized to reset this device"
                }
            )

        if user_id is not None and device.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": "Device does not belong to this user"
                }
            )

        motion_ids = [
            motion_id
            for (motion_id,) in db.query(models.MotionSensorData.id)
            .filter(models.MotionSensorData.device_id == device.device_id)
            .all()
        ]
        prediction_ids = []
        if motion_ids:
            prediction_ids = [
                prediction_id
                for (prediction_id,) in db.query(Prediction.id)
                .filter(Prediction.motion_data_id.in_(motion_ids))
                .all()
            ]

        motion_count = len(motion_ids)
        prediction_count = len(prediction_ids)
        vital_count = db.query(VitalSensorData).filter(
            VitalSensorData.device_id == device.device_id
        ).count()
        alert_count_query = db.query(Alert).filter(Alert.device_id == device.device_id)
        if prediction_ids:
            alert_count_query = db.query(Alert).filter(
                or_(
                    Alert.device_id == device.device_id,
                    Alert.prediction_id.in_(prediction_ids),
                )
            )
        alert_count = alert_count_query.count()
        emergency_log_count = db.query(EmergencyLog).filter(
            EmergencyLog.device_id == device.device_id
        ).count()

        if prediction_ids:
            db.query(Alert).filter(
                Alert.prediction_id.in_(prediction_ids)
            ).delete(synchronize_session=False)
            db.query(Prediction).filter(
                Prediction.id.in_(prediction_ids)
            ).delete(synchronize_session=False)

        db.query(Alert).filter(
            Alert.device_id == device.device_id
        ).delete(synchronize_session=False)
        db.query(EmergencyLog).filter(
            EmergencyLog.device_id == device.device_id
        ).delete(synchronize_session=False)
        db.query(VitalSensorData).filter(
            VitalSensorData.device_id == device.device_id
        ).delete(synchronize_session=False)
        db.query(models.MotionSensorData).filter(
            models.MotionSensorData.device_id == device.device_id
        ).delete(synchronize_session=False)
        db.commit()

        clear_raw_buffer(f"{device.user_id}:{device.device_id}")

        payload = _serialize_device(db, device, latest_data_at=None)
        reset_counts = {
            "motions": motion_count,
            "predictions": prediction_count,
            "vitals": vital_count,
            "alerts": alert_count,
            "emergency_logs": emergency_log_count,
        }
        payload["reset_counts"] = reset_counts

        await _notify_patient_and_caregivers(
            db,
            device.user_id,
            "devices",
            action="updated",
            payload=payload,
            throttle_seconds=1.0,
        )
        await notify_admins(
            "devices",
            action="updated",
            payload=payload,
            throttle_seconds=1.0,
        )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device data reset successfully",
                "data": {
                    "device_id": device.device_id,
                    "user_id": device.user_id,
                    "reset_counts": reset_counts,
                },
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error resetting device data: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to reset device data: {str(e)}"
            }
        )

@router.get("/devices/{device_id}", response_model=Dict[str, Any])
async def get_device(
    device_id: str,
    db: Session = Depends(get_db)
):
    """Get device by device_id."""
    try:
        device = crud.get_device_by_id(db, device_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Device with ID {device_id} not found"
                }
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": _serialize_device(db, device),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get device: {str(e)}"
            }
        )

@router.get("/devices/user/{user_id}", response_model=Dict[str, Any])
async def get_device_for_user(
    user_id: int,
    db: Session = Depends(get_db)
):
    """Get device for a user (first/primary device)."""
    try:
        device = crud.get_device_by_user(db, user_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"No device found for user ID {user_id}"
                }
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": _serialize_device(db, device),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get user device: {str(e)}"
            }
        )

@router.get("/devices/user/{user_id}/all", response_model=Dict[str, Any])
async def get_devices_for_user(
    user_id: int,
    db: Session = Depends(get_db)
):
    """Get all devices for a user."""
    try:
        devices = crud.get_devices_by_user(db, user_id)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": [_serialize_device(db, device) for device in devices],
                "count": len(devices),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except Exception as e:
        logger.error(f"Error getting user devices: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get user devices: {str(e)}"
            }
        )

@router.get("/devices/user/{user_id}/archived", response_model=Dict[str, Any])
async def get_archived_devices_for_user(
    user_id: int,
    db: Session = Depends(get_db)
):
    """Get archived devices for a user."""
    try:
        devices = crud.get_archived_devices_by_user(db, user_id)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": [_serialize_device(db, device) for device in devices],
                "count": len(devices),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except Exception as e:
        logger.error(f"Error getting archived devices: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get archived devices: {str(e)}"
            }
        )

@router.post("/devices/{device_id}/restore", response_model=Dict[str, Any])
async def restore_device(
    device_id: str,
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """Restore an archived device."""
    try:
        device = crud.get_device_by_id(db, device_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Device with ID {device_id} not found"
                }
            )

        if user_id is not None and device.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": "Device does not belong to this user"
                }
            )

        device.is_archived = False
        device.is_connected = False
        db.commit()
        db.refresh(device)

        payload = _serialize_device(db, device)
        await _notify_patient_and_caregivers(db, device.user_id, "devices", action="updated", payload=payload)
        await notify_admins("devices", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device restored successfully",
                "data": {
                    "id": device.id,
                    "user_id": device.user_id,
                    "device_id": device.device_id,
                    "mac_address": device.mac_address,
                    "firmware_version": device.firmware_version,
                    "battery_level": device.battery_level,
                    "is_connected": device.is_connected,
                    "is_archived": device.is_archived,
                    "last_seen": device.last_seen.isoformat() if device.last_seen else None,
                    "created_at": device.created_at.isoformat() if device.created_at else None
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error restoring device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to restore device: {str(e)}"
            }
        )


@router.post("/emergency/trigger", response_model=Dict[str, Any])
async def trigger_emergency(
    emergency_data: schemas.EmergencyTrigger,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger emergency SMS delivery from the backend without requiring the iPhone Messages send button."""
    try:
        user = crud.get_user(db, emergency_data.user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": f"User with ID {emergency_data.user_id} not found"},
            )

        raw_contacts = emergency_data.contacts or []
        active_contacts = [
            {
                "id": str(contact.id or contact.phone),
                "name": contact.name,
                "phone": contact.phone,
                "relationship": contact.relationship,
                "priority": contact.priority,
                "is_active": contact.is_active,
            }
            for contact in raw_contacts
            if contact.is_active and str(contact.phone or "").strip()
        ]

        if not active_contacts:
            stored_contacts = crud.get_emergency_contacts(db, emergency_data.user_id)
            active_contacts = [
                {
                    "id": str(contact.id),
                    "name": contact.name,
                    "phone": contact.phone,
                    "relationship": contact.relation_type,
                    "priority": contact.priority,
                    "is_active": contact.is_active,
                }
                for contact in stored_contacts
                if contact.is_active and str(contact.phone or "").strip()
            ]

        if not active_contacts:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "No active emergency contacts available"},
            )

        sorted_contacts = sorted(active_contacts, key=lambda item: item.get("priority", 3))
        location = emergency_data.location or {}
        generated_message, severity = _build_emergency_message(
            emergency_data.type,
            emergency_data.user_name or user.name,
            language=emergency_data.language or "en",
            location=location,
            fall_data=emergency_data.fall_data,
        )
        final_message = emergency_data.message.strip() if emergency_data.message else generated_message

        responses = notification_service.send_emergency_sms_contacts(sorted_contacts, final_message)
        successful_contacts = [
            item for item in responses if item.get("response_type") in {"sms_sent", "sms_and_call_sent"}
        ]
        # Do not mark the alert as failed just because we do not have a confirmed
        # SMS delivery yet. For async/indirect delivery paths, "pending" is a
        # better user-facing state than a hard failure.
        alert_status = "sent" if successful_contacts else ("pending" if responses else "failed")

        alert = Alert(
            user_id=user.id,
            device_id=emergency_data.device_id or (emergency_data.fall_data or {}).get("device_id"),
            alert_type=emergency_data.type,
            severity=severity,
            message=final_message,
            status=alert_status,
            sent_to=",".join([contact["phone"] for contact in sorted_contacts]),
            timestamp=datetime.utcnow(),
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)

        emergency_log = EmergencyLog(
            user_id=user.id,
            device_id=emergency_data.device_id or (emergency_data.fall_data or {}).get("device_id"),
            emergency_type=emergency_data.type,
            location_lat=location.get("latitude"),
            location_lng=location.get("longitude"),
            location_accuracy=location.get("accuracy"),
            message=final_message,
            sent_to=json.dumps(sorted_contacts),
            status=alert_status,
            responses=json.dumps(responses),
            timestamp=datetime.utcnow(),
        )
        db.add(emergency_log)
        db.commit()
        db.refresh(emergency_log)

        payload = _serialize_alert(alert)
        await _notify_patient_and_caregivers(db, user.id, "alerts", action="created", payload=payload)
        await notify_admins("alerts", action="created", payload=payload)
        background_tasks.add_task(_notify_caregivers_push_for_alert_id, alert.id, alert.alert_type)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Emergency alert processed",
                "emergency_id": str(alert.id),
                "sms_sent_count": len(successful_contacts),
                "contacts_count": len(sorted_contacts),
                "responses": responses,
                "data": {
                    "alert": payload,
                    "log_id": emergency_log.id,
                },
                "timestamp": datetime.utcnow().isoformat(),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error triggering emergency: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to trigger emergency: {str(e)}"},
        )

# ======================
# System Stats (Optional)
# ======================

@router.get("/stats", response_model=Dict[str, Any])
async def get_system_stats(
    db: Session = Depends(get_db)
):
    """Get lightweight system statistics for dashboard views."""
    try:
        stats = {
            "total_users": db.query(User).count(),
            "total_alerts": db.query(Alert).count(),
            "total_predictions": db.query(Prediction).count()
        }

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "data": stats,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except Exception as e:
        logger.error(f"Error getting system stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get system stats: {str(e)}"
            }
        )
