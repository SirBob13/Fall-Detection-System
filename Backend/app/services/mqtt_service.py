"""
MQTT ingestion service.
Subscribes to device payloads and forwards them to the existing HTTP ingest endpoint.
"""

import json
import logging
import os
import threading
import time
from typing import Iterable, Optional

import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)

MQTT_ENABLED = os.getenv("MQTT_ENABLED", "false").lower() == "true"
MQTT_BROKER = os.getenv("MQTT_BROKER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_TOPICS_RAW = os.getenv("MQTT_TOPICS", "fall-detection/device-data")
MQTT_QOS = int(os.getenv("MQTT_QOS", "0"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "fall-detection-api")
_client: Optional[mqtt.Client] = None
_thread: Optional[threading.Thread] = None


def _topics() -> Iterable[str]:
    return [t.strip() for t in MQTT_TOPICS_RAW.split(",") if t.strip()]


def _on_connect(client: mqtt.Client, userdata, flags, rc) -> None:  # type: ignore[override]
    if rc != 0:
        logger.error("MQTT connect failed: rc=%s", rc)
        return
    for topic in _topics():
        client.subscribe(topic, qos=MQTT_QOS)
    logger.info("✅ MQTT connected and subscribed to %s", ", ".join(_topics()))


def _on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage) -> None:  # type: ignore[override]
    try:
        raw = msg.payload.decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return
        from app.database import SessionLocal
        from app import schemas
        from app.routes.main import _handle_device_payload

        db = SessionLocal()
        try:
            payload = schemas.DeviceIngestPayload(**data)
            result = _handle_device_payload(payload, db)
            logger.info("✅ MQTT processed: %s", result.get("device_id"))
        except Exception as exc:
            logger.error("❌ Payload validation/processing error: %s", exc)
        finally:
            db.close()
    except Exception as exc:
        logger.error("MQTT message error: %s", exc)


def start_mqtt_service() -> None:
    global _client, _thread
    if not MQTT_ENABLED:
        logger.info("MQTT disabled (MQTT_ENABLED=false)")
        return
    if _client:
        return

    client = mqtt.Client(client_id=MQTT_CLIENT_ID, clean_session=True)
    if MQTT_USERNAME or MQTT_PASSWORD:
        client.username_pw_set(MQTT_USERNAME or None, MQTT_PASSWORD or None)

    client.on_connect = _on_connect
    client.on_message = _on_message

    def _run() -> None:
        while True:
            try:
                client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
                client.loop_forever()
            except Exception as exc:
                logger.error("MQTT connection error: %s", exc)
                time.sleep(5)

    _client = client
    _thread = threading.Thread(target=_run, daemon=True, name="mqtt-listener")
    _thread.start()
    logger.info("🚀 MQTT listener started")
