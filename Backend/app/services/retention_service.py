"""
Background retention cleanup for high-volume telemetry tables.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

from sqlalchemy.orm import Session

from ..config import (
    DATA_RETENTION_INTERVAL_MINUTES,
    DATA_RETENTION_RUN_ON_STARTUP,
    ENABLE_DATA_RETENTION,
    MOTION_RETENTION_HOURS,
    PREDICTION_RETENTION_HOURS,
    SYSTEM_LOG_RETENTION_DAYS,
    USER_SESSION_RETENTION_DAYS,
    VITAL_RETENTION_DAYS,
)
from ..database import SessionLocal
from ..models import Alert, MotionSensorData, Prediction, SystemLog, UserSession, VitalSensorData

logger = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None


def cleanup_runtime_data(db: Session) -> Dict[str, int | str | bool]:
    """
    Clean old runtime data while preserving incident-related motion/predictions.

    Current schema couples predictions to motion rows through a cascading FK, so
    motion and prediction retention should stay aligned unless the schema changes.
    """
    now = datetime.utcnow()
    motion_cutoff = now - timedelta(hours=MOTION_RETENTION_HOURS)
    prediction_cutoff = now - timedelta(hours=PREDICTION_RETENTION_HOURS)
    vital_cutoff = now - timedelta(days=VITAL_RETENTION_DAYS)
    log_cutoff = now - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
    session_cutoff = now - timedelta(days=USER_SESSION_RETENTION_DAYS)

    protected_prediction_ids = db.query(Alert.prediction_id).filter(Alert.prediction_id.isnot(None))
    protected_motion_ids = (
        db.query(Prediction.motion_data_id)
        .join(Alert, Alert.prediction_id == Prediction.id)
        .filter(Prediction.motion_data_id.isnot(None))
    )

    motion_deleted = (
        db.query(MotionSensorData)
        .filter(MotionSensorData.timestamp < motion_cutoff)
        .filter(~MotionSensorData.id.in_(protected_motion_ids))
        .delete(synchronize_session=False)
    )

    prediction_deleted = (
        db.query(Prediction)
        .filter(Prediction.timestamp < prediction_cutoff)
        .filter(~Prediction.id.in_(protected_prediction_ids))
        .delete(synchronize_session=False)
    )

    vital_deleted = (
        db.query(VitalSensorData)
        .filter(VitalSensorData.timestamp < vital_cutoff)
        .delete(synchronize_session=False)
    )

    log_deleted = (
        db.query(SystemLog)
        .filter(SystemLog.timestamp < log_cutoff)
        .delete(synchronize_session=False)
    )

    session_deleted = (
        db.query(UserSession)
        .filter(UserSession.expires_at < session_cutoff)
        .delete(synchronize_session=False)
    )

    db.commit()

    result = {
        "success": True,
        "motions_deleted": motion_deleted,
        "predictions_deleted": prediction_deleted,
        "vitals_deleted": vital_deleted,
        "system_logs_deleted": log_deleted,
        "sessions_deleted": session_deleted,
        "motion_cutoff": motion_cutoff.isoformat(),
        "prediction_cutoff": prediction_cutoff.isoformat(),
        "vital_cutoff": vital_cutoff.isoformat(),
    }
    logger.info("🧹 Data retention cleanup complete: %s", result)
    return result


def run_retention_cleanup_once() -> Dict[str, int | str | bool]:
    db = SessionLocal()
    try:
        return cleanup_runtime_data(db)
    except Exception as exc:
        db.rollback()
        logger.error("❌ Data retention cleanup failed: %s", exc, exc_info=True)
        return {
            "success": False,
            "error": str(exc),
        }
    finally:
        db.close()


def start_retention_service() -> None:
    global _thread
    if not ENABLE_DATA_RETENTION:
        logger.info("Data retention disabled (ENABLE_DATA_RETENTION=false)")
        return
    if _thread:
        return

    interval_seconds = max(DATA_RETENTION_INTERVAL_MINUTES, 5) * 60

    def _run() -> None:
        if DATA_RETENTION_RUN_ON_STARTUP:
            run_retention_cleanup_once()
        while True:
            time.sleep(interval_seconds)
            run_retention_cleanup_once()

    _thread = threading.Thread(target=_run, daemon=True, name="data-retention-cleanup")
    _thread.start()
    logger.info(
        "🧹 Data retention service started (every %s minutes, motion=%sh, predictions=%sh, vitals=%sd)",
        max(DATA_RETENTION_INTERVAL_MINUTES, 5),
        MOTION_RETENTION_HOURS,
        PREDICTION_RETENTION_HOURS,
        VITAL_RETENTION_DAYS,
    )
