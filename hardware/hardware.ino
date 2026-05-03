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
static const char *DEVICE_TYPE = "esp32-bracelet";
static const char *FIRMWARE_VERSION = "2.0.0";

// ================= Timing =================
static const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
static const unsigned long PUBLISH_INTERVAL_MS = 5000;
static const unsigned long BACKUP_BLE_PUBLISH_INTERVAL_MS = 2000;
static const unsigned long PROVISIONING_CHUNK_TIMEOUT_MS = 15000;
static const size_t PROVISIONING_CHUNK_BUFFER_LIMIT = 2048;

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
String provisioningChunkBuffer = "";
int provisioningChunkExpectedTotal = 0;
int provisioningChunkNextIndex = 0;

unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
unsigned long lastPublishMs = 0;
unsigned long lastBackupBlePublishMs = 0;
unsigned long provisioningChunkStartedAtMs = 0;

enum BleMode {
  BLE_MODE_OFF,
  BLE_MODE_PROVISIONING,
  BLE_MODE_BACKUP,
};

BleMode currentBleMode = BLE_MODE_OFF;

// ================= Utilities =================
void disableClassicBluetooth() {
  esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
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

String decodeBase64Payload(const String &encoded) {
  if (encoded.length() == 0) return "";

  size_t outputLen = 0;
  size_t bufferSize = encoded.length() + 8;
  unsigned char *buffer = (unsigned char *)malloc(bufferSize);

  if (!buffer) {
    return "";
  }

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
  provisioningChunkBuffer = "";
  provisioningChunkExpectedTotal = 0;
  provisioningChunkNextIndex = 0;
  provisioningChunkStartedAtMs = 0;
}

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

  JsonObject wifi = doc["wifi"].is<JsonObject>() ? doc["wifi"].as<JsonObject>() : doc["w"].as<JsonObject>();
  JsonObject mqtt = doc["mqtt"].is<JsonObject>() ? doc["mqtt"].as<JsonObject>() : doc["m"].as<JsonObject>();

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
  updateDeviceInfoCharacteristic();
  notifyStatus("provisioning_received", true, "Provisioning data received, connecting to WiFi");
  shouldApplyProvisioning = true;
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

    if (index == 0 || provisioningTransferId != transferId) {
      resetProvisioningTransfer();
      provisioningTransferId = transferId;
      provisioningChunkExpectedTotal = total;
      provisioningChunkStartedAtMs = millis();
    }

    if (provisioningChunkExpectedTotal != total) {
      notifyStatus("invalid_data", false, "Chunk total mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (index != provisioningChunkNextIndex) {
      notifyStatus("invalid_data", false, "Chunk order mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (provisioningChunkBuffer.length() + data.length() > PROVISIONING_CHUNK_BUFFER_LIMIT) {
      notifyStatus("invalid_data", false, "Provisioning payload too large");
      resetProvisioningTransfer();
      return false;
    }

    provisioningChunkBuffer += data;
    provisioningChunkNextIndex++;
    provisioningChunkStartedAtMs = millis();

    Serial.printf("📦 Provisioning chunk %d/%d received\n", index + 1, total);
    return true;
  }

  if (type == "commit") {
    if (transferId.isEmpty() || provisioningTransferId != transferId) {
      notifyStatus("invalid_data", false, "Commit transfer id mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (provisioningChunkExpectedTotal <= 0 || provisioningChunkNextIndex != provisioningChunkExpectedTotal) {
      notifyStatus("invalid_data", false, "Incomplete chunked provisioning payload");
      resetProvisioningTransfer();
      return false;
    }

    String decodedPayload = decodeBase64Payload(provisioningChunkBuffer);
    resetProvisioningTransfer();

    if (decodedPayload.isEmpty()) {
      notifyStatus("invalid_data", false, "Failed to decode chunked provisioning payload");
      return false;
    }

    return applyProvisioningPayload(decodedPayload);
  }

  return false;
}

void notifyStatus(const char *stage, bool success, const String &message, int code = 0) {
  if (!statusChar) return;

  StaticJsonDocument<256> doc;

  if (!success) {
    setLastError(stage, message);
  } else if (String(stage) == "streaming" || String(stage) == "mqtt_connected" || String(stage) == "wifi_connected") {
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

  char buffer[256];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));
  statusChar->setValue((uint8_t *)buffer, len);
  statusChar->notify();

  Serial.printf("STATUS [%s] %s - %s\n", stage, success ? "OK" : "FAIL", message.c_str());
}

void updateDeviceInfoCharacteristic() {
  if (!deviceInfoChar) return;

  StaticJsonDocument<256> doc;
  doc["device_id"] = provisionedDeviceId.length() ? provisionedDeviceId : fallbackDeviceId();
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
  BLEDevice::deinit(true);
  deviceInfoChar = nullptr;
  writeChar = nullptr;
  statusChar = nullptr;
  sensorDataChar = nullptr;
  deviceConnected = false;
  currentBleMode = BLE_MODE_OFF;
  Serial.println("✅ BLE stopped");
}

// ================= Mock Sensor Data =================
// Replace these helpers with actual MPU6050 / MAX30102 readings when the hardware integration is ready.
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

void buildTelemetryJson(char *output, size_t outputSize) {
  unsigned long now = millis();

  float accX = wave(now, 700.0f, 0.18f, 0.02f);
  float accY = wave(now + 200, 900.0f, 0.12f, -0.01f);
  float accZ = wave(now + 500, 650.0f, 0.25f, 9.72f);

  float gyroX = wave(now, 300.0f, 8.0f, 0.8f);
  float gyroY = wave(now + 300, 400.0f, 7.0f, -0.5f);
  float gyroZ = wave(now + 500, 500.0f, 6.0f, 0.2f);

  float heartRate = wave(now, 1400.0f, 6.0f, 78.0f);
  float spo2 = wave(now, 2500.0f, 1.0f, 97.5f);
  float bodyTemp = wave(now, 3200.0f, 0.2f, 36.7f);
  float batteryLevel = 84.0f;

  StaticJsonDocument<512> doc;
  doc["device_id"] = provisionedDeviceId;
  doc["user_id"] = provisionedUserId;
  doc["pairing_token"] = pairingToken;
  doc["battery_level"] = batteryLevel;
  doc["firmware_version"] = FIRMWARE_VERSION;

  JsonObject motion = doc.createNestedObject("motion");
  motion["acc_x"] = accX;
  motion["acc_y"] = accY;
  motion["acc_z"] = accZ;
  motion["gyro_x"] = gyroX;
  motion["gyro_y"] = gyroY;
  motion["gyro_z"] = gyroZ;
  motion["temperature"] = bodyTemp;

  const bool hasValidVitals =
    isValidHeartRate(heartRate) ||
    isValidOxygenSaturation(spo2) ||
    isValidBodyTemperature(bodyTemp);

  if (hasValidVitals) {
    JsonObject vitals = doc.createNestedObject("vitals");
    if (isValidHeartRate(heartRate)) {
      vitals["heart_rate"] = heartRate;
    }
    if (isValidOxygenSaturation(spo2)) {
      vitals["oxygen_saturation"] = spo2;
    }
    if (isValidBodyTemperature(bodyTemp)) {
      vitals["body_temperature"] = bodyTemp;
    }
  }

  serializeJson(doc, output, outputSize);
}

void notifyBackupTelemetry() {
  if (!sensorDataChar || !BLEDevice::getInitialized()) return;

  char payload[512];
  buildTelemetryJson(payload, sizeof(payload));
  sensorDataChar->setValue((uint8_t *)payload, strlen(payload));
  sensorDataChar->notify();
  Serial.printf("📡 BLE backup telemetry: %s\n", payload);
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
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
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

    if (currentBleMode == BLE_MODE_BACKUP) {
      stopBle();
    }
    Serial.printf("✅ WiFi connected. IP=%s\n", WiFi.localIP().toString().c_str());
    notifyStatus("wifi_connected", true, WiFi.localIP().toString());
    updateDeviceInfoCharacteristic();
    return true;
  }

  Serial.println("❌ WiFi connection failed");
  notifyStatus("wifi_failed", false, "Failed to connect to WiFi");
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

  char payload[512];
  buildTelemetryJson(payload, sizeof(payload));

  bool published = mqttClient.publish(mqttTopic.c_str(), payload);
  if (published) {
    Serial.printf("📤 MQTT published: %s\n", payload);
    notifyStatus("streaming", true, "Telemetry published");
  } else {
    Serial.println("❌ MQTT publish failed");
    notifyStatus("mqtt_failed", false, "MQTT publish failed");
  }

  updateDeviceInfoCharacteristic();
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
    std::string rawValue = characteristic->getValue();
    if (rawValue.empty()) {
      notifyStatus("invalid_data", false, "Empty provisioning payload");
      return;
    }

    String encodedValue = String(rawValue.c_str());
    String value = encodedValue;

    if (!value.startsWith("{")) {
      String decodedValue = decodeBase64Payload(encodedValue);
      if (decodedValue.length() > 0) {
        value = decodedValue;
      }
    }

    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, value);
    if (err) {
      Serial.printf("❌ Provisioning JSON parse failed: %s\n", err.c_str());
      notifyStatus("invalid_json", false, String("Invalid provisioning payload: ") + err.c_str());
      return;
    }

    if (doc["type"].is<const char*>()) {
      handleProvisioningChunkEnvelope(doc.as<JsonObject>());
      return;
    }

    applyProvisioningPayload(value);
  }
};

// ================= BLE Setup =================
void startBleProvisioning() {
  if (currentBleMode == BLE_MODE_PROVISIONING && BLEDevice::getInitialized()) {
    return;
  }
  if (BLEDevice::getInitialized()) {
    stopBle();
  }

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(517);

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

  updateDeviceInfoCharacteristic();
  notifyStatus("ready_for_provisioning", true, "BLE provisioning ready");

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  adv->start();

  currentBleMode = BLE_MODE_PROVISIONING;
  Serial.println("🚀 BLE provisioning ready");
}

void startBackupBleMode() {
  if (currentBleMode == BLE_MODE_BACKUP && BLEDevice::getInitialized()) {
    return;
  }
  if (BLEDevice::getInitialized()) {
    stopBle();
  }

  BLEDevice::init(BACKUP_DEVICE_NAME);
  BLEDevice::setMTU(517);

  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *service = server->createService(SENSOR_SERVICE_UUID);

  sensorDataChar = service->createCharacteristic(
    SENSOR_DATA_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  sensorDataChar->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SENSOR_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  adv->start();

  currentBleMode = BLE_MODE_BACKUP;
  Serial.println("🆘 BLE backup mode ready");
}

// ================= Arduino Setup/Loop =================
void setup() {
  Serial.begin(115200);
  Serial.println("\n===== FALL DETECTION BRACELET START =====");

  disableClassicBluetooth();
  Wire.begin(21, 22);
  preferences.begin(PREF_NAMESPACE, false);
  loadStoredConfig();

  if (wifiSsid.isEmpty() || provisionedUserId <= 0) {
    startBleProvisioning();
  } else {
    Serial.println("📦 Found stored provisioning config");
    shouldApplyProvisioning = true;
  }
}

void loop() {
  unsigned long now = millis();

  if (
    provisioningChunkStartedAtMs > 0 &&
    provisioningChunkExpectedTotal > 0 &&
    now - provisioningChunkStartedAtMs >= PROVISIONING_CHUNK_TIMEOUT_MS
  ) {
    notifyStatus("invalid_data", false, "Provisioning chunks timed out");
    resetProvisioningTransfer();
  }

  if (shouldApplyProvisioning) {
    shouldApplyProvisioning = false;
    stopBle();
    if (!connectToWiFi(true)) {
      Serial.println("🔁 WiFi provisioning failed, restarting BLE provisioning");
      startBleProvisioning();
      delay(100);
      return;
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    const hasStoredConfig = !wifiSsid.isEmpty() && provisionedUserId > 0;
    if (hasStoredConfig && currentBleMode != BLE_MODE_BACKUP) {
      startBackupBleMode();
    } else if (!hasStoredConfig && currentBleMode != BLE_MODE_PROVISIONING) {
      startBleProvisioning();
    }

    if (now - lastWifiAttemptMs >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiAttemptMs = now;
      connectToWiFi(false);
    }

    if (currentBleMode == BLE_MODE_BACKUP && now - lastBackupBlePublishMs >= BACKUP_BLE_PUBLISH_INTERVAL_MS) {
      lastBackupBlePublishMs = now;
      notifyBackupTelemetry();
    }

    delay(100);
    return;
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
