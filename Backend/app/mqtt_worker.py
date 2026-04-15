import logging
import time

from app.services.mqtt_service import start_mqtt_service

logging.basicConfig(level=logging.INFO)

start_mqtt_service()

while True:
    time.sleep(60)
