"""
CRUD operations for the Fall Detection system.
"""

import logging
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
import numpy as np

from . import models, schemas
from .ai_model import predict_fall, preprocess_motion_data
from .double_verification import DoubleVerificationSystem

logger = logging.getLogger(__name__)

# ======================
# User CRUD Operations
# ======================

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """Create a new user."""
    db_user = models.User(**user.dict())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    logger.info(f"Created user {db_user.id}: {db_user.name}")
    return db_user

def get_user(db: Session, user_id: int) -> Optional[models.User]:
    """Get user by ID."""
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_users(db: Session, skip: int = 0, limit: int = 100) -> List[models.User]:
    """Get list of users."""
    return db.query(models.User).offset(skip).limit(limit).all()

def update_user(db: Session, user_id: int, user_update: schemas.UserUpdate) -> Optional[models.User]:
    """Update user information."""
    db_user = get_user(db, user_id)
    if not db_user:
        return None
    
    update_data = user_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_user, field, value)
    
    db.commit()
    db.refresh(db_user)
    logger.info(f"Updated user {user_id}")
    return db_user

def delete_user(db: Session, user_id: int) -> bool:
    """Delete a user."""
    db_user = get_user(db, user_id)
    if not db_user:
        return False
    
    db.delete(db_user)
    db.commit()
    logger.info(f"Deleted user {user_id}")
    return True

# ======================
# Device CRUD Operations
# ======================

def create_device(db: Session, device: schemas.DeviceCreate) -> models.Device:
    """Register a new device."""
    db_device = models.Device(**device.dict())
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    logger.info(f"Created device {db_device.device_id} for user {db_device.user_id}")
    return db_device

def get_device_by_id(db: Session, device_id: str) -> Optional[models.Device]:
    """Get device by device ID."""
    return db.query(models.Device).filter(models.Device.device_id == device_id).first()

def get_device_by_user(db: Session, user_id: int) -> Optional[models.Device]:
    """Get device by user ID."""
    return db.query(models.Device).filter(models.Device.user_id == user_id).first()

def update_device_status(db: Session, device_id: str, battery_level: float, is_connected: bool) -> Optional[models.Device]:
    """Update device status."""
    db_device = get_device_by_id(db, device_id)
    if not db_device:
        return None
    
    db_device.battery_level = battery_level
    db_device.is_connected = is_connected
    db_device.last_seen = datetime.utcnow()
    
    db.commit()
    db.refresh(db_device)
    return db_device

# ======================
# Motion Data Operations
# ======================

def create_motion_data(db: Session, motion_data: schemas.MotionDataCreate) -> models.MotionSensorData:
    """Store motion sensor data."""
    
    # Calculate magnitudes
    acc_mag = (motion_data.acc_x**2 + motion_data.acc_y**2 + motion_data.acc_z**2) ** 0.5
    gyro_mag = (motion_data.gyro_x**2 + motion_data.gyro_y**2 + motion_data.gyro_z**2) ** 0.5
    
    # Check for fall suspicion (simple threshold)
    is_fall_suspected = acc_mag > 3.0 or gyro_mag > 150
    
    db_motion = models.MotionSensorData(
        user_id=motion_data.user_id,
        device_id=motion_data.device_id,
        acc_x=motion_data.acc_x,
        acc_y=motion_data.acc_y,
        acc_z=motion_data.acc_z,
        gyro_x=motion_data.gyro_x,
        gyro_y=motion_data.gyro_y,
        gyro_z=motion_data.gyro_z,
        temperature=motion_data.temperature,
        acc_mag=acc_mag,
        gyro_mag=gyro_mag,
        is_fall_suspected=is_fall_suspected,
        timestamp=datetime.utcnow()
    )
    
    db.add(db_motion)
    db.commit()
    db.refresh(db_motion)
    
    return db_motion

def get_recent_motion_data(db: Session, user_id: int, limit: int = 100) -> List[models.MotionSensorData]:
    """Get recent motion data for a user."""
    return db.query(models.MotionSensorData)\
        .filter(models.MotionSensorData.user_id == user_id)\
        .order_by(desc(models.MotionSensorData.timestamp))\
        .limit(limit)\
        .all()

# ======================
# Vital Data Operations
# ======================

def create_vital_data(db: Session, vital_data: schemas.VitalDataCreate) -> models.VitalSensorData:
    """Store vital signs data."""
    
    # Check for abnormalities (simplified)
    is_abnormal = False
    abnormality_type = None
    
    if vital_data.heart_rate:
        if vital_data.heart_rate < 50 or vital_data.heart_rate > 120:
            is_abnormal = True
            abnormality_type = "heart_rate"
    
    if vital_data.oxygen_saturation and vital_data.oxygen_saturation < 90:
        is_abnormal = True
        abnormality_type = "oxygen_saturation"
    
    if vital_data.blood_pressure_systolic and vital_data.blood_pressure_systolic > 180:
        is_abnormal = True
        abnormality_type = "blood_pressure"
    
    db_vital = models.VitalSensorData(
        user_id=vital_data.user_id,
        heart_rate=vital_data.heart_rate,
        blood_pressure_systolic=vital_data.blood_pressure_systolic,
        blood_pressure_diastolic=vital_data.blood_pressure_diastolic,
        oxygen_saturation=vital_data.oxygen_saturation,
        body_temperature=vital_data.body_temperature,
        respiration_rate=vital_data.respiration_rate,
        is_abnormal=is_abnormal,
        abnormality_type=abnormality_type,
        timestamp=datetime.utcnow()
    )
    
    db.add(db_vital)
    db.commit()
    db.refresh(db_vital)
    
    return db_vital

def get_recent_vital_data(db: Session, user_id: int, limit: int = 10) -> List[models.VitalSensorData]:
    """Get recent vital data for a user."""
    return db.query(models.VitalSensorData)\
        .filter(models.VitalSensorData.user_id == user_id)\
        .order_by(desc(models.VitalSensorData.timestamp))\
        .limit(limit)\
        .all()

# ======================
# Additional Helper Functions
# ======================

def get_prediction(db: Session, prediction_id: int) -> Optional[models.Prediction]:
    """Get prediction by ID."""
    return db.query(models.Prediction).filter(models.Prediction.id == prediction_id).first()

def get_motion_data(db: Session, motion_id: int) -> Optional[models.MotionSensorData]:
    """Get motion data by ID."""
    return db.query(models.MotionSensorData).filter(models.MotionSensorData.id == motion_id).first()

# ======================
# Prediction Operations
# ======================

def process_motion_and_predict(
    db: Session,
    motion_data: schemas.MotionDataCreate
) -> Dict:
    """
    Process motion data, make prediction, and verify with double verification.
    """
    
    try:
        # 1. Store motion data
        stored_motion = create_motion_data(db, motion_data)
        
        # 2. Get recent motion data for prediction buffer
        recent_motions = get_recent_motion_data(db, motion_data.user_id, limit=100)
        
        if len(recent_motions) < 10:
            logger.warning(f"Insufficient motion data for user {motion_data.user_id}")
            return {
                "success": False,
                "message": "Insufficient motion data for prediction",
                "motion_id": stored_motion.id
            }
        
        # 3. Prepare buffer for AI model
        motion_buffer = []
        for motion in recent_motions[-50:]:  # Use last 50 readings
            features = preprocess_motion_data(
                acc_x=motion.acc_x,
                acc_y=motion.acc_y,
                acc_z=motion.acc_z,
                gyro_x=motion.gyro_x,
                gyro_y=motion.gyro_y,
                gyro_z=motion.gyro_z
            )
            motion_buffer.append(features)
        
        motion_buffer = np.array(motion_buffer)
        
        # 4. Make AI prediction
        ai_prediction = predict_fall(motion_buffer)
        
        if not ai_prediction.get("success", False):
            logger.error(f"AI prediction failed for user {motion_data.user_id}")
            return {
                "success": False,
                "message": "AI prediction failed",
                "motion_id": stored_motion.id,
                "error": ai_prediction.get("error")
            }
        
        # 5. Double verification
        verification_system = DoubleVerificationSystem(db)
        
        # Get current vitals if available
        current_vitals = None
        recent_vital = get_recent_vital_data(db, motion_data.user_id, limit=1)
        if recent_vital:
            current_vitals = {
                'heart_rate': recent_vital[0].heart_rate,
                'oxygen_saturation': recent_vital[0].oxygen_saturation,
                'blood_pressure_systolic': recent_vital[0].blood_pressure_systolic
            }
        
        # Verify prediction
        verified_prediction = verification_system.verify_fall_with_vitals(
            user_id=motion_data.user_id,
            fall_prediction=ai_prediction,
            current_vitals=current_vitals
        )
        
        # 6. Store prediction
        db_prediction = models.Prediction(
            user_id=motion_data.user_id,
            motion_data_id=stored_motion.id,
            fall_now_probability=verified_prediction.get("fall_now_probability", 0.0),
            fall_soon_probability=verified_prediction.get("fall_soon_probability", 0.0),
            fall_now_prediction=verified_prediction.get("fall_now_prediction", False),
            fall_soon_prediction=verified_prediction.get("fall_soon_prediction", False),
            vital_check_performed=verified_prediction.get("vital_check_performed", False),
            vital_check_result=verified_prediction.get("vital_check_result"),
            final_verdict=verified_prediction.get("final_verdict"),
            confidence_score=verified_prediction.get("confidence_score", 0.0),
            timestamp=datetime.utcnow()
        )
        
        db.add(db_prediction)
        db.commit()
        db.refresh(db_prediction)
        
        # 7. Create alert if needed
        alert = None
        if verified_prediction.get("final_verdict", False):
            alert = verification_system.create_alert_if_needed(
                user_id=motion_data.user_id,
                prediction_id=db_prediction.id,
                verification_result=verified_prediction
            )
        
        return {
            "success": True,
            "message": "Prediction completed successfully",
            "motion_id": stored_motion.id,
            "prediction_id": db_prediction.id,
            "prediction": {
                "fall_now_probability": verified_prediction.get("fall_now_probability", 0.0),
                "fall_soon_probability": verified_prediction.get("fall_soon_probability", 0.0),
                "fall_now_detected": verified_prediction.get("fall_now_prediction", False),
                "fall_soon_warning": verified_prediction.get("fall_soon_prediction", False),
                "final_verdict": verified_prediction.get("final_verdict"),
                "confidence": verified_prediction.get("confidence_score", 0.0)
            },
            "alert_generated": alert is not None,
            "alert_id": alert.id if alert else None,
            "double_verification_performed": verified_prediction.get("vital_check_performed", False)
        }
        
    except Exception as e:
        logger.error(f"Error in process_motion_and_predict: {e}")
        return {
            "success": False,
            "message": f"Error processing motion data: {str(e)}",
            "error": str(e)
        }

# ======================
# Alert Operations
# ======================

def create_alert(db: Session, alert_data: schemas.AlertCreate) -> models.Alert:
    """Create a new alert."""
    db_alert = models.Alert(
        user_id=alert_data.user_id,
        prediction_id=alert_data.prediction_id,
        alert_type=alert_data.alert_type,
        severity=alert_data.severity,
        message=alert_data.message,
        status="pending",
        timestamp=datetime.utcnow()
    )
    
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    return db_alert

def get_pending_alerts(db: Session, limit: int = 50) -> List[models.Alert]:
    """Get pending alerts."""
    return db.query(models.Alert)\
        .filter(models.Alert.status == "pending")\
        .order_by(desc(models.Alert.timestamp))\
        .limit(limit)\
        .all()

def get_alerts_by_user(db: Session, user_id: int, limit: int = 20) -> List[models.Alert]:
    """Get alerts for a specific user."""
    return db.query(models.Alert)\
        .filter(models.Alert.user_id == user_id)\
        .order_by(desc(models.Alert.timestamp))\
        .limit(limit)\
        .all()

def update_alert_status(
    db: Session,
    alert_id: int,
    status: str,
    acknowledged_by: Optional[str] = None
) -> Optional[models.Alert]:
    """Update alert status."""
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if not alert:
        return None
    
    alert.status = status
    
    if status == "acknowledged" and acknowledged_by:
        alert.acknowledged_by = acknowledged_by
        alert.acknowledged_at = datetime.utcnow()
    elif status == "resolved":
        alert.resolved_at = datetime.utcnow()
    
    db.commit()
    db.refresh(alert)
    return alert

# ======================
# System Operations
# ======================

def get_system_stats(db: Session) -> Dict:
    """Get system statistics."""
    
    now = datetime.utcnow()
    last_hour = now - timedelta(hours=1)
    last_day = now - timedelta(days=1)
    
    try:
        # User stats
        total_users = db.query(models.User).count()
        active_users = db.query(models.User).filter(models.User.is_active == True).count()
        
        # Prediction stats
        total_predictions = db.query(models.Prediction).count()
        fall_predictions = db.query(models.Prediction).filter(models.Prediction.final_verdict == True).count()
        
        # Recent activity
        recent_predictions = db.query(models.Prediction)\
            .filter(models.Prediction.timestamp >= last_hour)\
            .count()
        
        recent_falls = db.query(models.Prediction)\
            .filter(models.Prediction.final_verdict == True)\
            .filter(models.Prediction.timestamp >= last_hour)\
            .count()
        
        # Alert stats
        pending_alerts = db.query(models.Alert).filter(models.Alert.status == "pending").count()
        total_alerts = db.query(models.Alert).filter(models.Alert.timestamp >= last_day).count()
        
        return {
            "users": {
                "total": total_users,
                "active": active_users
            },
            "predictions": {
                "total": total_predictions,
                "falls_detected": fall_predictions,
                "recent_hour": recent_predictions,
                "falls_recent_hour": recent_falls
            },
            "alerts": {
                "pending": pending_alerts,
                "last_24h": total_alerts
            },
            "timestamp": now.isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting system stats: {e}")
        return {
            "users": {"total": 0, "active": 0},
            "predictions": {"total": 0, "falls_detected": 0, "recent_hour": 0, "falls_recent_hour": 0},
            "alerts": {"pending": 0, "last_24h": 0},
            "timestamp": now.isoformat(),
            "error": str(e)
        }