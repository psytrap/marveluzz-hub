/*
 * Marveluzz Hub - ESP32 Hardware Microcontroller Firmware
 * Direct Supabase Cloud Ingest & Command Dispatch Engine
 * 
 * Hardware Config:
 * - ESP32 Microcontroller Board
 * - DS18B20 OneWire Temperature Sensor (Pin GPIO 4)
 * - Relay Switch Output (Pin GPIO 5)
 * - Emergency Hardware Fault Button (Pin GPIO 27)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

#include "certificates.h"
#include "TelemetryLogic.h"

// -------------------------------------------------------------
// 1. Network & Supabase Credentials
// -------------------------------------------------------------
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Supabase Direct Cloud Gateway URL & Anon Key
const char* SUPABASE_URL = "https://qmketwlyeexumcxboagc.supabase.co";
const char* SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // Publishable Key

// Unique Per-Device Credentials
const char* DEVICE_ID = "32323232-3232-4232-8232-28c13340c86c";
const char* DEVICE_KEY = "secret_passcode_123";

// -------------------------------------------------------------
// 2. Hardware Pin Assignments & Global State
// -------------------------------------------------------------
const int RELAY_PIN = 5;
const int EMERGENCY_BTN_PIN = 27;

DeviceState deviceState;
unsigned long lastUpdateMs = 0;

void applyRelayHardwareState(bool active) {
  deviceState.relayState = active;
  digitalWrite(RELAY_PIN, deviceState.relayState ? HIGH : LOW);
  Serial.printf("⚡ Relay Hardware Switched: %s\n", deviceState.relayState ? "ON" : "OFF");
}

// -------------------------------------------------------------
// 3. Register Dynamic UI Layout Schema via TelemetryLogic
// -------------------------------------------------------------
void registerUILayout() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/rpc/register_ui_definition";

  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

  String jsonPayload = TelemetryLogic::buildLayoutJson(DEVICE_ID, DEVICE_KEY);

  int httpCode = http.POST(jsonPayload);
  if (httpCode == 200 || httpCode == 204) {
    Serial.println("✅ ESP32 UI Layout Schema Registered Successfully.");
    deviceState.layoutSent = true;
  } else {
    Serial.printf("❌ UI Layout Registration Error %d: %s\n", httpCode, http.getString().c_str());
  }
  http.end();
}

// -------------------------------------------------------------
// 4. Send Telemetry & Process Executed Command Responses
// -------------------------------------------------------------
void sendTelemetryAndPollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/rpc/ingest_telemetry";

  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

  // Read hardware status / simulated DS18B20 sensor reading
  float temperatureC = 23.5 + random(-10, 10) / 10.0;
  unsigned long uptimeSec = millis() / 1000;

  // Check emergency fault button state (Active LOW)
  if (digitalRead(EMERGENCY_BTN_PIN) == LOW) {
    deviceState.hasFault = true;
  }

  String jsonPayload = TelemetryLogic::buildTelemetryJson(
    DEVICE_ID, DEVICE_KEY, temperatureC, deviceState.relayState, 
    uptimeSec, deviceState.viewersActive, deviceState.hasFault
  );

  Serial.printf("📡 Sending Telemetry [%s] -> Temp=%.1f C, Relay=%s, Fault=%s...\n", 
                deviceState.viewersActive ? "5s Fast Mode" : "30s Power-Save Mode",
                temperatureC, deviceState.relayState ? "ON" : "OFF",
                deviceState.hasFault ? "E-04" : "None");

  int httpCode = http.POST(jsonPayload);
  if (httpCode == 200) {
    String response = http.getString();
    Serial.printf("✅ Telemetry Ingest Response: %s\n", response.c_str());

    // Decode and apply executed commands returned from Marveluzz Hub
    TelemetryLogic::parseIngestResponse(response, deviceState, applyRelayHardwareState);
  } else {
    Serial.printf("❌ Telemetry Ingest Error %d: %s\n", httpCode, http.getString().c_str());
  }

  http.end();
}

// -------------------------------------------------------------
// 5. Arduino Setup & Loop
// -------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(EMERGENCY_BTN_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PIN, LOW);

  Serial.println("\n🚀 Booting ESP32 Marveluzz Field Node...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n📶 WiFi Connected. IP: " + WiFi.localIP().toString());
  deviceState.connected = true;

  registerUILayout();
  sendTelemetryAndPollCommands();
  lastUpdateMs = millis();
}

void loop() {
  unsigned long now = millis();
  unsigned long interval = TelemetryLogic::getStreamIntervalMs(deviceState.viewersActive);

  if (now - lastUpdateMs >= interval) {
    lastUpdateMs = now;
    sendTelemetryAndPollCommands();
  }
}
