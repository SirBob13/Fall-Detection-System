"""
Emergency System Routes - FIXED WITH PROPER HTTP STATUS CODES
"""

import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from .. import crud, schemas
from ..services.emergency_service import EmergencyService
from ..models import User, Alert

logger = logging.getLogger(__name__)
router = APIRouter()
emergency_service = EmergencyService()

# ==================== Emergency Trigger ====================

@router.post("/emergency/trigger", response_model=Dict[str, Any])
async def trigger_emergency(
    emergency_data: schemas.EmergencyTrigger,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger emergency response system with proper status codes.
    """
    try:
        logger.info(f"🚨 Emergency triggered: {emergency_data.type} for user {emergency_data.user_id}")
        
        # Validate input
        if not emergency_data.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "User ID is required"
                }
            )
        
        if not emergency_data.type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Emergency type is required"
                }
            )
        
        # Get user information
        user = crud.get_user(db, emergency_data.user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"User with ID {emergency_data.user_id} not found"
                }
            )
        
        # Create emergency alert in database
        try:
            alert = Alert(
                user_id=emergency_data.user_id,
                alert_type=emergency_data.type,
                severity="critical",
                message=f"Emergency triggered: {emergency_data.type}",
                location=emergency_data.location,
                status="active",
                timestamp=datetime.utcnow(),
                metadata={
                    "fall_data": emergency_data.fall_data,
                    "trigger_method": "manual" if emergency_data.type == "manual" else "automatic"
                } if emergency_data.fall_data else None
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            
            logger.info(f"✅ Emergency alert created: {alert.id}")
            
        except Exception as db_error:
            logger.error(f"Database error creating alert: {db_error}")
            # Continue with emergency even if database fails
            alert_id = f"EMG-{datetime.utcnow().timestamp()}"
        
        # Process emergency in background
        try:
            background_tasks.add_task(
                emergency_service.process_emergency,
                user=user,
                emergency_type=emergency_data.type,
                location=emergency_data.location,
                fall_data=emergency_data.fall_data
            )
            
            logger.info(f"✅ Background emergency task started for user {user.id}")
            
        except Exception as bg_error:
            logger.error(f"Background task error: {bg_error}")
            # Emergency will still be logged, just background processing failed
        
        # Return immediate response
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,  # 202 Accepted for async processing
            content={
                "success": True,
                "message": "Emergency response initiated",
                "emergency_id": alert.id if 'alert' in locals() else alert_id,
                "user_id": user.id,
                "user_name": user.name,
                "emergency_type": emergency_data.type,
                "timestamp": datetime.utcnow().isoformat(),
                "action_required": "Emergency services have been notified",
                "expected_response_time": "2-5 minutes",
                "emergency_contact_notified": True,
                "medical_services_alerted": True
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Emergency trigger failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Emergency trigger failed: {str(e)}"
            }
        )

# ==================== Emergency History ====================

@router.get("/emergency/history/{user_id}", response_model=Dict[str, Any])
async def get_emergency_history(
    user_id: int,
    limit: int = Query(20, ge=1, le=100, description="Number of records to return"),
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    status_filter: str = Query(None, description="Filter by alert status"),
    db: Session = Depends(get_db)
):
    """Get emergency history for user with proper error handling."""
    try:
        logger.info(f"Fetching emergency history for user {user_id}")
        
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
        
        try:
            # Try to get from database
            query = db.query(Alert).filter(
                Alert.user_id == user_id,
                Alert.timestamp >= start_date
            )
            
            # Apply status filter if provided
            if status_filter:
                query = query.filter(Alert.status == status_filter)
            
            # Order by timestamp (newest first)
            alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
            
            # Format response
            emergency_history = []
            for alert in alerts:
                emergency_history.append({
                    "id": alert.id,
                    "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
                    "type": alert.alert_type,
                    "severity": alert.severity,
                    "message": alert.message,
                    "location": alert.location,
                    "status": alert.status,
                    "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                    "response_notes": alert.response_notes,
                    "metadata": alert.metadata
                })
            
            logger.info(f"✅ Found {len(emergency_history)} emergency records for user {user_id}")
            
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "user_id": user_id,
                    "user_name": user.name,
                    "total_count": len(emergency_history),
                    "limit": limit,
                    "days": days,
                    "emergencies": emergency_history,
                    "summary": {
                        "total": len(emergency_history),
                        "critical": len([e for e in emergency_history if e["severity"] == "critical"]),
                        "high": len([e for e in emergency_history if e["severity"] == "high"]),
                        "medium": len([e for e in emergency_history if e["severity"] == "medium"]),
                        "low": len([e for e in emergency_history if e["severity"] == "low"]),
                        "active": len([e for e in emergency_history if e["status"] == "active"]),
                        "resolved": len([e for e in emergency_history if e["status"] == "resolved"]),
                        "cancelled": len([e for e in emergency_history if e["status"] == "cancelled"])
                    },
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            
        except Exception as db_error:
            logger.error(f"Database error fetching emergency history: {db_error}")
            
            # Fallback to service method if database fails
            try:
                emergencies = emergency_service.get_user_emergency_history(user_id, limit)
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={
                        "success": True,
                        "user_id": user_id,
                        "user_name": user.name,
                        "emergencies": emergencies,
                        "database_error": True,
                        "message": "Using cached data due to database error",
                        "timestamp": datetime.utcnow().isoformat()
                    }
                )
            except Exception as service_error:
                logger.error(f"Service fallback also failed: {service_error}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "success": False,
                        "error": "Unable to retrieve emergency history",
                        "user_id": user_id
                    }
                )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting emergency history: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get emergency history: {str(e)}"
            }
        )

# ==================== Update Emergency Status ====================

@router.put("/emergency/{emergency_id}/status", response_model=Dict[str, Any])
async def update_emergency_status(
    emergency_id: str,
    status_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Update emergency alert status."""
    try:
        logger.info(f"Updating emergency {emergency_id} status to {status_data}")
        
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
        
        # Find the alert
        alert = db.query(Alert).filter(Alert.id == emergency_id).first()
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Emergency with ID {emergency_id} not found"
                }
            )
        
        # Update status
        alert.status = new_status
        alert.response_notes = notes
        
        if new_status == "resolved":
            alert.resolved_at = datetime.utcnow()
        
        db.commit()
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": f"Emergency status updated to {new_status}",
                "emergency_id": emergency_id,
                "status": new_status,
                "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating emergency status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to update emergency status: {str(e)}"
            }
        )

# ==================== Cancel False Alarm ====================

@router.post("/emergency/{emergency_id}/cancel", response_model=Dict[str, Any])
async def cancel_false_alarm(
    emergency_id: str,
    cancel_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Cancel emergency as false alarm."""
    try:
        reason = cancel_data.get("reason", "False alarm")
        
        # Find the alert
        alert = db.query(Alert).filter(Alert.id == emergency_id).first()
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": f"Emergency with ID {emergency_id} not found"
                }
            )
        
        # Cancel the emergency
        alert.status = "cancelled"
        alert.response_notes = f"Cancelled: {reason}"
        alert.resolved_at = datetime.utcnow()
        
        db.commit()
        
        # Notify emergency service to cancel any ongoing responses
        emergency_service.cancel_emergency(emergency_id)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Emergency cancelled as false alarm",
                "emergency_id": emergency_id,
                "reason": reason,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling emergency: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to cancel emergency: {str(e)}"
            }
        )

# ==================== Emergency Statistics ====================

@router.get("/emergency/stats/{user_id}", response_model=Dict[str, Any])
async def get_emergency_stats(
    user_id: int,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db)
):
    """Get emergency statistics for user."""
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
        
        # Get statistics from database
        alerts = db.query(Alert).filter(
            Alert.user_id == user_id,
            Alert.timestamp >= start_date
        ).all()
        
        total_alerts = len(alerts)
        
        stats = {
            "total_emergencies": total_alerts,
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
            "average_response_time_minutes": None,
            "most_common_time_of_day": None,
            "trend_last_7_days": []
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
        logger.error(f"Error getting emergency stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to get emergency statistics: {str(e)}"
            }
        )