"""
Minimal notification service stub.
Provides availability checks and a no-op notifier used by routes.
"""

import logging
from typing import Any, Dict, Optional

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
