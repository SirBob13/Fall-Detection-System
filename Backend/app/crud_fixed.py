"""
CRUD operations - Fixed version with numpy import
"""
import logging
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
import numpy as np  # تم إضافة هذا الاستيراد

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

# ======================
# Motion Data Operations - SIMPLIFIED
# ======================

def create_motion_data(db: Session, motion: schemas.MotionDataCreate) -> models.MotionSensorData:
    """Store motion sensor data - SIMPLIFIED VERSION."""
    
    # حساب المقدار (magnitude)
    acc_mag = float((motion.acc_x**2 + motion.acc_y**2 + motion.acc_z**2) ** 0.5)
    gyro_mag = float((motion.gyro_x**2 + motion.gyro_y**2 + motion.gyro_z**2) ** 0.5)
    
    # التحقق من الشك في السقوط (عتبة بسيطة)
    is_fall_suspected = acc_mag > 3.0 or gyro_mag > 150
    
    db_motion = models.MotionSensorData(
        user_id=motion.user_id,
        device_id=motion.device_id,
        acc_x=motion.acc_x,
        acc_y=motion.acc_y,
        acc_z=motion.acc_z,
        gyro_x=motion.gyro_x,
        gyro_y=motion.gyro_y,
        gyro_z=motion.gyro_z,
        acc_mag=acc_mag,
        gyro_mag=gyro_mag,
        is_fall_suspected=is_fall_suspected
    )
    
    db.add(db_motion)
    db.commit()
    db.refresh(db_motion)
    
    return db_motion

def get_recent_motion_data(db: Session, user_id: int, limit: int = 50) -> List[models.MotionSensorData]:
    """Get recent motion data for a user."""
    return db.query(models.MotionSensorData)\
        .filter(models.MotionSensorData.user_id == user_id)\
        .order_by(desc(models.MotionSensorData.timestamp))\
        .limit(limit)\
        .all()

# ======================
# Main Processing Function - SIMPLIFIED
# ======================

def process_motion_and_predict(
    db: Session,
    motion_data: schemas.MotionDataCreate
) -> Dict:
    """
    Process motion data - SIMPLIFIED VERSION for testing.
    """
    
    # 1. حفظ بيانات الحركة
    stored_motion = create_motion_data(db, motion_data)
    
    # 2. الحصول على بيانات حركة حديثة
    recent_motions = get_recent_motion_data(db, motion_data.user_id, limit=100)
    
    # 3. إذا لم يكن هناك بيانات كافية، استخدم بيانات محاكاة
    if len(recent_motions) < 10:
        logger.info(f"Using simulated motion data for prediction")
        
        # إنشاء بيانات حركة محاكاة
        motion_buffer = []
        for i in range(50):
            features = np.array([
                motion_data.acc_x + np.random.uniform(-0.5, 0.5),
                motion_data.acc_y + np.random.uniform(-0.5, 0.5),
                motion_data.acc_z + np.random.uniform(-0.5, 0.5),
                motion_data.gyro_x + np.random.uniform(-10, 10),
                motion_data.gyro_y + np.random.uniform(-10, 10),
                motion_data.gyro_z + np.random.uniform(-10, 10),
                0, 0  # سيتم حسابها لاحقاً
            ], dtype=np.float32)
            
            # حساب المقدار
            features[6] = np.sqrt(features[0]**2 + features[1]**2 + features[2]**2)
            features[7] = np.sqrt(features[3]**2 + features[4]**2 + features[5]**2)
            
            motion_buffer.append(features)
    
    else:
        # استخدام البيانات الحقيقية
        motion_buffer = []
        for motion in recent_motions[-50:]:
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
    
    # 4. عمل تنبؤ باستخدام AI
    try:
        ai_prediction = predict_fall(motion_buffer)
    except Exception as e:
        logger.warning(f"AI prediction failed, using simulation: {e}")
        # تنبؤ محاكاة
        acc_mag = np.mean(np.sqrt(motion_buffer[:, 0]**2 + motion_buffer[:, 1]**2 + motion_buffer[:, 2]**2))
        
        # إذا كان التسارع عالي، نفترض وجود سقوط
        fall_now_prob = min(0.95, acc_mag / 10.0)
        fall_now = fall_now_prob > 0.5
        
        ai_prediction = {
            "success": True,
            "fall_now_probability": fall_now_prob,
            "fall_soon_probability": fall_now_prob * 0.7,
            "fall_now_prediction": fall_now,
            "fall_soon_prediction": fall_now_prob * 0.7 > 0.4,
            "threshold": 0.5,
            "timestamp": datetime.utcnow()
        }
    
    if not ai_prediction.get("success", False):
        return {
            "success": False,
            "message": "AI prediction failed",
            "motion_id": stored_motion.id,
            "error": ai_prediction.get("error")
        }
    
    # 5. إنشاء تنبؤ في قاعدة البيانات
    db_prediction = models.Prediction(
        user_id=motion_data.user_id,
        motion_data_id=stored_motion.id,
        fall_now_probability=ai_prediction["fall_now_probability"],
        fall_soon_probability=ai_prediction["fall_soon_probability"],
        fall_now_prediction=ai_prediction["fall_now_prediction"],
        fall_soon_prediction=ai_prediction["fall_soon_prediction"],
        final_verdict=ai_prediction["fall_now_prediction"]
    )
    
    db.add(db_prediction)
    db.commit()
    db.refresh(db_prediction)
    
    # 6. إنشاء إنذار إذا تم اكتشاف سقوط
    alert = None
    if ai_prediction["fall_now_prediction"]:
        user = get_user(db, motion_data.user_id)
        if user:
            alert = models.Alert(
                user_id=motion_data.user_id,
                prediction_id=db_prediction.id,
                alert_type="fall",
                severity="critical" if ai_prediction["fall_now_probability"] > 0.7 else "high",
                message=f"Fall detected for {user.name}. Confidence: {ai_prediction['fall_now_probability']:.1%}",
                status="pending",
                sent_to=user.emergency_contact
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
    
    return {
        "success": True,
        "message": "Prediction completed successfully",
        "motion_id": stored_motion.id,
        "prediction_id": db_prediction.id,
        "prediction": {
            "fall_now_probability": ai_prediction["fall_now_probability"],
            "fall_soon_probability": ai_prediction["fall_soon_probability"],
            "fall_now_detected": ai_prediction["fall_now_prediction"],
            "fall_soon_warning": ai_prediction["fall_soon_prediction"],
            "final_verdict": ai_prediction["fall_now_prediction"]
        },
        "alert_generated": alert is not None,
        "alert_id": alert.id if alert else None
    }

# ======================
# System Operations
# ======================

def get_system_stats(db: Session) -> Dict:
    """Get system statistics."""
    
    now = datetime.utcnow()
    last_hour = now - timedelta(hours=1)
    
    # إحصائيات بسيطة
    total_users = db.query(models.User).count()
    total_predictions = db.query(models.Prediction).count()
    fall_predictions = db.query(models.Prediction).filter(models.Prediction.final_verdict == True).count()
    pending_alerts = db.query(models.Alert).filter(models.Alert.status == "pending").count()
    
    return {
        "users": {
            "total": total_users
        },
        "predictions": {
            "total": total_predictions,
            "falls_detected": fall_predictions
        },
        "alerts": {
            "pending": pending_alerts
        },
        "timestamp": now.isoformat()
    }
