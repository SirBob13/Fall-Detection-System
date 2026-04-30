"""
Admin Dashboard API Routes
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
import csv
import io

from ..database import get_db
from ..models import User, UserAuth, Device, MotionSensorData, VitalSensorData, Alert, Prediction, UserSession
from ..config import SECRET_KEY, ALGORITHM, ADMIN_EMAILS
from ..status_utils import build_device_status_payload, is_device_online, summarize_user_presence

logger = logging.getLogger(__name__)
router = APIRouter()

def _parse_date(value: Optional[str], is_end: bool = False) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except Exception:
        try:
            dt = datetime.strptime(value, "%Y-%m-%d")
        except Exception:
            return None

    if len(value) <= 10:
        if is_end:
            dt = dt + timedelta(days=1) - timedelta(seconds=1)
    return dt

def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def require_admin(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Authorization token required"}
        )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid token"}
        )

    user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
    user = db.query(User).filter(User.id == user_id).first()

    if not user_auth or not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "User not found"}
        )

    if not ADMIN_EMAILS or user_auth.email.lower() not in ADMIN_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"success": False, "error": "Admin access required"}
        )

    return {"user": user, "auth": user_auth}

@router.get("/openapi.json")
def admin_openapi(
    request: Request,
    _: Dict[str, Any] = Depends(require_admin)
):
    return JSONResponse(request.app.openapi())


@router.get("/overview", response_model=Dict[str, Any])
def get_admin_overview(
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """High-level stats for admin dashboard."""
    total_users = db.query(User).count()
    total_devices = db.query(Device).count()
    devices = db.query(Device).all()
    connected_devices = sum(1 for device in devices if is_device_online(device))
    total_motions = db.query(MotionSensorData).count()
    total_vitals = db.query(VitalSensorData).count()
    total_predictions = db.query(Prediction).count()
    total_alerts = db.query(Alert).count()
    active_alerts = db.query(Alert).filter(Alert.status.in_(["active", "pending"])).count()

    users = db.query(User).all()
    sessions_by_user = {}
    for session in db.query(UserSession).all():
        sessions_by_user.setdefault(session.user_id, []).append(session)
    devices_by_user = {}
    for device in devices:
        devices_by_user.setdefault(device.user_id, []).append(device)

    active_users = 0
    logged_in_users = 0
    logged_out_users = 0
    for user in users:
        presence_status, _ = summarize_user_presence(
            devices_by_user.get(user.id, []),
            sessions_by_user.get(user.id, []),
        )
        if presence_status == "active":
            active_users += 1
            logged_in_users += 1
        elif presence_status == "login":
            logged_in_users += 1
        else:
            logged_out_users += 1

    last_motion = db.query(func.max(MotionSensorData.timestamp)).scalar()
    last_vital = db.query(func.max(VitalSensorData.timestamp)).scalar()
    last_alert = db.query(func.max(Alert.timestamp)).scalar()

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "success": True,
            "data": {
                "users": {
                    "total": total_users,
                    "active": active_users,
                    "login": logged_in_users,
                    "logout": logged_out_users,
                },
                "devices": {
                    "total": total_devices,
                    "connected": connected_devices,
                    "offline": max(total_devices - connected_devices, 0),
                },
                "motions": total_motions,
                "vitals": total_vitals,
                "predictions": total_predictions,
                "alerts": {
                    "total": total_alerts,
                    "active": active_alerts
                },
                "last_activity": {
                    "motion": last_motion.isoformat() if last_motion else None,
                    "vital": last_vital.isoformat() if last_vital else None,
                    "alert": last_alert.isoformat() if last_alert else None
                }
            },
            "timestamp": datetime.utcnow().isoformat()
        }
    )


@router.get("/alerts", response_model=Dict[str, Any])
def get_admin_alerts(
    limit: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(Alert)
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(Alert.timestamp >= start_dt)
    if end_dt:
        query = query.filter(Alert.timestamp <= end_dt)

    alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
    data = [
        {
            "id": a.id,
            "user_id": a.user_id,
            "prediction_id": a.prediction_id,
            "type": a.alert_type,
            "severity": a.severity,
            "status": a.status,
            "message": a.message,
            "timestamp": a.timestamp.isoformat() if a.timestamp else None,
        }
        for a in alerts
    ]
    return {"success": True, "data": data, "count": len(data)}


@router.get("/vitals", response_model=Dict[str, Any])
def get_admin_vitals(
    limit: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(VitalSensorData)
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(VitalSensorData.timestamp >= start_dt)
    if end_dt:
        query = query.filter(VitalSensorData.timestamp <= end_dt)

    vitals = query.order_by(VitalSensorData.timestamp.desc()).limit(limit).all()
    data = [
        {
            "id": v.id,
            "user_id": v.user_id,
            "heart_rate": v.heart_rate,
            "blood_pressure_systolic": v.blood_pressure_systolic,
            "blood_pressure_diastolic": v.blood_pressure_diastolic,
            "oxygen_saturation": v.oxygen_saturation,
            "body_temperature": v.body_temperature,
            "respiration_rate": v.respiration_rate,
            "is_abnormal": bool(v.is_abnormal),
            "abnormality_type": v.abnormality_type,
            "timestamp": v.timestamp.isoformat() if v.timestamp else None,
        }
        for v in vitals
    ]
    return {"success": True, "data": data, "count": len(data)}


@router.get("/devices", response_model=Dict[str, Any])
def get_admin_devices(
    limit: int = Query(50, ge=1, le=500),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    devices = db.query(Device).order_by(Device.last_seen.desc()).limit(limit).all()
    device_ids = [device.device_id for device in devices]
    latest_motion_rows = (
        db.query(MotionSensorData.device_id, func.max(MotionSensorData.timestamp))
        .filter(MotionSensorData.device_id.in_(device_ids))
        .group_by(MotionSensorData.device_id)
        .all()
        if device_ids
        else []
    )
    latest_motion_by_device = {device_id: timestamp for device_id, timestamp in latest_motion_rows}
    data = [
        {
            "id": d.id,
            "device_id": d.device_id,
            "user_id": d.user_id,
            "battery_level": d.battery_level,
            "firmware_version": d.firmware_version,
            "is_connected": bool(d.is_connected),
            "last_seen": d.last_seen.isoformat() if d.last_seen else None,
            **build_device_status_payload(d, latest_motion_by_device.get(d.device_id)),
        }
        for d in devices
    ]
    return {"success": True, "data": data, "count": len(data)}

@router.get("/users", response_model=Dict[str, Any])
def get_admin_users(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(User, UserAuth).join(UserAuth, UserAuth.user_id == User.id)
    if search:
        like = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(User.name).like(like),
                func.lower(UserAuth.email).like(like)
            )
        )
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(User.created_at >= start_dt)
    if end_dt:
        query = query.filter(User.created_at <= end_dt)

    total = query.count()
    rows = (
        query.order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Precompute device counts and last seen
    device_counts = dict(
        db.query(Device.user_id, func.count(Device.id))
        .group_by(Device.user_id)
        .all()
    )
    last_seen = dict(
        db.query(Device.user_id, func.max(Device.last_seen))
        .group_by(Device.user_id)
        .all()
    )
    devices_by_user = {}
    for device in db.query(Device).all():
        devices_by_user.setdefault(device.user_id, []).append(device)
    sessions_by_user = {}
    for session in db.query(UserSession).all():
        sessions_by_user.setdefault(session.user_id, []).append(session)

    data = []
    for user, auth in rows:
        presence_status, online_devices = summarize_user_presence(
            devices_by_user.get(user.id, []),
            sessions_by_user.get(user.id, []),
        )
        data.append({
            "id": user.id,
            "name": user.name,
            "email": auth.email,
            "is_active": bool(user.is_active),
            "presence_status": presence_status,
            "online_devices": online_devices,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "devices": device_counts.get(user.id, 0),
            "last_seen": last_seen.get(user.id).isoformat() if last_seen.get(user.id) else None
        })

    return {"success": True, "data": data, "count": len(data), "total": total}

@router.get("/users/{user_id}", response_model=Dict[str, Any])
def get_admin_user_detail(
    user_id: int,
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
    if not user or not auth:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "User not found"}
        )

    devices = db.query(Device).filter(Device.user_id == user_id).all()
    sessions = db.query(UserSession).filter(UserSession.user_id == user_id).all()
    presence_status, online_devices = summarize_user_presence(devices, sessions)
    alerts = db.query(Alert).filter(Alert.user_id == user_id).count()
    vitals = db.query(VitalSensorData).filter(VitalSensorData.user_id == user_id).count()
    motions = db.query(MotionSensorData).filter(MotionSensorData.user_id == user_id).count()

    return {
        "success": True,
        "data": {
            "id": user.id,
            "name": user.name,
            "email": auth.email,
            "is_active": bool(user.is_active),
            "presence_status": presence_status,
            "online_devices": online_devices,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "updated_at": user.updated_at.isoformat() if user.updated_at else None,
            "age": user.age,
            "gender": user.gender,
            "weight": user.weight,
            "height": user.height,
            "medical_conditions": user.medical_conditions,
            "emergency_contact": user.emergency_contact,
            "devices": [
                {
                    "id": d.id,
                    "device_id": d.device_id,
                    "battery_level": d.battery_level,
                    "firmware_version": d.firmware_version,
                    "is_connected": bool(d.is_connected),
                    "last_seen": d.last_seen.isoformat() if d.last_seen else None,
                    **build_device_status_payload(
                        d,
                        db.query(func.max(MotionSensorData.timestamp))
                        .filter(MotionSensorData.device_id == d.device_id)
                        .scalar(),
                    ),
                }
                for d in devices
            ],
            "stats": {
                "alerts": alerts,
                "vitals": vitals,
                "motions": motions
            }
        }
    }

@router.get("/users/{user_id}/alerts", response_model=Dict[str, Any])
def get_admin_user_alerts(
    user_id: int,
    limit: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(Alert).filter(Alert.user_id == user_id)
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(Alert.timestamp >= start_dt)
    if end_dt:
        query = query.filter(Alert.timestamp <= end_dt)

    alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
    data = [
        {
            "id": a.id,
            "prediction_id": a.prediction_id,
            "type": a.alert_type,
            "severity": a.severity,
            "status": a.status,
            "message": a.message,
            "timestamp": a.timestamp.isoformat() if a.timestamp else None,
        }
        for a in alerts
    ]
    return {"success": True, "data": data, "count": len(data)}

@router.get("/users/{user_id}/vitals", response_model=Dict[str, Any])
def get_admin_user_vitals(
    user_id: int,
    limit: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(VitalSensorData).filter(VitalSensorData.user_id == user_id)
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(VitalSensorData.timestamp >= start_dt)
    if end_dt:
        query = query.filter(VitalSensorData.timestamp <= end_dt)

    vitals = query.order_by(VitalSensorData.timestamp.desc()).limit(limit).all()
    data = [
        {
            "id": v.id,
            "heart_rate": v.heart_rate,
            "blood_pressure_systolic": v.blood_pressure_systolic,
            "blood_pressure_diastolic": v.blood_pressure_diastolic,
            "oxygen_saturation": v.oxygen_saturation,
            "body_temperature": v.body_temperature,
            "respiration_rate": v.respiration_rate,
            "is_abnormal": bool(v.is_abnormal),
            "abnormality_type": v.abnormality_type,
            "timestamp": v.timestamp.isoformat() if v.timestamp else None,
        }
        for v in vitals
    ]
    return {"success": True, "data": data, "count": len(data)}

@router.get("/users/{user_id}/motions", response_model=Dict[str, Any])
def get_admin_user_motions(
    user_id: int,
    limit: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(MotionSensorData).filter(MotionSensorData.user_id == user_id)
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(MotionSensorData.timestamp >= start_dt)
    if end_dt:
        query = query.filter(MotionSensorData.timestamp <= end_dt)

    motions = query.order_by(MotionSensorData.timestamp.desc()).limit(limit).all()
    data = [
        {
            "id": m.id,
            "device_id": m.device_id,
            "acc_x": m.acc_x,
            "acc_y": m.acc_y,
            "acc_z": m.acc_z,
            "acc_mag": m.acc_mag,
            "gyro_x": m.gyro_x,
            "gyro_y": m.gyro_y,
            "gyro_z": m.gyro_z,
            "gyro_mag": m.gyro_mag,
            "temperature": m.temperature,
            "is_fall_suspected": bool(m.is_fall_suspected),
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
        }
        for m in motions
    ]
    return {"success": True, "data": data, "count": len(data)}

@router.get("/users/{user_id}/predictions", response_model=Dict[str, Any])
def get_admin_user_predictions(
    user_id: int,
    limit: int = Query(50, ge=1, le=500),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    query = db.query(Prediction).filter(Prediction.user_id == user_id)
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt:
        query = query.filter(Prediction.timestamp >= start_dt)
    if end_dt:
        query = query.filter(Prediction.timestamp <= end_dt)

    preds = query.order_by(Prediction.timestamp.desc()).limit(limit).all()
    data = [
        {
            "id": p.id,
            "motion_data_id": p.motion_data_id,
            "fall_now_probability": p.fall_now_probability,
            "fall_soon_probability": p.fall_soon_probability,
            "fall_now_prediction": bool(p.fall_now_prediction),
            "fall_soon_prediction": bool(p.fall_soon_prediction),
            "vital_check_performed": bool(p.vital_check_performed),
            "vital_check_result": p.vital_check_result,
            "final_verdict": p.final_verdict,
            "confidence_score": p.confidence_score,
            "timestamp": p.timestamp.isoformat() if p.timestamp else None,
        }
        for p in preds
    ]
    return {"success": True, "data": data, "count": len(data)}

@router.get("/users/{user_id}/report.pdf")
def export_admin_user_report_pdf(
    user_id: int,
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"success": False, "error": "PDF export not available. Install reportlab."}
        )

    user = db.query(User).filter(User.id == user_id).first()
    auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
    if not user or not auth:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "User not found"}
        )

    devices = db.query(Device).filter(Device.user_id == user_id).all()
    alerts = db.query(Alert).filter(Alert.user_id == user_id).count()
    vitals = db.query(VitalSensorData).filter(VitalSensorData.user_id == user_id).count()
    motions = db.query(MotionSensorData).filter(MotionSensorData.user_id == user_id).count()
    predictions = db.query(Prediction).filter(Prediction.user_id == user_id).count()

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    y = height - 72
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, y, "Fall Detection User Report")
    y -= 24
    c.setFont("Helvetica", 11)
    c.drawString(72, y, f"User: {user.name} ({auth.email})")
    y -= 14
    c.drawString(72, y, f"User ID: {user.id}")
    y -= 14
    c.drawString(72, y, f"Active: {bool(user.is_active)}")
    y -= 20

    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, y, "Summary")
    y -= 16
    c.setFont("Helvetica", 11)
    c.drawString(80, y, f"Devices: {len(devices)}")
    y -= 14
    c.drawString(80, y, f"Alerts: {alerts}")
    y -= 14
    c.drawString(80, y, f"Vitals: {vitals}")
    y -= 14
    c.drawString(80, y, f"Motions: {motions}")
    y -= 14
    c.drawString(80, y, f"Predictions: {predictions}")
    y -= 20

    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, y, "Devices")
    y -= 16
    c.setFont("Helvetica", 10)
    if not devices:
        c.drawString(80, y, "No devices linked")
        y -= 14
    else:
        for d in devices[:10]:
            c.drawString(80, y, f"{d.device_id} | Battery {d.battery_level} | Connected {bool(d.is_connected)}")
            y -= 12
            if y < 100:
                c.showPage()
                y = height - 72

    c.showPage()
    c.save()
    pdf = buffer.getvalue()
    buffer.close()

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=user_{user_id}_report.pdf"}
    )

@router.put("/users/{user_id}/status", response_model=Dict[str, Any])
def set_user_status(
    user_id: int,
    payload: Dict[str, Any],
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "User not found"}
        )
    is_active = bool(payload.get("is_active", True))
    user.is_active = is_active
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return {"success": True, "message": "User status updated", "data": {"id": user.id, "is_active": user.is_active}}

@router.delete("/users/{user_id}", response_model=Dict[str, Any])
def delete_user(
    user_id: int,
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "User not found"}
        )
    db.delete(user)
    db.commit()
    return {"success": True, "message": "User deleted"}

@router.get("/users/export")
def export_admin_users(
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    rows = (
        db.query(User, UserAuth)
        .join(UserAuth, UserAuth.user_id == User.id)
        .order_by(User.created_at.desc())
        .all()
    )

    device_counts = dict(
        db.query(Device.user_id, func.count(Device.id))
        .group_by(Device.user_id)
        .all()
    )
    last_seen = dict(
        db.query(Device.user_id, func.max(Device.last_seen))
        .group_by(Device.user_id)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "name", "email", "is_active", "created_at", "devices", "last_seen"
    ])

    for user, auth in rows:
        writer.writerow([
            user.id,
            user.name,
            auth.email,
            int(bool(user.is_active)),
            user.created_at.isoformat() if user.created_at else "",
            device_counts.get(user.id, 0),
            last_seen.get(user.id).isoformat() if last_seen.get(user.id) else ""
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users.csv"}
    )


@router.get("/reports", response_model=Dict[str, Any])
def get_admin_reports(
    period: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt or end_dt:
        since = start_dt or (datetime.utcnow() - timedelta(days=7))
        until = end_dt or datetime.utcnow()
    else:
        days = {"daily": 1, "weekly": 7, "monthly": 30}[period]
        since = datetime.utcnow() - timedelta(days=days)
        until = datetime.utcnow()

    def group_by_date(model, column):
        date_col = func.date(column)
        rows = (
            db.query(date_col.label("date"), func.count().label("count"))
            .filter(column >= since)
            .filter(column <= until)
            .group_by(date_col)
            .order_by(date_col)
            .all()
        )
        return [{"date": r.date, "count": r.count} for r in rows]

    summary = {
        "motions": db.query(MotionSensorData).filter(MotionSensorData.timestamp >= since, MotionSensorData.timestamp <= until).count(),
        "vitals": db.query(VitalSensorData).filter(VitalSensorData.timestamp >= since, VitalSensorData.timestamp <= until).count(),
        "alerts": db.query(Alert).filter(Alert.timestamp >= since, Alert.timestamp <= until).count(),
        "predictions": db.query(Prediction).filter(Prediction.timestamp >= since, Prediction.timestamp <= until).count(),
    }

    return {
        "success": True,
        "period": period,
        "since": since.isoformat(),
        "until": until.isoformat(),
        "summary": summary,
        "series": {
            "motions": group_by_date(MotionSensorData, MotionSensorData.timestamp),
            "vitals": group_by_date(VitalSensorData, VitalSensorData.timestamp),
            "alerts": group_by_date(Alert, Alert.timestamp),
        }
    }

@router.get("/reports/export")
def export_admin_reports_pdf(
    period: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    # Lazy import to avoid hard dependency at startup
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"success": False, "error": "PDF export not available. Install reportlab."}
        )

    start_dt = _parse_date(start)
    end_dt = _parse_date(end, is_end=True)
    if start_dt or end_dt:
        since = start_dt or (datetime.utcnow() - timedelta(days=7))
        until = end_dt or datetime.utcnow()
    else:
        days = {"daily": 1, "weekly": 7, "monthly": 30}[period]
        since = datetime.utcnow() - timedelta(days=days)
        until = datetime.utcnow()

    summary = {
        "motions": db.query(MotionSensorData).filter(MotionSensorData.timestamp >= since, MotionSensorData.timestamp <= until).count(),
        "vitals": db.query(VitalSensorData).filter(VitalSensorData.timestamp >= since, VitalSensorData.timestamp <= until).count(),
        "alerts": db.query(Alert).filter(Alert.timestamp >= since, Alert.timestamp <= until).count(),
        "predictions": db.query(Prediction).filter(Prediction.timestamp >= since, Prediction.timestamp <= until).count(),
    }

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    y = height - 72
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, y, "Fall Detection Report")
    y -= 24
    c.setFont("Helvetica", 10)
    c.drawString(72, y, f"Period: {period}")
    y -= 14
    c.drawString(72, y, f"From: {since.isoformat()}  To: {until.isoformat()}")
    y -= 24

    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, y, "Summary")
    y -= 16
    c.setFont("Helvetica", 11)
    for key, value in summary.items():
        c.drawString(80, y, f"{key.title()}: {value}")
        y -= 14

    c.showPage()
    c.save()
    pdf = buffer.getvalue()
    buffer.close()

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=report.pdf"}
    )
