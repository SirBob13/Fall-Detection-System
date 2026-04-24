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
#include <math.h>

// ================= BLE UUIDs =================
static const char *SERVICE_UUID = "7A100001-8C6A-4F6D-A55B-000000000001";
static const char *DEVICE_INFO_UUID = "7A100002-8C6A-4F6D-A55B-000000000001";
static const char *WRITE_UUID = "7A100003-8C6A-4F6D-A55B-000000000001";
static const char *STATUS_UUID = "7A100004-8C6A-4F6D-A55B-000000000001";

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
static const char *DEVICE_TYPE = "esp32-bracelet";
static const char *FIRMWARE_VERSION = "2.0.0";

// ================= Timing =================
static const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
static const unsigned long PUBLISH_INTERVAL_MS = 5000;

Preferences preferences;
BLECharacteristic *deviceInfoChar = nullptr;
BLECharacteristic *writeChar = nullptr;
BLECharacteristic *statusChar = nullptr;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

bool deviceConnected = false;
bool shouldApplyProvisioning = false;

String wifiSsid = "";
String wifiPassword = "";
String provisionedDeviceId = "";
String pairingToken = "";
String mqttHost = "";
String mqttTopic = "";
uint16_t mqttPort = 1883;
int provisionedUserId = 0;

unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
unsigned long lastPublishMs = 0;

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
  if (mqttClient.connected()) return "streaming";
  if (WiFi.status() == WL_CONNECTED) return "wifi_connected";
  if (wifiSsid.length() > 0) return "provisioned";
  return "ready_for_provisioning";
}

void notifyStatus(const char *stage, bool success, const String &message) {
  if (!statusChar) return;

  StaticJsonDocument<256> doc;
  doc["device_id"] = provisionedDeviceId.length() ? provisionedDeviceId : fallbackDeviceId();
  doc["stage"] = stage;
  doc["success"] = success;
  doc["message"] = message;

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

  char buffer[256];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));
  deviceInfoChar->setValue((uint8_t *)buffer, len);
}

void stopBleProvisioning() {
  if (!BLEDevice::getInitialized()) return;
  BLEDevice::deinit(true);
  Serial.println("✅ BLE stopped after provisioning");
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

// ================= Connectivity =================
bool connectToWiFi(bool forceReconnect = false) {
  if (wifiSsid.isEmpty() || wifiPassword.isEmpty()) {
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
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  Serial.printf("🔄 Connecting to WiFi SSID=%s\n", wifiSsid.c_str());

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
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
      notifyStatus("provisioning_received", false, "Empty provisioning payload");
      return;
    }

    String value = String(rawValue.c_str());
    Serial.printf("📥 Provisioning payload bytes=%u\n", value.length());

    StaticJsonDocument<768> doc;
    DeserializationError err = deserializeJson(doc, value);
    if (err) {
      Serial.printf("❌ Provisioning JSON parse failed: %s\n", err.c_str());
      notifyStatus("provisioning_received", false, String("Invalid JSON: ") + err.c_str());
      return;
    }

    JsonObject wifi = doc["wifi"].is<JsonObject>() ? doc["wifi"].as<JsonObject>() : doc["w"].as<JsonObject>();
    JsonObject mqtt = doc["mqtt"].is<JsonObject>() ? doc["mqtt"].as<JsonObject>() : doc["m"].as<JsonObject>();

    wifiSsid = wifi["ssid"] | wifi["s"] | "";
    wifiPassword = wifi["password"] | wifi["p"] | "";
    provisionedDeviceId = doc["device_id"] | doc["d"] | fallbackDeviceId();
    pairingToken = doc["pairing_token"] | doc["pt"] | "";
    mqttHost = mqtt["host"] | mqtt["h"] | "";
    mqttTopic = mqtt["topic"] | mqtt["t"] | "fall-detection/device-data";
    mqttPort = mqtt["port"] | mqtt["o"] | 1883;
    provisionedUserId = doc["user_id"] | doc["u"] | 0;

    if (wifiSsid.isEmpty() || wifiPassword.isEmpty()) {
      notifyStatus("provisioning_received", false, "WiFi SSID/password missing");
      return;
    }

    if (provisionedDeviceId.isEmpty() || provisionedUserId <= 0) {
      notifyStatus("provisioning_received", false, "device_id or user_id missing");
      return;
    }

    saveConfig();
    updateDeviceInfoCharacteristic();
    notifyStatus("provisioning_received", true, "Provisioning saved");
    shouldApplyProvisioning = true;
  }
};

// ================= BLE Setup =================
void startBleProvisioning() {
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

  Serial.println("🚀 BLE provisioning ready");
}

// ================= Arduino Setup/Loop =================
void setup() {
  Serial.begin(115200);
  Serial.println("\n===== FALL DETECTION BRACELET START =====");

  disableClassicBluetooth();
  Wire.begin(21, 22);
  preferences.begin(PREF_NAMESPACE, false);
  loadStoredConfig();

  startBleProvisioning();

  if (!wifiSsid.isEmpty()) {
    Serial.println("📦 Found stored provisioning config");
    shouldApplyProvisioning = true;
  }
}

void loop() {
  unsigned long now = millis();

  if (shouldApplyProvisioning) {
    shouldApplyProvisioning = false;
    stopBleProvisioning();
    connectToWiFi(true);
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttemptMs >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiAttemptMs = now;
      connectToWiFi(false);
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
