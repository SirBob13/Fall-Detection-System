#include <WiFi.h>
#include <Wire.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include "esp_bt.h"
#include "mbedtls/base64.h"
#include <math.h>

// ================= ESP32 SuperMini / ESP32-C3 Settings =================
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  #define BOARD_NAME "ESP32-C3 SuperMini"
  #define I2C_SDA_PIN 8
  #define I2C_SCL_PIN 9
#else
  #define BOARD_NAME "ESP32 DevKit"
  #define I2C_SDA_PIN 21
  #define I2C_SCL_PIN 22
#endif

#define BLE_MTU_SIZE 247
static const int WIFI_MAX_RETRIES = 30;  // 30 x 500ms = about 15 seconds

// ================= BLE UUIDs =================
static const char *SERVICE_UUID = "7A100001-8C6A-4F6D-A55B-000000000001";
static const char *DEVICE_INFO_UUID = "7A100002-8C6A-4F6D-A55B-000000000001";
static const char *WRITE_UUID = "7A100003-8C6A-4F6D-A55B-000000000001";
static const char *STATUS_UUID = "7A100004-8C6A-4F6D-A55B-000000000001";
static const char *SENSOR_SERVICE_UUID = "7A200001-8C6A-4F6D-A55B-000000000001";
static const char *SENSOR_DATA_UUID = "7A200002-8C6A-4F6D-A55B-000000000001";

// ================= Preferences =================
static const char *PREF_NAMESPACE = "bracelet";
static const char *PREF_SSID_KEY = "ssid";
static const char *PREF_PASS_KEY = "pass";
static const char *PREF_DEVICE_ID_KEY = "device_id";
static const char *PREF_USER_ID_KEY = "user_id";
static const char *PREF_PAIRING_TOKEN_KEY = "pair_tok";
static const char *PREF_MQTT_HOST_KEY = "mqtt_host";
static const char *PREF_MQTT_PORT_KEY = "mqtt_port";
static const char *PREF_MQTT_TOPIC_KEY = "mqtt_topic";

// ================= Firmware Identity =================
static const char *DEVICE_NAME = "FallDetectionBracelet";
static const char *BACKUP_DEVICE_NAME = "FallDetectionBracelet-Backup";
static const char *DEVICE_TYPE = "esp32-c3-supermini-bracelet";
static const char *FIRMWARE_VERSION = "2.8.1-supermini-50hz-motion-1hz-vitals";

// ================= Timing =================
static const unsigned long WIFI_RETRY_INTERVAL_MS = 30000;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
static const unsigned long PUBLISH_INTERVAL_MS = 1000;
static const unsigned long BACKUP_BLE_PUBLISH_INTERVAL_MS = 2000;
static const unsigned long PROVISIONING_CHUNK_TIMEOUT_MS = 120000;  // 2 minutes for slow BLE phones
static const size_t PROVISIONING_CHUNK_BUFFER_LIMIT = 2048;

// ================= Sensor / Batch Settings =================
static const size_t SENSOR_SAMPLE_RATE_HZ = 50;
static const size_t TELEMETRY_BATCH_SAMPLE_COUNT = 50;
static const unsigned long SENSOR_SAMPLE_INTERVAL_MS = 1000 / SENSOR_SAMPLE_RATE_HZ;
static const unsigned long VITALS_PUBLISH_INTERVAL_MS = 1000;

// ================= MQTT / Telemetry Buffer Settings =================
// 50 motion samples in one MQTT batch still fit comfortably after compacting
// repeated metadata and rounding values.
static const uint16_t MQTT_PACKET_BUFFER_SIZE = 12288;
static const size_t TELEMETRY_PAYLOAD_SIZE = 12288;
static const size_t TELEMETRY_JSON_DOCUMENT_SIZE = 12288;

// ================= Fake Alert Test Settings =================
// true = inject a fake fall-like motion pattern inside the normal mock telemetry.
// Use this only for demo/testing so the backend/AI/app can prove that alert flow works.
static const bool ENABLE_FAKE_ALERT_TEST = false;

// At 50 Hz this creates one fake fall window about every 60 seconds.
static const unsigned long FAKE_ALERT_EVERY_N_MESSAGES = SENSOR_SAMPLE_RATE_HZ * 60;

// Start the fake fall after 8 published messages, so you do not wait too long in demos.
static const unsigned long FAKE_ALERT_START_OFFSET = 8;

// 8 samples is safer than 5 for AI/window-based detection: pre-fall, free-fall, impact, and post-fall stillness.
static const unsigned long FAKE_ALERT_BURST_SAMPLES = 8;

Preferences preferences;
BLECharacteristic *deviceInfoChar = nullptr;
BLECharacteristic *writeChar = nullptr;
BLECharacteristic *statusChar = nullptr;
BLECharacteristic *sensorDataChar = nullptr;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

bool deviceConnected = false;
bool shouldApplyProvisioning = false;
bool hasPendingProvisioning = false;
bool shouldStopBleAfterWiFiConnect = false;
bool shouldResumeProvisioningBle = false;

static const size_t RAW_PROVISIONING_PAYLOAD_SIZE = 768;
static const size_t RAW_PROVISIONING_QUEUE_SIZE = 8;  // 6 chunks + commit fits; overflow is guarded

volatile bool hasQueuedProvisioningPayload = false;
char rawProvisioningQueue[RAW_PROVISIONING_QUEUE_SIZE][RAW_PROVISIONING_PAYLOAD_SIZE];
volatile size_t rawProvisioningQueueHead = 0;
volatile size_t rawProvisioningQueueTail = 0;
volatile size_t rawProvisioningQueueCount = 0;
portMUX_TYPE rawProvisioningQueueMux = portMUX_INITIALIZER_UNLOCKED;

bool requireReProvisioning = false;
bool wifiWasConnectedOnce = false;

String wifiSsid = "";
String wifiPassword = "";
String provisionedDeviceId = "";
String pairingToken = "";
String mqttHost = "";
String mqttTopic = "";
uint16_t mqttPort = 1883;
int provisionedUserId = 0;

String pendingWifiSsid = "";
String pendingWifiPassword = "";
String pendingProvisionedDeviceId = "";
String pendingPairingToken = "";
String pendingMqttHost = "";
String pendingMqttTopic = "";
uint16_t pendingMqttPort = 1883;
int pendingProvisionedUserId = 0;

String lastErrorStage = "";
String lastErrorMessage = "";

String provisioningTransferId = "";
char provisioningChunkBuffer[PROVISIONING_CHUNK_BUFFER_LIMIT + 1];
size_t provisioningChunkBufferLen = 0;
int provisioningChunkExpectedTotal = 0;
int provisioningChunkNextIndex = 0;
unsigned long provisioningChunkStartedAtMs = 0;

unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
unsigned long lastPublishMs = 0;
unsigned long lastBackupBlePublishMs = 0;
unsigned long lastVitalsPublishMs = 0;
bool lastBuiltBatchIncludedVitals = false;
unsigned long telemetryCounter = 0;

enum BleMode {
  BLE_MODE_OFF,
  BLE_MODE_PROVISIONING,
  BLE_MODE_BACKUP,
};

BleMode currentBleMode = BLE_MODE_OFF;

struct TelemetrySample {
  float accX;
  float accY;
  float accZ;
  float gyroX;
  float gyroY;
  float gyroZ;
  float heartRate;
  float spo2;
  float bodyTemp;
  float batteryLevel;
  bool fakeFallEvent;
  const char *fakeFallPhase;
  const char *fakeSeverity;
  unsigned long sampleCounter;
};

// ================= Utilities =================
void disableClassicBluetooth() {
#if defined(CONFIG_IDF_TARGET_ESP32)
  esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
#endif
}

String fallbackDeviceId() {
  uint64_t chipId = ESP.getEfuseMac();
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "bracelet-%04X%08X", (uint16_t)(chipId >> 32), (uint32_t)chipId);
  return String(buffer);
}

void loadStoredConfig() {
  wifiSsid = preferences.getString(PREF_SSID_KEY, "");
  wifiPassword = preferences.getString(PREF_PASS_KEY, "");
  provisionedDeviceId = preferences.getString(PREF_DEVICE_ID_KEY, fallbackDeviceId());
  provisionedUserId = preferences.getInt(PREF_USER_ID_KEY, 0);
  pairingToken = preferences.getString(PREF_PAIRING_TOKEN_KEY, "");
  mqttHost = preferences.getString(PREF_MQTT_HOST_KEY, "");
  mqttPort = preferences.getUShort(PREF_MQTT_PORT_KEY, 1883);
  mqttTopic = preferences.getString(PREF_MQTT_TOPIC_KEY, "fall-detection/device-data");
}

void saveConfig() {
  preferences.putString(PREF_SSID_KEY, wifiSsid);
  preferences.putString(PREF_PASS_KEY, wifiPassword);
  preferences.putString(PREF_DEVICE_ID_KEY, provisionedDeviceId);
  preferences.putInt(PREF_USER_ID_KEY, provisionedUserId);
  preferences.putString(PREF_PAIRING_TOKEN_KEY, pairingToken);
  preferences.putString(PREF_MQTT_HOST_KEY, mqttHost);
  preferences.putUShort(PREF_MQTT_PORT_KEY, mqttPort);
  preferences.putString(PREF_MQTT_TOPIC_KEY, mqttTopic);
}

String connectionStatusLabel() {
  if (currentBleMode == BLE_MODE_BACKUP) return "backup_ble";
  if (mqttClient.connected()) return "streaming";
  if (WiFi.status() == WL_CONNECTED) return "wifi_connected";
  if (wifiSsid.length() > 0) return "provisioned";
  return "ready_for_provisioning";
}

void setLastError(const String &stage, const String &message) {
  lastErrorStage = stage;
  lastErrorMessage = message;
}

String getActiveDeviceId() {
  if (pendingProvisionedDeviceId.length() > 0) return pendingProvisionedDeviceId;
  if (provisionedDeviceId.length() > 0) return provisionedDeviceId;
  return fallbackDeviceId();
}

bool hasStoredConfig() {
  return !wifiSsid.isEmpty() && provisionedUserId > 0;
}

String decodeBase64Payload(const String &encoded) {
  if (encoded.length() == 0) return "";

  size_t outputLen = 0;
  size_t bufferSize = encoded.length() + 8;
  unsigned char *buffer = (unsigned char *)malloc(bufferSize);
  if (!buffer) return "";

  int result = mbedtls_base64_decode(
    buffer,
    bufferSize - 1,
    &outputLen,
    (const unsigned char *)encoded.c_str(),
    encoded.length()
  );

  if (result != 0 || outputLen == 0) {
    free(buffer);
    return "";
  }

  buffer[outputLen] = '\0';
  String decoded = String((char *)buffer);
  free(buffer);
  return decoded;
}

void resetProvisioningTransfer() {
  provisioningTransferId = "";
  memset(provisioningChunkBuffer, 0, sizeof(provisioningChunkBuffer));
  provisioningChunkBufferLen = 0;
  provisioningChunkExpectedTotal = 0;
  provisioningChunkNextIndex = 0;
  provisioningChunkStartedAtMs = 0;
}

void clearPendingProvisioningState() {
  hasPendingProvisioning = false;
  shouldApplyProvisioning = false;
  shouldStopBleAfterWiFiConnect = false;

  pendingWifiSsid = "";
  pendingWifiPassword = "";
  pendingProvisionedDeviceId = "";
  pendingPairingToken = "";
  pendingMqttHost = "";
  pendingMqttTopic = "";
  pendingMqttPort = 1883;
  pendingProvisionedUserId = 0;

  resetProvisioningTransfer();
}

bool enqueueRawProvisioningPayload(const String &rawValue) {
  if (rawValue.length() == 0) {
    Serial.println("❌ Empty provisioning payload received");
    return false;
  }

  if (rawValue.length() >= RAW_PROVISIONING_PAYLOAD_SIZE) {
    Serial.printf("❌ Provisioning payload too large for raw buffer: %u bytes\n", rawValue.length());
    return false;
  }

  bool queued = false;
  size_t queueCountAfter = 0;

  portENTER_CRITICAL(&rawProvisioningQueueMux);

  if (rawProvisioningQueueCount < RAW_PROVISIONING_QUEUE_SIZE) {
    memset(rawProvisioningQueue[rawProvisioningQueueTail], 0, RAW_PROVISIONING_PAYLOAD_SIZE);
    strncpy(rawProvisioningQueue[rawProvisioningQueueTail], rawValue.c_str(), RAW_PROVISIONING_PAYLOAD_SIZE - 1);

    rawProvisioningQueueTail = (rawProvisioningQueueTail + 1) % RAW_PROVISIONING_QUEUE_SIZE;
    rawProvisioningQueueCount++;
    hasQueuedProvisioningPayload = true;
    queueCountAfter = rawProvisioningQueueCount;
    queued = true;
  }

  portEXIT_CRITICAL(&rawProvisioningQueueMux);

  if (!queued) {
    Serial.println("❌ Provisioning queue overflow. Slow down BLE writes or use Write With Response.");
    setLastError("invalid_data", "Provisioning queue overflow");
    return false;
  }

  Serial.printf(
    "📦 Raw provisioning payload queued: %u bytes (queue=%u)\n",
    rawValue.length(),
    (unsigned int)queueCountAfter
  );

  return true;
}

bool dequeueRawProvisioningPayload(String &value) {
  char temp[RAW_PROVISIONING_PAYLOAD_SIZE];
  memset(temp, 0, sizeof(temp));

  bool hasItem = false;

  portENTER_CRITICAL(&rawProvisioningQueueMux);

  if (rawProvisioningQueueCount > 0) {
    strncpy(temp, rawProvisioningQueue[rawProvisioningQueueHead], RAW_PROVISIONING_PAYLOAD_SIZE - 1);
    memset(rawProvisioningQueue[rawProvisioningQueueHead], 0, RAW_PROVISIONING_PAYLOAD_SIZE);

    rawProvisioningQueueHead = (rawProvisioningQueueHead + 1) % RAW_PROVISIONING_QUEUE_SIZE;
    rawProvisioningQueueCount--;
    hasQueuedProvisioningPayload = rawProvisioningQueueCount > 0;
    hasItem = true;
  } else {
    hasQueuedProvisioningPayload = false;
  }

  portEXIT_CRITICAL(&rawProvisioningQueueMux);

  if (!hasItem) {
    return false;
  }

  value = String(temp);
  return value.length() > 0;
}

void notifyStatus(const char *stage, bool success, const String &message, int code = 0) {
  if (!statusChar) {
    Serial.printf("STATUS [%s] %s - %s\n", stage, success ? "OK" : "FAIL", message.c_str());
    return;
  }

  StaticJsonDocument<384> doc;

  if (!success) {
    setLastError(stage, message);
  } else if (
    String(stage) == "streaming" ||
    String(stage) == "mqtt_connected" ||
    String(stage) == "wifi_connected" ||
    String(stage) == "ready_for_provisioning"
  ) {
    setLastError("", "");
  }

  doc["device_id"] = getActiveDeviceId();
  doc["stage"] = stage;
  doc["success"] = success;
  doc["message"] = message;

  if (code != 0) {
    doc["code"] = code;
  }

  if (WiFi.status() == WL_CONNECTED) {
    doc["ip"] = WiFi.localIP().toString();
  }

  char buffer[384];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));

  if (len > 0 && len < sizeof(buffer)) {
    statusChar->setValue((uint8_t *)buffer, len);

    // Notify the phone only when connected. This lets the app send the next chunk after ACK.
    if (deviceConnected) {
      statusChar->notify();
      delay(20);
    }
  }

  Serial.printf("STATUS [%s] %s - %s\n", stage, success ? "OK" : "FAIL", message.c_str());
}

void updateDeviceInfoCharacteristic() {
  if (!deviceInfoChar) return;

  StaticJsonDocument<384> doc;
  doc["device_id"] = getActiveDeviceId();
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["device_type"] = DEVICE_TYPE;
  doc["wifi_connected"] = WiFi.status() == WL_CONNECTED;
  doc["backend_connected"] = mqttClient.connected();
  doc["battery_level"] = 85;
  doc["status"] = connectionStatusLabel();
  doc["last_error_stage"] = lastErrorStage;
  doc["last_error_message"] = lastErrorMessage;

  char buffer[384];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));
  deviceInfoChar->setValue((uint8_t *)buffer, len);
}

void stopBle() {
  if (!BLEDevice::getInitialized()) return;

  BLEDevice::stopAdvertising();
  delay(100);

#if defined(CONFIG_IDF_TARGET_ESP32C3)
  // ESP32-C3 can corrupt heap when BLEDevice::deinit(true) is called after BLE chunk writes.
  // Keep the BLE stack allocated and only stop advertising.
  currentBleMode = BLE_MODE_OFF;
  deviceConnected = false;
  Serial.println("✅ BLE advertising stopped safely on ESP32-C3 - no deinit");
  return;
#else
  BLEDevice::deinit(true);
  delay(150);

  deviceInfoChar = nullptr;
  writeChar = nullptr;
  statusChar = nullptr;
  sensorDataChar = nullptr;
  deviceConnected = false;
  currentBleMode = BLE_MODE_OFF;
  Serial.println("✅ BLE stopped and deinitialized");
#endif
}

// ================= Mock Sensor Data =================
float wave(unsigned long t, float speed, float amplitude, float offset) {
  return sin((float)t / speed) * amplitude + offset;
}

bool isValidHeartRate(float heartRate) {
  return heartRate > 0.0f && heartRate < 300.0f;
}

bool isValidOxygenSaturation(float spo2) {
  return spo2 >= 0.0f && spo2 <= 100.0f;
}

bool isValidBodyTemperature(float bodyTemp) {
  return bodyTemp > 20.0f && bodyTemp < 45.0f;
}

float roundedValue(float value, int decimals) {
  float factor = powf(10.0f, (float)decimals);
  return roundf(value * factor) / factor;
}

void generateTelemetrySample(unsigned long sampleNow, TelemetrySample &sample) {
  sample.accX = wave(sampleNow, 700.0f, 0.18f, 0.02f);
  sample.accY = wave(sampleNow + 200, 900.0f, 0.12f, -0.01f);
  sample.accZ = wave(sampleNow + 500, 650.0f, 0.25f, 9.72f);

  sample.gyroX = wave(sampleNow, 300.0f, 8.0f, 0.8f);
  sample.gyroY = wave(sampleNow + 300, 400.0f, 7.0f, -0.5f);
  sample.gyroZ = wave(sampleNow + 500, 500.0f, 6.0f, 0.2f);

  sample.heartRate = wave(sampleNow, 1400.0f, 6.0f, 78.0f);
  sample.spo2 = wave(sampleNow, 2500.0f, 1.0f, 97.5f);
  sample.bodyTemp = wave(sampleNow, 3200.0f, 0.2f, 36.7f);
  sample.batteryLevel = 84.0f;

  telemetryCounter++;
  sample.sampleCounter = telemetryCounter;
  sample.fakeFallEvent = false;
  sample.fakeFallPhase = "normal";
  sample.fakeSeverity = "normal";

  if (ENABLE_FAKE_ALERT_TEST && FAKE_ALERT_EVERY_N_MESSAGES > 0) {
    unsigned long cyclePosition = sample.sampleCounter % FAKE_ALERT_EVERY_N_MESSAGES;

    if (
      cyclePosition >= FAKE_ALERT_START_OFFSET &&
      cyclePosition < (FAKE_ALERT_START_OFFSET + FAKE_ALERT_BURST_SAMPLES)
    ) {
      sample.fakeFallEvent = true;
      sample.fakeSeverity = "high";

      unsigned long phase = cyclePosition - FAKE_ALERT_START_OFFSET;

      if (phase == 0) {
        sample.fakeFallPhase = "pre_fall_instability";
        sample.accX = 2.4f;
        sample.accY = -1.8f;
        sample.accZ = 8.2f;
        sample.gyroX = 55.0f;
        sample.gyroY = -48.0f;
        sample.gyroZ = 65.0f;
        sample.heartRate = 92.0f;
      } else if (phase == 1) {
        sample.fakeFallPhase = "free_fall";
        sample.accX = 0.12f;
        sample.accY = -0.08f;
        sample.accZ = 0.18f;
        sample.gyroX = 125.0f;
        sample.gyroY = -110.0f;
        sample.gyroZ = 95.0f;
        sample.heartRate = 98.0f;
      } else if (phase == 2) {
        sample.fakeFallPhase = "impact";
        sample.accX = 18.5f;
        sample.accY = -12.0f;
        sample.accZ = 31.0f;
        sample.gyroX = 360.0f;
        sample.gyroY = -290.0f;
        sample.gyroZ = 420.0f;
        sample.heartRate = 118.0f;
        sample.spo2 = 95.0f;
      } else if (phase == 3) {
        sample.fakeFallPhase = "secondary_impact";
        sample.accX = -14.0f;
        sample.accY = 9.5f;
        sample.accZ = 23.5f;
        sample.gyroX = -240.0f;
        sample.gyroY = 210.0f;
        sample.gyroZ = -180.0f;
        sample.heartRate = 122.0f;
        sample.spo2 = 94.0f;
      } else {
        sample.fakeFallPhase = "post_fall_stillness";
        sample.accX = 9.4f;
        sample.accY = 0.4f;
        sample.accZ = 1.2f;
        sample.gyroX = 0.8f;
        sample.gyroY = 0.5f;
        sample.gyroZ = 0.6f;
        sample.heartRate = 120.0f;
        sample.spo2 = 94.0f;
        sample.bodyTemp = 36.9f;
      }
    }
  }
}

bool buildSingleTelemetryJson(char *output, size_t outputSize) {
  if (!output || outputSize == 0) {
    return false;
  }

  memset(output, 0, outputSize);

  TelemetrySample sample;
  generateTelemetrySample(millis(), sample);

  DynamicJsonDocument doc(2048);
  doc["device_id"] = provisionedDeviceId;
  doc["user_id"] = provisionedUserId;
  doc["pairing_token"] = pairingToken;
  doc["battery_level"] = sample.batteryLevel;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["test_mode"] = ENABLE_FAKE_ALERT_TEST;
  doc["sample_counter"] = sample.sampleCounter;
  doc["fake_fall_event"] = sample.fakeFallEvent;
  doc["fall_detected"] = sample.fakeFallEvent;
  doc["alert_type"] = sample.fakeFallEvent ? "fall_test" : "none";
  doc["fall_phase"] = sample.fakeFallPhase;
  doc["severity"] = sample.fakeSeverity;

  JsonObject motion = doc.createNestedObject("motion");
  motion["acc_x"] = sample.accX;
  motion["acc_y"] = sample.accY;
  motion["acc_z"] = sample.accZ;
  motion["gyro_x"] = sample.gyroX;
  motion["gyro_y"] = sample.gyroY;
  motion["gyro_z"] = sample.gyroZ;
  motion["temperature"] = sample.bodyTemp;

  const bool hasValidVitals =
    isValidHeartRate(sample.heartRate) ||
    isValidOxygenSaturation(sample.spo2) ||
    isValidBodyTemperature(sample.bodyTemp);

  if (hasValidVitals) {
    JsonObject vitals = doc.createNestedObject("vitals");
    if (isValidHeartRate(sample.heartRate)) {
      vitals["heart_rate"] = sample.heartRate;
    }
    if (isValidOxygenSaturation(sample.spo2)) {
      vitals["oxygen_saturation"] = sample.spo2;
    }
    if (isValidBodyTemperature(sample.bodyTemp)) {
      vitals["body_temperature"] = sample.bodyTemp;
    }
  }

  if (doc.overflowed()) {
    Serial.println("❌ Single telemetry JSON document overflowed");
    output[0] = '\0';
    return false;
  }

  size_t written = serializeJson(doc, output, outputSize);
  output[outputSize - 1] = '\0';

  if (written == 0 || written >= outputSize - 1) {
    Serial.println("❌ Single telemetry JSON serialization failed");
    return false;
  }

  return true;
}

bool buildTelemetryBatchJson(String &output) {
  output = "";
  lastBuiltBatchIncludedVitals = false;

  DynamicJsonDocument doc(TELEMETRY_JSON_DOCUMENT_SIZE);
  JsonArray items = doc.createNestedArray("items");
  unsigned long batchBaseNow = millis();
  const bool includeVitalsThisBatch =
    lastVitalsPublishMs == 0 ||
    batchBaseNow < lastVitalsPublishMs ||
    (batchBaseNow - lastVitalsPublishMs) >= VITALS_PUBLISH_INTERVAL_MS;

  for (size_t i = 0; i < TELEMETRY_BATCH_SAMPLE_COUNT; i++) {
    unsigned long offsetMs = (TELEMETRY_BATCH_SAMPLE_COUNT - 1 - i) * SENSOR_SAMPLE_INTERVAL_MS;
    unsigned long sampleNow = batchBaseNow >= offsetMs ? batchBaseNow - offsetMs : 0;
    TelemetrySample sample;
    generateTelemetrySample(sampleNow, sample);

    JsonObject item = items.createNestedObject();
    item["device_id"] = provisionedDeviceId;
    item["user_id"] = provisionedUserId;

    JsonObject motion = item.createNestedObject("motion");
    motion["acc_x"] = roundedValue(sample.accX, 3);
    motion["acc_y"] = roundedValue(sample.accY, 3);
    motion["acc_z"] = roundedValue(sample.accZ, 3);
    motion["gyro_x"] = roundedValue(sample.gyroX, 2);
    motion["gyro_y"] = roundedValue(sample.gyroY, 2);
    motion["gyro_z"] = roundedValue(sample.gyroZ, 2);
    motion["temperature"] = roundedValue(sample.bodyTemp, 2);

    if (i == TELEMETRY_BATCH_SAMPLE_COUNT - 1) {
      item["battery_level"] = roundedValue(sample.batteryLevel, 1);
      item["firmware_version"] = FIRMWARE_VERSION;

      const bool hasValidVitals =
        isValidHeartRate(sample.heartRate) ||
        isValidOxygenSaturation(sample.spo2) ||
        isValidBodyTemperature(sample.bodyTemp);

      if (includeVitalsThisBatch && hasValidVitals) {
        JsonObject vitals = item.createNestedObject("vitals");
        if (isValidHeartRate(sample.heartRate)) {
          vitals["heart_rate"] = roundedValue(sample.heartRate, 2);
        }
        if (isValidOxygenSaturation(sample.spo2)) {
          vitals["oxygen_saturation"] = roundedValue(sample.spo2, 2);
        }
        if (isValidBodyTemperature(sample.bodyTemp)) {
          vitals["body_temperature"] = roundedValue(sample.bodyTemp, 2);
        }
        lastBuiltBatchIncludedVitals = true;
      }
    }
  }

  if (doc.overflowed()) {
    Serial.println("❌ Telemetry batch JSON document overflowed");
    return false;
  }

  output.reserve(TELEMETRY_PAYLOAD_SIZE);
  size_t written = serializeJson(doc, output);
  return written > 0 && output.length() < TELEMETRY_PAYLOAD_SIZE;
}

void notifyBackupTelemetry() {
  if (!sensorDataChar || !BLEDevice::getInitialized()) return;

  char payload[2048];

  if (!buildSingleTelemetryJson(payload, sizeof(payload))) {
    Serial.println("❌ BLE backup telemetry build failed");
    return;
  }

  sensorDataChar->setValue((uint8_t *)payload, strlen(payload));
  if (deviceConnected) {
    sensorDataChar->notify();
  }
  Serial.printf("📡 BLE backup telemetry: %s\n", payload);
}

// ================= Provisioning Parser =================
bool applyProvisioningPayload(const String &value) {
  Serial.printf("📥 Provisioning payload bytes=%u\n", value.length());
  Serial.println("📥 Provisioning payload:");
  Serial.println(value);

  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, value);
  if (err) {
    Serial.printf("❌ Provisioning JSON parse failed: %s\n", err.c_str());
    notifyStatus("invalid_json", false, String("Invalid provisioning payload: ") + err.c_str());
    return false;
  }

  JsonObject wifi = doc["wifi"].is<JsonObject>()
                      ? doc["wifi"].as<JsonObject>()
                      : doc["w"].as<JsonObject>();
  JsonObject mqtt = doc["mqtt"].is<JsonObject>()
                      ? doc["mqtt"].as<JsonObject>()
                      : doc["m"].as<JsonObject>();
  JsonObject api = doc["api"].is<JsonObject>()
                     ? doc["api"].as<JsonObject>()
                     : doc["a"].as<JsonObject>();

  pendingWifiSsid = wifi["ssid"] | wifi["s"] | "";
  pendingWifiPassword = wifi["password"] | wifi["p"] | "";
  pendingProvisionedDeviceId = doc["device_id"] | doc["d"] | fallbackDeviceId();
  pendingPairingToken = doc["pairing_token"] | doc["pt"] | "";
  pendingMqttHost = mqtt["host"] | mqtt["h"] | "";
  pendingMqttTopic = mqtt["topic"] | mqtt["t"] | "fall-detection/device-data";
  pendingMqttPort = mqtt["port"] | mqtt["o"] | 1883;
  pendingProvisionedUserId = doc["user_id"] | doc["u"] | 0;

  pendingWifiSsid.trim();
  pendingWifiPassword.trim();
  pendingProvisionedDeviceId.trim();
  pendingMqttHost.trim();
  pendingMqttTopic.trim();
  pendingPairingToken.trim();

  // api block is accepted for forward compatibility even if not used directly here.
  (void)api;

  if (pendingWifiSsid.isEmpty()) {
    notifyStatus("missing_ssid", false, "WiFi SSID is missing");
    return false;
  }

  if (pendingWifiPassword.isEmpty()) {
    notifyStatus("missing_password", false, "WiFi password is missing");
    return false;
  }

  if (pendingProvisionedDeviceId.isEmpty()) {
    notifyStatus("invalid_device_id", false, "device_id is missing");
    return false;
  }

  if (pendingProvisionedUserId <= 0) {
    notifyStatus("invalid_user_id", false, "user_id must be greater than 0");
    return false;
  }

  if (pendingMqttHost.isEmpty()) {
    notifyStatus("mqtt_failed", false, "MQTT host missing from provisioning data");
    return false;
  }

  hasPendingProvisioning = true;
  requireReProvisioning = false;
  shouldApplyProvisioning = true;
  shouldStopBleAfterWiFiConnect = true;
  shouldResumeProvisioningBle = false;

  updateDeviceInfoCharacteristic();
  notifyStatus("provisioning_received", true, "Provisioning data received, connecting to WiFi");
  Serial.println("✅ Provisioning data accepted. WiFi test will start from loop().");
  return true;
}

bool handleProvisioningChunkEnvelope(JsonObject envelope) {
  const String type = envelope["type"] | "";
  const String transferId = envelope["id"] | "";

  if (type == "chunk") {
    const int index = envelope["index"] | -1;
    const int total = envelope["total"] | 0;
    const String data = envelope["data"] | "";

    if (transferId.isEmpty() || index < 0 || total <= 0 || data.isEmpty()) {
      notifyStatus("invalid_data", false, "Invalid chunk metadata");
      return false;
    }

    // Start a new transfer only from the first chunk.
    if (provisioningTransferId.isEmpty()) {
      if (index != 0) {
        Serial.printf("❌ First chunk must be index 0. Received=%d total=%d\n", index, total);
        notifyStatus("invalid_data", false, "First chunk must be index 0");
        resetProvisioningTransfer();
        return false;
      }

      resetProvisioningTransfer();
      provisioningTransferId = transferId;
      provisioningChunkExpectedTotal = total;
      provisioningChunkStartedAtMs = millis();
      Serial.printf("🆕 New chunk transfer id=%s total=%d\n", transferId.c_str(), total);
    }

    if (provisioningTransferId != transferId) {
      Serial.printf("❌ Transfer id mismatch. Current=%s Received=%s\n", provisioningTransferId.c_str(), transferId.c_str());
      notifyStatus("invalid_data", false, "Chunk transfer id mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (provisioningChunkExpectedTotal != total) {
      notifyStatus("invalid_data", false, "Chunk total mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (index != provisioningChunkNextIndex) {
      Serial.printf("❌ Chunk order mismatch. Expected=%d Received=%d\n", provisioningChunkNextIndex, index);
      notifyStatus("invalid_data", false, "Chunk order mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (provisioningChunkBufferLen + data.length() > PROVISIONING_CHUNK_BUFFER_LIMIT) {
      notifyStatus("invalid_data", false, "Provisioning payload too large");
      resetProvisioningTransfer();
      return false;
    }

    memcpy(provisioningChunkBuffer + provisioningChunkBufferLen, data.c_str(), data.length());
    provisioningChunkBufferLen += data.length();
    provisioningChunkBuffer[provisioningChunkBufferLen] = '\0';

    provisioningChunkNextIndex++;
    provisioningChunkStartedAtMs = millis();

    Serial.printf("📦 Provisioning chunk %d/%d received | bytes=%u\n", index + 1, total, data.length());
    notifyStatus("chunk_received", true, String("Chunk ") + String(index + 1) + "/" + String(total));
    return true;
  }

  if (type == "commit") {
    if (transferId.isEmpty() || provisioningTransferId != transferId) {
      Serial.printf("❌ Commit transfer id mismatch. Current=%s Commit=%s\n", provisioningTransferId.c_str(), transferId.c_str());
      notifyStatus("invalid_data", false, "Commit transfer id mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (provisioningChunkExpectedTotal <= 0 || provisioningChunkNextIndex != provisioningChunkExpectedTotal) {
      Serial.printf("❌ Incomplete chunks. Received=%d Expected=%d\n", provisioningChunkNextIndex, provisioningChunkExpectedTotal);
      notifyStatus("invalid_data", false, "Incomplete chunked provisioning payload");
      resetProvisioningTransfer();
      return false;
    }

    String encodedPayload = String(provisioningChunkBuffer);
    String decodedPayload = decodeBase64Payload(encodedPayload);
    resetProvisioningTransfer();

    if (decodedPayload.isEmpty()) {
      notifyStatus("invalid_data", false, "Failed to decode chunked provisioning payload");
      return false;
    }

    Serial.println("✅ Chunked provisioning payload decoded successfully");
    return applyProvisioningPayload(decodedPayload);
  }

  notifyStatus("invalid_data", false, "Unknown provisioning envelope type");
  return false;
}

// This runs in loop(), not inside BLE callback, to avoid C3 heap issues.
void processProvisioningPayloadFromLoop() {
  String value;
  if (!dequeueRawProvisioningPayload(value)) {
    return;
  }

  if (value.length() == 0) {
    Serial.println("❌ Empty provisioning payload");
    setLastError("invalid_data", "Empty provisioning payload");
    return;
  }

  String decodedValue = value;
  if (!decodedValue.startsWith("{")) {
    String maybeJson = decodeBase64Payload(decodedValue);
    if (maybeJson.length() > 0) {
      decodedValue = maybeJson;
    }
  }

  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, decodedValue);
  if (err) {
    Serial.printf("❌ Provisioning JSON parse failed: %s\n", err.c_str());
    setLastError("invalid_json", String("Invalid provisioning payload: ") + err.c_str());
    return;
  }

  if (doc["type"].is<const char *>()) {
    handleProvisioningChunkEnvelope(doc.as<JsonObject>());
    return;
  }

  applyProvisioningPayload(decodedValue);
}

// ================= BLE Callbacks =================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
    Serial.println("📱 BLE connected");
  }

  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    Serial.println("📴 BLE disconnected");
    if (BLEDevice::getInitialized()) {
      delay(200);
      server->getAdvertising()->start();
      Serial.println("🔄 BLE advertising restarted");
    }
  }
};

class DeviceInfoCallbacks : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic *characteristic) override {
    updateDeviceInfoCharacteristic();
  }
};

class WriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String rawValue = characteristic->getValue();
    enqueueRawProvisioningPayload(rawValue);
  }
};

// ================= BLE Setup =================
void startBleProvisioning() {
  if (currentBleMode == BLE_MODE_PROVISIONING && BLEDevice::getInitialized()) {
    return;
  }

#if defined(CONFIG_IDF_TARGET_ESP32C3)
  // If the BLE stack is still allocated, just restart provisioning advertising.
  if (BLEDevice::getInitialized() && deviceInfoChar && writeChar && statusChar) {
    currentBleMode = BLE_MODE_PROVISIONING;
    updateDeviceInfoCharacteristic();
    BLEAdvertising *adv = BLEDevice::getAdvertising();
    adv->start();
    Serial.println("🚀 BLE provisioning advertising resumed safely on ESP32-C3");
    return;
  }
#endif

  if (BLEDevice::getInitialized()) {
    stopBle();
  }

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(BLE_MTU_SIZE);

  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *service = server->createService(SERVICE_UUID);

  deviceInfoChar = service->createCharacteristic(
    DEVICE_INFO_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  deviceInfoChar->addDescriptor(new BLE2902());
  deviceInfoChar->setCallbacks(new DeviceInfoCallbacks());

  writeChar = service->createCharacteristic(
    WRITE_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  writeChar->setCallbacks(new WriteCallbacks());

  statusChar = service->createCharacteristic(
    STATUS_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  statusChar->addDescriptor(new BLE2902());

  service->start();

  currentBleMode = BLE_MODE_PROVISIONING;
  updateDeviceInfoCharacteristic();

  Serial.println("STATUS [ready_for_provisioning] OK - BLE provisioning ready");

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  adv->start();

  Serial.println("🚀 BLE provisioning ready");
}

void startBackupBleMode() {
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  // Backup BLE service switching is intentionally disabled on ESP32-C3 to avoid heap instability.
  // The device will keep retrying WiFi instead.
  Serial.println("⚠️ Backup BLE mode skipped on ESP32-C3 for stability");
  return;
#endif

  if (currentBleMode == BLE_MODE_BACKUP && BLEDevice::getInitialized()) {
    return;
  }
  if (BLEDevice::getInitialized()) {
    stopBle();
  }

  BLEDevice::init(BACKUP_DEVICE_NAME);
  BLEDevice::setMTU(BLE_MTU_SIZE);

  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *service = server->createService(SENSOR_SERVICE_UUID);

  sensorDataChar = service->createCharacteristic(
    SENSOR_DATA_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  sensorDataChar->addDescriptor(new BLE2902());

  service->start();
  currentBleMode = BLE_MODE_BACKUP;

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SENSOR_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  adv->start();

  Serial.println("🆘 BLE backup mode ready");
}

// ================= Connectivity =================
bool connectToWiFi(bool forceReconnect = false) {
  const String targetSsid = hasPendingProvisioning ? pendingWifiSsid : wifiSsid;
  const String targetPassword = hasPendingProvisioning ? pendingWifiPassword : wifiPassword;

  if (targetSsid.isEmpty() || targetPassword.isEmpty()) {
    notifyStatus("ready_for_provisioning", false, "WiFi credentials not provisioned");
    return false;
  }

  if (WiFi.status() == WL_CONNECTED && !forceReconnect) {
    wifiWasConnectedOnce = true;
    requireReProvisioning = false;
    setLastError("", "");
    return true;
  }

  if (forceReconnect) {
    WiFi.disconnect(true, true);
    delay(200);
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(targetSsid.c_str(), targetPassword.c_str());

  Serial.printf("🔄 Connecting to WiFi SSID=%s\n", targetSsid.c_str());

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < WIFI_MAX_RETRIES) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiWasConnectedOnce = true;
    requireReProvisioning = false;
    setLastError("", "");

    if (hasPendingProvisioning) {
      wifiSsid = pendingWifiSsid;
      wifiPassword = pendingWifiPassword;
      provisionedDeviceId = pendingProvisionedDeviceId;
      pairingToken = pendingPairingToken;
      mqttHost = pendingMqttHost;
      mqttTopic = pendingMqttTopic;
      mqttPort = pendingMqttPort;
      provisionedUserId = pendingProvisionedUserId;
      saveConfig();
      hasPendingProvisioning = false;
      notifyStatus("credentials_saved", true, "Provisioning saved successfully");
    }

    if (
      currentBleMode == BLE_MODE_BACKUP ||
      (currentBleMode == BLE_MODE_PROVISIONING && shouldStopBleAfterWiFiConnect)
    ) {
      stopBle();
      shouldStopBleAfterWiFiConnect = false;
    }

    Serial.printf("✅ WiFi connected. IP=%s\n", WiFi.localIP().toString().c_str());
    notifyStatus("wifi_connected", true, WiFi.localIP().toString());
    updateDeviceInfoCharacteristic();
    return true;
  }

  Serial.println("❌ WiFi connection failed");
  notifyStatus(
    "wifi_failed",
    false,
    "Could not connect to Wi-Fi. Check SSID/password and make sure the network is 2.4GHz."
  );
  updateDeviceInfoCharacteristic();
  return false;
}

bool connectToMqtt() {
  if (mqttHost.isEmpty() || mqttTopic.isEmpty()) {
    notifyStatus("mqtt_failed", false, "MQTT config missing");
    return false;
  }

  if (mqttClient.connected()) {
    return true;
  }

  // Make sure the MQTT internal packet buffer is large enough before every connection attempt.
  if (!mqttClient.setBufferSize(MQTT_PACKET_BUFFER_SIZE)) {
    Serial.println("❌ MQTT buffer allocation failed");
    notifyStatus("mqtt_failed", false, "MQTT buffer allocation failed");
    return false;
  }

  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(10);
  mqttClient.setServer(mqttHost.c_str(), mqttPort);

  String clientId = String("fall-bracelet-") + provisionedDeviceId;
  Serial.printf("🔄 Connecting to MQTT %s:%u topic=%s\n", mqttHost.c_str(), mqttPort, mqttTopic.c_str());

  if (mqttClient.connect(clientId.c_str())) {
    Serial.println("✅ MQTT connected");
    notifyStatus("mqtt_connected", true, "MQTT connected");
    updateDeviceInfoCharacteristic();
    return true;
  }

  Serial.printf("❌ MQTT connect failed rc=%d\n", mqttClient.state());
  notifyStatus("mqtt_failed", false, String("MQTT rc=") + mqttClient.state());
  updateDeviceInfoCharacteristic();
  return false;
}

void publishTelemetry() {
  if (!mqttClient.connected()) return;

  if (provisionedDeviceId.isEmpty() || provisionedUserId <= 0) {
    notifyStatus("mqtt_failed", false, "Device provisioning incomplete");
    return;
  }

  if (!mqttClient.setBufferSize(MQTT_PACKET_BUFFER_SIZE)) {
    Serial.println("❌ MQTT buffer allocation failed before publish");
    notifyStatus("mqtt_failed", false, "MQTT buffer allocation failed before publish");
    return;
  }

  String payload;

  if (!buildTelemetryBatchJson(payload)) {
    Serial.println("❌ MQTT telemetry batch build failed");
    notifyStatus("mqtt_failed", false, "Telemetry JSON build failed");
    return;
  }

  size_t payloadLen = payload.length();
  size_t estimatedPacketSize = payloadLen + mqttTopic.length() + 16;

  Serial.print("📏 MQTT payload length: ");
  Serial.println(payloadLen);

  Serial.print("📦 MQTT estimated packet size: ");
  Serial.println(estimatedPacketSize);

  Serial.print("📊 MQTT batch samples: ");
  Serial.println(TELEMETRY_BATCH_SAMPLE_COUNT);

  Serial.print("📤 MQTT topic: ");
  Serial.println(mqttTopic);

  if (estimatedPacketSize >= MQTT_PACKET_BUFFER_SIZE) {
    Serial.println("❌ MQTT packet too large for PubSubClient buffer");
    notifyStatus("mqtt_failed", false, "MQTT packet too large for buffer");
    return;
  }

  bool published = mqttClient.publish(mqttTopic.c_str(), payload.c_str());

  if (published) {
    if (lastBuiltBatchIncludedVitals) {
      lastVitalsPublishMs = millis();
    }
    Serial.println("✅ MQTT published successfully");
    notifyStatus("streaming", true, "Telemetry published");
  } else {
    Serial.println("❌ MQTT publish failed");

    Serial.print("📡 MQTT connected state: ");
    Serial.println(mqttClient.connected());

    Serial.print("📡 MQTT client state: ");
    Serial.println(mqttClient.state());

    notifyStatus("mqtt_failed", false, "MQTT publish failed");
  }

  updateDeviceInfoCharacteristic();
}

// ================= Arduino Setup/Loop =================
void setup() {
  Serial.begin(115200);
  Serial.println("\n===== FALL DETECTION BRACELET START =====");
  Serial.print("Board profile: ");
  Serial.println(BOARD_NAME);
  Serial.print("I2C SDA: GPIO");
  Serial.println(I2C_SDA_PIN);
  Serial.print("I2C SCL: GPIO");
  Serial.println(I2C_SCL_PIN);

  disableClassicBluetooth();
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  preferences.begin(PREF_NAMESPACE, false);

  bool mqttBufferOk = mqttClient.setBufferSize(MQTT_PACKET_BUFFER_SIZE);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(10);

  Serial.print("📦 MQTT buffer size request: ");
  Serial.println(MQTT_PACKET_BUFFER_SIZE);
  Serial.print("📦 MQTT buffer allocation: ");
  Serial.println(mqttBufferOk ? "OK" : "FAILED");

  loadStoredConfig();
  resetProvisioningTransfer();

  if (!hasStoredConfig()) {
    Serial.println("ℹ️ No valid WiFi/user config. Opening BLE provisioning.");
    requireReProvisioning = true;
    startBleProvisioning();
  } else {
    Serial.println("📦 Found stored provisioning config");
    shouldApplyProvisioning = true;
  }
}

void loop() {
  // IMPORTANT FIX:
  // Process all queued BLE writes first, then calculate millis().
  // In the previous version, now was captured before processing the first chunk.
  // After the first chunk updated provisioningChunkStartedAtMs, the old now value
  // caused unsigned underflow and triggered a false timeout immediately.
  int processedProvisioningItems = 0;
  while (hasQueuedProvisioningPayload && processedProvisioningItems < RAW_PROVISIONING_QUEUE_SIZE) {
    processProvisioningPayloadFromLoop();
    processedProvisioningItems++;
    delay(2);
  }

  unsigned long now = millis();

  if (
    provisioningChunkStartedAtMs > 0 &&
    (now - provisioningChunkStartedAtMs) >= PROVISIONING_CHUNK_TIMEOUT_MS
  ) {
    notifyStatus("invalid_data", false, "Provisioning chunks timed out");
    resetProvisioningTransfer();
  }

  if (shouldApplyProvisioning) {
    shouldApplyProvisioning = false;

    delay(1200);

    if (!connectToWiFi(true)) {
      Serial.println("🔁 WiFi failed after retries. Opening BLE provisioning for new data.");
      requireReProvisioning = true;
      clearPendingProvisioningState();
      shouldResumeProvisioningBle = true;
      delay(100);
      return;
    }

    requireReProvisioning = false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    const bool validConfig = hasStoredConfig();

    if (requireReProvisioning || !validConfig) {
      if (shouldResumeProvisioningBle) {
        shouldResumeProvisioningBle = false;
        updateDeviceInfoCharacteristic();
        notifyStatus("ready_for_provisioning", true, "BLE provisioning ready");
      }

      if (currentBleMode != BLE_MODE_PROVISIONING) {
        Serial.println("🔁 Waiting for new provisioning data over BLE...");
        startBleProvisioning();
      }

      delay(100);
      return;
    }

    if (wifiWasConnectedOnce) {
      if (currentBleMode != BLE_MODE_BACKUP) {
        Serial.println("⚠️ WiFi lost after being connected. Opening BLE backup mode.");
        startBackupBleMode();
      }

      if (now - lastWifiAttemptMs >= WIFI_RETRY_INTERVAL_MS) {
        lastWifiAttemptMs = now;
        connectToWiFi(false);
      }

      if (
        currentBleMode == BLE_MODE_BACKUP &&
        now - lastBackupBlePublishMs >= BACKUP_BLE_PUBLISH_INTERVAL_MS
      ) {
        lastBackupBlePublishMs = now;
        notifyBackupTelemetry();
      }

      delay(100);
      return;
    }

    Serial.println("🔁 Stored WiFi credentials failed. Opening BLE provisioning for correction.");
    requireReProvisioning = true;
    setLastError(
      "wifi_failed",
      "Stored Wi-Fi credentials failed. Please enter Wi-Fi name/password again."
    );
    startBleProvisioning();

    delay(100);
    return;
  }

  wifiWasConnectedOnce = true;
  requireReProvisioning = false;
  setLastError("", "");

  if (currentBleMode == BLE_MODE_BACKUP || currentBleMode == BLE_MODE_PROVISIONING) {
    stopBle();
    shouldStopBleAfterWiFiConnect = false;
  }

  if (!mqttClient.connected()) {
    if (now - lastMqttAttemptMs >= MQTT_RETRY_INTERVAL_MS) {
      lastMqttAttemptMs = now;
      connectToMqtt();
    }

    delay(100);
    return;
  }

  mqttClient.loop();

  if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = now;
    publishTelemetry();
  }

  delay(50);
}
