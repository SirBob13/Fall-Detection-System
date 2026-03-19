"""
Minimal notification service stub.
Provides availability checks and a no-op notifier used by routes.
"""

import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self) -> None:
        self._available = True

    def is_available(self) -> bool:
        """Return whether notifications are available."""
        return self._available

    def notify_vital_abnormality(
        self,
        user_id: Optional[int] = None,
        vitals: Optional[Dict[str, Any]] = None,
        message: Optional[str] = None,
        **kwargs: Any
    ) -> None:
        """
        Placeholder notifier. Integrate with SMS/Email/Push as needed.
        """
        logger.info(
            "Notification (vitals): user_id=%s message=%s vitals=%s",
            user_id,
            message,
            vitals
        )

    def notify_caregivers_alert(
        self,
        db: Session,
        patient_id: int,
        alert: Any,
        reason: Optional[str] = None,
    ) -> None:
        """
        Notify all caregivers linked to a patient about an alert.
        Placeholder: logs only. Integrate with Push/SMS/Email later.
        """
        try:
            from ..models import CareLink  # local import to avoid circular deps
        except Exception:
            CareLink = None

        if CareLink is None:
            logger.warning("CareLink model unavailable, skipping caregiver notifications.")
            return

        links = db.query(CareLink).filter(
            CareLink.patient_id == patient_id,
            CareLink.is_active == True
        ).all()

        if not links:
            logger.info("No caregivers linked for patient_id=%s", patient_id)
            return

        for link in links:
            caregiver = link.caregiver
            caregiver_email = None
            if caregiver and getattr(caregiver, "auth", None):
                caregiver_email = caregiver.auth.email

            logger.info(
                "Notification (caregiver): patient_id=%s caregiver_id=%s caregiver_email=%s alert_id=%s alert_type=%s reason=%s",
                patient_id,
                link.caregiver_id,
                caregiver_email,
                getattr(alert, "id", None),
                getattr(alert, "alert_type", None),
                reason,
            )
