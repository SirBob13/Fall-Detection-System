"""
Main API routes for the Fall Detection system - FIXED WITH PROPER HTTP STATUS CODES
"""

import logging
import re
import io
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query, Header
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import text, func
import math
import time

from ..database import get_db
from ..services.ai_model import load_model_and_scaler, predict_from_sample
from .. import crud, schemas, models
from ..services.auth_service import AuthService
from ..models import User, Alert, Prediction, Device, CareLink, VitalSensorData, EmergencyLog, UserPushToken
from ..device_auth import device_auth
from ..double_verification import DoubleVerificationSystem
from ..services.notification_service import NotificationService
from ..realtime import notify_user, notify_users, notify_admins

logger = logging.getLogger(__name__)
router = APIRouter()
notification_service = NotificationService()

# ======================
# Helper functions
# ======================

def _serialize_alert(alert: Alert) -> Dict[str, Any]:
    return {
        "id": alert.id,
        "user_id": alert.user_id,
        "prediction_id": alert.prediction_id,
        "type": alert.alert_type,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "message": alert.message,
        "status": alert.status,
        "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
        "resolved_at": alert.resolved_at.isoformat() if getattr(alert, "resolved_at", None) else None,
        "location": getattr(alert, "location", None),
        "response_notes": getattr(alert, "response_notes", None),
        "metadata": getattr(alert, "metadata", None),
        "acknowledged_by": getattr(alert, "acknowledged_by", None),
        "acknowledged_at": alert.acknowledged_at.isoformat() if getattr(alert, "acknowledged_at", None) else None,
    }

def _serialize_device(device: Device) -> Dict[str, Any]:
    return {
        "id": device.id,
        "user_id": device.user_id,
        "device_id": device.device_id,
        "mac_address": device.mac_address,
        "firmware_version": device.firmware_version,
        "battery_level": device.battery_level,
        "is_connected": device.is_connected,
        "is_archived": device.is_archived,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "created_at": device.created_at.isoformat() if device.created_at else None,
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
        "timestamp": motion.timestamp.isoformat() if motion.timestamp else None,
    }

def _serialize_user_profile(user: User) -> Dict[str, Any]:
    devices = list(getattr(user, "devices", []) or [])
    last_seen = None
    for device in devices:
        if device.last_seen and (last_seen is None or device.last_seen > last_seen):
            last_seen = device.last_seen
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
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "devices": len(devices),
        "last_seen": last_seen.isoformat() if last_seen else None,
    }

def _serialize_vital(vital: VitalSensorData) -> Dict[str, Any]:
    return {
        "id": vital.id,
        "user_id": vital.user_id,
        "heart_rate": vital.heart_rate,
        "blood_pressure_systolic": vital.blood_pressure_systolic,
        "blood_pressure_diastolic": vital.blood_pressure_diastolic,
        "oxygen_saturation": vital.oxygen_saturation,
        "body_temperature": vital.body_temperature,
        "respiration_rate": vital.respiration_rate,
        "is_abnormal": bool(vital.is_abnormal),
        "abnormality_type": vital.abnormality_type,
        "timestamp": vital.timestamp.isoformat() if vital.timestamp else None,
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
        "timestamp": pred.timestamp.isoformat() if pred.timestamp else None,
    }

def _ensure_device_for_ingest(
    db: Session,
    device_id: str,
    user_id: Optional[int],
    battery_level: Optional[float] = None,
    firmware_version: Optional[str] = None
) -> Device:
    """Ensure device exists and belongs to user."""
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

    # Update device metadata if provided
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

    if updated:
        device.is_connected = True
        device.last_seen = datetime.utcnow()
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
    }

    if payload.motion:
        motion_dict = payload.motion.dict(exclude_none=True)
        motion_dict["user_id"] = user_id
        motion_dict["device_id"] = device.device_id
        if payload.timestamp and not motion_dict.get("timestamp"):
            motion_dict["timestamp"] = payload.timestamp
        response, _, _, _ = _process_motion_data_internal(motion_dict, db)
        result["motion"] = response

    if payload.vitals:
        vitals_dict = payload.vitals.dict(exclude_unset=True)
        if payload.timestamp and not vitals_dict.get("timestamp"):
            vitals_dict["timestamp"] = payload.timestamp
        vital_schema = schemas.VitalDataCreate(user_id=user_id, **vitals_dict)
        stored_vital = crud.create_vital_data(db, vital_schema)

        alert_id = None
        if stored_vital.is_abnormal:
            alert = Alert(
                user_id=user_id,
                alert_type="vital_abnormal",
                severity="high",
                message=f"Abnormal {stored_vital.abnormality_type} detected",
                status="active",
                timestamp=datetime.utcnow()
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            alert_id = alert.id
            notification_service.notify_vital_abnormality(
                user_id=user_id,
                vitals=vitals_dict,
                message=alert.message
            )
            notification_service.notify_caregivers_alert(
                db=db,
                patient_id=user_id,
                alert=alert,
                reason="vital_abnormal",
            )

        result["vitals"] = {
            "id": stored_vital.id,
            "is_abnormal": bool(stored_vital.is_abnormal),
            "abnormality_type": stored_vital.abnormality_type,
            "alert_id": alert_id,
            "timestamp": stored_vital.timestamp.isoformat() if stored_vital.timestamp else None,
        }

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
    if not session or not session.get("user"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid or expired token"}
        )
    return session


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
            "timestamp": now.isoformat(),
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
                "timestamp": datetime.utcnow().isoformat(),
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
            "timestamp": datetime.utcnow().isoformat()
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

def _process_motion_data_internal(
    data: Dict[str, Any],
    db: Session,
) -> Tuple[Dict[str, Any], models.MotionSensorData, Prediction, Optional[Alert]]:
    """Core motion processing logic without realtime notifications."""
    logger.info(f"Processing motion data: {data}")

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
    raw_temperature = data.get('temperature', 36.5)
    temperature = float(36.5 if raw_temperature is None else raw_temperature)
    user_id = int(data.get('user_id'))
    device_id = data.get('device_id')

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
    ai_result = predict_from_sample(
        acc_x=acc_x,
        acc_y=acc_y,
        acc_z=acc_z,
        gyro_x=gyro_x,
        gyro_y=gyro_y,
        gyro_z=gyro_z,
        buffer_key=buffer_key
    )

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

    verification_system = DoubleVerificationSystem(db)
    verified = verification_system.verify_fall_with_vitals(
        user_id=user_id,
        fall_prediction=ai_result,
        current_vitals=None
    )

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
    if verified.get("final_verdict", False):
        alert = verification_system.create_alert_if_needed(
            user_id=user_id,
            prediction_id=db_pred.id,
            verification_result=verified
        )
        if alert:
            notification_service.notify_caregivers_alert(
                db=db,
                patient_id=user_id,
                alert=alert,
                reason="fall",
            )

    response = {
        "success": True,
        "message": "Prediction completed",
        "prediction": {
            "fall_now_probability": verified.get("fall_now_probability", 0.0),
            "fall_soon_probability": verified.get("fall_soon_probability", 0.0),
            "fall_now_prediction": verified.get("fall_now_prediction", False),
            "fall_soon_prediction": verified.get("fall_soon_prediction", False),
            "confidence_score": verified.get("confidence_score", 0.0),
            "final_verdict": verified.get("final_verdict", False),
            "vital_check_performed": verified.get("vital_check_performed", False),
            "vital_check_result": verified.get("vital_check_result"),
            "timestamp": datetime.utcnow().isoformat(),
            "is_mock": ai_result.get("is_mock", False),
            "model_type": "dual_output" if "fall_soon_probability" in ai_result else "single_output"
        },
        "is_test_data": ai_result.get("is_mock", False),
        "timestamp": datetime.utcnow().isoformat(),
        "database_stored": True,
        "motion_id": stored_motion.id,
        "prediction_id": db_pred.id,
        "alert_generated": alert is not None,
        "alert_id": alert.id if alert else None
    }

    return response, stored_motion, db_pred, alert


@router.post("/motion", response_model=Dict[str, Any])
async def process_motion_data(
    data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Process motion data and return prediction.
    Now supports dual output (fall_now and fall_soon).
    """
    try:
        response, stored_motion, db_pred, alert = _process_motion_data_internal(data, db)

        prediction_payload = _serialize_prediction(db_pred)
        motion_payload = _serialize_motion(stored_motion)
        await notify_user(stored_motion.user_id, "motions", action="created", payload=motion_payload, throttle_seconds=2.0)
        await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=2.0)
        await notify_user(stored_motion.user_id, "predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)
        await notify_admins("predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)

        if alert:
            alert_payload = _serialize_alert(alert)
            await notify_user(alert.user_id, "alerts", action="created", payload=alert_payload)
            await notify_admins("alerts", action="created", payload=alert_payload)

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
            device_payload = _serialize_device(device_obj) if device_obj else None

            if result.get("motion"):
                if motion_payload:
                    await notify_user(user_id, "motions", action="created", payload=motion_payload, throttle_seconds=2.0)
                    await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=2.0)
                await notify_user(user_id, "predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)
                await notify_admins("predictions", action="created", payload=prediction_payload, throttle_seconds=2.0)
            if result.get("vitals"):
                await notify_user(user_id, "vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
                await notify_admins("vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
            motion_alert_id = (result.get("motion") or {}).get("alert_id")
            vital_alert_id = (result.get("vitals") or {}).get("alert_id")
            if motion_alert_id or vital_alert_id:
                await notify_user(user_id, "alerts", action="created", payload=alert_payload)
                await notify_admins("alerts", action="created", payload=alert_payload)
            if device_payload:
                await notify_user(user_id, "devices", action="updated", payload=device_payload, throttle_seconds=10.0)
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

@router.post("/device-data/batch", response_model=Dict[str, Any])
async def ingest_device_data_batch(
    batch: schemas.DeviceIngestBatch,
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
        except Exception as e:
            errors.append({"index": idx, "error": str(e)})

    for uid in motion_users:
        latest_motion = db.query(models.MotionSensorData).filter(models.MotionSensorData.user_id == uid).order_by(models.MotionSensorData.timestamp.desc()).first()
        motion_payload = _serialize_motion(latest_motion) if latest_motion else None
        if motion_payload:
            await notify_user(uid, "motions", action="created", payload=motion_payload, throttle_seconds=2.0)
            await notify_admins("motions", action="created", payload=motion_payload, throttle_seconds=2.0)
        latest_prediction = db.query(Prediction).filter(Prediction.user_id == uid).order_by(Prediction.timestamp.desc()).first()
        payload = _serialize_prediction(latest_prediction) if latest_prediction else None
        await notify_user(uid, "predictions", action="created", payload=payload, throttle_seconds=2.0)
        await notify_admins("predictions", action="created", payload=payload, throttle_seconds=2.0)
    for uid in vitals_users:
        latest_vital = db.query(VitalSensorData).filter(VitalSensorData.user_id == uid).order_by(VitalSensorData.timestamp.desc()).first()
        payload = _serialize_vital(latest_vital) if latest_vital else None
        await notify_user(uid, "vitals", action="created", payload=payload, throttle_seconds=5.0)
        await notify_admins("vitals", action="created", payload=payload, throttle_seconds=5.0)
    for uid in alerts_users:
        latest_alert = db.query(Alert).filter(Alert.user_id == uid).order_by(Alert.timestamp.desc()).first()
        payload = _serialize_alert(latest_alert) if latest_alert else None
        await notify_user(uid, "alerts", action="created", payload=payload)
        await notify_admins("alerts", action="created", payload=payload)
    for uid in touched_users:
        device_obj = db.query(Device).filter(Device.user_id == uid).order_by(Device.created_at.desc()).first()
        payload = _serialize_device(device_obj) if device_obj else None
        await notify_user(uid, "devices", action="updated", payload=payload, throttle_seconds=10.0)
        await notify_admins("devices", action="updated", payload=payload, throttle_seconds=10.0)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": len(errors) == 0,
            "received": len(batch.items),
            "stored": len(results),
            "errors": errors,
            "timestamp": datetime.utcnow().isoformat()
        }
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
                    "blood_pressure": f"{round(vital_readings['blood_pressure_systolic'], 0)}/{round(vital_readings['blood_pressure_diastolic'], 0)}",
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
            await notify_user(user_id, "vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
            await notify_admins("vitals", action="created", payload=vital_payload, throttle_seconds=5.0)
            if alert_id:
                alert = db.query(Alert).filter(Alert.id == alert_id).first()
                alert_payload = _serialize_alert(alert) if alert else None
                await notify_user(user_id, "alerts", action="created", payload=alert_payload)
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
                    "timestamp": datetime.utcnow().isoformat()
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
            "timestamp": m.timestamp.isoformat() if m.timestamp else None
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
            "timestamp": datetime.utcnow().isoformat()
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
            "timestamp": v.timestamp.isoformat() if v.timestamp else None
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
            "timestamp": datetime.utcnow().isoformat()
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
            "timestamp": p.timestamp.isoformat() if p.timestamp else None
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
            "timestamp": datetime.utcnow().isoformat()
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
            formatted_alerts.append({
                "id": alert.id,
                "user_id": alert.user_id,
                "prediction_id": alert.prediction_id,
                "type": alert.alert_type,
                "alert_type": alert.alert_type,
                "severity": alert.severity,
                "message": alert.message,
                "status": alert.status,
                "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
                "resolved_at": alert.resolved_at.isoformat() if getattr(alert, "resolved_at", None) else None,
                "location": getattr(alert, "location", None),
                "response_notes": getattr(alert, "response_notes", None),
                "metadata": getattr(alert, "metadata", None)
            })
        
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
                "timestamp": datetime.utcnow().isoformat()
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
        await notify_user(alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": f"Alert status updated to {new_status}",
                "alert_id": alert_id,
                "status": new_status,
                "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                "timestamp": datetime.utcnow().isoformat()
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
        await notify_user(alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Alert acknowledged",
                "alert_id": alert_id,
                "status": alert.status,
                "acknowledged_by": alert.acknowledged_by,
                "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
                "timestamp": datetime.utcnow().isoformat()
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
        await notify_user(alert.user_id, "alerts", action="updated", payload=payload)
        await notify_admins("alerts", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Alert resolved",
                "alert_id": alert_id,
                "status": alert.status,
                "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                "timestamp": datetime.utcnow().isoformat()
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
        await notify_user(user.id, "profile", action="updated", payload=payload)
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

        if action.patient_id and req.patient_id != action.patient_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"success": False, "error": "Not authorized to accept this request"}
            )

        if req.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Request already processed"}
            )

        # Create care link if not exists
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

        req = crud.update_care_link_request_status(db, req, "accepted")

        payload = {
            "id": req.id,
            "status": req.status,
            "responded_at": req.responded_at.isoformat() if req.responded_at else None,
            "caregiver_id": req.caregiver_id,
            "patient_id": req.patient_id,
        }
        await notify_users([req.caregiver_id, req.patient_id], "care", action="updated", payload=payload)
        await notify_admins("care", action="updated", payload=payload)

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
            await notify_users([req.caregiver_id, req.patient_id], "care", action="updated", payload=link_payload)
            await notify_admins("care", action="updated", payload=link_payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"success": True, "message": "Request accepted", "data": {
                "id": req.id,
                "status": req.status,
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

        if action.patient_id and req.patient_id != action.patient_id:
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

        if action.caregiver_id and req.caregiver_id != action.caregiver_id:
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

        payload = _serialize_device(device)
        await notify_user(device.user_id, "devices", action="updated", payload=payload)
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
        device.last_seen = datetime.utcnow()
        db.commit()
        db.refresh(device)

        payload = _serialize_device(device)
        await notify_user(device.user_id, "devices", action="updated", payload=payload)
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
    db: Session = Depends(get_db)
):
    """Unlink (archive) a device without deleting its data."""
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

        device.is_connected = False
        device.is_archived = True
        device.last_seen = datetime.utcnow()
        db.commit()
        db.refresh(device)

        payload = _serialize_device(device)
        await notify_user(device.user_id, "devices", action="updated", payload=payload)
        await notify_admins("devices", action="updated", payload=payload)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Device unlinked successfully",
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
        logger.error(f"Error removing device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to remove device: {str(e)}"
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
                "data": [
                    {
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
                    }
                    for device in devices
                ],
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
                "data": [
                    {
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
                    }
                    for device in devices
                ],
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
        device.last_seen = datetime.utcnow()
        db.commit()
        db.refresh(device)

        payload = _serialize_device(device)
        await notify_user(device.user_id, "devices", action="updated", payload=payload)
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
