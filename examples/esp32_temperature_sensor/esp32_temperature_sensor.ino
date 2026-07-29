/*
 * Marveluzz Hub - ESP32 Hardware Microcontroller Firmware
 * Direct Supabase Cloud Ingest & Command Dispatch Engine
 *
 * Hardware Config:
 * - ESP32 Microcontroller Board
 * - DS18B20 OneWire Temperature Sensor (Pin GPIO 4)
 * - LED Toggle Digital Output (Pin GPIO 2 - Onboard / External LED)
 * - Emergency Hardware Fault Button (Pin GPIO 27)
 *
 * PROVISIONING & WIFI CONFIGURATION:
 * - Credentials (SSID, Password, Supabase URL, Device ID, Device Key) are saved to NVS Flash memory (Preferences.h).
 * - On boot, type 'reset' in Serial Monitor (115200 baud) to wipe/reconfigure credentials.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

#include "certificates.h"
#include "TelemetryLogic.h"

// -------------------------------------------------------------
// 1. Global State & NVS Flash Storage
// -------------------------------------------------------------
Preferences prefs;
WebSocketsClient webSocket;

String cfgSsid;
String cfgPass;
String cfgSupabaseUrl;
String cfgAnonKey;
String cfgDeviceId;
String cfgDeviceKey;

const int LED_PIN = 2; // GPIO 2 (Onboard LED or External LED with 220Ω resistor)
const int EMERGENCY_BTN_PIN = 27;

DeviceState deviceState;
unsigned long lastUpdateMs = 0;

void applyLedHardwareState(bool active) {
  deviceState.ledState = active;
  digitalWrite(LED_PIN, deviceState.ledState ? HIGH : LOW);
  Serial.printf("💡 LED Hardware Output Switched: %s\n", deviceState.ledState ? "ON" : "OFF");
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("❌ Supabase Realtime WebSocket Disconnected.");
      deviceState.wsConnected = false;
      break;
    case WStype_CONNECTED:
      Serial.println("⚡ Connected to Direct-to-Supabase Realtime WebSockets (<5ms Push Active)!");
      deviceState.wsConnected = true;
      {
        String joinPayload = TelemetryLogic::buildWsJoinPayload(cfgDeviceId);
        webSocket.sendTXT(joinPayload);
      }
      break;
    case WStype_TEXT:
      TelemetryLogic::parseIngestResponse(String((char*)payload), cfgDeviceId, deviceState, applyLedHardwareState);
      break;
    default:
      break;
  }
}

void setupWebSocket() {
  String protocol, host, path;
  int port;
  TelemetryLogic::parseUrl(cfgSupabaseUrl, protocol, host, port, path);

  String wsPath = "/realtime/v1/websocket?apikey=" + cfgAnonKey + "&vsn=1.0.0";

  if (protocol.equalsIgnoreCase("https")) {
    webSocket.beginSSL(host.c_str(), 443, wsPath.c_str());
  } else {
    webSocket.begin(host.c_str(), port, wsPath.c_str());
  }

  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// -------------------------------------------------------------
// 2. Serial Provisioning & NVS Flash Helpers
// -------------------------------------------------------------
String serialReadLine() {
  String line = "";
  while (true) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\r') {
        delay(10);
        if (Serial.available() && Serial.peek() == '\n') Serial.read();
        return line;
      }
      if (c == '\n') return line;
      line += c;
    }
    delay(10);
  }
}

String serialPrompt(const char* label, const String& defaultVal) {
  bool isSecret = (strcmp(label, "WiFi Password") == 0 || strcmp(label, "Device Key") == 0);
  if (defaultVal.length() > 0) {
    if (isSecret) {
      Serial.printf("  %s [********]: ", label);
    } else {
      Serial.printf("  %s [%s]: ", label, defaultVal.c_str());
    }
  } else {
    Serial.printf("  %s: ", label);
  }
  String input = serialReadLine();
  input.trim();
  return (input.length() > 0) ? input : defaultVal;
}

String getChipUUID() {
  uint64_t chipId = ESP.getEfuseMac();
  uint32_t macLow = (uint32_t)(chipId);
  uint16_t macHigh = (uint16_t)(chipId >> 32);

  char uuidBuf[37];
  snprintf(uuidBuf, sizeof(uuidBuf), "e5320000-0000-4000-8000-%04x%08x", macHigh, macLow);
  return String(uuidBuf);
}

bool isValidUUID(const String& str) {
  if (str.length() != 36) return false;
  for (size_t i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else {
      if (!isHexadecimalDigit(c)) return false;
    }
  }
  return true;
}

bool loadConfig() {
  prefs.begin("mh-config", true); // Read-only mode
  cfgSsid        = prefs.getString("ssid", "");
  cfgPass        = prefs.getString("pass", "");
  cfgSupabaseUrl = prefs.getString("sb_url", "https://qmketwlyeexumcxboagc.supabase.co");
  cfgAnonKey     = prefs.getString("anon_key", "");
  cfgDeviceId    = prefs.getString("device_id", getChipUUID());
  cfgDeviceKey   = prefs.getString("device_key", "secret_passcode_123");
  prefs.end();

  if (!isValidUUID(cfgDeviceId)) {
    cfgDeviceId = getChipUUID();
  }
  if (cfgDeviceKey.equalsIgnoreCase("reset") || cfgDeviceKey.length() == 0) {
    cfgDeviceKey = "secret_passcode_123";
  }

  return (cfgSsid.length() > 0 && cfgPass.length() > 0 && cfgSupabaseUrl.length() > 0);
}

void saveConfig() {
  prefs.begin("mh-config", false); // Read-write mode
  prefs.putString("ssid", cfgSsid);
  prefs.putString("pass", cfgPass);
  prefs.putString("sb_url", cfgSupabaseUrl);
  prefs.putString("anon_key", cfgAnonKey);
  prefs.putString("device_id", cfgDeviceId);
  prefs.putString("device_key", cfgDeviceKey);
  prefs.end();
  Serial.println("✅ Config saved to NVS Flash memory.");
}

void clearConfig() {
  prefs.begin("mh-config", false);
  prefs.clear();
  prefs.end();
  Serial.println("🗑️ NVS Flash memory cleared.");
}

void flushSerialInput() {
  while (Serial.available()) {
    Serial.read();
    delay(2);
  }
}

void runSerialProvisioning() {
  flushSerialInput();
  Serial.println();
  Serial.println("╔═════════════════════════════════════════════╗");
  Serial.println("║    Marveluzz Hub ESP32 Wi-Fi Setup Engine   ║");
  Serial.println("╚═════════════════════════════════════════════╝");
  Serial.println("Enter values below (press Enter to keep default):");
  Serial.println();

  cfgSsid        = serialPrompt("WiFi SSID", cfgSsid);
  cfgPass        = serialPrompt("WiFi Password", cfgPass);
  cfgSupabaseUrl = serialPrompt("Supabase URL", cfgSupabaseUrl.length() > 0 ? cfgSupabaseUrl : String("https://qmketwlyeexumcxboagc.supabase.co"));
  cfgAnonKey     = serialPrompt("Supabase Anon Key", cfgAnonKey);

  String defaultDevId = isValidUUID(cfgDeviceId) ? cfgDeviceId : getChipUUID();
  String inputDevId   = serialPrompt("Device UUID", defaultDevId);
  cfgDeviceId         = isValidUUID(inputDevId) ? inputDevId : defaultDevId;

  String defaultDevKey = (cfgDeviceKey.length() > 0 && !cfgDeviceKey.equalsIgnoreCase("reset")) ? cfgDeviceKey : String("secret_passcode_123");
  cfgDeviceKey        = serialPrompt("Device Secret Key", defaultDevKey);

  saveConfig();
}

// -------------------------------------------------------------
// 3. Register Dynamic UI Layout Schema via TelemetryLogic
// -------------------------------------------------------------
void registerUILayout() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = cfgSupabaseUrl + "/rest/v1/rpc/register_ui_definition";

  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  if (cfgAnonKey.length() > 0) {
    http.addHeader("apikey", cfgAnonKey);
    http.addHeader("Authorization", "Bearer " + cfgAnonKey);
  }

  String jsonPayload = TelemetryLogic::buildLayoutJson(cfgDeviceId, cfgDeviceKey);

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
// 4. Send Uplink Telemetry Cadence Stream (HTTP POST)
// -------------------------------------------------------------
void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = cfgSupabaseUrl + "/rest/v1/rpc/ingest_telemetry";

  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  if (cfgAnonKey.length() > 0) {
    http.addHeader("apikey", cfgAnonKey);
    http.addHeader("Authorization", "Bearer " + cfgAnonKey);
  }

  // Read hardware status / simulated DS18B20 sensor reading
  float temperatureC = 23.5 + random(-10, 10) / 10.0;
  unsigned long uptimeSec = millis() / 1000;

  // Check emergency fault button state (Active LOW)
  if (digitalRead(EMERGENCY_BTN_PIN) == LOW) {
    deviceState.hasFault = true;
  }

  String jsonPayload = TelemetryLogic::buildTelemetryJson(
    cfgDeviceId, cfgDeviceKey, temperatureC, deviceState.ledState,
    uptimeSec, deviceState.viewersActive, deviceState.hasFault
  );

  int httpCode = http.POST(jsonPayload);
  if (httpCode == 200) {
    String response = http.getString();
    // Update viewers_active presence stream mode (Commands are strictly WebSocket-only)
    TelemetryLogic::parseIngestResponse(response, cfgDeviceId, deviceState, applyLedHardwareState);

    Serial.printf("[UPLINK] Telemetry Ingest [%s] -> Temp=%.1f C, LED=%s (HTTP 200 OK)\n",
                  deviceState.viewersActive ? "5s Fast Mode" : "30s Power-Save Mode",
                  temperatureC, deviceState.ledState ? "ON" : "OFF");
  } else {
    Serial.printf("[UPLINK] Telemetry Error %d: %s\n", httpCode, http.getString().c_str());
  }

  http.end();
}

// -------------------------------------------------------------
// 5. Arduino Setup & Loop
// -------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(EMERGENCY_BTN_PIN, INPUT_PULLUP);
  digitalWrite(LED_PIN, LOW);

  Serial.println("\n🚀 Booting ESP32 Temperature Sensor Node...");

  bool hasConfig = loadConfig();

  // Prompt user for 3 seconds to enter 'reset' if they wish to change Wi-Fi settings
  Serial.println("⏱️ Press Enter or type 'reset' within 3 seconds to reconfigure Wi-Fi...");
  unsigned long startWait = millis();
  String initialInput = "";
  while (millis() - startWait < 3000) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\r' || c == '\n') break;
      initialInput += c;
    }
    delay(10);
  }
  initialInput.trim();

  if (!hasConfig || initialInput.equalsIgnoreCase("reset")) {
    runSerialProvisioning();
  }

  Serial.println();
  Serial.println("┌────────────────────────────────────────────────────────────────┐");
  Serial.printf( "│  🆔 DEVICE UUID : %-44s │\n", cfgDeviceId.c_str());
  Serial.println("└────────────────────────────────────────────────────────────────┘");
  Serial.println();

  Serial.printf("📶 Connecting to Wi-Fi SSID: '%s'...\n", cfgSsid.c_str());
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n📶 Wi-Fi Connected Successfully! IP: " + WiFi.localIP().toString());
    deviceState.connected = true;
    registerUILayout();
    setupWebSocket();
    sendTelemetry();
  } else {
    Serial.println("\n❌ Wi-Fi Connection Failed!");
    Serial.println("⚠️ Type 'reset' in Serial Monitor and restart to update your Wi-Fi credentials.");
  }

  lastUpdateMs = millis();
}

void loop() {
  webSocket.loop();

  // Listen for 'reset' command typed into Serial Monitor while running
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.equalsIgnoreCase("reset")) {
      clearConfig();
      runSerialProvisioning();
      ESP.restart();
    }
  }

  unsigned long now = millis();

  // Send Phoenix WebSocket heartbeat every 25 seconds to keep Supabase Realtime channel alive (prevents 60s idle disconnect)
  static unsigned long lastWsHeartbeatMs = 0;
  if (deviceState.wsConnected && (now - lastWsHeartbeatMs >= 25000)) {
    lastWsHeartbeatMs = now;
    webSocket.sendTXT("{\"topic\":\"phoenix\",\"event\":\"heartbeat\",\"payload\":{},\"ref\":\"hb\"}");
  }

  // Print system memory and network debug statistics every 60 seconds
  static unsigned long lastDebugPrint = 0;
  if (now - lastDebugPrint >= 60000) {
    lastDebugPrint = now;
    uint32_t totalHeap = ESP.getHeapSize();
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t minFreeHeap = ESP.getMinFreeHeap();
    float pctUsed = (totalHeap > 0) ? ((float)(totalHeap - freeHeap) / totalHeap * 100.0) : 0.0;
    float minPctUsed = (totalHeap > 0) ? ((float)(totalHeap - minFreeHeap) / totalHeap * 100.0) : 0.0;
    int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;

    Serial.println();
    Serial.println("--- [System Debug Status] ---");
    Serial.printf("  Free Heap: %u bytes (%u KB) - Used: %.1f%%\n", freeHeap, freeHeap / 1024, pctUsed);
    Serial.printf("  Min Free Heap: %u bytes (%u KB) - Max Used: %.1f%%\n", minFreeHeap, minFreeHeap / 1024, minPctUsed);
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("  WiFi RSSI: %d dBm (IP: %s)\n", rssi, WiFi.localIP().toString().c_str());
    } else {
      Serial.println("  WiFi Status: Disconnected");
    }
    Serial.printf("  WebSocket Status: %s\n", deviceState.wsConnected ? "CONNECTED" : "DISCONNECTED");
    Serial.printf("  Stream Mode: %s (%lums cadence)\n", deviceState.viewersActive ? "5s Fast Mode" : "30s Power-Save Mode", TelemetryLogic::getStreamIntervalMs(deviceState.viewersActive));
    Serial.println("-----------------------------");
    Serial.println();
  }

  unsigned long interval = TelemetryLogic::getStreamIntervalMs(deviceState.viewersActive);

  if (now - lastUpdateMs >= interval) {
    lastUpdateMs = now;
    sendTelemetry();
  }
}
