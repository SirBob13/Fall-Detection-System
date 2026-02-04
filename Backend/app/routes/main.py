"""
Main API routes for the Fall Detection system - FIXED WITH PROPER HTTP STATUS CODES
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query, Header
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
import math
import time

from ..database import get_db
from ..services.ai_model import load_model_and_scaler, predict_from_sample
from .. import crud, schemas
from ..services.auth_service import AuthService
from ..models import User, Alert, Prediction
from ..double_verification import DoubleVerificationSystem
from ..services.notification_service import NotificationService

logger = logging.getLogger(__name__)
router = APIRouter()
notification_service = NotificationService()

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
                "emergency": "/api/v1/emergency/*"
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

# ======================
# Motion Data Routes - WITH PROPER STATUS CODES
# ======================

@router.post("/motion", response_model=Dict[str, Any])
def process_motion_data(
    data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Process motion data and return prediction.
    Now supports dual output (fall_now and fall_soon).
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
        user_id = int(data.get('user_id'))
        device_id = data.get('device_id')

        # Ensure device exists (auto-register if missing)
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
        
        # Use AI model for prediction (per-user/device buffer)
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

        # Store motion data
        motion_data_schema = schemas.MotionDataCreate(
            user_id=user_id,
            device_id=device_id,
            acc_x=acc_x,
            acc_y=acc_y,
            acc_z=acc_z,
            gyro_x=gyro_x,
            gyro_y=gyro_y,
            gyro_z=gyro_z,
            temperature=temperature
        )
        stored_motion = crud.create_motion_data(db, motion_data_schema)

        # Double verification with vitals
        verification_system = DoubleVerificationSystem(db)
        verified = verification_system.verify_fall_with_vitals(
            user_id=user_id,
            fall_prediction=ai_result,
            current_vitals=None
        )

        # Store prediction in DB
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

        # Create alert if needed
        alert = None
        if verified.get("final_verdict", False):
            alert = verification_system.create_alert_if_needed(
                user_id=user_id,
                prediction_id=db_pred.id,
                verification_result=verified
            )

        # Prepare response with dual output + verification
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
                **vital_readings
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
    status: Optional[str] = Query(None, description="Filter by alert status"),
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
        if status:
            query = query.filter(Alert.status == status)
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
                "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                "location": alert.location,
                "response_notes": alert.response_notes,
                "metadata": alert.metadata
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
                    "status": status,
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

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "User updated successfully",
                "data": {
                    "id": user.id,
                    "name": user.name,
                    "age": user.age,
                    "gender": user.gender,
                    "weight": user.weight,
                    "height": user.height,
                    "medical_conditions": user.medical_conditions,
                    "emergency_contact": user.emergency_contact,
                    "is_active": user.is_active,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "updated_at": user.updated_at.isoformat() if user.updated_at else None
                },
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
# Device Routes - Mobile App Support
# ======================

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
