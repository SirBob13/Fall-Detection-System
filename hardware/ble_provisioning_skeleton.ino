#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <ArduinoJson.h>

static const char* SERVICE_UUID = "7A100001-8C6A-4F6D-A55B-000000000001";
static const char* DEVICE_INFO_UUID = "7A100002-8C6A-4F6D-A55B-000000000001";
static const char* PROVISIONING_UUID = "7A100003-8C6A-4F6D-A55B-000000000001";
static const char* STATUS_UUID = "7A100004-8C6A-4F6D-A55B-000000000001";

Preferences preferences;
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

BLECharacteristic* deviceInfoCharacteristic = nullptr;
BLECharacteristic* provisioningCharacteristic = nullptr;
BLECharacteristic* statusCharacteristic = nullptr;

String deviceId = "BRACELET-DEMO-001";
String firmwareVersion = "1.0.0";

String wifiSsid;
String wifiPassword;
String pairingToken;
String mqttHost = "broker.hivemq.com";
int mqttPort = 1883;
String mqttTopic = "fall-detection/device-data";
String apiBaseUrl = "http://138.2.183.9:8000/api/v1";

bool wifiConnected = false;
bool mqttConnected = false;

String buildDeviceInfoJson() {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["firmware_version"] = firmwareVersion;
  doc["device_type"] = "fall_bracelet";
  doc["wifi_connected"] = wifiConnected;
  doc["backend_connected"] = mqttConnected;
  doc["battery_level"] = 100;
  doc["status"] = "ready_for_provisioning";

  String output;
  serializeJson(doc, output);
  return output;
}

void notifyStatus(const char* stage, bool success, const char* message) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["stage"] = stage;
  doc["success"] = success;
  doc["message"] = message;

  String output;
  serializeJson(doc, output);
  statusCharacteristic->setValue(output.c_str());
  statusCharacteristic->notify();
  Serial.println(output);
}

bool connectToWifi() {
  if (wifiSsid.isEmpty()) return false;

  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  Serial.printf("Connecting to WiFi SSID: %s\n", wifiSsid.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected) {
    notifyStatus("wifi_connected", true, "Connected to WiFi");
  } else {
    notifyStatus("wifi_failed", false, "Invalid WiFi credentials or timeout");
  }
  return wifiConnected;
}

bool connectToMqtt() {
  if (!wifiConnected || mqttHost.isEmpty()) return false;

  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  String clientId = "esp32-" + deviceId;

  mqttConnected = mqttClient.connect(clientId.c_str());
  if (mqttConnected) {
    notifyStatus("mqtt_connected", true, "Connected to MQTT broker");
  } else {
    notifyStatus("mqtt_failed", false, "MQTT connection failed");
  }
  return mqttConnected;
}

void publishTelemetry() {
  if (!mqttConnected) return;

  StaticJsonDocument<512> doc;
  doc["device_id"] = deviceId;
  doc["pairing_token"] = pairingToken;
  doc["motion"]["acc_x"] = 0.10;
  doc["motion"]["acc_y"] = 0.02;
  doc["motion"]["acc_z"] = 0.98;
  doc["motion"]["gyro_x"] = 0.01;
  doc["motion"]["gyro_y"] = 0.02;
  doc["motion"]["gyro_z"] = 0.03;
  doc["vitals"]["heart_rate"] = 78;
  doc["vitals"]["oxygen_saturation"] = 98;
  doc["vitals"]["body_temperature"] = 36.6;
  doc["battery_level"] = 100;
  doc["firmware_version"] = firmwareVersion;

  String payload;
  serializeJson(doc, payload);
  mqttClient.publish(mqttTopic.c_str(), payload.c_str());
}

class DeviceInfoCallbacks : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* characteristic) override {
    const String info = buildDeviceInfoJson();
    characteristic->setValue(info.c_str());
  }
};

class ProvisioningCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    std::string rawValue = characteristic->getValue();
    if (rawValue.empty()) return;

    StaticJsonDocument<768> doc;
    DeserializationError error = deserializeJson(doc, rawValue.c_str());
    if (error) {
      notifyStatus("provisioning_received", false, "Invalid provisioning JSON");
      return;
    }

    deviceId = doc["device_id"] | deviceId;
    pairingToken = doc["pairing_token"] | "";
    wifiSsid = doc["wifi"]["ssid"] | "";
    wifiPassword = doc["wifi"]["password"] | "";
    mqttHost = doc["mqtt"]["host"] | mqttHost;
    mqttPort = doc["mqtt"]["port"] | mqttPort;
    mqttTopic = doc["mqtt"]["topic"] | mqttTopic;
    apiBaseUrl = doc["api"]["base_url"] | apiBaseUrl;

    preferences.putString("device_id", deviceId);
    preferences.putString("pairing_token", pairingToken);
    preferences.putString("wifi_ssid", wifiSsid);
    preferences.putString("wifi_pass", wifiPassword);
    preferences.putString("mqtt_host", mqttHost);
    preferences.putInt("mqtt_port", mqttPort);
    preferences.putString("mqtt_topic", mqttTopic);
    preferences.putString("api_base_url", apiBaseUrl);

    notifyStatus("provisioning_received", true, "Provisioning payload stored");

    if (connectToWifi()) {
      connectToMqtt();
    }
  }
};

void startBleProvisioningServer() {
  BLEDevice::init("FallDetectionBracelet");
  BLEServer* server = BLEDevice::createServer();
  BLEService* service = server->createService(SERVICE_UUID);

  deviceInfoCharacteristic = service->createCharacteristic(
    DEVICE_INFO_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  deviceInfoCharacteristic->setCallbacks(new DeviceInfoCallbacks());
  deviceInfoCharacteristic->setValue(buildDeviceInfoJson().c_str());

  provisioningCharacteristic = service->createCharacteristic(
    PROVISIONING_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  provisioningCharacteristic->setCallbacks(new ProvisioningCallbacks());

  statusCharacteristic = service->createCharacteristic(
    STATUS_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  statusCharacteristic->addDescriptor(new BLE2902());

  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
  Serial.println("BLE provisioning server started");
}

void loadSavedConfig() {
  preferences.begin("provisioning", false);
  deviceId = preferences.getString("device_id", deviceId);
  pairingToken = preferences.getString("pairing_token", "");
  wifiSsid = preferences.getString("wifi_ssid", "");
  wifiPassword = preferences.getString("wifi_pass", "");
  mqttHost = preferences.getString("mqtt_host", mqttHost);
  mqttPort = preferences.getInt("mqtt_port", mqttPort);
  mqttTopic = preferences.getString("mqtt_topic", mqttTopic);
  apiBaseUrl = preferences.getString("api_base_url", apiBaseUrl);
}

void setup() {
  Serial.begin(115200);
  loadSavedConfig();
  startBleProvisioningServer();

  if (!wifiSsid.isEmpty()) {
    connectToWifi();
    connectToMqtt();
  }
}

void loop() {
  if (wifiConnected && !mqttConnected) {
    connectToMqtt();
  }

  if (mqttConnected) {
    mqttClient.loop();
    static unsigned long lastPublish = 0;
    if (millis() - lastPublish > 2000) {
      lastPublish = millis();
      publishTelemetry();
      notifyStatus("streaming", true, "Publishing telemetry");
    }
  }

  delay(50);
}
