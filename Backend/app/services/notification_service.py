"""
Notification service for caregiver alerts (Push/SMS) + vitals warnings.
"""

import logging
from typing import Any, Dict, Optional, List

import httpx
from sqlalchemy.orm import Session

from ..config import (
    ENABLE_PUSH_ALERTS,
    ENABLE_SMS_ALERTS,
    EXPO_PUSH_URL,
    EXPO_ACCESS_TOKEN,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER,
)

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
        Basic notifier. For full caregiver alerting, use notify_caregivers_alert.
        """
        logger.info(
            "Notification (vitals): user_id=%s message=%s vitals=%s",
            user_id,
            message,
            vitals
        )

    def _send_expo_push(self, messages: List[Dict[str, Any]]) -> None:
        if not ENABLE_PUSH_ALERTS:
            return
        if not messages:
            return
        headers = {"Content-Type": "application/json"}
        if EXPO_ACCESS_TOKEN:
            headers["Authorization"] = f"Bearer {EXPO_ACCESS_TOKEN}"

        try:
            with httpx.Client(timeout=10.0) as client:
                for i in range(0, len(messages), 100):
                    chunk = messages[i:i + 100]
                    resp = client.post(EXPO_PUSH_URL, json=chunk, headers=headers)
                    if resp.status_code >= 400:
                        logger.warning("Expo push failed: %s %s", resp.status_code, resp.text[:200])
        except Exception as e:
            logger.warning("Expo push error: %s", e)

    def _send_sms(self, to_number: str, body: str) -> bool:
        if not ENABLE_SMS_ALERTS:
            return False
        if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER):
            logger.warning("Twilio is not configured; SMS skipped.")
            return False

        url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
        data = {"From": TWILIO_FROM_NUMBER, "To": to_number, "Body": body}

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, data=data, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN))
                if resp.status_code >= 400:
                    logger.warning("Twilio SMS failed: %s %s", resp.status_code, resp.text[:200])
                    return False
                return True
        except Exception as e:
            logger.warning("SMS error: %s", e)
            return False

    def send_emergency_sms_contacts(
        self,
        contacts: List[Dict[str, Any]],
        body: str,
    ) -> List[Dict[str, Any]]:
        responses: List[Dict[str, Any]] = []

        for contact in contacts:
            phone = str(contact.get("phone") or "").strip()
            if not phone:
                responses.append({
                    "contact_id": str(contact.get("id") or contact.get("phone") or "unknown"),
                    "contact_name": contact.get("name") or "Emergency Contact",
                    "response_type": "failed",
                    "attempts": 1,
                    "error": "Missing phone number",
                })
                continue

            sent = self._send_sms(phone, body)
            responses.append({
                "contact_id": str(contact.get("id") or phone),
                "contact_name": contact.get("name") or "Emergency Contact",
                "response_type": "sms_sent" if sent else "sms_failed",
                "attempts": 1,
            })

        return responses

    def notify_caregivers_alert(
        self,
        db: Session,
        patient_id: int,
        alert: Any,
        reason: Optional[str] = None,
    ) -> None:
        """
        Notify all caregivers linked to a patient about an alert (Push/SMS).
        """
        try:
            from ..models import CareLink, UserPushToken, User  # local import
        except Exception:
            CareLink = None
            UserPushToken = None
            User = None

        if CareLink is None or UserPushToken is None:
            logger.warning("CareLink/PushToken model unavailable, skipping caregiver notifications.")
            return

        links = db.query(CareLink).filter(
            CareLink.patient_id == patient_id,
            CareLink.is_active == True
        ).all()

        if not links:
            logger.info("No caregivers linked for patient_id=%s", patient_id)
            return

        patient = db.query(User).filter(User.id == patient_id).first() if User else None
        patient_name = patient.name if patient else f"Patient {patient_id}"

        alert_type = getattr(alert, "alert_type", "alert")
        severity = getattr(alert, "severity", "unknown")
        message = reason or getattr(alert, "message", None) or f"New {alert_type} alert"
        if alert_type in {"fall", "fall_now"}:
            title = f"🚨 Danger Alert: {patient_name}"
            body = f"Confirmed fall detected for {patient_name}. {message}"
        else:
            title = f"⚠️ {alert_type.upper()} Alert"
            body = f"{patient_name}: {message} (severity: {severity})"

        push_messages: List[Dict[str, Any]] = []

        for link in links:
            caregiver = link.caregiver
            caregiver_phone = getattr(caregiver, "phone", None) if caregiver else None
            if not caregiver_phone and caregiver:
                caregiver_phone = getattr(caregiver, "emergency_contact", None)

            # Push tokens
            tokens = db.query(UserPushToken).filter(
                UserPushToken.user_id == link.caregiver_id,
                UserPushToken.is_active == True
            ).all()

            for token_row in tokens:
                push_messages.append({
                    "to": token_row.token,
                    "title": title,
                    "body": body,
                    "data": {
                        "patient_id": patient_id,
                        "alert_id": getattr(alert, "id", None),
                        "alert_type": alert_type,
                        "severity": severity,
                    }
                })

            if caregiver_phone:
                self._send_sms(caregiver_phone, body)

            logger.info(
                "Notification (caregiver): patient_id=%s caregiver_id=%s alert_id=%s alert_type=%s reason=%s",
                patient_id,
                link.caregiver_id,
                getattr(alert, "id", None),
                alert_type,
                reason,
            )

        if push_messages:
            self._send_expo_push(push_messages)
