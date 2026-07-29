/**
 * ============================================================================
 * MARVELUZZ HUB TELEMETRY & BUSINESS LOGIC ENGINE
 * ============================================================================
 * Decoupled C++ business logic class for hardware microcontrollers (ESP32).
 * Formats JSON RPC payloads for layout registration and telemetry ingest,
 * decodes incoming executed command queues & Realtime WebSockets, and handles state.
 * ============================================================================
 */

#ifndef TELEMETRY_LOGIC_H
#define TELEMETRY_LOGIC_H

#include <Arduino.h>
#include <ArduinoJson.h>

struct DeviceState {
  bool connected = false;
  bool wsConnected = false;
  bool layoutSent = false;
  bool ledState = false;
  bool viewersActive = true;
  bool hasFault = false;
  const char* faultCode = nullptr;
  unsigned long fastIntervalMs = 5000;
  unsigned long slowIntervalMs = 30000;
  unsigned long streamIntervalMs = 5000;
};

class TelemetryLogic {
public:
  static void parseUrl(const String& fullUrl, String& protocol, String& host, int& port, String& path) {
    int protoIdx = fullUrl.indexOf("://");
    if (protoIdx != -1) {
      protocol = fullUrl.substring(0, protoIdx);
      String rest = fullUrl.substring(protoIdx + 3);
      int slashIdx = rest.indexOf('/');
      if (slashIdx != -1) {
        host = rest.substring(0, slashIdx);
        path = rest.substring(slashIdx);
      } else {
        host = rest;
        path = "";
      }
    } else {
      protocol = "http";
      host = fullUrl;
      path = "";
    }
    port = protocol.equalsIgnoreCase("https") ? 443 : 80;
  }

  // Formats uptime into a human-readable duration string (Days Hours Minutes Seconds)
  static String formatUptime(unsigned long uptimeSec) {
    char uptimeBuf[32];
    snprintf(uptimeBuf, sizeof(uptimeBuf), "%lud %luh %lum %lus",
             uptimeSec / 86400, (uptimeSec % 86400) / 3600,
             (uptimeSec % 3600) / 60, uptimeSec % 60);
    return String(uptimeBuf);
  }

  // Returns standard system status text based on sensor state & viewer activity
  static String getStatusText(bool hasFault, bool viewersActive) {
    if (hasFault) return "CRITICAL: Fault Code E-04 (Sensor Disconnected)";
    return viewersActive ? "Live Streaming (5s Fast Mode)" : "Power-Saving Idle (30s Mode)";
  }

  // Calculates current stream interval in milliseconds based on viewer presence
  static unsigned long getStreamIntervalMs(bool viewersActive) {
    return viewersActive ? 5000 : 30000;
  }

  // Builds Phoenix WebSocket Join frame payload for Supabase Realtime channel subscription (INSERT-only filter)
  static String buildWsJoinPayload(const String& deviceId) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
#else
    StaticJsonDocument<512> doc;
#endif

    doc["topic"] = "realtime:public:device_commands:device_id=eq." + deviceId;
    doc["event"] = "phx_join";

#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonObject payload = doc["payload"].to<JsonObject>();
    JsonObject config = payload["config"].to<JsonObject>();
    JsonArray postgresChanges = config["postgres_changes"].to<JsonArray>();
    JsonObject change = postgresChanges.add<JsonObject>();
#else
    JsonObject payload = doc.createNestedObject("payload");
    JsonObject config = payload.createNestedObject("config");
    JsonArray postgresChanges = config.createNestedArray("postgres_changes");
    JsonObject change = postgresChanges.createNestedObject();
#endif

    change["event"] = "INSERT";
    change["schema"] = "public";
    change["table"] = "device_commands";
    change["filter"] = "device_id=eq." + deviceId;

    doc["ref"] = "1";

    String output;
    serializeJson(doc, output);
    return output;
  }

  // Generates JSON Layout Definition document to register widgets with Marveluzz Hub
  static String buildLayoutJson(const String& deviceId, const String& deviceKey) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
#else
    StaticJsonDocument<768> doc;
#endif

    doc["p_device_id"] = deviceId.c_str();
    doc["p_device_key"] = deviceKey.c_str();

#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonObject layoutDef = doc["p_layout_def"].to<JsonObject>();
#else
    JsonObject layoutDef = doc.createNestedObject("p_layout_def");
#endif

    layoutDef["title"] = "ESP32 Temperature Sensor Node";
    layoutDef["type"] = "layout";

#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonObject props = layoutDef["properties"].to<JsonObject>();
#else
    JsonObject props = layoutDef.createNestedObject("properties");
#endif
    props["id"] = "layout_container";
    props["flow"] = "row";
    props["fast_timeout"] = 5000;
    props["slow_timeout"] = 30000;

#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonArray layout = layoutDef["layout"].to<JsonArray>();
#else
    JsonArray layout = layoutDef.createNestedArray("layout");
#endif

    // 1. Status Indicator
    JsonObject item1 = layout.add<JsonObject>();
    item1["type"] = "indicator";
    JsonObject prop1 = item1["properties"].to<JsonObject>();
    prop1["label"] = "Node Status";
    prop1["id"] = "status_text";
    prop1["value"] = "Online";

    // 2. Temperature Readout
    JsonObject item2 = layout.add<JsonObject>();
    item2["type"] = "number";
    JsonObject prop2 = item2["properties"].to<JsonObject>();
    prop2["label"] = "Field Sensor Temperature (°C)";
    prop2["id"] = "temperature";
    prop2["readonly"] = "true";

    // 3. Toggle LED Button
    JsonObject item3 = layout.add<JsonObject>();
    item3["type"] = "button";
    JsonObject prop3 = item3["properties"].to<JsonObject>();
    prop3["label"] = "Toggle LED";
    prop3["id"] = "led_toggle";

    // 4. LED State Feedback Indicator
    JsonObject item4 = layout.add<JsonObject>();
    item4["type"] = "indicator";
    JsonObject prop4 = item4["properties"].to<JsonObject>();
    prop4["label"] = "LED State";
    prop4["id"] = "led_state";
    prop4["value"] = "OFF";
    prop4["readonly"] = "true";

    // 5. Device Uptime Text
    JsonObject item5 = layout.add<JsonObject>();
    item5["type"] = "text";
    JsonObject prop5 = item5["properties"].to<JsonObject>();
    prop5["label"] = "Device Uptime";
    prop5["id"] = "uptime";
    prop5["readonly"] = "true";

    String output;
    serializeJson(doc, output);
    return output;
  }

  // Generates JSON Telemetry snapshot payload for ingest_telemetry RPC
  static String buildTelemetryJson(const String& deviceId, const String& deviceKey,
                                   float temp, bool ledState, unsigned long uptimeSec,
                                   bool viewersActive, bool hasFault) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
#else
    StaticJsonDocument<512> doc;
#endif

    doc["p_device_id"] = deviceId.c_str();
    doc["p_device_key"] = deviceKey.c_str();

#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonObject telemetry = doc["p_telemetry_data"].to<JsonObject>();
#else
    JsonObject telemetry = doc.createNestedObject("p_telemetry_data");
#endif

    telemetry["temperature"] = round(temp * 10.0) / 10.0;
    telemetry["led_toggle"] = ledState;
    telemetry["led_state"] = ledState ? "ON" : "OFF";
    telemetry["uptime"] = formatUptime(uptimeSec);
    telemetry["viewers_active"] = viewersActive;
    telemetry["power_save_mode"] = !viewersActive;
    telemetry["status_text"] = getStatusText(hasFault, viewersActive);

    if (hasFault) {
      telemetry["fault_code"] = "E-04";
      telemetry["emergency_stop"] = true;
    }

    String output;
    serializeJson(doc, output);
    return output;
  }

  // Parses executed command responses returned by Marveluzz Hub or Realtime WebSocket frame
  static void parseIngestResponse(const String& jsonResponse, const String& cfgDeviceId, DeviceState& state,
                                   void (*onLedCommand)(bool newState)) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
#else
    DynamicJsonDocument doc(1024);
#endif

    DeserializationError error = deserializeJson(doc, jsonResponse);
    if (error) return;

    // Handle WebSocket command push event payload (Strict Exclusive INSERT Downlink)
    String eventStr = doc["event"] | "";
    String payloadType = doc["payload"]["type"] | "";

    if (eventStr == "INSERT" || payloadType == "INSERT") {
      JsonObject payloadRecord = doc["payload"]["record"].as<JsonObject>();
      if (payloadRecord.isNull()) {
        payloadRecord = doc["payload"]["data"]["record"].as<JsonObject>();
      }

      if (!payloadRecord.isNull()) {
        // Defense 1: Verify payload device_id matches local cfgDeviceId
        const char* recDeviceId = payloadRecord["device_id"];
        if (recDeviceId != nullptr && cfgDeviceId.length() > 0 && String(recDeviceId) != cfgDeviceId) {
          return;
        }

        // Defense 2: Ensure command status is 'pending'
        const char* cmdStatus = payloadRecord["status"];
        if (cmdStatus != nullptr && String(cmdStatus) != "pending") {
          return;
        }

        const char* target = payloadRecord["target"];
        if (target != nullptr) {
          String targetStr = String(target);
          if (targetStr == "viewers_active") {
            bool active = payloadRecord["value"].as<bool>();
            state.viewersActive = active;
            state.streamIntervalMs = getStreamIntervalMs(active);
            Serial.printf("⚡ Viewer Presence Changed via WebSocket Push -> %s (%lums cadence)\n",
                          active ? "5s Fast Mode" : "30s Power-Save Mode",
                          state.streamIntervalMs);
          } else if (targetStr == "led_toggle" || targetStr == "fan_toggle") {
            String actionStr = payloadRecord["action"] | "";
            bool val = (actionStr == "set_value")
                         ? payloadRecord["value"].as<bool>()
                         : !state.ledState;
            state.ledState = val;
            Serial.printf("⚡ Instant WebSocket Command Received (INSERT) -> Target: '%s', Action: '%s'\n", targetStr.c_str(), actionStr.c_str());
            if (onLedCommand != nullptr) {
              onLedCommand(state.ledState);
            }
          }
        }
      }
      return;
    }

    // Handle HTTP telemetry ingest response (Viewer presence stream mode updates ONLY)
    if (doc.is<JsonObject>()) {
      JsonObject obj = doc.as<JsonObject>();
      if (!obj["viewers_active"].isNull()) {
        state.viewersActive = obj["viewers_active"].as<bool>();
        state.streamIntervalMs = getStreamIntervalMs(state.viewersActive);
      }
      return;
    }

    if (doc.is<JsonArray>()) {
      for (JsonObject row : doc.as<JsonArray>()) {
        if (!row["viewers_active"].isNull()) {
          state.viewersActive = row["viewers_active"].as<bool>();
          state.streamIntervalMs = getStreamIntervalMs(state.viewersActive);
        }
      }
    }
  }
};

#endif
