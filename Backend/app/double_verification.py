"""
Double Verification System for Fall Detection.
Combines motion-based prediction with vital signs verification.
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple 
from sqlalchemy.orm import Session

from . import models
from .config import (
    VITAL_CHANGE_THRESHOLD,
    FALL_ALERT_THRESHOLD,
    FALL_ALERT_WITH_VITALS_THRESHOLD,
)

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
            logger.debug("Starting double verification for user %s", user_id)
            
            # Get the most recent vital signs
            recent_vitals = self._get_recent_vitals(user_id)
            
            if not recent_vitals:
                logger.debug("No recent vitals found for user %s", user_id)
                fall_probability = fall_prediction.get("fall_now_probability", 0.0)
                fall_confirmed = fall_probability >= FALL_ALERT_THRESHOLD
                return {
                    **fall_prediction,
                    "vital_check_performed": False,
                    "vital_check_result": None,
                    "final_verdict": fall_confirmed,
                    "confidence_score": fall_probability,
                    "decision_reason": "motion_only" if fall_confirmed else "insufficient_confirmation",
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
            
            if fall_probability >= FALL_ALERT_THRESHOLD:
                # Motion score is high enough to confirm a fall even without vitals support.
                final_verdict = True
                confidence_score = min(1.0, fall_probability if not is_abnormal else fall_probability + 0.1)
                decision_reason = "strong_motion"
                logger.info(f"Strong motion-only fall confirmation for user {user_id}")

            elif fall_detected and is_abnormal and fall_probability >= FALL_ALERT_WITH_VITALS_THRESHOLD:
                # Motion is moderately high and vitals support the event.
                final_verdict = True
                confidence_score = min(1.0, fall_probability + 0.15)
                decision_reason = "motion_plus_vitals"
                logger.info(f"Double verification confirmed fall for user {user_id}")

            elif fall_detected:
                # Fall alerts must be motion-first. Vitals are collected after the
                # alert for context, but they must not block alert creation.
                final_verdict = True
                confidence_score = fall_probability
                decision_reason = "motion_only_prediction"
                logger.info(f"Motion-only fall confirmation for user {user_id}")

            elif not fall_detected and is_abnormal:
                # Vitals abnormal but no fall detected; keep as in-app health warning only.
                final_verdict = False
                confidence_score = 0.3
                decision_reason = "vitals_only"
                logger.debug("Vitals abnormal but no fall detected for user %s", user_id)

            else:
                # Both normal / low confidence
                final_verdict = False
                confidence_score = 1.0 - fall_probability
                decision_reason = "normal"
            
            return {
                **fall_prediction,
                "vital_check_performed": True,
                "vital_check_result": is_abnormal,
                "abnormality_type": abnormality_type,
                "final_verdict": final_verdict,
                "confidence_score": confidence_score,
                "decision_reason": decision_reason,
            }
            
        except Exception as e:
            logger.error(f"Double verification failed: {e}")
            return {
                **fall_prediction,
                "vital_check_performed": False,
                "vital_check_result": None,
                "final_verdict": fall_prediction.get("fall_now_probability", 0.0) >= FALL_ALERT_THRESHOLD,
                "confidence_score": fall_prediction.get("fall_now_probability", 0.0),
                "decision_reason": "verification_error",
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
        """Create either a confirmed fall alert or an in-app fall risk alert."""

        user = self.db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            logger.error(f"User {user_id} not found for alert creation")
            return None

        is_confirmed_fall = bool(verification_result.get("final_verdict"))
        is_fall_candidate = bool(verification_result.get("fall_candidate")) and not is_confirmed_fall
        is_fall_risk = bool(verification_result.get("fall_soon_prediction")) and not is_confirmed_fall

        if not is_confirmed_fall and not is_fall_candidate and not is_fall_risk:
            return None

        if is_confirmed_fall:
            alert_type = "fall_now"
        elif is_fall_candidate:
            alert_type = "fall_candidate"
        else:
            alert_type = "fall_risk"

        confidence = float(verification_result.get("confidence_score", 0))

        ten_minutes_ago = datetime.utcnow() - timedelta(minutes=10)
        recent_alerts_count = self.db.query(models.Alert)\
            .filter(models.Alert.user_id == user_id)\
            .filter(models.Alert.alert_type == alert_type)\
            .filter(models.Alert.timestamp >= ten_minutes_ago)\
            .filter(models.Alert.status.in_(['pending', 'sent', 'acknowledged']))\
            .count()

        if recent_alerts_count >= 3:
            logger.warning(f"Alert flood detected for user {user_id}. Skipping new {alert_type} alert.")
            return None

        two_minutes_ago = datetime.utcnow() - timedelta(minutes=2)
        recent_query = self.db.query(models.Alert)\
            .filter(models.Alert.user_id == user_id)\
            .filter(models.Alert.timestamp >= two_minutes_ago)\
            .filter(models.Alert.status.in_(['pending', 'sent']))

        if alert_type == "fall_now":
            # A fast candidate should become the confirmed fall alert instead of
            # creating a duplicate row seconds later.
            recent_alert = recent_query\
                .filter(models.Alert.alert_type.in_(["fall_candidate", "fall_now"]))\
                .order_by(models.Alert.timestamp.desc())\
                .first()
        else:
            recent_alert = recent_query\
                .filter(models.Alert.alert_type == alert_type)\
                .order_by(models.Alert.timestamp.desc())\
                .first()

        if alert_type == "fall_now":
            severity = "critical" if confidence >= 0.85 else "high"
            message = f"Confirmed fall detected for {user.name}. Confidence: {confidence:.2%}"
        elif alert_type == "fall_candidate":
            severity = "high"
            message = f"Possible fall detected for {user.name}. Confirming with motion AI. Confidence: {confidence:.2%}"
        else:
            risk_probability = float(verification_result.get("fall_soon_probability", 0))
            severity = "high" if risk_probability >= 0.9 else "medium"
            message = f"High fall risk detected for {user.name}. Probability: {risk_probability:.2%}"

        prediction = self.db.query(models.Prediction).filter(models.Prediction.id == prediction_id).first()
        device_id = None
        if prediction and prediction.motion_data:
            device_id = prediction.motion_data.device_id

        if recent_alert:
            logger.info(f"Updating existing alert {recent_alert.id} for user {user_id}")
            recent_alert.alert_type = alert_type
            recent_alert.severity = severity
            recent_alert.message = message
            recent_alert.timestamp = datetime.utcnow()
            recent_alert.prediction_id = prediction_id
            recent_alert.device_id = recent_alert.device_id or device_id
            self.db.commit()
            self.db.refresh(recent_alert)
            return recent_alert

        alert = models.Alert(
            user_id=user_id,
            prediction_id=prediction_id,
            device_id=device_id,
            alert_type=alert_type,
            severity=severity,
            message=message,
            status="pending",
            sent_to=user.emergency_contact,
            timestamp=datetime.utcnow()
        )

        self.db.add(alert)
        self.db.commit()
        self.db.refresh(alert)

        logger.info(f"Created alert {alert.id} ({alert_type}) for user {user_id}")
        return alert
    
    def check_vital_patterns(self, user_id: int, hours: int = 24) -> Dict:
        """Analyze vital sign patterns over time for anomaly detection."""
        
        try:
            time_threshold = datetime.utcnow() - timedelta(hours=hours)
            
            # Get vital data for the specified period
            vitals = self.db.query(models.VitalSensorData)\
                .filter(models.VitalSensorData.user_id == user_id)\
                .filter(models.VitalSensorData.timestamp >= time_threshold)\
                .order_by(models.VitalSensorData.timestamp)\
                .all()
            
            if not vitals or len(vitals) < 5:
                return {"success": False, "message": "Insufficient data"}
            
            # Extract vital values
            heart_rates = [v.heart_rate for v in vitals if v.heart_rate is not None]
            oxygen_levels = [v.oxygen_saturation for v in vitals if v.oxygen_saturation is not None]
            bp_systolic = [v.blood_pressure_systolic for v in vitals if v.blood_pressure_systolic is not None]
            
            # Calculate statistics
            stats = {
                "heart_rate": {
                    "mean": sum(heart_rates) / len(heart_rates) if heart_rates else None,
                    "min": min(heart_rates) if heart_rates else None,
                    "max": max(heart_rates) if heart_rates else None,
                    "count": len(heart_rates)
                },
                "oxygen_saturation": {
                    "mean": sum(oxygen_levels) / len(oxygen_levels) if oxygen_levels else None,
                    "min": min(oxygen_levels) if oxygen_levels else None,
                    "max": max(oxygen_levels) if oxygen_levels else None,
                    "count": len(oxygen_levels)
                },
                "blood_pressure": {
                    "mean": sum(bp_systolic) / len(bp_systolic) if bp_systolic else None,
                    "min": min(bp_systolic) if bp_systolic else None,
                    "max": max(bp_systolic) if bp_systolic else None,
                    "count": len(bp_systolic)
                },
                "total_readings": len(vitals),
                "abnormal_readings": sum(1 for v in vitals if v.is_abnormal)
            }
            
            # Check for trends
            trends = self._detect_vital_trends(vitals)
            
            return {
                "success": True,
                "stats": stats,
                "trends": trends,
                "time_period_hours": hours
            }
            
        except Exception as e:
            logger.error(f"Error analyzing vital patterns: {e}")
            return {"success": False, "error": str(e)}
    
    def _detect_vital_trends(self, vitals: List[models.VitalSensorData]) -> Dict:
        """Detect trends in vital signs."""
        
        if len(vitals) < 3:
            return {"detected": False, "message": "Insufficient data"}
        
        trends = {
            "heart_rate_increasing": False,
            "heart_rate_decreasing": False,
            "oxygen_decreasing": False,
            "blood_pressure_increasing": False
        }
        
        # Simple trend detection based on last 3 readings
        last_three = vitals[-3:]
        
        # Check heart rate trend
        hr_values = [v.heart_rate for v in last_three if v.heart_rate is not None]
        if len(hr_values) == 3:
            if hr_values[0] < hr_values[1] < hr_values[2]:
                trends["heart_rate_increasing"] = True
            elif hr_values[0] > hr_values[1] > hr_values[2]:
                trends["heart_rate_decreasing"] = True
        
        # Check oxygen saturation trend
        oxygen_values = [v.oxygen_saturation for v in last_three if v.oxygen_saturation is not None]
        if len(oxygen_values) == 3:
            if oxygen_values[0] > oxygen_values[1] > oxygen_values[2]:
                trends["oxygen_decreasing"] = True
        
        # Check blood pressure trend
        bp_values = [v.blood_pressure_systolic for v in last_three if v.blood_pressure_systolic is not None]
        if len(bp_values) == 3:
            if bp_values[0] < bp_values[1] < bp_values[2]:
                trends["blood_pressure_increasing"] = True
        
        return trends
    
    def get_verification_history(self, user_id: int, days: int = 7) -> List[Dict]:
        """Get verification history for a user."""
        
        try:
            time_threshold = datetime.utcnow() - timedelta(days=days)
            
            predictions = self.db.query(models.Prediction)\
                .filter(models.Prediction.user_id == user_id)\
                .filter(models.Prediction.timestamp >= time_threshold)\
                .filter(models.Prediction.vital_check_performed == True)\
                .order_by(desc(models.Prediction.timestamp))\
                .all()
            
            history = []
            for pred in predictions:
                history.append({
                    "timestamp": pred.timestamp.isoformat(),
                    "fall_now_detected": pred.fall_now_prediction,
                    "fall_soon_warning": pred.fall_soon_prediction,
                    "vital_check_result": pred.vital_check_result,
                    "final_verdict": pred.final_verdict,
                    "confidence": pred.confidence_score,
                    "motion_data_id": pred.motion_data_id
                })
            
            return history
            
        except Exception as e:
            logger.error(f"Error getting verification history: {e}")
            return []
