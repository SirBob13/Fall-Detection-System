"""
Emergency System Routes
"""

import logging
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db
from .. import crud, schemas
from ..services.emergency_service import EmergencyService

logger = logging.getLogger(__name__)
router = APIRouter()
emergency_service = EmergencyService()

@router.post("/emergency/trigger", response_model=schemas.EmergencyResponse)
def trigger_emergency(
    emergency_data: schemas.EmergencyTrigger,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger emergency response system.
    """
    try:
        logger.info(f"🚨 Emergency triggered: {emergency_data.type}")
        
        # Get user information
        user = crud.get_user(db, emergency_data.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Process emergency in background
        background_tasks.add_task(
            emergency_service.process_emergency,
            user=user,
            emergency_type=emergency_data.type,
            location=emergency_data.location,
            fall_data=emergency_data.fall_data
        )
        
        return {
            "success": True,
            "message": "Emergency response initiated",
            "timestamp": datetime.utcnow(),
            "emergency_id": f"EMG-{datetime.utcnow().timestamp()}"
        }
        
    except Exception as e:
        logger.error(f"Emergency trigger failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/emergency/history/{user_id}")
def get_emergency_history(
    user_id: int,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """Get emergency history for user."""
    try:
        # In real implementation, fetch from database
        emergencies = emergency_service.get_user_emergency_history(user_id, limit)
        return emergencies
    except Exception as e:
        logger.error(f"Error getting emergency history: {e}")
        return []