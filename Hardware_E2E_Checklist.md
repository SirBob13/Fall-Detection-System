# Hardware End-to-End Checklist

## Goal
Confirm that the bracelet can be provisioned from the mobile app, connect to Wi-Fi and MQTT, publish telemetry, and have the backend ingest that data successfully.

## Important Note
The current firmware in `/Users/AyshaKassem/Desktop/graduating-project/App/hardware/hardware.ino` still publishes mock telemetry generated in code. This is useful for transport testing, but it is not yet reading real MPU6050 or MAX30102 values.

## Before You Start
- Confirm the backend is healthy: `https://fall-detection.ddns.net/api/v1/health`
- Confirm the mobile app build is using `https://fall-detection.ddns.net/api/v1`
- Confirm the bracelet firmware has been flashed from `/Users/AyshaKassem/Desktop/graduating-project/App/hardware/hardware.ino`
- Confirm the server-side MQTT worker is enabled with the same broker and topic that the pairing endpoint returns

## MQTT Values Must Match
Check these three values together:
- The mobile app receives provisioning data from `/api/v1/devices/request-pairing-token`
- The bracelet stores `mqtt.host`, `mqtt.port`, and `mqtt.topic`
- The backend worker listens using `MQTT_BROKER`, `MQTT_PORT`, and `MQTT_TOPICS`

If those values do not match, the bracelet may publish successfully while the backend receives nothing.

## Step 1: Provision the Bracelet
- Open the mobile app and log in
- Go to device provisioning / device connect flow
- Scan and connect to `FallDetectionBracelet`
- Provide Wi-Fi SSID and password
- Let the app request a pairing token from `/api/v1/devices/request-pairing-token`
- Let the app write the provisioning payload over BLE

## Step 2: Watch the Bracelet Serial Monitor
Open the serial monitor at `115200` baud and look for logs similar to:
- `===== FALL DETECTION BRACELET START =====`
- `📦 Found stored provisioning config`
- `📥 Provisioning payload bytes=...`
- `STATUS [provisioning_received] OK - Provisioning saved`
- `🔄 Connecting to WiFi SSID=...`
- `✅ WiFi connected. IP=...`
- `🔄 Connecting to MQTT ...`
- `✅ MQTT connected`
- `📤 MQTT published: {...}`

## Step 3: Confirm the Backend Receives Telemetry
Use at least one of these checks:
- Open the admin dashboard and confirm the device status updates
- Check for new motion, vitals, prediction, and alert records in the dashboard
- Recheck `https://fall-detection.ddns.net/api/v1/health` and look for updated statistics
- If you have server access, inspect the MQTT worker logs and Nginx/app logs

## Step 4: Confirm the Payload Shape
The firmware currently publishes:
- `device_id`
- `user_id`
- `pairing_token`
- `battery_level`
- `firmware_version`
- nested `motion`
- nested `vitals`

The backend ingest route currently requires `device_id` and enough information to resolve `user_id`. The extra `pairing_token` is provisioned but is not part of the current ingest schema, so do not depend on it for live validation.

## Step 5: Success Criteria
A successful end-to-end run means all of the following are true:
- The bracelet reports Wi-Fi connected
- The bracelet reports MQTT connected
- The bracelet prints repeated `MQTT published` logs
- The backend stores new motion/vitals rows
- The backend creates predictions from incoming motion
- The mobile app or admin dashboard shows fresh updates

## If Something Fails
- If Wi-Fi fails: re-provision SSID/password and verify signal strength
- If MQTT fails: compare broker, port, and topic between pairing response and server env
- If MQTT publishes but backend shows nothing: the backend worker is likely listening on a different broker or topic
- If the backend ingests HTTP test payloads but not bracelet data: focus on MQTT, not API health
- If the app pairs but the bracelet does not connect afterward: inspect the serial monitor first

## Recommended Real Test Sequence
1. Provision the bracelet from the app
2. Confirm Wi-Fi connection in the serial monitor
3. Confirm MQTT connection in the serial monitor
4. Wait for at least two `MQTT published` messages
5. Refresh the admin dashboard
6. Confirm new motion/prediction/vitals entries appear
7. Confirm alerts only appear when the mock motion pattern triggers them
