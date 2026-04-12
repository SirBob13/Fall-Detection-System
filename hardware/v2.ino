#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "MAX30105.h"
#include "heartRate.h"

// ===== WiFi =====
const char *ssid = "Ali's S24";
const char *password = "56789000";

// ===== Server =====
const char *serverName = "http://138.2.183.9:8000/api/v1/device-data";
const char *deviceId = "esp32_max_001";
const int userId = 5;

// ===== Sensors =====
Adafruit_MPU6050 mpu;
MAX30105 max30102;

// ===== HR Vars =====
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
int beatAvg = 0;
long irValue = 0;

// ===== Timing =====
unsigned long lastSend = 0;
unsigned long lastPrint = 0;

// ===== FLAGS =====
bool maxOK = false;

// ================= WIFI INIT (ONCE ONLY) =================
void setupWiFi() {
  WiFi.begin(ssid, password);

  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected");
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(21, 22);
  Wire.setClock(80000);

  Serial.println("Starting system...");

  // MPU
  if (mpu.begin()) {
    Serial.println("MPU OK");
  } else {
    Serial.println("MPU FAIL");
  }

  // MAX30102
  if (max30102.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println("MAX OK");
    max30102.setup();
    maxOK = true;
  } else {
    Serial.println("MAX FAIL");
  }

  setupWiFi();

  Serial.println("SYSTEM READY");
}

// ================= HEART RATE =================
void updateHR() {
  if (!maxOK) return;

  irValue = max30102.getIR();

  // smooth signal
  static long prev = 0;
  irValue = (irValue + prev) / 2;
  prev = irValue;

  // lower threshold (IMPORTANT FIX)
  if (irValue < 30000) {
    beatAvg = 0;
    return;
  }

  if (checkForBeat(irValue)) {
    long delta = millis() - lastBeat;
    lastBeat = millis();

    if (delta <= 0) return;

    float bpm = 60.0 / (delta / 1000.0);

    if (bpm > 30 && bpm < 200) {
      rates[rateSpot++] = (byte)bpm;
      rateSpot %= RATE_SIZE;

      int sum = 0;
      for (byte i = 0; i < RATE_SIZE; i++) sum += rates[i];

      beatAvg = sum / RATE_SIZE;
    }
  }
}

// ================= LOOP =================
void loop() {

  updateHR();

  // MPU
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);

  float ax = a.acceleration.x;
  float ay = a.acceleration.y;
  float az = a.acceleration.z;

  float gx = g.gyro.x * 57.2958;
  float gy = g.gyro.y * 57.2958;
  float gz = g.gyro.z * 57.2958;

  // PRINT
  if (millis() - lastPrint > 500) {
    lastPrint = millis();

    Serial.println("----- DATA -----");
    Serial.print("IR: "); Serial.println(irValue);
    Serial.print("BPM: "); Serial.println(beatAvg);

    Serial.print("AX: "); Serial.print(ax);
    Serial.print(" AY: "); Serial.print(ay);
    Serial.print(" AZ: "); Serial.println(az);
  }

  // SEND (no WiFi reconnect spam)
  if (millis() - lastSend > 2000) {
    lastSend = millis();

    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");

    String json = "{";
    json += "\"device_id\":\"" + String(deviceId) + "\",";
    json += "\"user_id\":" + String(userId) + ",";
    json += "\"motion\":{";
    json += "\"acc_x\":" + String(ax, 3) + ",";
    json += "\"acc_y\":" + String(ay, 3) + ",";
    json += "\"acc_z\":" + String(az, 3) + ",";
    json += "\"gyro_x\":" + String(gx, 2) + ",";
    json += "\"gyro_y\":" + String(gy, 2) + ",";
    json += "\"gyro_z\":" + String(gz, 2);
    json += "},";
    json += "\"vitals\":{";
    json += "\"heart_rate\":" + String(beatAvg);
    json += "}";
    json += "}";

    int code = http.POST(json);

    Serial.print("HTTP: ");
    Serial.println(code);

    http.end();
  }
}