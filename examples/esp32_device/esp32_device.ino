/*
 * Marveluzz Hub - ESP32 Hardware Microcontroller Firmware
 * Direct Supabase Cloud Ingest & Command Dispatch Engine
 * 
 * Hardware Config:
 * - ESP32 Microcontroller Board
 * - DS18B20 OneWire Temperature Sensor (Pin GPIO 4)
 * - Relay Switch Output (Pin GPIO 5)
 * 
 * Update Interval: 5 minutes (300,000 ms / 300 seconds)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

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
// 2. Hardware Pin Assignments & Update Timers
// -------------------------------------------------------------
const int RELAY_PIN = 5;
const unsigned long UPDATE_INTERVAL_MS = 300000; // 5 Minutes (300,000 ms)
unsigned long lastUpdateMs = 0;
bool relayState = false;

// -------------------------------------------------------------
// 3. Helper: Register Dynamic UI Layout Schema
// -------------------------------------------------------------
void registerUILayout() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/rpc/register_ui_definition";

  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

  StaticJsonDocument<512> doc;
  doc["p_device_id"] = DEVICE_ID;
  doc["p_device_key"] = DEVICE_KEY;

  JsonObject layoutDef = doc.createNestedObject("p_layout_def");
  layoutDef["title"] = "ESP32 Field Temperature Node";
  layoutDef["type"] = "layout";

  JsonArray layout = layoutDef.createNestedArray("layout");
  
  JsonObject item1 = layout.createNestedObject();
  item1["type"] = "number";
  JsonObject prop1 = item1.createNestedObject("properties");
  prop1["label"] = "Field Sensor Temperature (°C)";
  prop1["id"] = "temperature";
  prop1["readonly"] = "true";

  JsonObject item2 = layout.createNestedObject();
  item2["type"] = "button";
  JsonObject prop2 = item2.createNestedObject("properties");
  prop2["label"] = "Water Pump Relay";
  prop2["id"] = "pump_relay";

  String jsonBody;
  serializeJson(doc, jsonBody);

  int httpCode = http.POST(jsonBody);
  if (httpCode == 200 || httpCode == 204) {
    Serial.println("✅ ESP32 UI Layout Schema Registered Successfully.");
  } else {
    Serial.printf("❌ UI Layout Registration Error %d: %s\n", httpCode, http.getString().c_str());
  }
  http.end();
}

// -------------------------------------------------------------
// 4. Helper: Send Telemetry & Fetch Pending Commands (5 Min Interval)
// -------------------------------------------------------------
void sendTelemetryAndPollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/rpc/ingest_telemetry";

  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

  // Simulated DS18B20 Temperature Reading
  float temperatureC = 23.5 + random(-10, 10) / 10.0;
  unsigned long uptimeSec = millis() / 1000;

  StaticJsonDocument<512> doc;
  doc["p_device_id"] = DEVICE_ID;
  doc["p_device_key"] = DEVICE_KEY;

  JsonObject telemetry = doc.createNestedObject("p_telemetry_data");
  telemetry["temperature"] = temperatureC;
  telemetry["pump_relay"] = relayState;
  telemetry["uptime"] = String(uptimeSec) + "s";
  telemetry["interval"] = "5m";

  String jsonBody;
  serializeJson(doc, jsonBody);

  Serial.printf("📡 [5-Min Update] Sending Telemetry: Temp=%.1f C, Relay=%s...\n", temperatureC, relayState ? "ON" : "OFF");

  int httpCode = http.POST(jsonBody);
  if (httpCode == 200) {
    String response = http.getString();
    Serial.printf("✅ Telemetry Ingest Response: %s\n", response.c_str());

    // Parse executed commands returned in the array
    DynamicJsonDocument respDoc(1024);
    DeserializationError error = deserializeJson(respDoc, response);
    if (!error && respDoc.is<JsonArray>()) {
      JsonArray commands = respDoc.as<JsonArray>();
      for (JsonObject cmd : commands) {
        const char* target = cmd["target"];
        bool val = cmd["value"] | true;
        Serial.printf("⚡ Command Executed -> Target: %s, Value: %s\n", target, val ? "ON" : "OFF");
        if (String(target) == "pump_relay") {
          relayState = val;
          digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
        }
      }
    }
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
  digitalWrite(RELAY_PIN, LOW);

  Serial.println("\n🚀 Booting ESP32 Marveluzz Field Node...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n📶 WiFi Connected. IP: " + WiFi.localIP().toString());

  registerUILayout();
  sendTelemetryAndPollCommands();
  lastUpdateMs = millis();
}

void loop() {
  unsigned long now = millis();
  if (now - lastUpdateMs >= UPDATE_INTERVAL_MS) {
    lastUpdateMs = now;
    sendTelemetryAndPollCommands();
  }
}
