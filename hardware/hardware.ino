#include <WiFi.h>
#include <Wire.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <MAX30105.h>
#include "heartRate.h"

// =========================
// Device identity
// =========================
const char *DEFAULT_DEVICE_ID = "BRACELET-DEMO-001";
const char *FIRMWARE_VERSION = "1.0.0";

// =========================
// I2C pins for ESP32
// =========================
const int SDA_PIN = 21;
const int SCL_PIN = 22;

// =========================
// BLE Provisioning UUIDs
// =========================
static const char *PROVISIONING_SERVICE_UUID = "7A100001-8C6A-4F6D-A55B-000000000001";
static const char *DEVICE_INFO_CHARACTERISTIC_UUID = "7A100002-8C6A-4F6D-A55B-000000000001";
static const char *PROVISIONING_CHARACTERISTIC_UUID = "7A100003-8C6A-4F6D-A55B-000000000001";
static const char *STATUS_CHARACTERISTIC_UUID = "7A100004-8C6A-4F6D-A55B-000000000001";

// =========================
// Runtime constants
// =========================
const unsigned long SEND_INTERVAL_MS = 2000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;
const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
const unsigned long FINGER_ON_SENSOR_THRESHOLD = 50000;
const byte RATE_SIZE = 4;

Preferences preferences;
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
Adafruit_MPU6050 imu;
MAX30105 max30102;

BLECharacteristic *deviceInfoCharacteristic = nullptr;
BLECharacteristic *provisioningCharacteristic = nullptr;
BLECharacteristic *statusCharacteristic = nullptr;

String deviceId = DEFAULT_DEVICE_ID;
String pairingToken;
String wifiSsid;
String wifiPassword;
String mqttHost = "broker.hivemq.com";
int mqttPort = 1883;
String mqttTopic = "fall-detection/device-data";
String apiBaseUrl = "http://138.2.183.9:8000/api/v1";

bool wifiConnected = false;
bool mqttConnected = false;
bool max301Ready = false;
unsigned long lastSendAt = 0;
unsigned long lastMqttAttemptAt = 0;

byte rates[RATE_SIZE];
byte rateSpot = 0;
byte validRateCount = 0;
long lastBeat = 0;
float beatsPerMinute = 0.0;
int beatAvg = 0;
long lastIrValue = 0;

String buildDeviceInfoJson() {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["device_type"] = "fall_bracelet";
  doc["wifi_connected"] = wifiConnected;
  doc["backend_connected"] = mqttConnected;
  doc["battery_level"] = 100;
  doc["status"] = wifiSsid.isEmpty() ? "ready_for_provisioning" : (mqttConnected ? "streaming" : (wifiConnected ? "wifi_connected" : "configured"));

  String output;
  serializeJson(doc, output);
  return output;
}

void refreshDeviceInfoCharacteristic() {
  if (deviceInfoCharacteristic != nullptr) {
    const String payload = buildDeviceInfoJson();
    deviceInfoCharacteristic->setValue(payload.c_str());
  }
}

void notifyStatus(const char *stage, bool success, const char *message) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["stage"] = stage;
  doc["success"] = success;
  doc["message"] = message;

  String payload;
  serializeJson(doc, payload);
  Serial.println(payload);

  if (statusCharacteristic != nullptr) {
    statusCharacteristic->setValue(payload.c_str());
    statusCharacteristic->notify();
  }

  refreshDeviceInfoCharacteristic();
}

void loadSavedConfig() {
  preferences.begin("provisioning", false);
  deviceId = preferences.getString("device_id", DEFAULT_DEVICE_ID);
  pairingToken = preferences.getString("pairing_token", "");
  wifiSsid = preferences.getString("wifi_ssid", "");
  wifiPassword = preferences.getString("wifi_pass", "");
  mqttHost = preferences.getString("mqtt_host", mqttHost);
  mqttPort = preferences.getInt("mqtt_port", mqttPort);
  mqttTopic = preferences.getString("mqtt_topic", mqttTopic);
  apiBaseUrl = preferences.getString("api_base_url", apiBaseUrl);
}

void persistProvisioning() {
  preferences.putString("device_id", deviceId);
  preferences.putString("pairing_token", pairingToken);
  preferences.putString("wifi_ssid", wifiSsid);
  preferences.putString("wifi_pass", wifiPassword);
  preferences.putString("mqtt_host", mqttHost);
  preferences.putInt("mqtt_port", mqttPort);
  preferences.putString("mqtt_topic", mqttTopic);
  preferences.putString("api_base_url", apiBaseUrl);
}

bool connectToWiFi() {
  if (wifiSsid.isEmpty()) {
    wifiConnected = false;
    return false;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    return true;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  Serial.printf("Connecting to WiFi SSID: %s\n", wifiSsid.c_str());

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    notifyStatus("wifi_connected", true, "Connected to WiFi");
  } else {
    notifyStatus("wifi_failed", false, "Failed to connect to WiFi");
  }

  return wifiConnected;
}

bool connectToMqtt() {
  if (!wifiConnected || mqttHost.isEmpty()) {
    mqttConnected = false;
    return false;
  }

  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setBufferSize(1024);

  String clientId = "esp32-" + deviceId;
  mqttConnected = mqttClient.connect(clientId.c_str());

  if (mqttConnected) {
    notifyStatus("mqtt_connected", true, "Connected to MQTT broker");
  } else {
    notifyStatus("mqtt_failed", false, "Failed to connect to MQTT broker");
  }

  return mqttConnected;
}

void setupMpu6050() {
  Serial.println("Initializing MPU6050...");

  if (!imu.begin()) {
    Serial.println("MPU6050 connection failed!");
    while (true) {
      delay(1000);
    }
  }

  imu.setAccelerometerRange(MPU6050_RANGE_8_G);
  imu.setGyroRange(MPU6050_RANGE_500_DEG);
  imu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  Serial.println("MPU6050 connected successfully!");
}

void setupMax30102() {
  Serial.println("Initializing MAX30102...");

  if (!max30102.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 connection failed! Vitals will be skipped.");
    max301Ready = false;
    return;
  }

  max30102.setup();
  max30102.setPulseAmplitudeRed(0x1F);
  max30102.setPulseAmplitudeIR(0x1F);
  max30102.setPulseAmplitudeGreen(0);
  max301Ready = true;
  Serial.println("MAX30102 connected successfully!");
}

void updateHeartRate() {
  if (!max301Ready) {
    return;
  }

  long irValue = max30102.getIR();
  lastIrValue = irValue;

  if (irValue < FINGER_ON_SENSOR_THRESHOLD) {
    beatsPerMinute = 0.0;
    beatAvg = 0;
    validRateCount = 0;
    return;
  }

  if (checkForBeat(irValue)) {
    long delta = millis() - lastBeat;
    lastBeat = millis();

    if (delta <= 0) {
      return;
    }

    float bpm = 60.0 / (delta / 1000.0);
    if (bpm > 20 && bpm < 255) {
      beatsPerMinute = bpm;
      rates[rateSpot] = (byte)bpm;
      rateSpot = (rateSpot + 1) % RATE_SIZE;

      if (validRateCount < RATE_SIZE) {
        validRateCount++;
      }

      int sum = 0;
      for (byte i = 0; i < validRateCount; i++) {
        sum += rates[i];
      }
      beatAvg = sum / validRateCount;
    }
  }
}

String buildTelemetryPayload(float ax, float ay, float az, float gx, float gy, float gz) {
  StaticJsonDocument<768> doc;
  doc["device_id"] = deviceId;
  if (!pairingToken.isEmpty()) {
    doc["pairing_token"] = pairingToken;
  }
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["battery_level"] = 100;

  JsonObject motion = doc.createNestedObject("motion");
  motion["acc_x"] = ax;
  motion["acc_y"] = ay;
  motion["acc_z"] = az;
  motion["gyro_x"] = gx;
  motion["gyro_y"] = gy;
  motion["gyro_z"] = gz;

  if (max301Ready && validRateCount > 0 && beatAvg > 0) {
    JsonObject vitals = doc.createNestedObject("vitals");
    vitals["heart_rate"] = beatAvg;
  }

  String output;
  serializeJson(doc, output);
  return output;
}

void publishTelemetry(const String &payload) {
  if (!mqttConnected) {
    return;
  }

  bool published = mqttClient.publish(mqttTopic.c_str(), payload.c_str());
  if (published) {
    notifyStatus("streaming", true, "Publishing telemetry");
  } else {
    notifyStatus("mqtt_publish_failed", false, "Failed to publish telemetry");
  }
}

class DeviceInfoCallbacks : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic *characteristic) override {
    const String info = buildDeviceInfoJson();
    characteristic->setValue(info.c_str());
  }
};

class ProvisioningCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    std::string rawValue = characteristic->getValue();
    if (rawValue.empty()) {
      return;
    }

    StaticJsonDocument<768> doc;
    DeserializationError error = deserializeJson(doc, rawValue.c_str());
    if (error) {
      notifyStatus("provisioning_received", false, "Invalid provisioning JSON");
      return;
    }

    deviceId = doc["device_id"] | deviceId;
    pairingToken = doc["pairing_token"] | pairingToken;
    wifiSsid = doc["wifi"]["ssid"] | wifiSsid;
    wifiPassword = doc["wifi"]["password"] | wifiPassword;
    mqttHost = doc["mqtt"]["host"] | mqttHost;
    mqttPort = doc["mqtt"]["port"] | mqttPort;
    mqttTopic = doc["mqtt"]["topic"] | mqttTopic;
    apiBaseUrl = doc["api"]["base_url"] | apiBaseUrl;

    persistProvisioning();
    notifyStatus("provisioning_received", true, "Provisioning payload stored");

    if (connectToWiFi()) {
      connectToMqtt();
    }
  }
};

void startBleProvisioningServer() {
  BLEDevice::init("FallDetectionBracelet");
  BLEServer *server = BLEDevice::createServer();
  BLEService *service = server->createService(PROVISIONING_SERVICE_UUID);

  deviceInfoCharacteristic = service->createCharacteristic(
      DEVICE_INFO_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ);
  deviceInfoCharacteristic->setCallbacks(new DeviceInfoCallbacks());
  deviceInfoCharacteristic->setValue(buildDeviceInfoJson().c_str());

  provisioningCharacteristic = service->createCharacteristic(
      PROVISIONING_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_WRITE);
  provisioningCharacteristic->setCallbacks(new ProvisioningCallbacks());

  statusCharacteristic = service->createCharacteristic(
      STATUS_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  statusCharacteristic->addDescriptor(new BLE2902());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(PROVISIONING_SERVICE_UUID);
  advertising->start();
  Serial.println("BLE provisioning server started");
}

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  loadSavedConfig();
  setupMpu6050();
  setupMax30102();
  startBleProvisioningServer();

  if (!wifiSsid.isEmpty()) {
    connectToWiFi();
    connectToMqtt();
  }
}

void loop() {
  updateHeartRate();

  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    if (!wifiSsid.isEmpty()) {
      connectToWiFi();
    }
  } else {
    wifiConnected = true;
  }

  if (wifiConnected && !mqttClient.connected() && millis() - lastMqttAttemptAt >= MQTT_RETRY_INTERVAL_MS) {
    lastMqttAttemptAt = millis();
    connectToMqtt();
  }

  mqttConnected = mqttClient.connected();
  if (mqttConnected) {
    mqttClient.loop();
  }

  if (millis() - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = millis();

    sensors_event_t accel;
    sensors_event_t gyro;
    sensors_event_t temp;
    imu.getEvent(&accel, &gyro, &temp);

    float ax = accel.acceleration.x / 9.80665;
    float ay = accel.acceleration.y / 9.80665;
    float az = accel.acceleration.z / 9.80665;
    float gx = gyro.gyro.x * 57.2958;
    float gy = gyro.gyro.y * 57.2958;
    float gz = gyro.gyro.z * 57.2958;

    String payload = buildTelemetryPayload(ax, ay, az, gx, gy, gz);

    Serial.println("=== Sensor Data ===");
    Serial.print("Accel (g) -> X: ");
    Serial.print(ax, 3);
    Serial.print(" Y: ");
    Serial.print(ay, 3);
    Serial.print(" Z: ");
    Serial.println(az, 3);

    Serial.print("Gyro (deg/s) -> X: ");
    Serial.print(gx, 2);
    Serial.print(" Y: ");
    Serial.print(gy, 2);
    Serial.print(" Z: ");
    Serial.println(gz, 2);

    if (max301Ready) {
      Serial.print("MAX30102 IR: ");
      Serial.println(lastIrValue);
      if (validRateCount > 0 && beatAvg > 0) {
        Serial.print("Heart Rate (BPM): ");
        Serial.println(beatAvg);
      } else {
        Serial.println("Heart Rate (BPM): -- put finger correctly on MAX30102");
      }
    }

    Serial.println("=== JSON to publish ===");
    Serial.println(payload);

    if (mqttConnected) {
      publishTelemetry(payload);
    }
  }

  delay(50);
}
