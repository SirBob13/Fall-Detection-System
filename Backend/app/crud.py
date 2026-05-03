"""
CRUD operations for the Fall Detection system.
"""

import logging
import re
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from sqlalchemy.exc import SQLAlchemyError, IntegrityError, OperationalError
import numpy as np
from statistics import median

from . import models, schemas
from .config import (
    TIME_STEPS,
    VITAL_HR_MIN,
    VITAL_HR_MAX,
    VITAL_SPO2_MIN,
    VITAL_TEMP_MIN,
    VITAL_TEMP_MAX,
    VITAL_HR_MIN_VALID,
    VITAL_HR_MAX_VALID,
    VITAL_SPO2_MIN_VALID,
    VITAL_SPO2_MAX_VALID,
    VITAL_TEMP_MIN_VALID,
    VITAL_TEMP_MAX_VALID,
)
from .services.ai_model import predict_fall
from .double_verification import DoubleVerificationSystem

logger = logging.getLogger(__name__)

# ======================
# User CRUD Operations
# ======================

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """Create a new user with proper error handling."""
    try:
        db_user = models.User(**user.dict())
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        logger.info(f"Created user {db_user.id}: {db_user.name}")
        return db_user
        
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error creating user: {e}")
        raise ValueError(f"User creation failed due to constraint violation: {str(e)}")
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating user: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating user: {e}")
        raise

def get_user(db: Session, user_id: int) -> Optional[models.User]:
    """Get user by ID."""
    try:
        return db.query(models.User).filter(models.User.id == user_id).first()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting user {user_id}: {e}")
        return None

def get_users(db: Session, skip: int = 0, limit: int = 100) -> List[models.User]:
    """Get list of users."""
    try:
        return db.query(models.User).offset(skip).limit(limit).all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting users: {e}")
        return []

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    """Get user by email."""
    try:
        if not email:
            return None
        user_auth = db.query(models.UserAuth).filter(models.UserAuth.email == email.lower()).first()
        return user_auth.user if user_auth else None
    except SQLAlchemyError as e:
        logger.error(f"Database error getting user by email {email}: {e}")
        return None

def get_user_by_phone(db: Session, phone: str) -> Optional[models.User]:
    """Get user by phone (matched against emergency_contact)."""
    try:
        if not phone:
            return None
        normalized = re.sub(r'[\s\-\(\)]', '', phone).strip()
        if not normalized:
            return None
        user = db.query(models.User).filter(models.User.phone == normalized).first()
        if user:
            return user
        user = db.query(models.User).filter(models.User.emergency_contact == normalized).first()
        if user:
            return user
        if normalized != phone:
            user = db.query(models.User).filter(models.User.phone == phone).first()
            if user:
                return user
            return db.query(models.User).filter(models.User.emergency_contact == phone).first()
        return None
    except SQLAlchemyError as e:
        logger.error(f"Database error getting user by phone {phone}: {e}")
        return None

def update_user(db: Session, user_id: int, user_update: schemas.UserUpdate) -> Optional[models.User]:
    """Update user information."""
    try:
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
        
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error updating user {user_id}: {e}")
        raise ValueError(f"User update failed due to constraint violation: {str(e)}")
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error updating user {user_id}: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error updating user {user_id}: {e}")
        raise

def delete_user(db: Session, user_id: int) -> bool:
    """Delete a user."""
    try:
        db_user = get_user(db, user_id)
        if not db_user:
            return False
        
        db.delete(db_user)
        db.commit()
        logger.info(f"Deleted user {user_id}")
        return True
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error deleting user {user_id}: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error deleting user {user_id}: {e}")
        raise

# ======================
# Care Links Operations
# ======================

def create_care_link(
    db: Session,
    caregiver_id: int,
    patient_id: int,
    relationship: Optional[str] = None
) -> models.CareLink:
    """Create caregiver to patient link."""
    try:
        if caregiver_id == patient_id:
            raise ValueError("Caregiver and patient cannot be the same user")

        existing = db.query(models.CareLink).filter(
            models.CareLink.caregiver_id == caregiver_id,
            models.CareLink.patient_id == patient_id
        ).first()
        if existing:
            if relationship:
                existing.relationship_type = relationship
            existing.is_active = True
            db.commit()
            db.refresh(existing)
            return existing

        link = models.CareLink(
            caregiver_id=caregiver_id,
            patient_id=patient_id,
            relationship_type=relationship,
            is_active=True,
            created_at=datetime.utcnow()
        )
        db.add(link)
        db.commit()
        db.refresh(link)
        return link
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating care link: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating care link: {e}")
        raise

def get_care_links_by_caregiver(db: Session, caregiver_id: int) -> List[models.CareLink]:
    """List care links for a caregiver."""
    try:
        return db.query(models.CareLink).filter(
            models.CareLink.caregiver_id == caregiver_id,
            models.CareLink.is_active == True
        ).all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting care links for caregiver {caregiver_id}: {e}")
        return []

def get_care_links_by_patient(db: Session, patient_id: int) -> List[models.CareLink]:
    """List care links where the user is the monitored patient."""
    try:
        return db.query(models.CareLink).filter(
            models.CareLink.patient_id == patient_id,
            models.CareLink.is_active == True
        ).all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting care links for patient {patient_id}: {e}")
        return []

def delete_care_link(db: Session, link_id: int, caregiver_id: Optional[int] = None) -> bool:
    """Delete a care link."""
    try:
        query = db.query(models.CareLink).filter(models.CareLink.id == link_id)
        if caregiver_id:
            query = query.filter(models.CareLink.caregiver_id == caregiver_id)
        link = query.first()
        if not link:
            return False
        db.delete(link)
        db.commit()
        return True
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error deleting care link {link_id}: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error deleting care link {link_id}: {e}")
        raise

# ======================
# Care Link Requests CRUD
# ======================

def create_care_link_request(
    db: Session,
    caregiver_id: int,
    patient_id: int,
    relationship: Optional[str] = None,
    message: Optional[str] = None
) -> models.CareLinkRequest:
    """Create a pending care link request."""
    try:
        request = models.CareLinkRequest(
            caregiver_id=caregiver_id,
            patient_id=patient_id,
            relationship_type=relationship,
            message=message,
            status="pending",
        )
        db.add(request)
        db.commit()
        db.refresh(request)
        return request
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating care link request: {e}")
        raise RuntimeError(f"Database error: {str(e)}")

def get_care_link_request(db: Session, request_id: int) -> Optional[models.CareLinkRequest]:
    """Get care link request by ID."""
    try:
        return db.query(models.CareLinkRequest).filter(models.CareLinkRequest.id == request_id).first()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting care request {request_id}: {e}")
        return None

def list_care_link_requests_for_patient(db: Session, patient_id: int) -> List[models.CareLinkRequest]:
    """List pending requests for a patient."""
    try:
        return db.query(models.CareLinkRequest).filter(
            models.CareLinkRequest.patient_id == patient_id,
            models.CareLinkRequest.status == "pending"
        ).order_by(models.CareLinkRequest.created_at.desc()).all()
    except SQLAlchemyError as e:
        logger.error(f"Database error listing care requests for patient {patient_id}: {e}")
        return []

def list_care_link_requests_for_caregiver(db: Session, caregiver_id: int) -> List[models.CareLinkRequest]:
    """List requests created by caregiver."""
    try:
        return db.query(models.CareLinkRequest).filter(
            models.CareLinkRequest.caregiver_id == caregiver_id
        ).order_by(models.CareLinkRequest.created_at.desc()).all()
    except SQLAlchemyError as e:
        logger.error(f"Database error listing care requests for caregiver {caregiver_id}: {e}")
        return []

def update_care_link_request_status(
    db: Session,
    request: models.CareLinkRequest,
    status: str
) -> models.CareLinkRequest:
    """Update request status."""
    request.status = status
    request.responded_at = datetime.utcnow()
    db.commit()
    db.refresh(request)
    return request

# ======================
# Device CRUD Operations
# ======================

def create_device(db: Session, device: schemas.DeviceCreate) -> models.Device:
    """Register a new device."""
    try:
        db_device = models.Device(**device.dict())
        db.add(db_device)
        db.commit()
        db.refresh(db_device)
        logger.info(f"Created device {db_device.device_id} for user {db_device.user_id}")
        return db_device
        
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error creating device: {e}")
        raise ValueError(f"Device creation failed due to constraint violation: {str(e)}")
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating device: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating device: {e}")
        raise

def get_device_by_id(db: Session, device_id: str) -> Optional[models.Device]:
    """Get device by device ID."""
    try:
        return db.query(models.Device).filter(models.Device.device_id == device_id).first()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting device {device_id}: {e}")
        return None

def get_device_by_user(db: Session, user_id: int) -> Optional[models.Device]:
    """Get device by user ID."""
    try:
        return (
            db.query(models.Device)
            .filter(models.Device.user_id == user_id, models.Device.is_archived == False)  # noqa: E712
            .order_by(models.Device.last_seen.desc(), models.Device.created_at.desc())
            .first()
        )
    except SQLAlchemyError as e:
        logger.error(f"Database error getting device for user {user_id}: {e}")
        return None

def get_devices_by_user(db: Session, user_id: int) -> List[models.Device]:
    """Get all devices for a user (ordered by last seen)."""
    try:
        return (
            db.query(models.Device)
            .filter(models.Device.user_id == user_id, models.Device.is_archived == False)  # noqa: E712
            .order_by(models.Device.last_seen.desc(), models.Device.created_at.desc())
            .all()
        )
    except SQLAlchemyError as e:
        logger.error(f"Database error getting devices for user {user_id}: {e}")
        return []

def get_archived_devices_by_user(db: Session, user_id: int) -> List[models.Device]:
    """Get archived devices for a user (ordered by last seen)."""
    try:
        return (
            db.query(models.Device)
            .filter(models.Device.user_id == user_id, models.Device.is_archived == True)  # noqa: E712
            .order_by(models.Device.last_seen.desc(), models.Device.created_at.desc())
            .all()
        )
    except SQLAlchemyError as e:
        logger.error(f"Database error getting archived devices for user {user_id}: {e}")
        return []

def delete_device(db: Session, device: models.Device) -> None:
    """Delete a device."""
    try:
        db.delete(device)
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error deleting device {device.device_id}: {e}")
        raise RuntimeError(f"Database error: {str(e)}")

def update_device_status(db: Session, device_id: str, battery_level: float, is_connected: bool) -> Optional[models.Device]:
    """Update device status."""
    try:
        db_device = get_device_by_id(db, device_id)
        if not db_device:
            return None
        
        db_device.battery_level = battery_level
        db_device.is_connected = is_connected
        db_device.last_seen = datetime.utcnow()
        
        db.commit()
        db.refresh(db_device)
        return db_device
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error updating device status {device_id}: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error updating device status {device_id}: {e}")
        raise

# ======================
# Motion Data Operations
# ======================

def create_motion_data(db: Session, motion_data: schemas.MotionDataCreate) -> models.MotionSensorData:
    """Store motion sensor data."""
    try:
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
            timestamp=motion_data.timestamp or datetime.utcnow()
        )
        
        db.add(db_motion)
        db.commit()
        db.refresh(db_motion)
        
        return db_motion
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error storing motion data: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error storing motion data: {e}")
        raise

def get_recent_motion_data(db: Session, user_id: int, limit: int = 100) -> List[models.MotionSensorData]:
    """Get recent motion data for a user."""
    try:
        return db.query(models.MotionSensorData)\
            .filter(models.MotionSensorData.user_id == user_id)\
            .order_by(desc(models.MotionSensorData.timestamp))\
            .limit(limit)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting motion data for user {user_id}: {e}")
        return []

def get_motion_data(db: Session, motion_id: int) -> Optional[models.MotionSensorData]:
    """Get motion data by ID."""
    try:
        return db.query(models.MotionSensorData).filter(models.MotionSensorData.id == motion_id).first()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting motion data {motion_id}: {e}")
        return None

def get_motion_data_timeframe(
    db: Session, 
    user_id: int, 
    start_time: datetime, 
    end_time: datetime
) -> List[models.MotionSensorData]:
    """Get motion data within a specific timeframe."""
    try:
        return db.query(models.MotionSensorData)\
            .filter(
                and_(
                    models.MotionSensorData.user_id == user_id,
                    models.MotionSensorData.timestamp >= start_time,
                    models.MotionSensorData.timestamp <= end_time
                )
            )\
            .order_by(models.MotionSensorData.timestamp)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting motion data for timeframe: {e}")
        return []

# ======================
# Vital Data Operations
# ======================

def _sanitize_vital_value(value: Optional[float], min_valid: float, max_valid: float) -> Optional[float]:
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if value < min_valid or value > max_valid:
        return None
    return value

def _smooth_vital_value(current: Optional[float], recent_values: List[Optional[float]]) -> Optional[float]:
    values = [v for v in [current, *recent_values] if v is not None]
    if not values:
        return None
    return float(median(values))

def create_vital_data(db: Session, vital_data: schemas.VitalDataCreate) -> models.VitalSensorData:
    """Store vital signs data."""
    try:
        heart_rate = _sanitize_vital_value(vital_data.heart_rate, VITAL_HR_MIN_VALID, VITAL_HR_MAX_VALID)
        oxygen_saturation = _sanitize_vital_value(
            vital_data.oxygen_saturation, VITAL_SPO2_MIN_VALID, VITAL_SPO2_MAX_VALID
        )
        body_temperature = _sanitize_vital_value(
            vital_data.body_temperature, VITAL_TEMP_MIN_VALID, VITAL_TEMP_MAX_VALID
        )

        recent = db.query(models.VitalSensorData)\
            .filter(models.VitalSensorData.user_id == vital_data.user_id)\
            .order_by(desc(models.VitalSensorData.timestamp))\
            .limit(2)\
            .all()

        heart_rate = _smooth_vital_value(heart_rate, [v.heart_rate for v in recent])
        oxygen_saturation = _smooth_vital_value(oxygen_saturation, [v.oxygen_saturation for v in recent])
        body_temperature = _smooth_vital_value(body_temperature, [v.body_temperature for v in recent])

        # Check for abnormalities (simplified)
        abnormalities: List[str] = []

        if heart_rate is not None and (heart_rate < VITAL_HR_MIN or heart_rate > VITAL_HR_MAX):
            abnormalities.append("heart_rate")

        if oxygen_saturation is not None and oxygen_saturation < VITAL_SPO2_MIN:
            abnormalities.append("oxygen_saturation")

        if body_temperature is not None and (body_temperature < VITAL_TEMP_MIN or body_temperature > VITAL_TEMP_MAX):
            abnormalities.append("temperature")

        if vital_data.blood_pressure_systolic and vital_data.blood_pressure_systolic > 180:
            abnormalities.append("blood_pressure")

        is_abnormal = len(abnormalities) > 0
        abnormality_type = ", ".join(abnormalities) if abnormalities else None
        
        db_vital = models.VitalSensorData(
            user_id=vital_data.user_id,
            device_id=vital_data.device_id,
            heart_rate=heart_rate,
            blood_pressure_systolic=vital_data.blood_pressure_systolic,
            blood_pressure_diastolic=vital_data.blood_pressure_diastolic,
            oxygen_saturation=oxygen_saturation,
            body_temperature=body_temperature,
            respiration_rate=vital_data.respiration_rate,
            is_abnormal=is_abnormal,
            abnormality_type=abnormality_type,
            timestamp=vital_data.timestamp or datetime.utcnow()
        )
        
        db.add(db_vital)
        db.commit()
        db.refresh(db_vital)
        
        return db_vital
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error storing vital data: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error storing vital data: {e}")
        raise

def get_recent_vital_data(db: Session, user_id: int, limit: int = 10) -> List[models.VitalSensorData]:
    """Get recent vital data for a user."""
    try:
        return db.query(models.VitalSensorData)\
            .filter(models.VitalSensorData.user_id == user_id)\
            .order_by(desc(models.VitalSensorData.timestamp))\
            .limit(limit)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting vital data for user {user_id}: {e}")
        return []

def get_current_vitals(db: Session, user_id: int) -> Optional[Dict]:
    """Get current vitals for a user."""
    try:
        vitals = get_recent_vital_data(db, user_id, limit=1)
        if not vitals:
            return None
        
        return {
            'heart_rate': vitals[0].heart_rate,
            'oxygen_saturation': vitals[0].oxygen_saturation,
            'blood_pressure_systolic': vitals[0].blood_pressure_systolic,
            'body_temperature': vitals[0].body_temperature,
            'timestamp': vitals[0].timestamp
        }
    except Exception as e:
        logger.error(f"Error getting current vitals for user {user_id}: {e}")
        return None

# ======================
# Prediction Operations
# ======================

def get_prediction(db: Session, prediction_id: int) -> Optional[models.Prediction]:
    """Get prediction by ID."""
    try:
        return db.query(models.Prediction).filter(models.Prediction.id == prediction_id).first()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting prediction {prediction_id}: {e}")
        return None

def create_prediction(db: Session, prediction: schemas.PredictionCreate) -> models.Prediction:
    """Create a new prediction record."""
    try:
        db_prediction = models.Prediction(**prediction.dict())
        db.add(db_prediction)
        db.commit()
        db.refresh(db_prediction)
        return db_prediction
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating prediction: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating prediction: {e}")
        raise

def get_user_predictions(db: Session, user_id: int, limit: int = 50) -> List[models.Prediction]:
    """Get predictions for a specific user."""
    try:
        return db.query(models.Prediction)\
            .filter(models.Prediction.user_id == user_id)\
            .order_by(desc(models.Prediction.timestamp))\
            .limit(limit)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting predictions for user {user_id}: {e}")
        return []

def process_motion_and_predict(
    db: Session,
    motion_data: schemas.MotionDataCreate
) -> Dict:
    """
    Process motion data, make prediction, and verify with double verification.
    UPDATED FOR DUAL OUTPUT MODEL.
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
        
        # 3. Prepare raw buffer for AI model (match training pipeline)
        raw_buffer = []
        for motion in recent_motions[-TIME_STEPS:]:
            raw_buffer.append([
                motion.acc_x, motion.acc_y, motion.acc_z,
                motion.gyro_x, motion.gyro_y, motion.gyro_z
            ])
        
        raw_buffer = np.array(raw_buffer, dtype=np.float32)
        
        # 4. Make AI prediction with dual output
        ai_prediction = predict_fall(raw_buffer)
        
        # Log the dual output
        logger.info(f"🎯 AI Prediction:")
        logger.info(f"   Fall Now: {ai_prediction.get('fall_now_probability', 0):.3f}")
        logger.info(f"   Fall Soon: {ai_prediction.get('fall_soon_probability', 0):.3f}")
        logger.info(f"   Is Mock: {ai_prediction.get('is_mock', False)}")
        
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
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error in process_motion_and_predict: {e}")
        return {
            "success": False,
            "message": f"Database error processing motion data: {str(e)}",
            "error": str(e)
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
    try:
        db_alert = models.Alert(
            user_id=alert_data.user_id,
            prediction_id=alert_data.prediction_id,
            device_id=alert_data.device_id,
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
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating alert: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating alert: {e}")
        raise

def get_pending_alerts(db: Session, limit: int = 50) -> List[models.Alert]:
    """Get pending alerts."""
    try:
        return db.query(models.Alert)\
            .filter(models.Alert.status == "pending")\
            .order_by(desc(models.Alert.timestamp))\
            .limit(limit)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting pending alerts: {e}")
        return []

def get_alerts_by_user(db: Session, user_id: int, limit: int = 20) -> List[models.Alert]:
    """Get alerts for a specific user."""
    try:
        return db.query(models.Alert)\
            .filter(models.Alert.user_id == user_id)\
            .order_by(desc(models.Alert.timestamp))\
            .limit(limit)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting alerts for user {user_id}: {e}")
        return []

def update_alert_status(
    db: Session,
    alert_id: int,
    status: str,
    acknowledged_by: Optional[str] = None
) -> Optional[models.Alert]:
    """Update alert status."""
    try:
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
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error updating alert status {alert_id}: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error updating alert status {alert_id}: {e}")
        raise

# ======================
# Emergency Contact Operations
# ======================

def create_emergency_contact(db: Session, contact_data: schemas.EmergencyContactCreate) -> models.EmergencyContact:
    """Create a new emergency contact."""
    try:
        db_contact = models.EmergencyContact(**contact_data.dict())
        db.add(db_contact)
        db.commit()
        db.refresh(db_contact)
        return db_contact
        
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error creating emergency contact: {e}")
        raise ValueError(f"Emergency contact creation failed: {str(e)}")
        
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating emergency contact: {e}")
        raise RuntimeError(f"Database error: {str(e)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating emergency contact: {e}")
        raise

def get_emergency_contacts(db: Session, user_id: int) -> List[models.EmergencyContact]:
    """Get emergency contacts for a user."""
    try:
        return db.query(models.EmergencyContact)\
            .filter(models.EmergencyContact.user_id == user_id)\
            .order_by(models.EmergencyContact.priority)\
            .all()
    except SQLAlchemyError as e:
        logger.error(f"Database error getting emergency contacts for user {user_id}: {e}")
        return []

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
        
        # Device stats
        connected_devices = db.query(models.Device).filter(models.Device.is_connected == True).count()
        
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
            "devices": {
                "connected": connected_devices,
                "total": db.query(models.Device).count()
            },
            "timestamp": now.isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting system stats: {e}")
        return {
            "users": {"total": 0, "active": 0},
            "predictions": {"total": 0, "falls_detected": 0, "recent_hour": 0, "falls_recent_hour": 0},
            "alerts": {"pending": 0, "last_24h": 0},
            "devices": {"connected": 0, "total": 0},
            "timestamp": now.isoformat(),
            "error": str(e)
        }

def cleanup_old_data(db: Session, days_to_keep: int = 30) -> Dict:
    """Clean up old data to maintain database performance."""
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)
        
        # Delete old motion data
        motion_deleted = db.query(models.MotionSensorData)\
            .filter(models.MotionSensorData.timestamp < cutoff_date)\
            .delete(synchronize_session=False)
        
        # Delete old vital data
        vital_deleted = db.query(models.VitalSensorData)\
            .filter(models.VitalSensorData.timestamp < cutoff_date)\
            .delete(synchronize_session=False)
        
        # Delete old system logs (keep 7 days only)
        logs_cutoff = datetime.utcnow() - timedelta(days=7)
        logs_deleted = db.query(models.SystemLog)\
            .filter(models.SystemLog.timestamp < logs_cutoff)\
            .delete(synchronize_session=False)
        
        db.commit()
        
        return {
            "success": True,
            "message": "Old data cleaned up successfully",
            "deleted_records": {
                "motion_data": motion_deleted,
                "vital_data": vital_deleted,
                "system_logs": logs_deleted
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error cleaning up old data: {e}")
        return {
            "success": False,
            "message": f"Error cleaning up data: {str(e)}",
            "error": str(e)
        }
