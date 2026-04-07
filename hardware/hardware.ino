#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <MAX30105.h>
#include "heartRate.h"

// WiFi credentials
const char *ssid = "Ali's S24";
const char *password = "56789000";

// Server settings
const char *serverName = "http://138.2.183.9:8000/api/v1/device-data";
const char *deviceId = "esp32_max_001";
const int userId = 5;

// I2C pins for ESP32
const int SDA_PIN = 21;
const int SCL_PIN = 22;

// Send interval
const unsigned long SEND_INTERVAL_MS = 1000;

// MAX30102 pulse detection settings
const byte RATE_SIZE = 4;
const long FINGER_ON_SENSOR_THRESHOLD = 50000;

Adafruit_MPU6050 imu;
MAX30105 max30102;

byte rates[RATE_SIZE];
byte rateSpot = 0;
byte validRateCount = 0;
long lastBeat = 0;
float beatsPerMinute = 0.0;
int beatAvg = 0;
long lastIrValue = 0;
bool max301Ready = false;
unsigned long lastSendAt = 0;

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
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

String buildPayload(float ax, float ay, float az, float gx, float gy, float gz) {
  String jsonData = "{";
  jsonData += "\"device_id\":\"" + String(deviceId) + "\",";
  jsonData += "\"user_id\":" + String(userId) + ",";
  jsonData += "\"motion\":{";
  jsonData += "\"acc_x\":" + String(ax, 3) + ",";
  jsonData += "\"acc_y\":" + String(ay, 3) + ",";
  jsonData += "\"acc_z\":" + String(az, 3) + ",";
  jsonData += "\"gyro_x\":" + String(gx, 2) + ",";
  jsonData += "\"gyro_y\":" + String(gy, 2) + ",";
  jsonData += "\"gyro_z\":" + String(gz, 2);
  jsonData += "}";

  if (max301Ready && validRateCount > 0 && beatAvg > 0) {
    jsonData += ",";
    jsonData += "\"vitals\":{";
    jsonData += "\"heart_rate\":" + String(beatAvg);
    jsonData += "}";
  }

  jsonData += "}";
  return jsonData;
}

void sendPayload(const String &jsonData) {
  connectToWiFi();

  HTTPClient http;
  http.begin(serverName);
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(jsonData);
  Serial.print("HTTP Response code: ");
  Serial.println(httpResponseCode);

  if (httpResponseCode > 0) {
    Serial.println("Server Response:");
    Serial.println(http.getString());
  } else {
    Serial.print("HTTP Error: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  setupMpu6050();
  setupMax30102();
  connectToWiFi();
}

void loop() {
  updateHeartRate();

  if (millis() - lastSendAt < SEND_INTERVAL_MS) {
    delay(10);
    return;
  }
  lastSendAt = millis();

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  imu.getEvent(&accel, &gyro, &temp);

  // Adafruit library returns acceleration in m/s^2 and gyro in rad/s.
  float ax = accel.acceleration.x / 9.80665;
  float ay = accel.acceleration.y / 9.80665;
  float az = accel.acceleration.z / 9.80665;

  float gx = gyro.gyro.x * 57.2958;
  float gy = gyro.gyro.y * 57.2958;
  float gz = gyro.gyro.z * 57.2958;

  String jsonData = buildPayload(ax, ay, az, gx, gy, gz);

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

  Serial.println("=== JSON to send ===");
  Serial.println(jsonData);

  sendPayload(jsonData);
}
