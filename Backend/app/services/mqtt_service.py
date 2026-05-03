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
from urllib import error as urllib_error
from urllib import request as urllib_request

import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)

MQTT_ENABLED = os.getenv("MQTT_ENABLED", "false").lower() == "true"
MQTT_BROKER = os.getenv("MQTT_BROKER", "broker.hivemq.com")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_TOPICS_RAW = os.getenv("MQTT_TOPICS", "fall-detection/device-data")
MQTT_QOS = int(os.getenv("MQTT_QOS", "0"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "fall-detection-mqtt-worker")
MQTT_INGEST_URL = os.getenv("MQTT_INGEST_URL", "http://127.0.0.1:8000/api/v1/device-data")
MQTT_BATCH_INGEST_URL = os.getenv("MQTT_BATCH_INGEST_URL", "")
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


def _resolve_ingest_url(payload: dict) -> str:
    if isinstance(payload.get("items"), list):
        if MQTT_BATCH_INGEST_URL:
            return MQTT_BATCH_INGEST_URL
        if MQTT_INGEST_URL.endswith("/device-data"):
            return f"{MQTT_INGEST_URL}/batch"
    return MQTT_INGEST_URL


def _forward_payload(payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(
        _resolve_ingest_url(payload),
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib_request.urlopen(req, timeout=15) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage) -> None:  # type: ignore[override]
    try:
        raw = msg.payload.decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return
        try:
            result = _forward_payload(data)
            logger.info("✅ MQTT processed via API: %s", result.get("device_id", data.get("device_id")))
        except urllib_error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            logger.error("❌ MQTT ingest HTTP error %s: %s", exc.code, body or exc.reason)
        except urllib_error.URLError as exc:
            logger.error("❌ MQTT ingest connection error: %s", exc.reason)
        except Exception as exc:
            logger.error("❌ Payload validation/processing error: %s", exc)
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
