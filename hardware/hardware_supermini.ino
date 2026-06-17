#include <WiFi.h>
#include "esp_wifi.h"
#include <time.h>
#include <Wire.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include "mbedtls/base64.h"
#include <math.h>

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// =====================================================
// ESP32-C3 Mini / SuperMini Fall Detection Bracelet
//
// Current hardware wiring:
// I2C SDA = GPIO6
// I2C SCL = GPIO7
// I2C speed = 400kHz Fast Mode for smoother OLED refresh.
// If your wiring is long/noisy, set I2C_CLOCK_HZ back to 100000.
//
// I2C devices:
// OLED SSD1306 128x64 address = 0x3C
// MAX30102 address = 0x57
// MPU sensor address = 0x68
//
// MPU behavior:
// 1) Try Adafruit_MPU6050 first.
// 2) If Adafruit begin fails but 0x68 exists, use direct register reading.
// 3) Never stop the device because a sensor failed.
// 4) No while(1) sensor failure loops.
//
// OLED behavior:
// - Boot Check only once for 3.8 seconds.
// - Normal Dashboard after boot.
// - DEBUG_SCREEN false => final user dashboard.
// - DEBUG_SCREEN true  => raw debug pages.
// =====================================================

// ================= Debug Screen Mode =================
#define DEBUG_SCREEN 0

// ================= Board / I2C Pins =================
static const char *BOARD_NAME = "ESP32-C3 Mini / SuperMini";
static const int I2C_SDA_PIN = 6;
static const int I2C_SCL_PIN = 7;
static const uint32_t I2C_CLOCK_HZ = 400000;

// ================= I2C Addresses =================
static const uint8_t OLED_I2C_ADDRESS = 0x3C;
static const uint8_t MAX30102_I2C_ADDRESS = 0x57;
static const uint8_t MPU_I2C_ADDRESS = 0x68;

// ================= MPU Direct Register Map =================
static const uint8_t MPU_REG_WHO_AM_I = 0x75;
static const uint8_t MPU_REG_PWR_MGMT_1 = 0x6B;
static const uint8_t MPU_REG_ACCEL_XOUT_H = 0x3B;
static const uint8_t MPU_REG_TEMP_OUT_H = 0x41;
static const uint8_t MPU_REG_GYRO_XOUT_H = 0x43;

// ================= OLED Display Settings =================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
// SSD1306 redraws the full 1KB buffer. These intervals keep the UI responsive
// without permanently occupying the shared I2C bus used by MPU + MAX30102.
static const unsigned long OLED_FAST_UPDATE_INTERVAL_MS = 45;
static const unsigned long OLED_ACTIVE_UPDATE_INTERVAL_MS = 75;
static const unsigned long OLED_IDLE_UPDATE_INTERVAL_MS = 140;
static const unsigned long OLED_PAGE_INTERVAL_MS = 10000;
static const unsigned long BOOT_CHECK_DURATION_MS = 3800;
static const unsigned long READY_TOAST_DURATION_MS = 4500;

// ================= BLE Settings =================
#define BLE_MTU_SIZE 247
static const char *DEVICE_NAME = "FallDetectionBracelet";
static const char *SERVICE_UUID     = "7A100001-8C6A-4F6D-A55B-000000000001";
static const char *DEVICE_INFO_UUID = "7A100002-8C6A-4F6D-A55B-000000000001";
static const char *WRITE_UUID       = "7A100003-8C6A-4F6D-A55B-000000000001";
static const char *STATUS_UUID      = "7A100004-8C6A-4F6D-A55B-000000000001";

// ================= Preferences Keys =================
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
static const char *DEVICE_TYPE = "esp32-c3-supermini-bracelet";
static const char *FIRMWARE_VERSION = "3.8.3-c3-command-debug-vitals";

// ================= WiFi / MQTT Timing =================
static const int WIFI_MAX_RETRIES = 30;
static const unsigned long WIFI_RETRY_INTERVAL_MS = 30000;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
static const unsigned long PUBLISH_INTERVAL_MS = 1000;

// ================= Sensor Timing =================
static const unsigned long MPU_SAMPLE_INTERVAL_MS = 50; // 20 samples/sec
static const int MPU_BATCH_SIZE = 20;

#define MAX_POWER_SAVE true
#define MAX_KEEP_ON_WHEN_FINGER false  // Fixed 30s ON / 30s OFF cycle. Do not keep MAX on forever when finger is present.
#define MAX_HR_DEBUG true
static const uint32_t FINGER_IR_THRESHOLD = 35000;  // Lowered to avoid losing finger contact during a 30s session.
static const uint32_t SIGNAL_GOOD_IR_THRESHOLD = 60000;
static const unsigned long MAX_ON_DURATION_MS = 30000;
static const unsigned long MAX_OFF_DURATION_MS = 30000;  // Hold last vitals on screen while MAX rests.
static const unsigned long MAX_NO_FINGER_GRACE_MS = 6000;
static const unsigned long MAX_SAMPLE_INTERVAL_MS = 10; // 100Hz sampling for stable PPG
static const unsigned long VITALS_STATUS_INTERVAL_MS = 1000;
static const unsigned long VITALS_DEFAULT_DURATION_MS = 60000;
static const unsigned long VITALS_MIN_DURATION_MS = 10000;
static const unsigned long VITALS_MAX_DURATION_MS = 120000;
static const int SPO2_BUFFER_SIZE = 400; // 400 samples @ 100Hz ≈ 4 sec window

// MAX30102 is very sensitive to finger pressure and motion.
// HR now uses a window-based IR autocorrelation estimator, because checkForBeat()
// may miss beats on some MAX30102 modules or bracelet optical layouts.
static const int HR_MIN_BPM = 45;
static const int HR_MAX_BPM = 150;
static const int HR_MAX_JUMP_BPM = 34;
static const int HR_CANDIDATE_TOLERANCE_BPM = 18;
static const byte HR_REQUIRED_CONFIRMATIONS = 2;
static const unsigned long HR_FINGER_STABLE_MS = 1200;
static const unsigned long HR_ADJUST_FINGER_MS = 18000;

#define MAX_USE_SOFT_HR_FALLBACK 0
#define HR_USE_AUTOCORRELATION 0
#define HR_ALLOW_INSTANT_BEAT 0
static const int HR_BUFFER_SIZE = 800;          // 8 sec @ 100Hz
static const int HR_ANALYSIS_SAMPLES = 600;     // last 6 sec window
static const unsigned long HR_ANALYSIS_INTERVAL_MS = 1000;
static const float HR_MIN_AUTOCORR_QUALITY = 0.18f;
static const unsigned long FINGER_LOST_GRACE_MS = 1800;

// Session-based HR measurement. This is closer to wearable behavior:
// measure for a fixed window, publish/display the last reliable result, then re-measure.
#define HR_SESSION_MODE 1
static const unsigned long HR_MEASURE_DURATION_MS = 30000;
static const unsigned long HR_HOLD_DURATION_MS = 30000;
static const int HR_SESSION_SAMPLE_RATE_HZ = 100;
static const int HR_SESSION_BUFFER_SIZE = 3000; // 30 sec @ 100Hz
static const int HR_DOWNSAMPLE_FACTOR = 4;      // analyze at 25Hz
static const int HR_DOWNSAMPLED_MAX = HR_SESSION_BUFFER_SIZE / HR_DOWNSAMPLE_FACTOR;
static const float HR_SESSION_MIN_RMS = 8.0f;  // More tolerant for exposed MAX30102 modules.

// SpO2 estimator tuning. Use a real fingertip pulse oximeter to tune SPO2_RATIO_SCALE later.
static const double SPO2_RATIO_SCALE = 0.68;
static const double SPO2_RATIO_MIN = 0.30;
static const double SPO2_RATIO_MAX = 1.25;
static const int SPO2_MIN_VALID_PERCENT = 88;
static const int SPO2_MAX_VALID_PERCENT = 100;
static const int SPO2_MAX_STEP_PERCENT = 4;
static const byte SPO2_REQUIRED_CONFIRMATIONS = 2;
static const unsigned long SPO2_DISPLAY_HOLD_MS = 120000;  // Keep last valid value visible across OFF cycle.
static const unsigned long HR_DISPLAY_HOLD_MS = 120000;  // Keep last valid value visible across OFF cycle.

// ================= BLE Provisioning Chunk Settings =================
static const unsigned long PROVISIONING_CHUNK_TIMEOUT_MS = 120000;
static const size_t PROVISIONING_CHUNK_BUFFER_LIMIT = 2048;
static const size_t RAW_PROVISIONING_PAYLOAD_SIZE = 768;
static const size_t RAW_PROVISIONING_QUEUE_SIZE = 8;

// ================= MQTT Buffer =================
// ESP32-C3 RAM optimization:
// Keep the MQTT/JSON publish peak smaller while preserving the same telemetry schema.
static const uint16_t MQTT_PACKET_BUFFER_SIZE = 18000;
static const size_t TELEMETRY_PAYLOAD_SIZE = 16000;
static const size_t TELEMETRY_JSON_CAPACITY = 16000;

// ================= Objects =================
Preferences preferences;
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

Adafruit_MPU6050 mpu;
MAX30105 max30102;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

BLECharacteristic *deviceInfoChar = nullptr;
BLECharacteristic *writeChar = nullptr;
BLECharacteristic *statusChar = nullptr;

// ================= MPU Mode =================
enum MpuReadMode {
  MPU_MODE_NONE = 0,
  MPU_MODE_ADAFRUIT = 1,
  MPU_MODE_DIRECT = 2
};

MpuReadMode mpuMode = MPU_MODE_NONE;
uint8_t mpuWhoAmI = 0x00;
bool mpuAddressPresent = false;

// ================= State =================
bool mpuReady = false;
bool maxReady = false;
bool maxPowered = false;
bool oledReady = false;

bool deviceConnected = false;
bool shouldApplyProvisioning = false;
bool hasPendingProvisioning = false;
bool shouldStopBleAfterWiFiConnect = false;
bool shouldResumeProvisioningBle = false;
bool requireReProvisioning = false;
bool wifiWasConnectedOnce = false;
bool bleProvisioningActive = false;

String wifiSsid = "";
String wifiPassword = "";
String provisionedDeviceId = "";
String pairingToken = "";
String mqttHost = "";
String mqttTopic = "";
String mqttCommandTopic = "";
String mqttCommandTopicLegacy = "";
String mqttCommandTopicBroadcast = "fall-detection/device-commands/all";
String mqttCommandTopicGeneric = "fall-detection/device-commands";
String serialCommandBuffer = "";
uint16_t mqttPort = 1883;
int provisionedUserId = 0;

bool wifiTargetApLocked = false;
uint8_t wifiTargetBssid[6] = {0, 0, 0, 0, 0, 0};
int32_t wifiTargetChannel = 0;
int32_t lastWifiDisconnectReason = -1;

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

unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
unsigned long lastPublishMs = 0;
unsigned long lastMpuSampleMs = 0;
unsigned long lastMaxSampleMs = 0;
unsigned long maxPowerStateChangedAtMs = 0;
unsigned long lastFingerDetectedMs = 0;
unsigned long telemetryCounter = 0;
bool timeSynced = false;

bool vitalsMeasurementActive = false;
String activeVitalsRequestId = "";
String activeVitalsTrigger = "manual";
unsigned long vitalsMeasurementStartedMs = 0;
unsigned long vitalsMeasurementDurationMs = VITALS_DEFAULT_DURATION_MS;
unsigned long lastVitalsStatusPublishMs = 0;
int activeVitalsHrBpm = 0;
bool activeVitalsHrValid = false;
int activeVitalsSpo2 = 0;
bool activeVitalsSpo2Valid = false;
float activeVitalsHrQuality = 0.0f;
bool activeVitalsFingerSeen = false;
bool activeVitalsGoodSignalSeen = false;

unsigned long lastOledUpdateMs = 0;
unsigned long lastOledPageSwitchMs = 0;
uint8_t oledPage = 0;

bool bootCheckDone = false;
bool lastBatchSent = false;
unsigned long lastBatchSentMs = 0;
String alertStatus = "None";
bool readyToastShown = false;
unsigned long readyToastStartedMs = 0;

// ================= I2C Scan Cache =================
String i2cFoundText = "";
bool i2cFoundOled = false;
bool i2cFoundMax = false;
bool i2cFoundMpu = false;

// ================= Provisioning Queue =================
volatile bool hasQueuedProvisioningPayload = false;
char rawProvisioningQueue[RAW_PROVISIONING_QUEUE_SIZE][RAW_PROVISIONING_PAYLOAD_SIZE];
volatile size_t rawProvisioningQueueHead = 0;
volatile size_t rawProvisioningQueueTail = 0;
volatile size_t rawProvisioningQueueCount = 0;
portMUX_TYPE rawProvisioningQueueMux = portMUX_INITIALIZER_UNLOCKED;

String provisioningTransferId = "";
char provisioningChunkBuffer[PROVISIONING_CHUNK_BUFFER_LIMIT + 1];
size_t provisioningChunkBufferLen = 0;
int provisioningChunkExpectedTotal = 0;
int provisioningChunkNextIndex = 0;
unsigned long provisioningChunkStartedAtMs = 0;

// ================= Motion Buffer =================
struct MotionSample {
  float ax = 0;
  float ay = 0;
  float az = 0;
  float gx = 0;
  float gy = 0;
  float gz = 0;
  float temp = 0;
  float accMag = 0;
  float gyroMag = 0;
  unsigned long t = 0;
};

MotionSample motionSamples[MPU_BATCH_SIZE];
MotionSample latestMotion;
int motionWriteIndex = 0;
int motionCount = 0;

// ================= MAX30102 Snapshot =================
struct MaxSnapshot {
  uint32_t ir = 0;
  uint32_t red = 0;
  bool fingerDetected = false;
  int heartRate = 0;
  int beatAvg = 0;
  int spo2 = 0;
  bool spo2Valid = false;
  unsigned long t = 0;
};

MaxSnapshot latestMax;
uint32_t spo2IrBuffer[SPO2_BUFFER_SIZE];
uint32_t spo2RedBuffer[SPO2_BUFFER_SIZE];
int spo2BufferIndex = 0;
int spo2BufferCount = 0;
int spo2Candidate = 0;
byte spo2CandidateHits = 0;
const byte RATE_SIZE = 5;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
int hrCandidateBpm = 0;
byte hrCandidateHits = 0;
unsigned long fingerStableSinceMs = 0;
bool previousFingerDetected = false;
unsigned long lastMaxDebugPrintMs = 0;
float hrDcEstimate = 0.0f;
float hrPrev2 = 0.0f;
float hrPrev1 = 0.0f;
float hrAcAvg = 0.0f;
unsigned long lastSimplePeakMs = 0;
unsigned long lastHrValidMs = 0;
unsigned long lastSpo2ValidMs = 0;

// Values shown on the OLED must survive MAX30102 sleep and temporary finger loss.
// latestMax is the live sensor snapshot; held* is the last completed user-facing reading.
int heldHrBpm = 0;
bool heldHrValid = false;
int heldSpo2 = 0;
bool heldSpo2Valid = false;
unsigned long heldHrUpdatedMs = 0;
unsigned long heldSpo2UpdatedMs = 0;

unsigned long lastHrAnalysisMs = 0;
unsigned long fingerMissingStartedMs = 0;
float hrAutocorrQuality = 0.0f;
float hrFilteredBpm = 0.0f;
#if HR_USE_AUTOCORRELATION
uint32_t hrIrBuffer[HR_BUFFER_SIZE];
int hrBufferIndex = 0;
int hrBufferCount = 0;
static float hrWorkBuffer[HR_ANALYSIS_SAMPLES];
#endif

// ================= HR Session Mode State =================
// These variables are required by the session-based HR algorithm.
// The previous generated file referenced them but missed their declarations.
#if HR_SESSION_MODE
enum HrSessionState {
  HR_SESSION_IDLE = 0,
  HR_SESSION_MEASURING = 1,
  HR_SESSION_HOLDING = 2
};

HrSessionState hrSessionState = HR_SESSION_IDLE;
unsigned long hrSessionStartedMs = 0;
unsigned long hrSessionHoldStartedMs = 0;
int hrSessionCount = 0;

uint32_t hrSessionIrBuffer[HR_SESSION_BUFFER_SIZE];
float hrSessionWork[HR_DOWNSAMPLED_MAX];
int lastSessionHrBpm = 0;
bool lastSessionHrValid = false;
float lastSessionHrQuality = 0.0f;
#endif


static char telemetryPayload[TELEMETRY_PAYLOAD_SIZE];

// ================= Forward Declarations =================
void finishHrMeasurementSession(unsigned long now);
void isoTimestamp(char *buffer, size_t bufferSize);
void resetHeartRateEstimator();
void publishVitalsStatus(const char *state, unsigned long now);
void startVitalsMeasurement(const String &requestId, const String &trigger, unsigned long durationMs, unsigned long now);
void stopVitalsMeasurement(const char *state, unsigned long now);
void handleMqttMessage(char *topic, byte *payload, unsigned int length);
void processSerialCommands();


// =====================================================
// Utility Functions
// =====================================================
String fallbackDeviceId() {
  uint64_t chipId = ESP.getEfuseMac();
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "bracelet-%04X%08X", (uint16_t)(chipId >> 32), (uint32_t)chipId);
  return String(buffer);
}

String getActiveDeviceId() {
  if (pendingProvisionedDeviceId.length() > 0) return pendingProvisionedDeviceId;
  if (provisionedDeviceId.length() > 0) return provisionedDeviceId;
  return fallbackDeviceId();
}

String getShortDeviceId() {
  String id = getActiveDeviceId();
  if (id.length() <= 8) return id;
  return id.substring(id.length() - 8);
}

bool hasStoredConfig() {
  return !wifiSsid.isEmpty() && provisionedUserId > 0;
}

void setLastError(const String &stage, const String &message) {
  lastErrorStage = stage;
  lastErrorMessage = message;
}

const char *connectionStatusLabel() {
  if (mqttClient.connected()) return "streaming";
  if (WiFi.status() == WL_CONNECTED) return "wifi_connected";
  if (wifiSsid.length() > 0 || hasPendingProvisioning) return "connecting";
  return "ready_for_provisioning";
}

const char *generalStatusLabel() {
  if (mqttClient.connected()) return "Streaming";
  if (WiFi.status() == WL_CONNECTED) return "Connecting";
  if (hasStoredConfig() || hasPendingProvisioning) return "Connecting";
  return "Offline";
}

const char *headerStatusShortLabel() {
  if (mqttClient.connected()) return "LIVE";
  if (WiFi.status() == WL_CONNECTED || hasStoredConfig() || hasPendingProvisioning) return "CONN";
  return "OFF";
}

int getDisplayHrBpm() {
  if (heldHrValid && heldHrBpm > 0) return heldHrBpm;
  if (latestMax.beatAvg > 0) return latestMax.beatAvg;
  return 0;
}

int getDisplaySpo2() {
  if (heldSpo2Valid && heldSpo2 > 0) return heldSpo2;
  if (latestMax.spo2Valid && latestMax.spo2 > 0) return latestMax.spo2;
  return 0;
}

void commitHeldHeartRate(int bpm, unsigned long now) {
  if (bpm < HR_MIN_BPM || bpm > HR_MAX_BPM) return;

  heldHrBpm = bpm;
  heldHrValid = true;
  heldHrUpdatedMs = now;

  latestMax.heartRate = bpm;
  latestMax.beatAvg = bpm;
  lastHrValidMs = now;

  if (vitalsMeasurementActive) {
    activeVitalsHrBpm = bpm;
    activeVitalsHrValid = true;
  }

#if HR_SESSION_MODE
  lastSessionHrBpm = bpm;
  lastSessionHrValid = true;
#endif
}

void commitHeldSpo2(int spo2, unsigned long now) {
  if (spo2 < SPO2_MIN_VALID_PERCENT || spo2 > SPO2_MAX_VALID_PERCENT) return;

  heldSpo2 = spo2;
  heldSpo2Valid = true;
  heldSpo2UpdatedMs = now;

  latestMax.spo2 = spo2;
  latestMax.spo2Valid = true;
  lastSpo2ValidMs = now;

  if (vitalsMeasurementActive) {
    activeVitalsSpo2 = spo2;
    activeVitalsSpo2Valid = true;
  }
}

String heartRateDisplayLabel() {
  if (!maxReady) return "-- BPM";

  int bpm = getDisplayHrBpm();
  if (bpm > 0) return String(bpm) + " BPM";

  if (maxPowered) return "Measuring";
  return "WAIT";
}

const char *wifiDashboardStatus() {
  if (WiFi.status() == WL_CONNECTED) return "OK";
  if (hasStoredConfig() || hasPendingProvisioning) return "Retry";
  return "Not connected";
}

const char *mqttDashboardStatus() {
  if (mqttClient.connected()) return "OK";
  if (WiFi.status() == WL_CONNECTED) {
    if (lastErrorStage == "mqtt_failed") return "Failed";
    return "Waiting";
  }
  return "Waiting";
}

const char *signalStrengthLabel() {
  if (!maxReady) return "Weak";
  if (!maxPowered) return "Rest";
  if (latestMax.ir > SIGNAL_GOOD_IR_THRESHOLD) return "Good";
  if (latestMax.ir > FINGER_IR_THRESHOLD) return "Good";
  return "Weak";
}

const char *vitalsSignalStatusLabel() {
  if (!maxReady) return "sensor_not_ready";
  if (!maxPowered) return "rest";
  if (!latestMax.fingerDetected) return "place_finger";
  if (mpuReady && (latestMotion.accMag > 16.5f || latestMotion.gyroMag > 95.0f)) return "keep_still";
  if (latestMax.ir > SIGNAL_GOOD_IR_THRESHOLD && latestMax.red > 8000) return "good";
  if (latestMax.ir > FINGER_IR_THRESHOLD && latestMax.red > 1000) return "weak_signal";
  return "place_finger";
}


const char *fingerDisplayLabel() {
  if (!maxReady) return "NO";
  if (!maxPowered) return "WAIT";
  return latestMax.fingerDetected ? "YES" : "NO";
}

void resetSpo2Buffer() {
  spo2BufferIndex = 0;
  spo2BufferCount = 0;
  spo2Candidate = 0;
  spo2CandidateHits = 0;
  latestMax.spo2 = 0;
  latestMax.spo2Valid = false;
  lastSpo2ValidMs = 0;
}

// Clear only the temporary SpO2 window for the next MAX session.
// Keep the last calculated SpO2 on screen while the MAX30102 is sleeping.
void clearSpo2MeasurementWindowOnly() {
  spo2BufferIndex = 0;
  spo2BufferCount = 0;
  spo2Candidate = 0;
  spo2CandidateHits = 0;
}

void holdLastSpo2OrInvalidate() {
  // Never erase the user-facing value because of a temporary bad sample.
  // During MAX sleep or a new measurement window, keep the last completed value.
  if (heldSpo2Valid && heldSpo2 > 0) {
    latestMax.spo2 = heldSpo2;
    latestMax.spo2Valid = true;
    return;
  }

  if (latestMax.spo2 > 0 && lastSpo2ValidMs > 0) {
    latestMax.spo2Valid = true;
    return;
  }

  latestMax.spo2Valid = false;
}

bool acceptSpo2Candidate(int spo2) {
  if (spo2 < SPO2_MIN_VALID_PERCENT || spo2 > SPO2_MAX_VALID_PERCENT) {
    spo2Candidate = 0;
    spo2CandidateHits = 0;
    holdLastSpo2OrInvalidate();
    return false;
  }

  if (!latestMax.spo2Valid) {
    if (spo2Candidate == 0 || abs(spo2 - spo2Candidate) > SPO2_MAX_STEP_PERCENT) {
      spo2Candidate = spo2;
      spo2CandidateHits = 1;
      holdLastSpo2OrInvalidate();
      return false;
    }

    if (spo2CandidateHits < 255) spo2CandidateHits++;
    if (spo2CandidateHits < SPO2_REQUIRED_CONFIRMATIONS) {
      holdLastSpo2OrInvalidate();
      return false;
    }

    commitHeldSpo2((spo2Candidate + spo2) / 2, millis());
    return true;
  }

  if (abs(spo2 - latestMax.spo2) > SPO2_MAX_STEP_PERCENT) {
    if (spo2Candidate == 0 || abs(spo2 - spo2Candidate) > SPO2_MAX_STEP_PERCENT) {
      spo2Candidate = spo2;
      spo2CandidateHits = 1;
      return true; // keep showing the previous good value while confirming the new one
    }

    if (spo2CandidateHits < 255) spo2CandidateHits++;
    if (spo2CandidateHits < SPO2_REQUIRED_CONFIRMATIONS) return true;
  } else {
    spo2Candidate = 0;
    spo2CandidateHits = 0;
  }

  int baseSpo2 = getDisplaySpo2();
  if (baseSpo2 <= 0) baseSpo2 = spo2;
  commitHeldSpo2(((baseSpo2 * 3) + spo2 + 2) / 4, millis());
  return true;
}

void updateSpo2Estimator(uint32_t redValue, uint32_t irValue) {
  if (!latestMax.fingerDetected || irValue < FINGER_IR_THRESHOLD || redValue < 1000) {
    clearSpo2MeasurementWindowOnly();
    holdLastSpo2OrInvalidate();
    return;
  }

  spo2IrBuffer[spo2BufferIndex] = irValue;
  spo2RedBuffer[spo2BufferIndex] = redValue;
  spo2BufferIndex = (spo2BufferIndex + 1) % SPO2_BUFFER_SIZE;
  if (spo2BufferCount < SPO2_BUFFER_SIZE) spo2BufferCount++;

  if (spo2BufferCount < SPO2_BUFFER_SIZE) {
    holdLastSpo2OrInvalidate();
    return;
  }

  double irSum = 0.0;
  double redSum = 0.0;
  uint32_t irMin = 0xFFFFFFFF;
  uint32_t irMax = 0;
  uint32_t redMin = 0xFFFFFFFF;
  uint32_t redMax = 0;

  for (int i = 0; i < SPO2_BUFFER_SIZE; i++) {
    uint32_t ir = spo2IrBuffer[i];
    uint32_t red = spo2RedBuffer[i];
    irSum += ir;
    redSum += red;
    if (ir < irMin) irMin = ir;
    if (ir > irMax) irMax = ir;
    if (red < redMin) redMin = red;
    if (red > redMax) redMax = red;
  }

  double irDc = irSum / SPO2_BUFFER_SIZE;
  double redDc = redSum / SPO2_BUFFER_SIZE;

  double irVar = 0.0;
  double redVar = 0.0;
  for (int i = 0; i < SPO2_BUFFER_SIZE; i++) {
    double irDiff = (double)spo2IrBuffer[i] - irDc;
    double redDiff = (double)spo2RedBuffer[i] - redDc;
    irVar += irDiff * irDiff;
    redVar += redDiff * redDiff;
  }

  double irAc = sqrt(irVar / SPO2_BUFFER_SIZE);
  double redAc = sqrt(redVar / SPO2_BUFFER_SIZE);
  double irPp = (double)(irMax - irMin);
  double redPp = (double)(redMax - redMin);

  bool motionOk = (!mpuReady) || (latestMotion.accMag < 16.5f && latestMotion.gyroMag < 95.0f);
  bool signalOk = (
    irDc >= (double)FINGER_IR_THRESHOLD &&
    redDc >= 1000.0 &&
    irAc >= 45.0 &&
    redAc >= 18.0 &&
    irPp >= 120.0 &&
    redPp >= 60.0 &&
    irAc < (irDc * 0.22) &&
    redAc < (redDc * 0.30)
  );

  if (!motionOk || !signalOk) {
    holdLastSpo2OrInvalidate();
    return;
  }

  double ratio = (redAc / redDc) / (irAc / irDc);
  ratio *= SPO2_RATIO_SCALE;

  if (ratio < SPO2_RATIO_MIN || ratio > SPO2_RATIO_MAX) {
    holdLastSpo2OrInvalidate();
    return;
  }

  int spo2 = (int)round(110.0 - (25.0 * ratio));

  if (!acceptSpo2Candidate(spo2)) {
    return;
  }
}

const char *motionStatusLabel() {
  if (!mpuReady || motionCount == 0) return "Checking";
  if (latestMotion.accMag > 14.0f || latestMotion.gyroMag > 80.0f) return "Movement";
  if (latestMotion.accMag >= 7.0f && latestMotion.accMag <= 12.5f && latestMotion.gyroMag < 45.0f) return "Stable";
  return "Checking";
}

const char *batchStatusLabel() {
  if (lastBatchSent && millis() - lastBatchSentMs < 3000) return "Sent";
  return "Waiting";
}

int getBatteryPercent() {
  // TODO: replace with real battery measurement circuit later.
  return 84;
}

bool isFallDetectedForDisplay() {
  // Local display/demo threshold only. Real AI decision should come from server/backend.
  return (mpuReady && latestMotion.accMag > 25.0f && latestMotion.gyroMag > 200.0f);
}

// =====================================================
// I2C Helpers / Scanner
// =====================================================
bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void scanI2C() {
  Serial.println("🔎 I2C scan started");
  i2cFoundText = "";
  i2cFoundOled = false;
  i2cFoundMax = false;
  i2cFoundMpu = false;
  byte found = 0;

  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0) {
      char buffer[8];
      snprintf(buffer, sizeof(buffer), "0x%02X", address);

      if (i2cFoundText.length() > 0) i2cFoundText += " ";
      i2cFoundText += buffer;

      if (address == OLED_I2C_ADDRESS) i2cFoundOled = true;
      if (address == MAX30102_I2C_ADDRESS) i2cFoundMax = true;
      if (address == MPU_I2C_ADDRESS) i2cFoundMpu = true;

      Serial.print("✅ I2C device found at ");
      Serial.println(buffer);
      found++;
    }
  }

  if (found == 0) {
    i2cFoundText = "None";
    Serial.println("❌ No I2C devices found");
  }

  Serial.print("🔎 I2C scan result: ");
  Serial.println(i2cFoundText);
  Serial.println("🔎 I2C scan finished");
}

// =====================================================
// MPU Direct Register Helpers
// =====================================================
bool mpuWriteRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_I2C_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuReadBytes(uint8_t reg, uint8_t *buffer, size_t length) {
  if (!buffer || length == 0) return false;

  Wire.beginTransmission(MPU_I2C_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  size_t received = Wire.requestFrom((int)MPU_I2C_ADDRESS, (int)length);
  if (received != length) {
    return false;
  }

  for (size_t i = 0; i < length && Wire.available(); i++) {
    buffer[i] = Wire.read();
  }

  return true;
}

bool mpuReadRegister(uint8_t reg, uint8_t &value) {
  uint8_t buffer[1];
  if (!mpuReadBytes(reg, buffer, 1)) return false;
  value = buffer[0];
  return true;
}

int16_t combineHighLow(uint8_t highByte, uint8_t lowByte) {
  return (int16_t)((highByte << 8) | lowByte);
}

bool initMpuDirectFallback() {
  Serial.println("🔁 Trying MPU direct register fallback...");

  mpuAddressPresent = i2cDevicePresent(MPU_I2C_ADDRESS);
  Serial.print("📍 MPU 0x68 address present: ");
  Serial.println(mpuAddressPresent ? "YES" : "NO");

  if (!mpuAddressPresent) {
    Serial.println("❌ MPU direct fallback failed: 0x68 not present");
    return false;
  }

  if (!mpuReadRegister(MPU_REG_WHO_AM_I, mpuWhoAmI)) {
    Serial.println("❌ MPU direct fallback failed: WHO_AM_I read failed");
    return false;
  }

  Serial.print("📌 MPU WHO_AM_I = 0x");
  if (mpuWhoAmI < 16) Serial.print("0");
  Serial.println(mpuWhoAmI, HEX);

  if (!mpuWriteRegister(MPU_REG_PWR_MGMT_1, 0x00)) {
    Serial.println("❌ MPU direct fallback failed: PWR_MGMT_1 write failed");
    return false;
  }

  delay(120);

  uint8_t pwr = 0xFF;
  if (mpuReadRegister(MPU_REG_PWR_MGMT_1, pwr)) {
    Serial.print("📌 MPU PWR_MGMT_1 after wake = 0x");
    if (pwr < 16) Serial.print("0");
    Serial.println(pwr, HEX);
  }

  Serial.println("✅ MPU direct fallback READY");
  return true;
}

bool readMpuDirectSample(MotionSample &s) {
  uint8_t buffer[14];

  if (!mpuReadBytes(MPU_REG_ACCEL_XOUT_H, buffer, sizeof(buffer))) {
    Serial.println("⚠️ MPU direct read failed");
    return false;
  }

  int16_t rawAx = combineHighLow(buffer[0], buffer[1]);
  int16_t rawAy = combineHighLow(buffer[2], buffer[3]);
  int16_t rawAz = combineHighLow(buffer[4], buffer[5]);
  int16_t rawTemp = combineHighLow(buffer[6], buffer[7]);
  int16_t rawGx = combineHighLow(buffer[8], buffer[9]);
  int16_t rawGy = combineHighLow(buffer[10], buffer[11]);
  int16_t rawGz = combineHighLow(buffer[12], buffer[13]);

  float axG = rawAx / 16384.0f;
  float ayG = rawAy / 16384.0f;
  float azG = rawAz / 16384.0f;

  s.ax = axG * 9.81f;
  s.ay = ayG * 9.81f;
  s.az = azG * 9.81f;

  s.gx = rawGx / 131.0f;
  s.gy = rawGy / 131.0f;
  s.gz = rawGz / 131.0f;

  s.temp = (rawTemp / 340.0f) + 36.53f;
  s.accMag = sqrt((s.ax * s.ax) + (s.ay * s.ay) + (s.az * s.az));
  s.gyroMag = sqrt((s.gx * s.gx) + (s.gy * s.gy) + (s.gz * s.gz));
  s.t = millis();

  return true;
}

// =====================================================
// OLED Display - Optimized Modern UI
// =====================================================
void initOled() {
  oledReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS);

  Serial.print("OLED status: ");
  Serial.println(oledReady ? "OK" : "FAILED");

  if (!oledReady) {
    Serial.println("OLED SSD1306 not found at 0x3C");
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Fall Bracelet");
  display.println("OLED Ready");
  display.println("SDA GPIO6");
  display.println("SCL GPIO7");
  display.display();

  Serial.println("OLED SSD1306 initialized at 0x3C");
}

void resetText() {
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
}

// Compact monochrome UI icons for the 128x64 SSD1306.
// Stored in flash so the modern UI does not spend extra RAM on artwork.
static const uint8_t ICON_BLE_8X12[] PROGMEM = {
  0b00011000,
  0b00010100,
  0b00010010,
  0b01010100,
  0b00111000,
  0b00010000,
  0b00111000,
  0b01010100,
  0b00010010,
  0b00010100,
  0b00011000,
  0b00000000
};

static const uint8_t ICON_WIFI_12X10[] PROGMEM = {
  0b00000000, 0b00000000,
  0b00111111, 0b00000000,
  0b01000000, 0b10000000,
  0b10011110, 0b01000000,
  0b00100001, 0b00000000,
  0b00001100, 0b00000000,
  0b00010010, 0b00000000,
  0b00000000, 0b00000000,
  0b00001100, 0b00000000,
  0b00001100, 0b00000000
};

static const uint8_t ICON_CLOUD_12X10[] PROGMEM = {
  0b00001100, 0b00000000,
  0b00110011, 0b00000000,
  0b01000000, 0b10000000,
  0b10000000, 0b01000000,
  0b10000000, 0b01000000,
  0b01111111, 0b10000000,
  0b00010010, 0b00000000,
  0b00111111, 0b00000000,
  0b00010010, 0b00000000,
  0b00000000, 0b00000000
};

static const uint8_t ICON_HEART_9X8[] PROGMEM = {
  0b01101100, 0b00000000,
  0b11111110, 0b00000000,
  0b11111110, 0b00000000,
  0b11111110, 0b00000000,
  0b01111100, 0b00000000,
  0b00111000, 0b00000000,
  0b00010000, 0b00000000,
  0b00000000, 0b00000000
};

static const uint8_t ICON_DROP_8X10[] PROGMEM = {
  0b00010000,
  0b00111000,
  0b00111000,
  0b01111100,
  0b01111100,
  0b11111110,
  0b11111110,
  0b01111100,
  0b00111000,
  0b00000000
};

static const uint8_t ICON_WARNING_12X12[] PROGMEM = {
  0b00000100, 0b00000000,
  0b00001110, 0b00000000,
  0b00011011, 0b00000000,
  0b00110001, 0b10000000,
  0b01100000, 0b11000000,
  0b11000100, 0b01100000,
  0b11000100, 0b01100000,
  0b01100000, 0b11000000,
  0b00110001, 0b10000000,
  0b00011011, 0b00000000,
  0b00001110, 0b00000000,
  0b00000000, 0b00000000
};

void drawBatteryIcon(int x, int y, int percent) {
  percent = constrain(percent, 0, 100);
  display.drawRoundRect(x, y, 17, 9, 2, SSD1306_WHITE);
  display.fillRect(x + 17, y + 3, 2, 3, SSD1306_WHITE);
  int fillWidth = map(percent, 0, 100, 0, 13);
  if (fillWidth > 0) display.fillRect(x + 2, y + 2, fillWidth, 5, SSD1306_WHITE);
}

void drawInactiveSlash(int x, int y, int w, int h) {
  display.drawLine(x, y + h - 1, x + w - 1, y, SSD1306_WHITE);
}

void drawWifiIcon(int x, int y, bool connected) {
  display.drawBitmap(x, y, ICON_WIFI_12X10, 12, 10, SSD1306_WHITE);
  if (!connected) drawInactiveSlash(x, y, 12, 10);
}

void drawBluetoothIcon(int x, int y, bool active, bool connected, unsigned long now) {
  display.drawBitmap(x, y, ICON_BLE_8X12, 8, 12, SSD1306_WHITE);

  if (!active && !connected) {
    drawInactiveSlash(x, y, 8, 12);
    return;
  }

  if (connected) {
    display.fillCircle(x + 10, y + 2, 1, SSD1306_WHITE);
    return;
  }

  bool blinkOn = ((now / 300) % 2) == 0;
  if (blinkOn) display.fillCircle(x + 10, y + 2, 1, SSD1306_WHITE);
}

void drawMqttIcon(int x, int y, bool connected) {
  display.drawBitmap(x, y, ICON_CLOUD_12X10, 12, 10, SSD1306_WHITE);
  if (!connected) drawInactiveSlash(x, y, 12, 10);
}

void drawTinyHeart(int x, int y) {
  display.drawBitmap(x, y, ICON_HEART_9X8, 9, 8, SSD1306_WHITE);
}

void drawDropIcon(int x, int y) {
  display.drawBitmap(x, y, ICON_DROP_8X10, 8, 10, SSD1306_WHITE);
}

void drawWarningIcon(int x, int y) {
  display.drawBitmap(x, y, ICON_WARNING_12X12, 12, 12, SSD1306_WHITE);
}

void drawSmallCheck(int x, int y) {
  display.drawLine(x, y + 4, x + 3, y + 7, SSD1306_WHITE);
  display.drawLine(x + 3, y + 7, x + 9, y, SSD1306_WHITE);
}

void drawSmallX(int x, int y) {
  display.drawLine(x, y, x + 8, y + 8, SSD1306_WHITE);
  display.drawLine(x + 8, y, x, y + 8, SSD1306_WHITE);
}

void drawStatusPill(int x, int y, const char *text, bool filled) {
  int w = strlen(text) * 6 + 8;
  if (w < 24) w = 24;
  if (filled) {
    display.fillRoundRect(x, y, w, 12, 3, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
  } else {
    display.drawRoundRect(x, y, w, 12, 3, SSD1306_WHITE);
    display.setTextColor(SSD1306_WHITE);
  }
  display.setTextSize(1);
  display.setCursor(x + 4, y + 2);
  display.print(text);
  display.setTextColor(SSD1306_WHITE);
}

void drawValueCard(int x, int y, int w, int h, const char *label) {
  display.drawRoundRect(x, y, w, h, 4, SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(x + 4, y + 3);
  display.print(label);
}

void drawSignalBars(int x, int y, bool good) {
  display.drawRect(x, y + 6, 3, 4, SSD1306_WHITE);
  display.drawRect(x + 5, y + 3, 3, 7, SSD1306_WHITE);
  display.drawRect(x + 10, y, 3, 10, SSD1306_WHITE);
  if (good) {
    display.fillRect(x + 1, y + 7, 1, 2, SSD1306_WHITE);
    display.fillRect(x + 6, y + 4, 1, 5, SSD1306_WHITE);
    display.fillRect(x + 11, y + 1, 1, 8, SSD1306_WHITE);
  } else {
    display.fillRect(x + 1, y + 7, 1, 2, SSD1306_WHITE);
  }
}

void drawProgressBar(int x, int y, int w, int h, int percent) {
  percent = constrain(percent, 0, 100);
  display.drawRoundRect(x, y, w, h, 2, SSD1306_WHITE);
  int fillWidth = map(percent, 0, 100, 0, w - 4);
  if (fillWidth > 0) display.fillRect(x + 2, y + 2, fillWidth, h - 4, SSD1306_WHITE);
}

void drawModernHeader() {
  unsigned long now = millis();
  bool bleOk = bleProvisioningActive || deviceConnected;
  bool wifiOk = (WiFi.status() == WL_CONNECTED) && !bleOk;
  bool mqttOk = mqttClient.connected() && wifiOk;

  resetText();
  drawBatteryIcon(0, 3, getBatteryPercent());
  display.setCursor(22, 3);
  display.print(getBatteryPercent());
  display.print("%");

  // Shared radio UX: in this firmware BLE provisioning and WiFi streaming are treated as exclusive states.
  drawBluetoothIcon(48, 1, bleOk, deviceConnected, now);
  drawWifiIcon(66, 2, wifiOk);
  drawMqttIcon(84, 2, mqttOk);

  drawStatusPill(96, 1, headerStatusShortLabel(), mqttOk);

  display.drawLine(0, 16, 127, 16, SSD1306_WHITE);
}

void drawBootCheckScreen() {
  if (!oledReady) return;

  display.clearDisplay();
  resetText();

  display.setCursor(0, 0);
  display.print("FALL BRACELET");
  drawStatusPill(96, 1, "BOOT", true);
  display.drawLine(0, 16, 127, 16, SSD1306_WHITE);

  display.setCursor(0, 21);
  display.print("OLED");
  oledReady ? drawSmallCheck(36, 21) : drawSmallX(36, 21);

  display.setCursor(0, 34);
  display.print("MPU");
  mpuReady ? drawSmallCheck(36, 34) : drawSmallX(36, 34);

  display.setCursor(70, 21);
  display.print("MAX");
  maxReady ? drawSmallCheck(106, 21) : drawSmallX(106, 21);

  display.setCursor(70, 34);
  display.print("I2C");
  (i2cFoundOled || i2cFoundMax || i2cFoundMpu) ? drawSmallCheck(106, 34) : drawSmallX(106, 34);

  display.drawRoundRect(0, 51, 128, 10, 3, SSD1306_WHITE);
  display.fillRect(2, 53, 124, 6, SSD1306_WHITE);
  display.display();
  delay(BOOT_CHECK_DURATION_MS);
  bootCheckDone = true;
}

void drawPageDots(uint8_t pageCount) {
  int startX = 56;
  int y = 14;
  for (uint8_t i = 0; i < pageCount; i++) {
    int x = startX + (i * 7);
    if (i == oledPage) display.fillCircle(x, y, 1, SSD1306_WHITE);
    else display.drawCircle(x, y, 1, SSD1306_WHITE);
  }
}

void drawHomeDashboardPage() {
  drawModernHeader();
  resetText();

  bool wifiOk = WiFi.status() == WL_CONNECTED;
  bool mqttOk = mqttClient.connected();
  bool setupMode = bleProvisioningActive && !wifiOk;

  const char *title = "CONNECT";
  const char *big = "WiFi";
  const char *sub = "RETRY";

  if (mqttOk) {
    title = "DEVICE";
    big = "LIVE";
    sub = "STREAM 20/s";
  } else if (setupMode) {
    title = "SETUP";
    big = "BLE";
    sub = deviceConnected ? "PHONE LINK" : "PAIRING";
  } else if (wifiOk) {
    title = "NETWORK";
    big = "MQTT";
    sub = "WAITING";
  }

  display.setCursor(0, 20);
  display.print(title);
  drawMqttIcon(110, 20, mqttOk);

  display.setTextSize(2);
  display.setCursor(0, 32);
  display.print(big);
  resetText();
  int subX = 128 - ((int)strlen(sub) * 6);
  if (subX < 58) subX = 58;
  display.setCursor(subX, 37);
  display.print(sub);

  const char *wifiMini = wifiOk ? "OK" : ((hasStoredConfig() || hasPendingProvisioning) ? "RTY" : "NO");
  const char *mqttMini = mqttOk ? "OK" : (wifiOk ? "WAIT" : "--");

  display.setCursor(0, 55);
  display.print("W:");
  display.print(wifiMini);
  display.setCursor(43, 55);
  display.print("M:");
  display.print(mqttMini);
  display.setCursor(91, 55);
  display.print("B:");
  display.print(bleProvisioningActive ? (deviceConnected ? "ON" : "ADV") : "OFF");
}

void drawVitalsDashboardPage() {
  drawModernHeader();
  resetText();

  // Show held values from the last completed 30s session even while MAX30102 is sleeping.
  int displayHr = getDisplayHrBpm();
  int displaySpo2 = getDisplaySpo2();
  bool hrVisible = displayHr > 0;
  bool spo2Visible = displaySpo2 > 0;

  display.drawLine(63, 19, 63, 53, SSD1306_WHITE);

  drawTinyHeart(4, 21);
  display.setCursor(16, 21);
  display.print("BPM");
  display.setTextSize(2);
  display.setCursor(4, 34);
  if (hrVisible) {
    display.print(displayHr);
  } else if (latestMax.fingerDetected && maxPowered) {
    int progress = hrSessionProgressPercent();
    if (hrSessionState == HR_SESSION_MEASURING && progress > 0) {
      display.print(progress);
    } else {
      display.print("...");
    }
  } else {
    display.print("--");
  }
  resetText();

  drawDropIcon(70, 20);
  display.setCursor(82, 21);
  display.print("SpO2");
  display.setTextSize(2);
  display.setCursor(70, 34);
  if (spo2Visible) {
    display.print(displaySpo2);
  } else if (latestMax.fingerDetected && maxPowered) {
    display.print("...");
  } else {
    display.print("--");
  }
  resetText();
  display.setCursor(112, 43);
  display.print("%");

  display.setCursor(0, 56);
  if (maxPowered && latestMax.fingerDetected && hrSessionState == HR_SESSION_MEASURING) {
    drawProgressBar(0, 55, 58, 8, hrSessionProgressPercent());
  } else {
    display.print("Finger ");
    display.print(fingerDisplayLabel());
  }
  drawSignalBars(73, 53, latestMax.ir > SIGNAL_GOOD_IR_THRESHOLD);
  display.setCursor(91, 56);
  if (!maxPowered) display.print("REST");
  else if (hrSessionState == HR_SESSION_MEASURING) display.print("MEAS");
  else if (hrSessionState == HR_SESSION_HOLDING) display.print("HOLD");
  else display.print(signalStrengthLabel());
}

void drawFallDashboardPage() {
  drawModernHeader();
  resetText();

  bool fallCheck = isFallDetectedForDisplay();
  drawWarningIcon(2, 20);
  display.setCursor(18, 21);
  display.print("FALL");

  if (fallCheck) {
    display.fillRoundRect(0, 34, 66, 19, 4, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setTextSize(2);
    display.setCursor(4, 36);
    display.print("CHECK");
    display.setTextColor(SSD1306_WHITE);
  } else {
    display.drawRoundRect(0, 34, 54, 19, 4, SSD1306_WHITE);
    display.setTextSize(2);
    display.setCursor(7, 36);
    display.print("OK");
    resetText();
    display.setCursor(32, 41);
    display.print("SAFE");
  }

  resetText();
  display.setCursor(76, 24);
  display.print("MOTION");
  display.setCursor(76, 36);
  display.print(motionStatusLabel());

  display.setCursor(0, 56);
  display.print("Alert:");
  if (alertStatus == "None") display.print("OK");
  else if (alertStatus == "Sending") display.print("SND");
  else if (alertStatus == "Sent") display.print("SENT");
  else display.print(alertStatus);

  const char *batchMini = (lastBatchSent && millis() - lastBatchSentMs < 3000) ? "SENT" : "WAIT";
  display.setCursor(74, 56);
  display.print("B:");
  display.print(batchMini);
}

void drawReadyToastPage() {
  drawModernHeader();
  resetText();

  display.fillRoundRect(0, 22, 58, 28, 5, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(2);
  display.setCursor(7, 29);
  display.print("LIVE");
  display.setTextColor(SSD1306_WHITE);
  resetText();

  display.setCursor(66, 22);
  display.print("Device OK");
  display.setCursor(66, 34);
  display.print(getShortDeviceId());
  display.setCursor(66, 46);
  display.print("MQTT Ready");
}

#if DEBUG_SCREEN
void drawDebugPage0() {
  drawModernHeader();
  display.setCursor(0, 19);
  display.println("DEBUG I2C");
  display.print("Found:");
  display.println(i2cFoundText);
  display.print("MPU 0x68: ");
  display.println(i2cFoundMpu ? "YES" : "NO");
  display.print("WHO:0x");
  if (mpuWhoAmI < 16) display.print("0");
  display.println(mpuWhoAmI, HEX);
}

void drawDebugPage1() {
  drawModernHeader();
  display.setCursor(0, 19);
  display.println("DEBUG ACC");
  display.print("AX "); display.println(latestMotion.ax, 2);
  display.print("AY "); display.println(latestMotion.ay, 2);
  display.print("AZ "); display.println(latestMotion.az, 2);
}

void drawDebugPage2() {
  drawModernHeader();
  display.setCursor(0, 19);
  display.println("DEBUG GYRO");
  display.print("GX "); display.println(latestMotion.gx, 1);
  display.print("GY "); display.println(latestMotion.gy, 1);
  display.print("GZ "); display.println(latestMotion.gz, 1);
}

void drawDebugPage3() {
  drawModernHeader();
  display.setCursor(0, 19);
  display.println("DEBUG TEMP/MAX");
  display.print("Temp "); display.println(latestMotion.temp, 1);
  display.print("IR "); display.println(latestMax.ir);
  display.print("RED "); display.println(latestMax.red);
}
#endif

unsigned long oledRefreshIntervalMs() {
  if (isFallDetectedForDisplay()) return OLED_FAST_UPDATE_INTERVAL_MS;
  if (deviceConnected || bleProvisioningActive) return OLED_FAST_UPDATE_INTERVAL_MS;
  if (maxPowered && latestMax.fingerDetected) return OLED_FAST_UPDATE_INTERVAL_MS;
  if (mqttClient.connected() || WiFi.status() == WL_CONNECTED) return OLED_ACTIVE_UPDATE_INTERVAL_MS;
  return OLED_IDLE_UPDATE_INTERVAL_MS;
}

void updateOledDisplay(unsigned long now) {
  if (!oledReady || !bootCheckDone) return;
  if (now - lastOledUpdateMs < oledRefreshIntervalMs()) return;
  lastOledUpdateMs = now;

#if DEBUG_SCREEN
  const uint8_t pageCount = 4;
#else
  const uint8_t pageCount = 3;
#endif

  if (mqttClient.connected() && !readyToastShown) {
    readyToastShown = true;
    readyToastStartedMs = now;
  }

  if (now - lastOledPageSwitchMs >= OLED_PAGE_INTERVAL_MS) {
    lastOledPageSwitchMs = now;
    oledPage = (oledPage + 1) % pageCount;
  }

  bool fallCheck = isFallDetectedForDisplay();
  if (fallCheck) {
    alertStatus = mqttClient.connected() ? "Sending" : "None";
  } else if (alertStatus == "Sending" && mqttClient.connected()) {
    alertStatus = "Sent";
  } else if (!fallCheck && millis() - lastBatchSentMs > 5000) {
    alertStatus = "None";
  }

  display.clearDisplay();

#if !DEBUG_SCREEN
  if (readyToastShown && readyToastStartedMs > 0 && now - readyToastStartedMs < READY_TOAST_DURATION_MS) {
    drawReadyToastPage();
    display.display();
    return;
  }
#endif

#if DEBUG_SCREEN
  if (oledPage == 0) drawDebugPage0();
  else if (oledPage == 1) drawDebugPage1();
  else if (oledPage == 2) drawDebugPage2();
  else drawDebugPage3();
  drawPageDots(pageCount);
#else
  if (oledPage == 0) drawHomeDashboardPage();
  else if (oledPage == 1) drawVitalsDashboardPage();
  else drawFallDashboardPage();
  drawPageDots(pageCount);
#endif

  display.display();
}

// =====================================================
// Preferences
// =====================================================
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

void clearSavedWiFi() {
  preferences.clear();
  Serial.println("🧹 Saved provisioning cleared");
}

// =====================================================
// Base64 / Provisioning State
// =====================================================
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

// =====================================================
// BLE Status / Info
// =====================================================
void notifyStatus(const char *stage, bool success, const String &message, int code = 0) {
  if (!statusChar) {
    Serial.printf("STATUS [%s] %s - %s\n", stage, success ? "OK" : "FAIL", message.c_str());
    return;
  }

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

  StaticJsonDocument<512> doc;
  doc["device_id"] = getActiveDeviceId();
  doc["stage"] = stage;
  doc["success"] = success;
  doc["message"] = message;

  if (code != 0) doc["code"] = code;

  if (WiFi.status() == WL_CONNECTED) {
    doc["ip"] = WiFi.localIP().toString();
  }

  char buffer[512];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));

  if (len > 0 && len < sizeof(buffer)) {
    statusChar->setValue((uint8_t *)buffer, len);
    if (deviceConnected) {
      statusChar->notify();
      delay(20);
    }
  }

  Serial.printf("STATUS [%s] %s - %s\n", stage, success ? "OK" : "FAIL", message.c_str());
}

void updateDeviceInfoCharacteristic() {
  if (!deviceInfoChar) return;

  StaticJsonDocument<768> doc;
  doc["device_id"] = getActiveDeviceId();
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["device_type"] = DEVICE_TYPE;
  doc["board"] = BOARD_NAME;
  doc["wifi_connected"] = WiFi.status() == WL_CONNECTED;
  doc["backend_connected"] = mqttClient.connected();
  doc["status"] = connectionStatusLabel();
  doc["battery_level"] = getBatteryPercent();

  doc["i2c_sda"] = I2C_SDA_PIN;
  doc["i2c_scl"] = I2C_SCL_PIN;
  doc["i2c_clock_hz"] = I2C_CLOCK_HZ;

  doc["mpu_ready"] = mpuReady;
  doc["mpu_mode"] = (mpuMode == MPU_MODE_ADAFRUIT) ? "adafruit" : ((mpuMode == MPU_MODE_DIRECT) ? "direct" : "none");
  doc["mpu_who_am_i"] = mpuWhoAmI;
  doc["mpu_sample_rate_hz"] = 20;
  doc["mpu_batch_size"] = MPU_BATCH_SIZE;

  doc["max_ready"] = maxReady;
  doc["max_powered"] = maxPowered;
  doc["max_on_duration_ms"] = MAX_ON_DURATION_MS;
  doc["max_off_duration_ms"] = MAX_OFF_DURATION_MS;
  doc["spo2"] = getDisplaySpo2();
  doc["spo2_valid"] = getDisplaySpo2() > 0;
  doc["heart_rate"] = getDisplayHrBpm();
  doc["heart_rate_valid"] = getDisplayHrBpm() > 0;

  doc["last_error_stage"] = lastErrorStage;
  doc["last_error_message"] = lastErrorMessage;

  char buffer[768];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));
  deviceInfoChar->setValue((uint8_t *)buffer, len);
}

void stopBleAdvertisingOnly() {
  if (!BLEDevice::getInitialized()) return;

  BLEDevice::stopAdvertising();
  bleProvisioningActive = false;
  deviceConnected = false;
  Serial.println("✅ BLE advertising stopped safely on ESP32-C3");
}

void stopBleBeforeWifiConnect() {
  if (BLEDevice::getInitialized()) {
    Serial.println("🛑 Stopping BLE stack before WiFi connection...");
    BLEDevice::stopAdvertising();
    deviceConnected = false;
    bleProvisioningActive = false;
    delay(300);
    BLEDevice::deinit(true);
    delay(1200);
  }
}

// =====================================================
// Provisioning Queue
// =====================================================
bool enqueueRawProvisioningPayload(const String &rawValue) {
  if (rawValue.length() == 0) {
    Serial.println("❌ Empty provisioning payload received");
    return false;
  }

  if (rawValue.length() >= RAW_PROVISIONING_PAYLOAD_SIZE) {
    Serial.printf("❌ Provisioning payload too large: %u bytes\n", rawValue.length());
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
    Serial.println("❌ Provisioning queue overflow");
    setLastError("invalid_data", "Provisioning queue overflow");
    return false;
  }

  Serial.printf("📦 Raw provisioning payload queued: %u bytes (queue=%u)\n",
                rawValue.length(),
                (unsigned int)queueCountAfter);

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

  if (!hasItem) return false;

  value = String(temp);
  return value.length() > 0;
}

// =====================================================
// Sensors
// =====================================================
bool initMpu6050() {
  mpuAddressPresent = i2cDevicePresent(MPU_I2C_ADDRESS);

  Serial.print("📍 MPU I2C address 0x68 present before init: ");
  Serial.println(mpuAddressPresent ? "YES" : "NO");

  Serial.println("🔄 Trying Adafruit_MPU6050 begin...");
  if (mpu.begin(MPU_I2C_ADDRESS, &Wire)) {
    mpu.setAccelerometerRange(MPU6050_RANGE_16_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

    mpuMode = MPU_MODE_ADAFRUIT;
    mpuReady = true;

    uint8_t who = 0x00;
    if (mpuReadRegister(MPU_REG_WHO_AM_I, who)) {
      mpuWhoAmI = who;
    }

    Serial.println("✅ MPU6050 initialized using Adafruit library");
    Serial.print("📌 MPU WHO_AM_I = 0x");
    if (mpuWhoAmI < 16) Serial.print("0");
    Serial.println(mpuWhoAmI, HEX);
    return true;
  }

  Serial.println("⚠️ Adafruit_MPU6050 begin failed");
  Serial.println("ℹ️ Checking direct fallback because scanner may still see 0x68...");

  if (initMpuDirectFallback()) {
    mpuMode = MPU_MODE_DIRECT;
    mpuReady = true;
    return true;
  }

  mpuMode = MPU_MODE_NONE;
  mpuReady = false;
  Serial.println("⚠️ MPU unavailable. Device will continue without motion data.");
  return false;
}

bool initMax30102() {
  Serial.print("📍 MAX30102 I2C address 0x57 present: ");
  Serial.println(i2cDevicePresent(MAX30102_I2C_ADDRESS) ? "YES" : "NO");

  if (!max30102.begin(Wire, 100000)) {
    Serial.println("❌ MAX30102 not found or failed to initialize");
    return false;
  }

  byte ledBrightness = 0x3F;
  byte sampleAverage = 8;
  byte ledMode = 2;      // Red + IR
  int sampleRate = 100;
  int pulseWidth = 411;
  int adcRange = 8192;

  max30102.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);
  max30102.setPulseAmplitudeRed(0x3F);
  max30102.setPulseAmplitudeIR(0x3F);
  max30102.setPulseAmplitudeGreen(0);

  max30102.shutDown();
  maxPowered = false;
  maxPowerStateChangedAtMs = millis();

  Serial.println("✅ MAX30102 initialized and left OFF until vitals measurement is requested");
  return true;
}

void initSensors() {
  scanI2C();

  Serial.println("===== SENSOR INIT START =====");
  mpuReady = initMpu6050();
  maxReady = initMax30102();

  Serial.print("🧭 Final MPU status: ");
  if (mpuMode == MPU_MODE_ADAFRUIT) Serial.println("READY via Adafruit");
  else if (mpuMode == MPU_MODE_DIRECT) Serial.println("READY via Direct Registers");
  else Serial.println("NOT READY");

  Serial.print("💓 Final MAX30102 status: ");
  Serial.println(maxReady ? "READY" : "NOT READY");
  Serial.println("===== SENSOR INIT END =====");
}

void setMaxPower(bool on) {
  if (!maxReady) return;

  if (on && !maxPowered) {
    max30102.wakeUp();
    maxPowered = true;
    maxPowerStateChangedAtMs = millis();

    // New measurement window starts fresh, but old displayed vitals remain
    // until the new 30s session produces a replacement value.
    clearSpo2MeasurementWindowOnly();
#if HR_SESSION_MODE
    hrSessionState = HR_SESSION_IDLE;
    hrSessionStartedMs = 0;
    hrSessionHoldStartedMs = 0;
    hrSessionCount = 0;
    lastSessionHrQuality = 0.0f;
#endif

    latestMax.fingerDetected = false;
    previousFingerDetected = false;

    // Keep OLED values visible during the next ON measuring period.
    if (heldHrValid && heldHrBpm > 0) {
      latestMax.heartRate = heldHrBpm;
      latestMax.beatAvg = heldHrBpm;
    }
    if (heldSpo2Valid && heldSpo2 > 0) {
      latestMax.spo2 = heldSpo2;
      latestMax.spo2Valid = true;
    }

    Serial.println("💓 MAX30102 powered ON - starting new 30s vitals window");
  }

  if (!on && maxPowered) {
    // Finish the HR session before sleeping so the OLED can keep the latest value.
#if HR_SESSION_MODE
    if (hrSessionState == HR_SESSION_MEASURING && hrSessionCount > 0) {
      finishHrMeasurementSession(millis());
    }
#endif

    // Freeze whatever valid value is available before the sensor goes to sleep.
    if (latestMax.beatAvg > 0) commitHeldHeartRate(latestMax.beatAvg, millis());
    if (latestMax.spo2Valid && latestMax.spo2 > 0) commitHeldSpo2(latestMax.spo2, millis());

    max30102.shutDown();
    maxPowered = false;
    maxPowerStateChangedAtMs = millis();

    // Do NOT clear latestMax.beatAvg or latestMax.spo2 here.
    // The display must keep the last calculated values while MAX is OFF.
    clearSpo2MeasurementWindowOnly();

    Serial.println("💤 MAX30102 powered OFF - holding last HR/SpO2 on OLED");
  }
}

int vitalsProgressPercent(unsigned long now) {
  if (!vitalsMeasurementActive || vitalsMeasurementStartedMs == 0) return 0;
  unsigned long elapsed = now - vitalsMeasurementStartedMs;
  if (elapsed >= vitalsMeasurementDurationMs) return 100;
  return (int)((elapsed * 100UL) / vitalsMeasurementDurationMs);
}

void publishVitalsStatus(const char *state, unsigned long now) {
  if (!mqttClient.connected() || provisionedDeviceId.isEmpty()) return;

  StaticJsonDocument<768> doc;
  char timestamp[32];
  isoTimestamp(timestamp, sizeof(timestamp));

  bool finalState = strcmp(state, "complete") == 0 || strcmp(state, "stopped") == 0 || strcmp(state, "error") == 0;
  bool hrValid = activeVitalsHrValid && activeVitalsHrBpm > 0;
  bool spo2Valid = activeVitalsSpo2Valid && activeVitalsSpo2 > 0 && hrValid;
  int hr = hrValid ? activeVitalsHrBpm : 0;
  int spo2 = spo2Valid ? activeVitalsSpo2 : 0;
  const char *signalStatus = finalState
    ? (activeVitalsGoodSignalSeen ? "good" : (activeVitalsFingerSeen ? "weak_signal" : "place_finger"))
    : vitalsSignalStatusLabel();

  doc["message_type"] = "vitals_status";
  doc["device_id"] = provisionedDeviceId;
  doc["user_id"] = provisionedUserId;
  doc["request_id"] = activeVitalsRequestId;
  doc["vitals_trigger"] = activeVitalsTrigger;
  doc["state"] = state;
  doc["progress_percent"] = strcmp(state, "complete") == 0 ? 100 : vitalsProgressPercent(now);
  doc["finger_detected"] = latestMax.fingerDetected;
  doc["heart_rate"] = hr;
  doc["spo2"] = spo2;
  doc["heart_rate_valid"] = hrValid;
  doc["spo2_valid"] = spo2Valid;
  doc["max_powered"] = maxPowered;
  doc["signal_status"] = signalStatus;
  doc["last_heart_rate"] = getDisplayHrBpm();
  doc["last_spo2"] = getDisplaySpo2();
  doc["hr_quality"] = activeVitalsHrQuality;
  doc["finger_seen"] = activeVitalsFingerSeen;
  doc["good_signal_seen"] = activeVitalsGoodSignalSeen;
  doc["timestamp"] = timestamp;

  char buffer[768];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));
  if (len > 0 && len < sizeof(buffer)) {
    mqttClient.publish(mqttTopic.c_str(), buffer);
    Serial.print("📤 Vitals status: ");
    Serial.println(buffer);
  }
}

void startVitalsMeasurement(const String &requestId, const String &trigger, unsigned long durationMs, unsigned long now) {
  activeVitalsRequestId = requestId.length() > 0 ? requestId : String("local-") + String(now);
  activeVitalsTrigger = trigger.length() > 0 ? trigger : "manual";
  vitalsMeasurementDurationMs = constrain(durationMs, VITALS_MIN_DURATION_MS, VITALS_MAX_DURATION_MS);
  vitalsMeasurementStartedMs = now;
  lastVitalsStatusPublishMs = 0;
  activeVitalsHrBpm = 0;
  activeVitalsHrValid = false;
  activeVitalsSpo2 = 0;
  activeVitalsSpo2Valid = false;
  activeVitalsHrQuality = 0.0f;
  activeVitalsFingerSeen = false;
  activeVitalsGoodSignalSeen = false;

  if (!maxReady) {
    Serial.println("⚠️ Vitals requested but MAX30102 is not ready");
    publishVitalsStatus("error", now);
    vitalsMeasurementActive = false;
    vitalsMeasurementStartedMs = 0;
    return;
  }

  vitalsMeasurementActive = true;

  resetHeartRateEstimator();
  clearSpo2MeasurementWindowOnly();
  setMaxPower(true);

  Serial.print("💓 Vitals measurement started request_id=");
  Serial.print(activeVitalsRequestId);
  Serial.print(" trigger=");
  Serial.println(activeVitalsTrigger);
  publishVitalsStatus("measuring", now);
}

void stopVitalsMeasurement(const char *state, unsigned long now) {
  if (!vitalsMeasurementActive && !maxPowered) return;

#if HR_SESSION_MODE
  if (hrSessionState == HR_SESSION_MEASURING && hrSessionCount > 0) {
    finishHrMeasurementSession(now);
  }
#endif

  setMaxPower(false);
  publishVitalsStatus(state, now);
  vitalsMeasurementActive = false;
  vitalsMeasurementStartedMs = 0;
  lastVitalsStatusPublishMs = 0;

  Serial.print("💤 Vitals measurement stopped state=");
  Serial.println(state);
}

void updateMaxPowerState(unsigned long now) {
  if (!maxReady) return;

  if (!vitalsMeasurementActive) {
    if (maxPowered) setMaxPower(false);
    return;
  }

  if (!maxPowered) {
    setMaxPower(true);
    return;
  }

  if (lastVitalsStatusPublishMs == 0 || now - lastVitalsStatusPublishMs >= VITALS_STATUS_INTERVAL_MS) {
    lastVitalsStatusPublishMs = now;
    publishVitalsStatus("measuring", now);
  }

  if (now - vitalsMeasurementStartedMs >= vitalsMeasurementDurationMs) {
    stopVitalsMeasurement("complete", now);
    return;
  }
}

bool sampleMpuAdafruit(MotionSample &s) {
  sensors_event_t accelEvent;
  sensors_event_t gyroEvent;
  sensors_event_t tempEvent;
  mpu.getEvent(&accelEvent, &gyroEvent, &tempEvent);

  s.ax = accelEvent.acceleration.x;
  s.ay = accelEvent.acceleration.y;
  s.az = accelEvent.acceleration.z;

  s.gx = gyroEvent.gyro.x * 180.0f / PI;
  s.gy = gyroEvent.gyro.y * 180.0f / PI;
  s.gz = gyroEvent.gyro.z * 180.0f / PI;

  s.temp = tempEvent.temperature;
  s.accMag = sqrt((s.ax * s.ax) + (s.ay * s.ay) + (s.az * s.az));
  s.gyroMag = sqrt((s.gx * s.gx) + (s.gy * s.gy) + (s.gz * s.gz));
  s.t = millis();
  return true;
}

void sampleMpuNow() {
  if (!mpuReady || mpuMode == MPU_MODE_NONE) return;

  MotionSample s;
  bool ok = false;

  if (mpuMode == MPU_MODE_ADAFRUIT) {
    ok = sampleMpuAdafruit(s);
  } else if (mpuMode == MPU_MODE_DIRECT) {
    ok = readMpuDirectSample(s);
  }

  if (!ok) {
    Serial.println("⚠️ MPU sample failed. Keeping last sample.");
    return;
  }

  latestMotion = s;
  motionSamples[motionWriteIndex] = s;
  motionWriteIndex = (motionWriteIndex + 1) % MPU_BATCH_SIZE;

  if (motionCount < MPU_BATCH_SIZE) motionCount++;
}

void resetHeartRateEstimator() {
  // Reset temporary HR detection state only.
  // Keep latestMax.beatAvg / lastSessionHrValid so OLED keeps the last completed
  // measurement while MAX is off or during brief finger contact loss.
  memset(rates, 0, sizeof(rates));
#if HR_USE_AUTOCORRELATION
  memset(hrIrBuffer, 0, sizeof(hrIrBuffer));
  memset(hrWorkBuffer, 0, sizeof(hrWorkBuffer));
#endif
  rateSpot = 0;
  lastBeat = 0;
  hrCandidateBpm = 0;
  hrCandidateHits = 0;
  fingerStableSinceMs = 0;
  previousFingerDetected = false;
  hrDcEstimate = 0.0f;
  hrPrev2 = 0.0f;
  hrPrev1 = 0.0f;
  hrAcAvg = 0.0f;
  lastSimplePeakMs = 0;
  lastHrAnalysisMs = 0;
  fingerMissingStartedMs = 0;
  hrAutocorrQuality = 0.0f;
  hrFilteredBpm = 0.0f;
#if HR_USE_AUTOCORRELATION
  hrBufferIndex = 0;
  hrBufferCount = 0;
#endif
#if HR_SESSION_MODE
  hrSessionState = HR_SESSION_IDLE;
  hrSessionStartedMs = 0;
  hrSessionHoldStartedMs = 0;
  hrSessionCount = 0;
  lastSessionHrQuality = 0.0f;
#endif

  // Restore the OLED-facing values after clearing temporary detection state.
  if (heldHrValid && heldHrBpm > 0) {
    latestMax.heartRate = heldHrBpm;
    latestMax.beatAvg = heldHrBpm;
  }
  if (heldSpo2Valid && heldSpo2 > 0) {
    latestMax.spo2 = heldSpo2;
    latestMax.spo2Valid = true;
  }
}

int countValidRates() {
  int validRates = 0;
  for (byte i = 0; i < RATE_SIZE; i++) {
    if (rates[i] > 0) validRates++;
  }
  return validRates;
}

int averageValidRates() {
  byte values[RATE_SIZE];
  int validRates = 0;

  for (byte i = 0; i < RATE_SIZE; i++) {
    if (rates[i] > 0) {
      values[validRates++] = rates[i];
    }
  }

  if (validRates == 0) return 0;

  for (int i = 0; i < validRates - 1; i++) {
    for (int j = i + 1; j < validRates; j++) {
      if (values[j] < values[i]) {
        byte temp = values[i];
        values[i] = values[j];
        values[j] = temp;
      }
    }
  }

  if (validRates >= 5) {
    int sum = 0;
    for (int i = 1; i < validRates - 1; i++) sum += values[i];
    return sum / (validRates - 2);
  }

  if (validRates >= 3) {
    return values[validRates / 2];
  }

  int sum = 0;
  for (int i = 0; i < validRates; i++) sum += values[i];
  return sum / validRates;
}

int hrSessionProgressPercent() {
  if (hrSessionState != HR_SESSION_MEASURING || hrSessionStartedMs == 0) return 0;
  unsigned long elapsed = millis() - hrSessionStartedMs;
  if (elapsed >= HR_MEASURE_DURATION_MS) return 100;
  return (int)((elapsed * 100UL) / HR_MEASURE_DURATION_MS);
}

void startHrMeasurementSession(unsigned long now) {
#if HR_SESSION_MODE
  hrSessionState = HR_SESSION_MEASURING;
  hrSessionStartedMs = now;
  hrSessionHoldStartedMs = 0;
  hrSessionCount = 0;
  lastSessionHrQuality = 0.0f;
#endif
}

void addHrSessionSample(uint32_t irValue) {
#if HR_SESSION_MODE
  if (hrSessionState != HR_SESSION_MEASURING) return;
  if (hrSessionCount < HR_SESSION_BUFFER_SIZE) {
    hrSessionIrBuffer[hrSessionCount++] = irValue;
  }
#endif
}

float goertzelPower(const float *x, int n, float sampleRateHz, float bpm) {
  float freq = bpm / 60.0f;
  float omega = 2.0f * PI * freq / sampleRateHz;
  float coeff = 2.0f * cosf(omega);
  float q0 = 0.0f;
  float q1 = 0.0f;
  float q2 = 0.0f;

  for (int i = 0; i < n; i++) {
    q0 = coeff * q1 - q2 + x[i];
    q2 = q1;
    q1 = q0;
  }

  return (q1 * q1) + (q2 * q2) - (coeff * q1 * q2);
}

bool analyzeHrSessionGoertzel(int &bpmOut, float &qualityOut) {
#if !HR_SESSION_MODE
  return false;
#else
  bpmOut = 0;
  qualityOut = 0.0f;

  if (hrSessionCount < 1200) return false; // at least 12 sec of data

  int dsCount = hrSessionCount / HR_DOWNSAMPLE_FACTOR;
  if (dsCount > HR_DOWNSAMPLED_MAX) dsCount = HR_DOWNSAMPLED_MAX;
  if (dsCount < 300) return false;

  double mean = 0.0;
  for (int i = 0; i < dsCount; i++) {
    uint32_t sum = 0;
    int base = i * HR_DOWNSAMPLE_FACTOR;
    for (int k = 0; k < HR_DOWNSAMPLE_FACTOR; k++) sum += hrSessionIrBuffer[base + k];
    float v = (float)sum / (float)HR_DOWNSAMPLE_FACTOR;
    hrSessionWork[i] = v;
    mean += v;
  }
  mean /= (double)dsCount;

  double energy = 0.0;
  for (int i = 0; i < dsCount; i++) {
    float centered = hrSessionWork[i] - (float)mean;
    hrSessionWork[i] = centered;
    energy += (double)centered * (double)centered;
  }

  float rms = sqrt(energy / (double)dsCount);
  if (rms < HR_SESSION_MIN_RMS) return false;

  // Light smoothing. This keeps the pulse wave but removes sharp sample noise.
  for (int i = 2; i < dsCount - 2; i++) {
    hrSessionWork[i] = (hrSessionWork[i - 2] + hrSessionWork[i - 1] + hrSessionWork[i] + hrSessionWork[i + 1] + hrSessionWork[i + 2]) / 5.0f;
  }

  const float fs = (float)HR_SESSION_SAMPLE_RATE_HZ / (float)HR_DOWNSAMPLE_FACTOR;
  float bestPower = 0.0f;
  float secondPower = 0.0f;
  int bestBpm = 0;

  for (int bpm = HR_MIN_BPM; bpm <= HR_MAX_BPM; bpm++) {
    float p = goertzelPower(hrSessionWork, dsCount, fs, (float)bpm);
    if (p > bestPower) {
      secondPower = bestPower;
      bestPower = p;
      bestBpm = bpm;
    } else if (p > secondPower) {
      secondPower = p;
    }
  }

  if (bestBpm <= 0) return false;

  // If the second harmonic wins, prefer the fundamental when it is strong enough.
  if (bestBpm > 95) {
    int half = bestBpm / 2;
    if (half >= HR_MIN_BPM && half <= HR_MAX_BPM) {
      float halfPower = goertzelPower(hrSessionWork, dsCount, fs, (float)half);
      if (halfPower > bestPower * 0.42f) {
        bestBpm = half;
        bestPower = halfPower;
      }
    }
  }

  float ratio = bestPower / (secondPower + 1.0f);
  qualityOut = ratio;

  int estimated = bestBpm;

  // Smooth against previous accepted HR to avoid sudden unrealistic jumps.
  if (latestMax.beatAvg > 0) {
    int jump = abs(estimated - latestMax.beatAvg);
    if (jump > 30) estimated = (estimated + (2 * latestMax.beatAvg)) / 3;
  }

  estimated = constrain(estimated, HR_MIN_BPM, HR_MAX_BPM);
  bpmOut = estimated;
  return true;
#endif
}


bool analyzeHrSessionPeaks(int &bpmOut, float &qualityOut) {
#if !HR_SESSION_MODE
  return false;
#else
  bpmOut = 0;
  qualityOut = 0.0f;

  if (hrSessionCount < 1200) return false;

  int dsCount = hrSessionCount / HR_DOWNSAMPLE_FACTOR;
  if (dsCount > HR_DOWNSAMPLED_MAX) dsCount = HR_DOWNSAMPLED_MAX;
  if (dsCount < 300) return false;

  double mean = 0.0;
  for (int i = 0; i < dsCount; i++) {
    uint32_t sum = 0;
    int base = i * HR_DOWNSAMPLE_FACTOR;
    for (int k = 0; k < HR_DOWNSAMPLE_FACTOR; k++) sum += hrSessionIrBuffer[base + k];
    float v = (float)sum / (float)HR_DOWNSAMPLE_FACTOR;
    hrSessionWork[i] = v;
    mean += v;
  }
  mean /= (double)dsCount;

  double energy = 0.0;
  for (int i = 0; i < dsCount; i++) {
    float centered = hrSessionWork[i] - (float)mean;
    hrSessionWork[i] = centered;
    energy += (double)centered * (double)centered;
  }

  float rms = sqrt(energy / (double)dsCount);
  if (rms < 6.0f) return false;

  // Smooth enough to remove sample noise but keep the pulse wave.
  for (int i = 2; i < dsCount - 2; i++) {
    hrSessionWork[i] = (hrSessionWork[i - 2] + hrSessionWork[i - 1] + hrSessionWork[i] + hrSessionWork[i + 1] + hrSessionWork[i + 2]) / 5.0f;
  }

  const float fs = (float)HR_SESSION_SAMPLE_RATE_HZ / (float)HR_DOWNSAMPLE_FACTOR;
  int minDistance = (int)((fs * 60.0f) / (float)HR_MAX_BPM);
  int maxDistance = (int)((fs * 60.0f) / (float)HR_MIN_BPM);
  if (minDistance < 3) minDistance = 3;

  float threshold = rms * 0.45f;
  if (threshold < 8.0f) threshold = 8.0f;

  int intervals[64];
  int intervalCount = 0;
  int lastPeak = -10000;

  for (int i = 2; i < dsCount - 2; i++) {
    bool localMax = (hrSessionWork[i] > hrSessionWork[i - 1]) &&
                    (hrSessionWork[i] >= hrSessionWork[i + 1]) &&
                    (hrSessionWork[i] > threshold);

    if (!localMax) continue;

    int distance = i - lastPeak;
    if (lastPeak < 0 || distance >= minDistance) {
      if (lastPeak >= 0 && distance <= maxDistance && intervalCount < 64) {
        intervals[intervalCount++] = distance;
      }
      lastPeak = i;
    }
  }

  if (intervalCount < 3) return false;

  // Sort intervals and use the median interval for stability.
  for (int i = 0; i < intervalCount - 1; i++) {
    for (int j = i + 1; j < intervalCount; j++) {
      if (intervals[j] < intervals[i]) {
        int tmp = intervals[i];
        intervals[i] = intervals[j];
        intervals[j] = tmp;
      }
    }
  }

  int medianDistance = intervals[intervalCount / 2];
  if (medianDistance <= 0) return false;

  int bpm = (int)round((fs * 60.0f) / (float)medianDistance);
  if (bpm < HR_MIN_BPM || bpm > HR_MAX_BPM) return false;

  bpmOut = bpm;
  qualityOut = (float)intervalCount / 12.0f;
  return true;
#endif
}

void finishHrMeasurementSession(unsigned long now) {
#if HR_SESSION_MODE
  int bpm = 0;
  float quality = 0.0f;

  bool ok = analyzeHrSessionGoertzel(bpm, quality);

  // If frequency scan cannot lock because the signal is weak, try a peak-interval
  // session analysis. This still uses the full 30s window and is safer than instant peaks.
  if (!ok || bpm <= 0) {
    ok = analyzeHrSessionPeaks(bpm, quality);
  }

  if (ok && bpm > 0 && quality >= 0.35f) {
    // Smooth against the previous completed session. Do not allow a sudden 50->120 jump
    // unless the new window keeps confirming it in later sessions.
    if (latestMax.beatAvg > 0 && abs(bpm - latestMax.beatAvg) > 35) {
      bpm = (bpm + latestMax.beatAvg) / 2;
    }

    bpm = constrain(bpm, HR_MIN_BPM, HR_MAX_BPM);

    lastSessionHrQuality = quality;
    activeVitalsHrQuality = quality;
    commitHeldHeartRate(bpm, now);

    memset(rates, 0, sizeof(rates));
    rates[0] = (byte)bpm;
    rateSpot = 1;

    Serial.print("✅ HR session complete BPM=");
    Serial.print(bpm);
    Serial.print(" quality=");
    Serial.println(quality, 2);
  } else {
    // Keep the old value on screen if the new session was not good enough.
    activeVitalsHrQuality = quality;
    Serial.println("⚠️ HR session ended without a reliable BPM. Keeping previous displayed HR.");
  }

  hrSessionState = HR_SESSION_HOLDING;
  hrSessionHoldStartedMs = now;
  hrSessionCount = 0;
#endif
}

void updateHrMeasurementSession(uint32_t irValue) {
#if HR_SESSION_MODE
  unsigned long now = millis();

  if (!latestMax.fingerDetected || !maxPowered) return;

  if (hrSessionState == HR_SESSION_IDLE) {
    startHrMeasurementSession(now);
  }

  if (hrSessionState == HR_SESSION_MEASURING) {
    addHrSessionSample(irValue);
    if (now - hrSessionStartedMs >= HR_MEASURE_DURATION_MS || hrSessionCount >= HR_SESSION_BUFFER_SIZE) {
      finishHrMeasurementSession(now);
    }
    return;
  }

  if (hrSessionState == HR_SESSION_HOLDING) {
    if (now - hrSessionHoldStartedMs >= HR_HOLD_DURATION_MS) {
      startHrMeasurementSession(now);
    }
  }
#endif
}

bool confirmBpmCandidate(int bpm) {
  if (hrCandidateBpm == 0 || abs(bpm - hrCandidateBpm) > HR_CANDIDATE_TOLERANCE_BPM) {
    hrCandidateBpm = bpm;
    hrCandidateHits = 1;
    return false;
  }

  if (hrCandidateHits < 255) hrCandidateHits++;
  return hrCandidateHits >= HR_REQUIRED_CONFIRMATIONS;
}

void acceptHeartRateBpm(float beatsPerMinute) {
  int bpm = (int)(beatsPerMinute + 0.5f);

  if (bpm < HR_MIN_BPM || bpm > HR_MAX_BPM) return;
  if (fingerStableSinceMs == 0 || millis() - fingerStableSinceMs < HR_FINGER_STABLE_MS) return;
  if (mpuReady && (latestMotion.accMag > 17.5f || latestMotion.gyroMag > 110.0f)) return;

  int currentAvg = latestMax.beatAvg;

  if (currentAvg <= 0) {
    if (!confirmBpmCandidate(bpm)) return;
  } else {
    int jump = abs(bpm - currentAvg);

    if (jump > HR_MAX_JUMP_BPM) {
      if (!confirmBpmCandidate(bpm)) return;
      bpm = (bpm + currentAvg) / 2;
    } else {
      hrCandidateBpm = 0;
      hrCandidateHits = 0;
    }
  }

  rates[rateSpot++] = (byte)bpm;
  rateSpot %= RATE_SIZE;

  latestMax.heartRate = bpm;
  latestMax.beatAvg = averageValidRates();
  if (latestMax.beatAvg > 0) commitHeldHeartRate(latestMax.beatAvg, millis());
}


void addHeartRateIrSample(uint32_t irValue) {
#if HR_USE_AUTOCORRELATION
  hrIrBuffer[hrBufferIndex] = irValue;
  hrBufferIndex = (hrBufferIndex + 1) % HR_BUFFER_SIZE;
  if (hrBufferCount < HR_BUFFER_SIZE) hrBufferCount++;
#endif
}

void acceptAutocorrHeartRateBpm(float bpm, float quality) {
  if (bpm < HR_MIN_BPM || bpm > HR_MAX_BPM) return;
  if (fingerStableSinceMs == 0 || millis() - fingerStableSinceMs < HR_FINGER_STABLE_MS) return;

  int newBpm = (int)(bpm + 0.5f);

  if (latestMax.beatAvg > 0) {
    int jump = abs(newBpm - latestMax.beatAvg);
    if (jump > HR_MAX_JUMP_BPM && quality < 0.32f) {
      // Keep the old value unless the periodic signal is strong enough.
      return;
    }

    if (jump > HR_MAX_JUMP_BPM) {
      newBpm = (newBpm + latestMax.beatAvg) / 2;
    }
  }

  if (hrFilteredBpm <= 1.0f) hrFilteredBpm = (float)newBpm;
  else hrFilteredBpm = (0.72f * hrFilteredBpm) + (0.28f * (float)newBpm);

  rates[rateSpot++] = (byte)((int)(hrFilteredBpm + 0.5f));
  rateSpot %= RATE_SIZE;

  latestMax.heartRate = (int)(hrFilteredBpm + 0.5f);
  latestMax.beatAvg = averageValidRates();
  if (latestMax.beatAvg <= 0) latestMax.beatAvg = latestMax.heartRate;

  commitHeldHeartRate(latestMax.beatAvg, millis());
  hrAutocorrQuality = quality;
}

bool updateHeartRateFromAutocorrelation() {
#if !HR_USE_AUTOCORRELATION
  return false;
#else
  unsigned long now = millis();
  if (now - lastHrAnalysisMs < HR_ANALYSIS_INTERVAL_MS) return false;
  lastHrAnalysisMs = now;

  if (!latestMax.fingerDetected || !maxPowered) return false;
  if (fingerStableSinceMs == 0 || now - fingerStableSinceMs < 3500) return false;

  int n = hrBufferCount;
  if (n > HR_ANALYSIS_SAMPLES) n = HR_ANALYSIS_SAMPLES;
  if (n < 350) return false; // Need at least 3.5 sec at 100Hz.

  // Use the last n samples from the ring buffer in chronological order.
  double mean = 0.0;
  for (int i = 0; i < n; i++) {
    int idx = hrBufferIndex - n + i;
    while (idx < 0) idx += HR_BUFFER_SIZE;
    idx %= HR_BUFFER_SIZE;
    mean += (double)hrIrBuffer[idx];
  }
  mean /= (double)n;

  double energy = 0.0;
  for (int i = 0; i < n; i++) {
    int idx = hrBufferIndex - n + i;
    while (idx < 0) idx += HR_BUFFER_SIZE;
    idx %= HR_BUFFER_SIZE;
    float centered = (float)((double)hrIrBuffer[idx] - mean);
    hrWorkBuffer[i] = centered;
    energy += (double)centered * (double)centered;
  }

  float rms = sqrt(energy / (double)n);
  if (rms < 35.0f) return false; // Finger is present, but pulse amplitude is too weak.

  // Smooth very lightly to reduce I2C/sample noise without flattening the pulse.
  for (int i = 2; i < n - 2; i++) {
    hrWorkBuffer[i] = (hrWorkBuffer[i - 2] + hrWorkBuffer[i - 1] + hrWorkBuffer[i] + hrWorkBuffer[i + 1] + hrWorkBuffer[i + 2]) / 5.0f;
  }

  const int sampleRateHz = 100;
  int minLag = (sampleRateHz * 60) / HR_MAX_BPM;
  int maxLag = (sampleRateHz * 60) / HR_MIN_BPM;
  if (minLag < 1) minLag = 1;
  if (maxLag > n / 2) maxLag = n / 2;

  float bestCorr = -1.0f;
  int bestLag = 0;

  for (int lag = minLag; lag <= maxLag; lag++) {
    double corr = 0.0;
    double e0 = 0.0;
    double e1 = 0.0;

    for (int i = 0; i < n - lag; i++) {
      float a = hrWorkBuffer[i];
      float b = hrWorkBuffer[i + lag];
      corr += (double)a * (double)b;
      e0 += (double)a * (double)a;
      e1 += (double)b * (double)b;
    }

    if (e0 <= 1.0 || e1 <= 1.0) continue;
    float c = (float)(corr / sqrt(e0 * e1));

    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < HR_MIN_AUTOCORR_QUALITY) {
    return false;
  }

  float bpm = 6000.0f / (float)bestLag;
  if (bpm < HR_MIN_BPM || bpm > HR_MAX_BPM) return false;

  // If the user is moving, only accept strong correlations; otherwise hold the old value.
  if (mpuReady && (latestMotion.accMag > 18.5f || latestMotion.gyroMag > 130.0f) && bestCorr < 0.34f) {
    return false;
  }

  int beforeAvg = latestMax.beatAvg;
  acceptAutocorrHeartRateBpm(bpm, bestCorr);
  return latestMax.beatAvg != beforeAvg || latestMax.heartRate > 0;
#endif
}

bool updateSimpleHeartRateFallback(long irValue) {
#if !MAX_USE_SOFT_HR_FALLBACK
  return false;
#else
  if (fingerStableSinceMs == 0 || millis() - fingerStableSinceMs < HR_FINGER_STABLE_MS + 1500) return false;
  if (latestMax.ir < FINGER_IR_THRESHOLD) return false;
  if (mpuReady && (latestMotion.accMag > 17.0f || latestMotion.gyroMag > 105.0f)) return false;

  unsigned long now = millis();

  if (hrDcEstimate <= 1.0f) {
    hrDcEstimate = (float)irValue;
    hrPrev2 = 0.0f;
    hrPrev1 = 0.0f;
    hrAcAvg = 0.0f;
    return false;
  }

  hrDcEstimate = (0.975f * hrDcEstimate) + (0.025f * (float)irValue);
  float ac = (float)irValue - hrDcEstimate;
  hrAcAvg = (0.975f * hrAcAvg) + (0.025f * fabsf(ac));

  float dynamicThreshold = hrAcAvg * 1.9f;
  if (dynamicThreshold < 320.0f) dynamicThreshold = 320.0f;
  if (dynamicThreshold > 5200.0f) dynamicThreshold = 5200.0f;

  bool isPeak = (hrPrev1 > hrPrev2) && (hrPrev1 > ac) && (hrPrev1 > dynamicThreshold);

  hrPrev2 = hrPrev1;
  hrPrev1 = ac;

  if (!isPeak) return false;

  if (lastSimplePeakMs == 0) {
    lastSimplePeakMs = now;
    return false;
  }

  unsigned long delta = now - lastSimplePeakMs;
  unsigned long minDelta = 60000UL / HR_MAX_BPM;
  unsigned long maxDelta = 60000UL / HR_MIN_BPM;

  if (delta < minDelta) return false;

  if (delta > maxDelta) {
    lastSimplePeakMs = now;
    return false;
  }

  lastSimplePeakMs = now;
  float bpm = 60000.0f / (float)delta;
  int beforeAvg = latestMax.beatAvg;
  acceptHeartRateBpm(bpm);
  return latestMax.beatAvg != beforeAvg || latestMax.heartRate > 0;
#endif
}

void sampleMaxNow() {
  if (!maxReady || !maxPowered) return;

  unsigned long now = millis();
  long irValue = max30102.getIR();
  long redValue = max30102.getRed();

  latestMax.ir = (uint32_t)irValue;
  latestMax.red = (uint32_t)redValue;
  latestMax.t = now;

  bool rawFingerDetected = (irValue > FINGER_IR_THRESHOLD) && (redValue > 1000);

  if (!rawFingerDetected) {
    // Do not reset HR immediately on a short optical dip. Optical sensors can lose
    // contact for a few samples because of pressure, skin motion, or ambient light.
    if (previousFingerDetected && lastFingerDetectedMs > 0 && (now - lastFingerDetectedMs < FINGER_LOST_GRACE_MS)) {
      latestMax.fingerDetected = true;
      return;
    }

    latestMax.fingerDetected = false;
    resetHeartRateEstimator();
    clearSpo2MeasurementWindowOnly();
    holdLastSpo2OrInvalidate();
    return;
  }

  latestMax.fingerDetected = true;
  lastFingerDetectedMs = now;

  if (vitalsMeasurementActive) {
    activeVitalsFingerSeen = true;
    if (irValue > SIGNAL_GOOD_IR_THRESHOLD && redValue > 8000) {
      activeVitalsGoodSignalSeen = true;
    }
  }

  if (!previousFingerDetected) {
    previousFingerDetected = true;
    fingerStableSinceMs = now;
    lastBeat = 0;
    hrCandidateBpm = 0;
    hrCandidateHits = 0;
    hrDcEstimate = 0.0f;
    hrPrev2 = 0.0f;
    hrPrev1 = 0.0f;
    hrAcAvg = 0.0f;
    lastSimplePeakMs = 0;
    // Start a fresh measurement session, but keep the previous completed HR visible
    // until this new 30s session produces a replacement.
    lastHrAnalysisMs = 0;
    fingerMissingStartedMs = 0;
    hrAutocorrQuality = 0.0f;
    hrFilteredBpm = 0.0f;
#if HR_USE_AUTOCORRELATION
    hrBufferIndex = 0;
    hrBufferCount = 0;
    memset(hrIrBuffer, 0, sizeof(hrIrBuffer));
#endif
    memset(rates, 0, sizeof(rates));
    rateSpot = 0;
    startHrMeasurementSession(now);
  }

  addHeartRateIrSample((uint32_t)irValue);
  updateSpo2Estimator((uint32_t)redValue, (uint32_t)irValue);
  updateHrMeasurementSession((uint32_t)irValue);

  bool beatAccepted = false;

  // Primary HR path: window autocorrelation over raw IR. This is more robust for
  // modules where SparkFun checkForBeat() fails to fire.
  beatAccepted = updateHeartRateFromAutocorrelation();

  // Secondary path: SparkFun beat detector, optional. Session mode is the primary HR source.
#if HR_ALLOW_INSTANT_BEAT
  if (checkForBeat(irValue)) {
    if (lastBeat == 0) {
      lastBeat = now;
    } else {
      long delta = now - lastBeat;
      lastBeat = now;

      if (delta > 0) {
        float beatsPerMinute = 60000.0f / (float)delta;
        int beforeAvg = latestMax.beatAvg;
        acceptHeartRateBpm(beatsPerMinute);
        beatAccepted = beatAccepted || latestMax.beatAvg != beforeAvg || latestMax.heartRate > 0;
      }
    }
  }
#endif

  // Last resort: simple peak detector. Kept conservative to avoid 180/200 BPM noise.
  if (!beatAccepted) {
    updateSimpleHeartRateFallback(irValue);
  }

#if MAX_HR_DEBUG
  if (millis() - lastMaxDebugPrintMs >= 1000) {
    lastMaxDebugPrintMs = millis();
    Serial.print("MAX IR=");
    Serial.print(latestMax.ir);
    Serial.print(" RED=");
    Serial.print(latestMax.red);
    Serial.print(" Finger=");
    Serial.print(latestMax.fingerDetected ? "YES" : "NO");
    Serial.print(" HR=");
    Serial.print(latestMax.beatAvg);
    Serial.print(" HRq=");
    Serial.print(hrAutocorrQuality, 2);
    Serial.print(" SpO2=");
    Serial.print(latestMax.spo2Valid ? latestMax.spo2 : 0);
    Serial.print(" Powered=");
    Serial.println(maxPowered ? "ON" : "OFF");
  }
#endif
}

void readSensorsIfDue(unsigned long now) {
  if (mpuReady && (now - lastMpuSampleMs >= MPU_SAMPLE_INTERVAL_MS)) {
    lastMpuSampleMs = now;
    sampleMpuNow();
  }

  updateMaxPowerState(now);

  if (maxReady && maxPowered && (now - lastMaxSampleMs >= MAX_SAMPLE_INTERVAL_MS)) {
    lastMaxSampleMs = now;
    sampleMaxNow();
  }
}

void clearMotionBatchAfterPublish() {
  motionWriteIndex = 0;
  motionCount = 0;
}

// =====================================================
// Time + MQTT Batch Telemetry JSON
// =====================================================
void syncTimeIfNeeded() {
  if (timeSynced || WiFi.status() != WL_CONNECTED) return;

  Serial.println("⏱️ Syncing time with NTP...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  unsigned long startMs = millis();
  while (millis() - startMs < 6000) {
    time_t now = time(nullptr);
    if (now > 1700000000) {
      timeSynced = true;
      Serial.println("✅ Time synced");
      return;
    }
    delay(250);
  }

  Serial.println("⚠️ Time sync not ready yet. Backend may use received_at if timestamp is old.");
}

void isoTimestamp(char *buffer, size_t bufferSize) {
  if (!buffer || bufferSize == 0) return;

  time_t now = time(nullptr);
  struct tm timeInfo;
  gmtime_r(&now, &timeInfo);

  snprintf(
    buffer,
    bufferSize,
    "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
    timeInfo.tm_year + 1900,
    timeInfo.tm_mon + 1,
    timeInfo.tm_mday,
    timeInfo.tm_hour,
    timeInfo.tm_min,
    timeInfo.tm_sec
  );
}

bool hasPublishableVitals() {
  return getDisplayHrBpm() > 0 || getDisplaySpo2() > 0;
}

void addVitalsObject(JsonObject item, const char *timestamp) {
  JsonObject vitals = item.createNestedObject("vitals");

  int hr = getDisplayHrBpm();
  int spo2 = getDisplaySpo2();

  if (hr > 0) vitals["heart_rate"] = hr;
  if (spo2 > 0) vitals["oxygen_saturation"] = spo2;
  vitals["timestamp"] = timestamp;

  // Extra fields are ignored by the backend today, but useful in serial/debug captures.
  vitals["finger_detected"] = latestMax.fingerDetected;
  vitals["ir"] = latestMax.ir;
  vitals["red"] = latestMax.red;
  vitals["max_powered"] = maxPowered;
}

bool buildTelemetryJson(char *output, size_t outputSize) {
  if (!output || outputSize == 0) return false;

  if (!mpuReady) {
    Serial.println("⚠️ Building telemetry without MPU is not supported by current backend schema");
    return false;
  }

  if (motionCount <= 0) {
    Serial.println("⚠️ Cannot build telemetry: no MPU samples in batch");
    return false;
  }

  memset(output, 0, outputSize);
  telemetryCounter++;

  char timestamp[32];
  isoTimestamp(timestamp, sizeof(timestamp));

  DynamicJsonDocument doc(TELEMETRY_JSON_CAPACITY);

  const char *deviceId = provisionedDeviceId.c_str();
  const char *token = pairingToken.c_str();
  const char *firmware = FIRMWARE_VERSION;

  doc["message_type"] = "device_data_batch";
  doc["device_id"] = deviceId;
  doc["user_id"] = provisionedUserId;
  doc["pairing_token"] = token;
  doc["batch_id"] = telemetryCounter;
  doc["batch_count"] = motionCount;
  doc["mpu_sample_rate_hz"] = 20;
  doc["mpu_mode"] = (mpuMode == MPU_MODE_ADAFRUIT) ? "adafruit" : ((mpuMode == MPU_MODE_DIRECT) ? "direct" : "none");
  doc["mpu_who_am_i"] = mpuWhoAmI;
  doc["publish_interval_ms"] = PUBLISH_INTERVAL_MS;
  doc["firmware_version"] = firmware;
  doc["battery_level"] = getBatteryPercent();
  doc["test_mode"] = false;

  JsonArray items = doc.createNestedArray("items");

  int startIndex = 0;
  if (motionCount >= MPU_BATCH_SIZE) startIndex = motionWriteIndex;

  for (int i = 0; i < motionCount; i++) {
    int idx = (startIndex + i) % MPU_BATCH_SIZE;
    MotionSample &s = motionSamples[idx];

    JsonObject item = items.createNestedObject();
    item["device_id"] = deviceId;
    item["user_id"] = provisionedUserId;
    item["timestamp"] = timestamp;

    JsonObject motion = item.createNestedObject("motion");
    motion["acc_x"] = s.ax;
    motion["acc_y"] = s.ay;
    motion["acc_z"] = s.az;
    motion["gyro_x"] = s.gx;
    motion["gyro_y"] = s.gy;
    motion["gyro_z"] = s.gz;
    motion["temperature"] = s.temp;
    motion["timestamp"] = timestamp;

    motion["acc_magnitude"] = s.accMag;
    motion["gyro_magnitude"] = s.gyroMag;
    motion["sampled_at_ms"] = s.t;

    if (i == motionCount - 1) {
      if (hasPublishableVitals()) {
        addVitalsObject(item, timestamp);
      }
      item["battery_level"] = getBatteryPercent();
      item["firmware_version"] = firmware;
    }
  }

  if (doc.overflowed()) {
    Serial.println("❌ Telemetry JSON document overflowed");
    output[0] = '\0';
    return false;
  }

  size_t written = serializeJson(doc, output, outputSize);
  output[outputSize - 1] = '\0';

  if (written == 0) {
    Serial.println("❌ Telemetry JSON serialization wrote 0 bytes");
    return false;
  }

  if (written >= outputSize - 1) {
    Serial.printf("❌ Telemetry payload truncated. written=%u buffer=%u\n",
                  (unsigned int)written,
                  (unsigned int)outputSize);
    return false;
  }

  return true;
}

// =====================================================
// Provisioning Parser
// =====================================================
bool applyProvisioningPayload(const String &value) {
  Serial.printf("📥 Provisioning payload bytes=%u\n", value.length());
  Serial.println("📥 Provisioning payload:");
  Serial.println(value);

  StaticJsonDocument<1536> doc;
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
  pendingProvisionedUserId = doc["user_id"] | doc["u"] | 0;
  pendingPairingToken = doc["pairing_token"] | doc["pt"] | "";
  pendingMqttHost = mqtt["host"] | mqtt["h"] | "";
  pendingMqttPort = mqtt["port"] | mqtt["o"] | 1883;
  pendingMqttTopic = mqtt["topic"] | mqtt["t"] | "fall-detection/device-data";

  pendingWifiSsid.trim();
  // Do not trim WiFi password. Spaces may be part of the password.
  pendingProvisionedDeviceId.trim();
  pendingPairingToken.trim();
  pendingMqttHost.trim();
  pendingMqttTopic.trim();

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
  Serial.println("✅ Provisioning data accepted");
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

    if (provisioningTransferId.isEmpty()) {
      if (index != 0) {
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
      notifyStatus("invalid_data", false, "Commit transfer id mismatch");
      resetProvisioningTransfer();
      return false;
    }

    if (provisioningChunkExpectedTotal <= 0 || provisioningChunkNextIndex != provisioningChunkExpectedTotal) {
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

void processProvisioningPayloadFromLoop() {
  String value;
  if (!dequeueRawProvisioningPayload(value)) return;

  if (value.length() == 0) {
    setLastError("invalid_data", "Empty provisioning payload");
    return;
  }

  String decodedValue = value;

  if (!decodedValue.startsWith("{")) {
    String maybeJson = decodeBase64Payload(decodedValue);
    if (maybeJson.length() > 0) decodedValue = maybeJson;
  }

  StaticJsonDocument<1536> doc;
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

// =====================================================
// BLE Callbacks / Setup
// =====================================================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
    Serial.println("📱 BLE connected");
  }

  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    Serial.println("📴 BLE disconnected");

    if (BLEDevice::getInitialized() && bleProvisioningActive) {
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

void startBleProvisioning() {
  if (BLEDevice::getInitialized() && deviceInfoChar && writeChar && statusChar) {
    bleProvisioningActive = true;
    updateDeviceInfoCharacteristic();
    BLEAdvertising *adv = BLEDevice::getAdvertising();
    adv->start();
    Serial.println("🚀 BLE provisioning advertising resumed");
    return;
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

  bleProvisioningActive = true;
  updateDeviceInfoCharacteristic();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  adv->start();

  Serial.println("STATUS [ready_for_provisioning] OK - BLE provisioning ready");
  Serial.println("🚀 BLE provisioning ready");
}

// =====================================================
// WiFi / MQTT
// =====================================================
String wifiStatusToText(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS: return "WL_IDLE_STATUS";
    case WL_NO_SSID_AVAIL: return "WL_NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED: return "WL_SCAN_COMPLETED";
    case WL_CONNECTED: return "WL_CONNECTED";
    case WL_CONNECT_FAILED: return "WL_CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "WL_CONNECTION_LOST";
    case WL_DISCONNECTED: return "WL_DISCONNECTED";
    default: return String("UNKNOWN_") + String((int)status);
  }
}

String wifiDisconnectReasonToText(uint8_t reason) {
  switch (reason) {
    case 2: return "AUTH_EXPIRE";
    case 4: return "ASSOC_EXPIRE";
    case 5: return "ASSOC_TOOMANY";
    case 8: return "ASSOC_LEAVE";
    case 15: return "4WAY_HANDSHAKE_TIMEOUT";
    case 17: return "IE_INVALID";
    case 18: return "MIC_FAILURE";
    case 23: return "802_1X_AUTH_FAILED";
    case 24: return "CIPHER_SUITE_REJECTED";
    case 200: return "BEACON_TIMEOUT";
    case 201: return "NO_AP_FOUND";
    case 202: return "AUTH_FAIL";
    case 203: return "ASSOC_FAIL";
    case 204: return "HANDSHAKE_TIMEOUT";
    default: return String("REASON_") + String((int)reason);
  }
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    lastWifiDisconnectReason = info.wifi_sta_disconnected.reason;
    Serial.print("📡 WiFi disconnected reason=");
    Serial.print(lastWifiDisconnectReason);
    Serial.print(" ");
    Serial.println(wifiDisconnectReasonToText((uint8_t)lastWifiDisconnectReason));
  }
}

String wifiAuthModeToText(wifi_auth_mode_t authMode) {
  switch (authMode) {
    case WIFI_AUTH_OPEN: return "OPEN";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA_PSK";
    case WIFI_AUTH_WPA2_PSK: return "WPA2_PSK";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA_WPA2_PSK";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2_ENTERPRISE";
    case WIFI_AUTH_WPA3_PSK: return "WPA3_PSK";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2_WPA3_PSK";
    default: return String("AUTH_") + String((int)authMode);
  }
}

bool scanForTargetWiFi(const String &targetSsid) {
  Serial.println("🔎 WiFi scan before connect...");
  wifiTargetApLocked = false;
  wifiTargetChannel = 0;
  memset(wifiTargetBssid, 0, sizeof(wifiTargetBssid));

  int networkCount = WiFi.scanNetworks(false, true);

  if (networkCount < 0) {
    Serial.print("⚠️ WiFi scan failed code=");
    Serial.println(networkCount);
    return false;
  }

  Serial.print("🔎 WiFi networks found: ");
  Serial.println(networkCount);

  bool foundTarget = false;
  int bestTargetRssi = -999;
  wifi_auth_mode_t bestTargetAuth = WIFI_AUTH_OPEN;
  int bestTargetIndex = -1;

  for (int i = 0; i < networkCount; i++) {
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    wifi_auth_mode_t authMode = WiFi.encryptionType(i);

    Serial.print("  ");
    Serial.print(i + 1);
    Serial.print(") '");
    Serial.print(ssid);
    Serial.print("' RSSI=");
    Serial.print(rssi);
    Serial.print(" auth=");
    Serial.println(wifiAuthModeToText(authMode));

    if (ssid == targetSsid && rssi > bestTargetRssi) {
      foundTarget = true;
      bestTargetRssi = rssi;
      bestTargetAuth = authMode;
      bestTargetIndex = i;
    }
  }

  if (!foundTarget) {
    WiFi.scanDelete();
    Serial.print("❌ Target SSID not found in scan: '");
    Serial.print(targetSsid);
    Serial.println("'");
    Serial.println("⚠️ Check exact SSID, 2.4GHz hotspot, and iPhone Maximize Compatibility.");
    return false;
  }

  if (bestTargetIndex >= 0) {
    uint8_t *bssid = WiFi.BSSID(bestTargetIndex);
    if (bssid) {
      memcpy(wifiTargetBssid, bssid, sizeof(wifiTargetBssid));
      wifiTargetChannel = WiFi.channel(bestTargetIndex);
      wifiTargetApLocked = wifiTargetChannel > 0;
    }
  }

  Serial.print("✅ Target SSID found. Best RSSI=");
  Serial.print(bestTargetRssi);
  Serial.print(" auth=");
  Serial.println(wifiAuthModeToText(bestTargetAuth));

  if (wifiTargetApLocked) {
    Serial.print("🔒 Locking WiFi AP channel=");
    Serial.print(wifiTargetChannel);
    Serial.print(" bssid=");
    for (int i = 0; i < 6; i++) {
      if (i > 0) Serial.print(":");
      if (wifiTargetBssid[i] < 16) Serial.print("0");
      Serial.print(wifiTargetBssid[i], HEX);
    }
    Serial.println();
  }

  if (bestTargetRssi < -82) {
    Serial.println("⚠️ WiFi signal is very weak. Move bracelet closer to router/hotspot.");
  }

  if (bestTargetAuth == WIFI_AUTH_WPA3_PSK) {
    Serial.println("⚠️ WPA3-only networks often fail on ESP32-C3. Use WPA2/WPA3 mixed or WPA2.");
  }

  WiFi.scanDelete();
  return true;
}

void resetWiFiBeforeConnect() {
  Serial.println("🧹 Cleaning old WiFi state...");

  WiFi.setAutoReconnect(false);
  WiFi.persistent(false);

  WiFi.disconnect(true, true);
  delay(1000);

  esp_wifi_disconnect();
  delay(300);

  WiFi.mode(WIFI_OFF);
  delay(1200);

  WiFi.mode(WIFI_STA);
  delay(800);

  WiFi.setSleep(false);
  WiFi.setAutoReconnect(false);

  Serial.println("✅ WiFi state cleaned");
}

bool isAcceptedMqttCommandTopic(const String &topicText) {
  if (topicText == mqttCommandTopic) return true;
  if (mqttCommandTopicLegacy.length() > 0 && topicText == mqttCommandTopicLegacy) return true;
  if (topicText == mqttCommandTopicBroadcast) return true;
  if (topicText == mqttCommandTopicGeneric) return true;
  return false;
}

void handleMqttMessage(char *topic, byte *payload, unsigned int length) {
  String topicText = String(topic);

  Serial.print("📥 MQTT command topic=");
  Serial.println(topicText);

  if (!isAcceptedMqttCommandTopic(topicText)) {
    Serial.print("⚠️ MQTT command ignored: expected primary topic=");
    Serial.println(mqttCommandTopic);
    Serial.print("⚠️ MQTT legacy topic=");
    Serial.println(mqttCommandTopicLegacy);
    return;
  }

  if (length == 0 || length >= 768) {
    Serial.println("⚠️ MQTT command ignored: invalid length");
    return;
  }

  char buffer[768];
  memcpy(buffer, payload, length);
  buffer[length] = '\0';

  StaticJsonDocument<768> doc;
  DeserializationError err = deserializeJson(doc, buffer);
  if (err) {
    Serial.print("⚠️ MQTT command JSON parse failed: ");
    Serial.println(err.c_str());
    return;
  }

  String messageType = doc["message_type"] | "";
  String command = doc["command"] | doc["cmd"] | "";
  String requestId = doc["request_id"] | "";
  String source = doc["source"] | "mobile_app";
  String trigger = doc["vitals_trigger"] | "";
  if (trigger.length() == 0) trigger = doc["reason"] | "";
  if (trigger.length() == 0) trigger = (source == "fall_alert") ? "fall_alert" : "manual";
  unsigned long durationMs = doc["duration_ms"] | VITALS_DEFAULT_DURATION_MS;

  Serial.print("📥 MQTT command payload command=");
  Serial.print(command);
  Serial.print(" request_id=");
  Serial.print(requestId);
  Serial.print(" trigger=");
  Serial.print(trigger);
  Serial.print(" duration_ms=");
  Serial.println(durationMs);

  if (messageType.length() > 0 && messageType != "device_command") {
    Serial.println("⚠️ MQTT command ignored: message_type mismatch");
    return;
  }

  if (command == "vitals_start" || command == "measure_vitals" || command == "measureVitals" || command == "start_vitals") {
    startVitalsMeasurement(requestId, trigger, durationMs, millis());
    return;
  }

  if (command == "vitals_stop" || command == "stop_vitals" || command == "cancel_vitals") {
    if (requestId.length() == 0 || requestId == activeVitalsRequestId) {
      stopVitalsMeasurement("stopped", millis());
    }
    return;
  }

  Serial.print("⚠️ Unknown MQTT command: ");
  Serial.println(command);
}

void runLocalVitalsCommand(const String &source) {
  unsigned long now = millis();
  String requestId = String(source) + "-" + String(now);
  Serial.print("⌨️ Local vitals command accepted source=");
  Serial.println(source);
  startVitalsMeasurement(requestId, "manual", VITALS_DEFAULT_DURATION_MS, now);
}

void handleSerialCommand(String command) {
  command.trim();
  command.toLowerCase();
  if (command.length() == 0) return;

  if (
    command == "meger" ||
    command == "measure" ||
    command == "vitals" ||
    command == "vitals_start" ||
    command == "start vitals"
  ) {
    runLocalVitalsCommand("serial");
    return;
  }

  if (command == "stop" || command == "vitals_stop" || command == "stop vitals") {
    Serial.println("⌨️ Local vitals stop command accepted");
    stopVitalsMeasurement("stopped", millis());
    return;
  }

  if (command == "status") {
    Serial.print("Firmware=");
    Serial.println(FIRMWARE_VERSION);
    Serial.print("MQTT connected=");
    Serial.println(mqttClient.connected() ? "YES" : "NO");
    Serial.print("MQTT command topic=");
    Serial.println(mqttCommandTopic.length() > 0 ? mqttCommandTopic : "(not subscribed yet)");
    Serial.print("MQTT legacy topic=");
    Serial.println(mqttCommandTopicLegacy.length() > 0 ? mqttCommandTopicLegacy : "(not subscribed yet)");
    Serial.print("Device id=");
    Serial.println(provisionedDeviceId);
    Serial.print("Vitals active=");
    Serial.println(vitalsMeasurementActive ? "YES" : "NO");
    return;
  }

  Serial.print("⚠️ Unknown serial command: ");
  Serial.println(command);
  Serial.println("Try: meger | measure | vitals | status | stop");
}

void processSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;

    if (c == '\n') {
      handleSerialCommand(serialCommandBuffer);
      serialCommandBuffer = "";
      continue;
    }

    if (serialCommandBuffer.length() < 80) {
      serialCommandBuffer += c;
    } else {
      serialCommandBuffer = "";
      Serial.println("⚠️ Serial command too long, buffer reset");
    }
  }
}

bool connectToWiFi(bool forceReconnect = false) {
  static bool wifiConnectBusy = false;

  if (wifiConnectBusy) {
    Serial.println("⚠️ WiFi connect already running, skipping duplicate call");
    return false;
  }

  wifiConnectBusy = true;

  String targetSsid = hasPendingProvisioning ? pendingWifiSsid : wifiSsid;
  String targetPassword = hasPendingProvisioning ? pendingWifiPassword : wifiPassword;

  targetSsid.trim();
  // Do NOT trim targetPassword.

  if (targetSsid.isEmpty() || targetPassword.isEmpty()) {
    notifyStatus("ready_for_provisioning", false, "WiFi credentials not provisioned");
    wifiConnectBusy = false;
    return false;
  }

  if (
    WiFi.status() == WL_CONNECTED &&
    WiFi.SSID() == targetSsid &&
    !forceReconnect
  ) {
    Serial.println("✅ Already connected to target WiFi");
    wifiWasConnectedOnce = true;
    requireReProvisioning = false;
    setLastError("", "");
    wifiConnectBusy = false;
    return true;
  }

  stopBleBeforeWifiConnect();
  resetWiFiBeforeConnect();

  Serial.println("=================================");
  Serial.printf("🔄 Connecting to WiFi SSID='%s'\n", targetSsid.c_str());
  Serial.printf("🔐 Password length=%d\n", targetPassword.length());
  Serial.println("⚠️ Router must be 2.4GHz WPA/WPA2. ESP32-C3 does not support 5GHz.");
  Serial.println("=================================");

  bool targetFoundInScan = scanForTargetWiFi(targetSsid);
  if (!targetFoundInScan) {
    Serial.println("⚠️ Continuing WiFi.begin anyway, but connection is unlikely if SSID was not found.");
  }

  lastWifiDisconnectReason = -1;
  if (wifiTargetApLocked) {
    Serial.println("🔐 WiFi.begin using locked channel/BSSID from scan");
    WiFi.begin(targetSsid.c_str(), targetPassword.c_str(), wifiTargetChannel, wifiTargetBssid, true);
  } else {
    WiFi.begin(targetSsid.c_str(), targetPassword.c_str());
  }

  unsigned long startMs = millis();
  const unsigned long WIFI_CONNECT_TIMEOUT_MS = 35000;

  wl_status_t lastStatus = WL_IDLE_STATUS;

  while (millis() - startMs < WIFI_CONNECT_TIMEOUT_MS) {
    wl_status_t currentStatus = WiFi.status();

    if (currentStatus != lastStatus) {
      Serial.print("📡 WiFi status: ");
      Serial.println(wifiStatusToText(currentStatus));
      lastStatus = currentStatus;
    }

    if (currentStatus == WL_CONNECTED) {
      Serial.println();
      Serial.println("✅ WiFi connected successfully");
      Serial.print("📶 SSID: ");
      Serial.println(WiFi.SSID());
      Serial.print("🌐 IP: ");
      Serial.println(WiFi.localIP());
      Serial.print("📡 RSSI: ");
      Serial.println(WiFi.RSSI());

      syncTimeIfNeeded();

      wifiWasConnectedOnce = true;
      requireReProvisioning = false;
      setLastError("", "");

      if (hasPendingProvisioning) {
        wifiSsid = pendingWifiSsid;
        wifiPassword = pendingWifiPassword;
        provisionedDeviceId = pendingProvisionedDeviceId;
        provisionedUserId = pendingProvisionedUserId;
        pairingToken = pendingPairingToken;
        mqttHost = pendingMqttHost;
        mqttPort = pendingMqttPort;
        mqttTopic = pendingMqttTopic;
        saveConfig();

        hasPendingProvisioning = false;
        notifyStatus("credentials_saved", true, "Provisioning saved successfully");
      }

      shouldStopBleAfterWiFiConnect = false;

      notifyStatus("wifi_connected", true, WiFi.localIP().toString());
      updateDeviceInfoCharacteristic();

      wifiConnectBusy = false;
      return true;
    }

    delay(500);
    Serial.print(".");
  }

  String finalStatus = wifiStatusToText(WiFi.status());

  Serial.println();
  Serial.print("❌ WiFi connection failed. Final status: ");
  Serial.println(finalStatus);
  Serial.print("❌ Last WiFi disconnect reason: ");
  Serial.print(lastWifiDisconnectReason);
  if (lastWifiDisconnectReason >= 0) {
    Serial.print(" ");
    Serial.println(wifiDisconnectReasonToText((uint8_t)lastWifiDisconnectReason));
  } else {
    Serial.println("unknown");
  }

  WiFi.disconnect(true, true);
  delay(500);

  notifyStatus(
    "wifi_failed",
    false,
    String("WiFi failed. Final status: ") + finalStatus
  );

  updateDeviceInfoCharacteristic();

  wifiConnectBusy = false;
  return false;
}

bool connectToMqtt() {
  if (mqttHost.isEmpty() || mqttTopic.isEmpty()) {
    notifyStatus("mqtt_failed", false, "MQTT config missing");
    return false;
  }

  if (mqttClient.connected()) return true;

  if (!mqttClient.setBufferSize(MQTT_PACKET_BUFFER_SIZE)) {
    Serial.println("❌ MQTT buffer allocation failed");
    notifyStatus("mqtt_failed", false, "MQTT buffer allocation failed");
    return false;
  }

  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(10);
  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setCallback(handleMqttMessage);

  String clientId = String("fall-bracelet-") + provisionedDeviceId;

  Serial.printf("🔄 Connecting to MQTT %s:%u topic=%s\n",
                mqttHost.c_str(), mqttPort, mqttTopic.c_str());

  if (mqttClient.connect(clientId.c_str())) {
    Serial.println("✅ MQTT connected");
    mqttCommandTopic = String("devices/") + provisionedDeviceId + "/commands";
    mqttCommandTopicLegacy = String("fall-detection/devices/") + provisionedDeviceId + "/commands";

    bool primaryOk = mqttClient.subscribe(mqttCommandTopic.c_str());
    bool legacyOk = mqttClient.subscribe(mqttCommandTopicLegacy.c_str());
    bool broadcastOk = mqttClient.subscribe(mqttCommandTopicBroadcast.c_str());
    bool genericOk = mqttClient.subscribe(mqttCommandTopicGeneric.c_str());

    Serial.print(primaryOk ? "✅" : "⚠️");
    Serial.print(" MQTT primary command topic: ");
    Serial.println(mqttCommandTopic);
    Serial.print(legacyOk ? "✅" : "⚠️");
    Serial.print(" MQTT legacy command topic: ");
    Serial.println(mqttCommandTopicLegacy);
    Serial.print(broadcastOk ? "✅" : "⚠️");
    Serial.print(" MQTT broadcast command topic: ");
    Serial.println(mqttCommandTopicBroadcast);
    Serial.print(genericOk ? "✅" : "⚠️");
    Serial.print(" MQTT generic command topic: ");
    Serial.println(mqttCommandTopicGeneric);

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

  if (!mpuReady) {
    Serial.println("⚠️ MPU not ready. Skipping motion batch publish, device remains alive.");
    lastBatchSent = false;
    return;
  }

  if (motionCount <= 0) {
    Serial.println("⚠️ No MPU motion samples ready yet");
    lastBatchSent = false;
    return;
  }

  if (!mqttClient.setBufferSize(MQTT_PACKET_BUFFER_SIZE)) {
    Serial.println("❌ MQTT buffer allocation failed before publish");
    notifyStatus("mqtt_failed", false, "MQTT buffer allocation failed before publish");
    lastBatchSent = false;
    return;
  }

  if (!buildTelemetryJson(telemetryPayload, sizeof(telemetryPayload))) {
    Serial.println("❌ MQTT telemetry JSON build failed");
    notifyStatus("mqtt_failed", false, "Telemetry JSON build failed");
    lastBatchSent = false;
    return;
  }

  size_t payloadLen = strlen(telemetryPayload);
  size_t estimatedPacketSize = payloadLen + mqttTopic.length() + 16;

  Serial.print("📏 MQTT payload length: ");
  Serial.println(payloadLen);
  Serial.print("📦 MQTT estimated packet size: ");
  Serial.println(estimatedPacketSize);
  Serial.print("📤 MQTT topic: ");
  Serial.println(mqttTopic);

#if DEBUG_SCREEN
  Serial.print("MQTT payload: ");
  Serial.println(telemetryPayload);
#endif

  if (estimatedPacketSize >= MQTT_PACKET_BUFFER_SIZE) {
    Serial.println("❌ MQTT packet too large for PubSubClient buffer");
    notifyStatus("mqtt_failed", false, "MQTT packet too large for buffer");
    lastBatchSent = false;
    return;
  }

  bool published = mqttClient.publish(mqttTopic.c_str(), telemetryPayload);

  if (published) {
    Serial.println("✅ MQTT published successfully");
    notifyStatus("streaming", true, String("MQTT batch published: ") + motionCount + " readings");
    lastBatchSent = true;
    lastBatchSentMs = millis();
    clearMotionBatchAfterPublish();
  } else {
    Serial.println("❌ MQTT publish failed");
    Serial.print("📡 MQTT connected state: ");
    Serial.println(mqttClient.connected());
    Serial.print("📡 MQTT client state: ");
    Serial.println(mqttClient.state());
    notifyStatus("mqtt_failed", false, "MQTT publish failed");
    lastBatchSent = false;
  }

  updateDeviceInfoCharacteristic();
}

// =====================================================
// Arduino Setup / Loop
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n===== FALL DETECTION BRACELET START =====");
  Serial.print("Board profile: ");
  Serial.println(BOARD_NAME);
  Serial.print("I2C SDA: GPIO");
  Serial.println(I2C_SDA_PIN);
  Serial.print("I2C SCL: GPIO");
  Serial.println(I2C_SCL_PIN);
  Serial.print("I2C clock: ");
  Serial.println(I2C_CLOCK_HZ);
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.println("Arduino IDE: Enable USB CDC On Boot");
  WiFi.onEvent(onWiFiEvent);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(I2C_CLOCK_HZ);

  initOled();
  initSensors();
  drawBootCheckScreen();

  preferences.begin(PREF_NAMESPACE, false);

  // Uncomment once to clear saved WiFi/provisioning during testing, upload, then comment again.
  // clearSavedWiFi();

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
  processSerialCommands();

  int processedProvisioningItems = 0;
  while (hasQueuedProvisioningPayload && processedProvisioningItems < RAW_PROVISIONING_QUEUE_SIZE) {
    processProvisioningPayloadFromLoop();
    processedProvisioningItems++;
    delay(2);
  }

  unsigned long now = millis();
  readSensorsIfDue(now);
  updateOledDisplay(now);

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

      WiFi.disconnect(false, true);
      delay(1000);

      return;
    }

    requireReProvisioning = false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    const bool validConfig = hasStoredConfig();

    if (requireReProvisioning || !validConfig) {
      if (shouldResumeProvisioningBle) {
        shouldResumeProvisioningBle = false;
        startBleProvisioning();
        updateDeviceInfoCharacteristic();
        notifyStatus("ready_for_provisioning", true, "BLE provisioning ready");
      }

      if (!bleProvisioningActive) {
        Serial.println("🔁 Waiting for new provisioning data over BLE...");
        startBleProvisioning();
      }

      delay(50);
      return;
    }

    if (wifiWasConnectedOnce) {
      if (now - lastWifiAttemptMs >= WIFI_RETRY_INTERVAL_MS) {
        lastWifiAttemptMs = now;
        connectToWiFi(false);
      }
      delay(50);
      return;
    }

    Serial.println("🔁 Stored WiFi credentials failed. Opening BLE provisioning for correction.");
    requireReProvisioning = true;
    setLastError("wifi_failed", "Stored Wi-Fi credentials failed. Please enter Wi-Fi name/password again.");
    startBleProvisioning();
    delay(50);
    return;
  }

  wifiWasConnectedOnce = true;
  requireReProvisioning = false;
  setLastError("", "");

  if (bleProvisioningActive) {
    stopBleAdvertisingOnly();
    shouldStopBleAfterWiFiConnect = false;
  }

  if (!mqttClient.connected()) {
    if (now - lastMqttAttemptMs >= MQTT_RETRY_INTERVAL_MS) {
      lastMqttAttemptMs = now;
      connectToMqtt();
    }
    delay(50);
    return;
  }

  mqttClient.loop();

  if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = now;
    publishTelemetry();
  }

  delay(5);
}
