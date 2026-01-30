# Backend/app/double_verification.py
"""
Double Verification System for Fall Detection.
Combines motion-based prediction with vital signs verification.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
from sqlalchemy.orm import Session

from . import models
from .config import VITAL_CHANGE_THRESHOLD

logger = logging.getLogger(__name__)

class DoubleVerificationSystem:
    """Double Verification System for fall detection."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def verify_fall_with_vitals(
        self,
        user_id: int,
        fall_prediction: Dict,
        current_vitals: Optional[Dict] = None
    ) -> Dict:
        """
        Verify fall prediction with vital signs.
        
        Args:
            user_id: User ID
            fall_prediction: Prediction result from AI model
            current_vitals: Current vital signs (optional)
        
        Returns:
            Verified prediction result
        """
        
        try:
            logger.info(f"Starting double verification for user {user_id}")
            
            # Get the most recent vital signs
            recent_vitals = self._get_recent_vitals(user_id)
            
            if not recent_vitals:
                logger.warning(f"No recent vitals found for user {user_id}")
                return {
                    **fall_prediction,
                    "vital_check_performed": False,
                    "vital_check_result": None,
                    "final_verdict": fall_prediction.get("fall_now_prediction", False),
                    "confidence_score": fall_prediction.get("fall_now_probability", 0.0)
                }
            
            # Check for vital abnormalities
            if current_vitals:
                # Compare with current vitals
                is_abnormal, abnormality_type = self._check_vital_abnormality(
                    current_vitals, recent_vitals
                )
            else:
                # Use recent vitals
                is_abnormal = recent_vitals.is_abnormal
                abnormality_type = recent_vitals.abnormality_type
            
            # Determine final verdict
            fall_detected = fall_prediction.get("fall_now_prediction", False)
            fall_probability = fall_prediction.get("fall_now_probability", 0.0)
            
            if fall_detected and is_abnormal:
                # Both motion and vitals indicate fall
                final_verdict = True
                confidence_score = min(1.0, fall_probability + 0.3)
                logger.info(f"Double verification confirmed fall for user {user_id}")
                
            elif fall_detected and not is_abnormal:
                # Motion indicates fall but vitals are normal
                final_verdict = True  # Still consider it a fall, but lower confidence
                confidence_score = fall_probability * 0.7
                logger.warning(f"Fall detected but vitals normal for user {user_id}")
                
            elif not fall_detected and is_abnormal:
                # Vitals abnormal but no fall detected
                final_verdict = False
                confidence_score = 0.3
                logger.info(f"Vitals abnormal but no fall detected for user {user_id}")
                
            else:
                # Both normal
                final_verdict = False
                confidence_score = 1.0 - fall_probability
            
            return {
                **fall_prediction,
                "vital_check_performed": True,
                "vital_check_result": is_abnormal,
                "abnormality_type": abnormality_type,
                "final_verdict": final_verdict,
                "confidence_score": confidence_score
            }
            
        except Exception as e:
            logger.error(f"Double verification failed: {e}")
            return {
                **fall_prediction,
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": fall_prediction.get("fall_now_prediction", False),
                "confidence_score": fall_prediction.get("fall_now_probability", 0.0),
                "error": str(e)
            }
    
    def _get_recent_vitals(self, user_id: int, minutes: int = 5) -> Optional[models.VitalSensorData]:
        """Get the most recent vital signs within the specified time window."""
        
        time_threshold = datetime.utcnow() - timedelta(minutes=minutes)
        
        vital = self.db.query(models.VitalSensorData)\
            .filter(models.VitalSensorData.user_id == user_id)\
            .filter(models.VitalSensorData.timestamp >= time_threshold)\
            .order_by(models.VitalSensorData.timestamp.desc())\
            .first()
        
        return vital
    
    def _check_vital_abnormality(
        self,
        current_vitals: Dict,
        previous_vitals: models.VitalSensorData
    ) -> Tuple[bool, str]:
        """Check if vital signs show abnormality."""
        
        abnormalities = []
        prev_vitals_dict = {
            'heart_rate': previous_vitals.heart_rate,
            'oxygen_saturation': previous_vitals.oxygen_saturation,
            'blood_pressure_systolic': previous_vitals.blood_pressure_systolic
        }
        
        # Check each vital sign
        for vital_name, current_value in current_vitals.items():
            if current_value is not None and vital_name in prev_vitals_dict:
                previous_value = prev_vitals_dict[vital_name]
                if previous_value is not None:
                    # Calculate percentage change
                    if previous_value > 0:
                        change = abs(current_value - previous_value) / previous_value
                        if change > VITAL_CHANGE_THRESHOLD:
                            abnormalities.append(vital_name)
        
        if abnormalities:
            return True, ", ".join(abnormalities)
        else:
            return False, "normal"
    
    def should_check_vitals(self, user_id: int) -> bool:
        """Check if it's time to perform vital signs monitoring."""
        
        # Get last vital check
        last_check = self.db.query(models.VitalSensorData)\
            .filter(models.VitalSensorData.user_id == user_id)\
            .order_by(models.VitalSensorData.timestamp.desc())\
            .first()
        
        if not last_check:
            return True  # No previous checks, should check now
        
        # Check if 30 minutes have passed
        time_since_last = datetime.utcnow() - last_check.timestamp
        return time_since_last.total_seconds() > 1800  # 30 minutes
    
    def create_alert_if_needed(
        self,
        user_id: int,
        prediction_id: int,
        verification_result: Dict
    ) -> Optional[models.Alert]:
        """Create alert if fall is verified."""
        
        if verification_result.get("final_verdict"):
            # Get user info
            user = self.db.query(models.User).filter(models.User.id == user_id).first()
            if not user:
                logger.error(f"User {user_id} not found for alert creation")
                return None
            
            # Check if there's a recent alert for this user
            recent_alert = self.db.query(models.Alert)\
                .filter(models.Alert.user_id == user_id)\
                .filter(models.Alert.status.in_(['pending', 'sent']))\
                .filter(models.Alert.timestamp >= datetime.utcnow() - timedelta(minutes=5))\
                .first()
            
            if recent_alert:
                logger.info(f"Recent alert already exists for user {user_id}")
                return recent_alert
            
            # Create new alert
            alert = models.Alert(
                user_id=user_id,
                prediction_id=prediction_id,
                alert_type="fall",
                severity="critical" if verification_result.get("confidence_score", 0) > 0.7 else "high",
                message=f"Fall detected for {user.name}. Confidence: {verification_result.get('confidence_score', 0):.2%}",
                status="pending",
                sent_to=user.emergency_contact
            )
            
            self.db.add(alert)
            self.db.commit()
            self.db.refresh(alert)
            
            logger.info(f"Created alert {alert.id} for user {user_id}")
            return alert
        
        return None