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
  unsigned long streamIntervalMs = 5000; // 5s fast stream default
};

class TelemetryLogic {
public:
  // Decodes an endpoint URL into protocol, host, port, and path variables
  static void parseUrl(String url, String &protocol, String &host, int &port, String &path) {
    protocol = "http";
    host = "";
    port = 80;
    path = "/";

    int protoIdx = url.indexOf("://");
    if (protoIdx != -1) {
      protocol = url.substring(0, protoIdx);
      url = url.substring(protoIdx + 3);
    }

    int pathIdx = url.indexOf('/');
    if (pathIdx != -1) {
      path = url.substring(pathIdx);
      url = url.substring(0, pathIdx);
    }

    int portIdx = url.indexOf(':');
    if (portIdx != -1) {
      host = url.substring(0, portIdx);
      port = url.substring(portIdx + 1).toInt();
    } else {
      host = url;
      port = (protocol.equalsIgnoreCase("https")) ? 443 : 80;
    }
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

  // Builds Phoenix WebSocket Join frame payload for Supabase Realtime channel subscription
  static String buildWsJoinPayload(const String& deviceId) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
#else
    StaticJsonDocument<256> doc;
#endif

    doc["topic"] = "realtime:public:device_commands:device_id=eq." + deviceId;
    doc["event"] = "phx_join";
#if ARDUINOJSON_VERSION_MAJOR >= 7
    doc["payload"].to<JsonObject>();
#else
    doc.createNestedObject("payload");
#endif
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

    layoutDef["title"] = "ESP32 Field Node";
    layoutDef["type"] = "layout";

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
  static void parseIngestResponse(const String& jsonResponse, DeviceState& state,
                                   void (*onLedCommand)(bool newState)) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
#else
    DynamicJsonDocument doc(1024);
#endif

    DeserializationError error = deserializeJson(doc, jsonResponse);
    if (error) return;

    // Handle WebSocket postgres_changes event payload
    if (doc["event"] == "postgres_changes") {
      JsonObject payloadRecord = doc["payload"]["data"]["record"];
      if (!payloadRecord.isNull()) {
        const char* target = payloadRecord["target"];
        if (target != nullptr && String(target) == "led_toggle") {
          bool val = payloadRecord["value"] | !state.ledState;
          state.ledState = val;
          if (onLedCommand != nullptr) {
            onLedCommand(state.ledState);
          }
        }
      }
      return;
    }

    // Handle JSON object response: {"success":true, "viewers_active":bool, "commands":[...]}
    if (doc.is<JsonObject>()) {
      JsonObject obj = doc.as<JsonObject>();
      if (!obj["viewers_active"].isNull()) {
        state.viewersActive = obj["viewers_active"].as<bool>();
        state.streamIntervalMs = getStreamIntervalMs(state.viewersActive);
      }
      JsonArray cmds = obj["commands"].as<JsonArray>();
      for (JsonObject cmd : cmds) {
        const char* target = cmd["target"];
        if (target == nullptr) continue;
        if (String(target) == "led_toggle") {
          bool val = (String(cmd["action"] | "") == "set_value")
                       ? cmd["value"].as<bool>()
                       : !state.ledState;
          state.ledState = val;
          if (onLedCommand != nullptr) {
            onLedCommand(state.ledState);
          }
        }
      }
      return;
    }

    // Handle standard HTTP POST RPC array payload:
    // Format: [{"success":true, "viewers_active":bool, "commands":[{"target":..., "action":..., "value":...}]}]
    if (doc.is<JsonArray>()) {
      for (JsonObject row : doc.as<JsonArray>()) {

        // Update viewers_active from top-level field
        if (!row["viewers_active"].isNull()) {
          state.viewersActive = row["viewers_active"].as<bool>();
          state.streamIntervalMs = getStreamIntervalMs(state.viewersActive);
        }

        // Unwrap nested commands array or direct row fields
        JsonArray cmds = row["commands"].as<JsonArray>();
        if (!cmds.isNull()) {
          for (JsonObject cmd : cmds) {
            const char* target = cmd["target"];
            if (target == nullptr) continue;

            if (String(target) == "led_toggle") {
              bool val = (String(cmd["action"] | "") == "set_value")
                           ? cmd["value"].as<bool>()
                           : !state.ledState;
              state.ledState = val;
              if (onLedCommand != nullptr) {
                onLedCommand(state.ledState);
              }
            }
          }
        } else {
          // Direct command row format
          const char* target = row["target"];
          if (target != nullptr && String(target) == "led_toggle") {
            bool val = (String(row["action"] | "") == "set_value")
                         ? row["value"].as<bool>()
                         : !state.ledState;
            state.ledState = val;
            if (onLedCommand != nullptr) {
              onLedCommand(state.ledState);
            }
          }
        }
      }
    }
  }
};

#endif
