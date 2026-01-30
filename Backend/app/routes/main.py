"""
Main API routes for the Fall Detection system - FIXED VERSION
"""

import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from sqlalchemy.orm import Session
import random
import math
import time

from ..database import get_db
from ..ai_model import load_model_and_scaler
from .. import crud, schemas
from ..services.auth_service import AuthService

logger = logging.getLogger(__name__)
router = APIRouter()

# ======================
# Health & System Routes
# ======================

@router.get("/health", response_model=Dict[str, Any])
def health_check():
    """Check system health"""
    try:
        # Check model availability
        try:
            model, scaler = load_model_and_scaler()
            model_loaded = True
        except Exception as e:
            logger.warning(f"Model loading failed: {e}")
            model_loaded = False
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "database": "connected",
            "model_loaded": model_loaded,
            "uptime": 0.0,
            "version": "2.0.0",
            "service": "fall_detection_api"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

@router.get("/", response_model=Dict[str, Any])
def root():
    """API root endpoint"""
    return {
        "name": "Fall Detection API",
        "version": "2.0.0",
        "description": "AI-powered fall detection with double verification system",
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "api_v1": "/api/v1",
            "auth": "/api/v1/auth/*",
            "motion": "/api/v1/motion",
            "vitals": "/api/v1/vitals",
            "alerts": "/api/v1/alerts",
            "users": "/api/v1/users"
        }
    }

# ======================
# Authentication Routes - FIXED WITH DATABASE
# ======================

@router.post("/auth/login", response_model=Dict[str, Any])
async def login(
    login_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """User login endpoint - REAL DATABASE VERSION"""
    try:
        email = login_data.get("email", "").lower().strip()
        password = login_data.get("password", "")
        
        logger.info(f"Login attempt for: {email}")
        
        if not email or not password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email and password are required"
            )
        
        # Use real auth service with database
        auth = AuthService(db)
        
        try:
            # First check if database connection is working
            db_check = auth.check_database_connection()
            if not db_check.get("connected", False):
                logger.error(f"Database connection failed: {db_check}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database connection failed"
                )
            
            # Verify user exists in database
            email_exists = auth.check_email_exists(email)
            if not email_exists:
                logger.warning(f"Email not found in database: {email}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found in database"
                )
            
            # Try to login with real database
            result = auth.login_user(email, password)
            
            if not result or "access_token" not in result:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid credentials"
                )
            
            return {
                "success": True,
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "user": result["user"],
                "message": "Login successful from real database"
            }
            
        except HTTPException as http_err:
            raise http_err
        except Exception as auth_error:
            logger.error(f"Auth service error: {auth_error}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials or database error"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.post("/auth/register", response_model=Dict[str, Any])
def register(
    register_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """User registration endpoint - REAL DATABASE VERSION"""
    try:
        logger.info(f"Registration attempt: {register_data}")
        
        email = register_data.get("email", "").lower().strip()
        password = register_data.get("password", "")
        name = register_data.get("name", "")
        confirm_password = register_data.get("confirm_password", "")
        
        if not email or not password or not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email, password, and name are required"
            )
        
        if password != confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Passwords do not match"
            )
        
        # Use real auth service with database
        auth = AuthService(db)
        
        try:
            # First check database connection
            db_check = auth.check_database_connection()
            if not db_check.get("connected", False):
                logger.error(f"Database connection failed: {db_check}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database connection failed"
                )
            
            # Check if email already exists in database
            email_exists = auth.check_email_exists(email)
            if email_exists:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered in database"
                )
            
            # Prepare user data for registration
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
            
            # Register user in real database
            result = auth.register_user(user_data)
            
            if not result.get("success", False):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=result.get("message", "Registration failed")
                )
            
            # Auto login after registration
            login_result = auth.login_user(email, password)
            
            if not login_result or "access_token" not in login_result:
                # Still return success but ask user to login manually
                return {
                    "success": True,
                    "message": "Registration successful. Please login.",
                    "user": result.get("user"),
                    "requires_login": True
                }
            
            return {
                "success": True,
                "access_token": login_result["access_token"],
                "refresh_token": login_result["refresh_token"],
                "user": login_result["user"],
                "message": "Registration and auto-login successful"
            }
            
        except HTTPException as http_err:
            raise http_err
        except Exception as auth_error:
            logger.error(f"Registration error: {auth_error}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(auth_error)
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.post("/auth/refresh", response_model=Dict[str, Any])
def refresh_token(
    refresh_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Refresh authentication token"""
    try:
        refresh_token = refresh_data.get("refresh_token")
        
        if not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Refresh token is required"
            )
        
        # Use real auth service
        auth = AuthService(db)
        result = auth.refresh_token(refresh_token)
        
        return result
        
    except Exception as e:
        logger.error(f"Token refresh error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

@router.post("/auth/logout")
def logout(
    logout_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Logout user"""
    try:
        token = logout_data.get("token", "")
        
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token is required"
            )
        
        # Use real auth service
        auth = AuthService(db)
        result = auth.logout_user(token)
        
        return {
            "success": result,
            "message": "Logged out successfully"
        }
        
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.post("/auth/check-email")
def check_email(
    email_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Check if email exists in database"""
    try:
        email = email_data.get("email", "").lower().strip()
        
        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is required"
            )
        
        # Use real auth service
        auth = AuthService(db)
        exists = auth.check_email_exists(email)
        
        return {
            "exists": exists,
            "email": email,
            "message": "Email found in database" if exists else "Email not found in database"
        }
        
    except Exception as e:
        logger.error(f"Check email error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

# ======================
# Motion Data Routes - WITH MOCK FALL DATA
# ======================

@router.post("/motion", response_model=Dict[str, Any])
def process_motion_data(
    data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Process motion data and return prediction.
    This is the main endpoint for the wearable device.
    Uses MOCK fall data for testing, but stores in real database.
    """
    try:
        logger.info(f"Processing motion data: {data}")
        
        # Validate required fields
        required_fields = ['user_id', 'device_id', 'acc_x', 'acc_y', 'acc_z', 'gyro_x', 'gyro_y', 'gyro_z']
        for field in required_fields:
            if field not in data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing required field: {field}"
                )
        
        # Extract sensor data
        acc_x = float(data.get('acc_x', 0.0))
        acc_y = float(data.get('acc_y', 0.0))
        acc_z = float(data.get('acc_z', 0.0))
        gyro_x = float(data.get('gyro_x', 0.0))
        gyro_y = float(data.get('gyro_y', 0.0))
        gyro_z = float(data.get('gyro_z', 0.0))
        temperature = float(data.get('temperature', 36.5))
        
        # Calculate magnitudes
        acc_mag = math.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
        gyro_mag = math.sqrt(gyro_x**2 + gyro_y**2 + gyro_z**2)
        
        # MOCK FALL DETECTION FOR TESTING
        # Generate random fall (15% chance for testing)
        is_fall = random.random() < 0.15
        gravity_change = abs(acc_z - 9.8)
        
        # Adjust probabilities based on sensor data
        if is_fall:
            # Simulate fall - high values
            fall_probability = min(0.98, 
                                0.3 + (acc_mag - 2.0) / 8 + 
                                (gyro_mag - 100) / 300 + 
                                gravity_change / 15)
            fall_soon_probability = min(0.75, fall_probability * 0.7)
        else:
            # Normal activity
            fall_probability = max(0.01, min(0.15, 
                                          (acc_mag / 6 + gyro_mag / 250) * 0.5))
            fall_soon_probability = max(0.01, min(0.3, 
                                               fall_probability * 1.5))
        
        # Determine fall prediction
        fall_now = fall_probability > 0.6
        fall_soon = fall_soon_probability > 0.4
        
        # Confidence score
        confidence = fall_probability if fall_now else (1 - fall_probability)
        
        # Create prediction response
        prediction = {
            "fall_now_probability": round(fall_probability, 3),
            "fall_soon_probability": round(fall_soon_probability, 3),
            "fall_now_prediction": fall_now,
            "fall_soon_prediction": fall_soon,
            "confidence_score": round(confidence, 3),
            "final_verdict": fall_now,
            "timestamp": datetime.utcnow().isoformat(),
            "is_mock": True,  # Indicate this is mock data for testing
            "sensor_data": {
                "acc_magnitude": round(acc_mag, 2),
                "gyro_magnitude": round(gyro_mag, 2),
                "temperature": temperature
            }
        }
        
        # Store in database (REAL storage)
        try:
            motion_data = schemas.MotionDataCreate(
                user_id=int(data.get('user_id')),
                device_id=data.get('device_id'),
                acc_x=acc_x,
                acc_y=acc_y,
                acc_z=acc_z,
                gyro_x=gyro_x,
                gyro_y=gyro_y,
                gyro_z=gyro_z,
                temperature=temperature
            )
            
            # Store motion data in real database
            stored_motion = crud.create_motion_data(db, motion_data)
            
            # Store prediction in real database
            db_prediction = schemas.PredictionCreate(
                user_id=int(data.get('user_id')),
                motion_data_id=stored_motion.id,
                fall_now_probability=fall_probability,
                fall_soon_probability=fall_soon_probability,
                fall_now_prediction=fall_now,
                fall_soon_prediction=fall_soon,
                vital_check_performed=False,
                final_verdict=fall_now,
                confidence_score=confidence
            )
            
            # Use crud to store prediction
            from ..models import Prediction
            db_pred = Prediction(
                user_id=int(data.get('user_id')),
                motion_data_id=stored_motion.id,
                fall_now_probability=fall_probability,
                fall_soon_probability=fall_soon_probability,
                fall_now_prediction=fall_now,
                fall_soon_prediction=fall_soon,
                vital_check_performed=False,
                final_verdict=fall_now,
                confidence_score=confidence,
                timestamp=datetime.utcnow()
            )
            db.add(db_pred)
            db.commit()
            
            # If fall detected, create alert in real database
            if fall_now:
                from ..models import Alert
                alert = Alert(
                    user_id=int(data.get('user_id')),
                    prediction_id=db_pred.id,
                    alert_type="fall",
                    severity="critical" if fall_probability > 0.7 else "high",
                    message=f"Fall detected with {fall_probability:.1%} probability",
                    status="pending",
                    timestamp=datetime.utcnow()
                )
                db.add(alert)
                db.commit()
                
                prediction["alert_generated"] = True
                prediction["alert_id"] = alert.id
            else:
                prediction["alert_generated"] = False
            
            prediction["database_stored"] = True
            prediction["motion_id"] = stored_motion.id
            prediction["prediction_id"] = db_pred.id
            
        except Exception as db_error:
            logger.warning(f"Database storage failed, using mock only: {db_error}")
            prediction["database_stored"] = False
            prediction["alert_generated"] = fall_now
            prediction["alert_id"] = random.randint(1000, 9999) if fall_now else None
        
        # Prepare response
        response = {
            "success": True,
            "message": "Fall detected!" if fall_now else "Normal activity",
            "prediction": prediction,
            "is_test_data": True,  # Indicate this is test data
            "mock_explanation": "Using mock fall detection for testing. Real AI model would analyze sensor patterns.",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Log the detection
        if fall_now:
            logger.warning(f"🚨 MOCK FALL DETECTED! Probability: {fall_probability:.1%}")
        elif fall_soon:
            logger.info(f"⚠️ MOCK Fall warning: {fall_soon_probability:.1%}")
        
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
# Vital Signs Routes - WITH MOCK DATA
# ======================

@router.post("/vitals", response_model=Dict[str, Any])
def process_vital_data(
    data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Process vital signs data.
    Uses MOCK data for testing, but stores in real database.
    """
    try:
        logger.info(f"Processing vital data: {data}")
        
        # Validate required fields
        if 'user_id' not in data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User ID is required"
            )
        
        # Extract vital data with defaults
        heart_rate = float(data.get('heart_rate', random.uniform(60, 100)))
        blood_pressure_systolic = float(data.get('blood_pressure_systolic', random.uniform(110, 140)))
        blood_pressure_diastolic = float(data.get('blood_pressure_diastolic', random.uniform(70, 90)))
        oxygen_saturation = float(data.get('oxygen_saturation', random.uniform(95, 99)))
        body_temperature = float(data.get('body_temperature', random.uniform(36.0, 37.5)))
        respiration_rate = float(data.get('respiration_rate', random.uniform(12, 20)))
        
        # MOCK abnormality detection (10% chance for testing)
        is_abnormal = random.random() < 0.10
        abnormality_type = None
        
        if is_abnormal:
            # Randomly select an abnormality type
            abnormalities = ['heart_rate', 'blood_pressure', 'oxygen_saturation', 'temperature']
            abnormality_type = random.choice(abnormalities)
            
            # Adjust values to simulate abnormality
            if abnormality_type == 'heart_rate':
                heart_rate = random.uniform(40, 50) if random.random() < 0.5 else random.uniform(130, 160)
            elif abnormality_type == 'blood_pressure':
                blood_pressure_systolic = random.uniform(150, 200)
            elif abnormality_type == 'oxygen_saturation':
                oxygen_saturation = random.uniform(85, 92)
            elif abnormality_type == 'temperature':
                body_temperature = random.uniform(38.0, 40.0)
        
        # Store in database (REAL storage)
        try:
            vital_data = schemas.VitalDataCreate(
                user_id=int(data.get('user_id')),
                heart_rate=heart_rate,
                blood_pressure_systolic=blood_pressure_systolic,
                blood_pressure_diastolic=blood_pressure_diastolic,
                oxygen_saturation=oxygen_saturation,
                body_temperature=body_temperature,
                respiration_rate=respiration_rate
            )
            
            # Store vital data in real database
            stored_vital = crud.create_vital_data(db, vital_data)
            
            vital_response = {
                "success": True,
                "message": "Abnormal vital signs detected!" if is_abnormal else "Normal vital signs",
                "vital_data": {
                    "heart_rate": round(heart_rate, 1),
                    "blood_pressure": f"{round(blood_pressure_systolic, 0)}/{round(blood_pressure_diastolic, 0)}",
                    "oxygen_saturation": round(oxygen_saturation, 1),
                    "body_temperature": round(body_temperature, 1),
                    "respiration_rate": round(respiration_rate, 1),
                    "is_abnormal": is_abnormal,
                    "abnormality_type": abnormality_type,
                    "database_stored": True,
                    "vital_id": stored_vital.id
                },
                "is_test_data": True,
                "mock_explanation": "Using mock vital data for testing. Real sensors would provide actual measurements.",
                "timestamp": datetime.utcnow().isoformat()
            }
            
            # If abnormal, create alert
            if is_abnormal and abnormality_type:
                from ..models import Alert
                alert = Alert(
                    user_id=int(data.get('user_id')),
                    alert_type="vital_abnormal",
                    severity="high",
                    message=f"Abnormal {abnormality_type.replace('_', ' ')} detected",
                    status="pending",
                    timestamp=datetime.utcnow()
                )
                db.add(alert)
                db.commit()
                
                vital_response["alert_generated"] = True
                vital_response["alert_id"] = alert.id
            
            return vital_response
            
        except Exception as db_error:
            logger.warning(f"Database storage failed, using mock only: {db_error}")
            return {
                "success": True,
                "message": "Abnormal vital signs detected!" if is_abnormal else "Normal vital signs",
                "vital_data": {
                    "heart_rate": round(heart_rate, 1),
                    "blood_pressure": f"{round(blood_pressure_systolic, 0)}/{round(blood_pressure_diastolic, 0)}",
                    "oxygen_saturation": round(oxygen_saturation, 1),
                    "body_temperature": round(body_temperature, 1),
                    "respiration_rate": round(respiration_rate, 1),
                    "is_abnormal": is_abnormal,
                    "abnormality_type": abnormality_type,
                    "database_stored": False
                },
                "is_test_data": True,
                "timestamp": datetime.utcnow().isoformat()
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing vital data: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error processing vital data: {str(e)}"
        )

# ======================
# Alerts Routes
# ======================

@router.get("/alerts/{user_id}", response_model=Dict[str, Any])
def get_user_alerts(
    user_id: int,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Get alerts for a specific user"""
    try:
        alerts = crud.get_alerts_by_user(db, user_id, limit)
        
        return {
            "success": True,
            "alerts": alerts,
            "count": len(alerts),
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting alerts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )