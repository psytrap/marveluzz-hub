/**
 * ============================================================================
 * MARVELUZZ HUB TELEMETRY & BUSINESS LOGIC ENGINE
 * ============================================================================
 * Decoupled C++ business logic class for hardware microcontrollers (ESP32).
 * Formats JSON RPC payloads for layout registration and telemetry ingest,
 * decodes incoming executed command queues, and handles status transitions.
 * ============================================================================
 */

#ifndef TELEMETRY_LOGIC_H
#define TELEMETRY_LOGIC_H

#include <Arduino.h>
#include <ArduinoJson.h>

struct DeviceState {
  bool connected = false;
  bool layoutSent = false;
  bool relayState = false;
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

  // Generates JSON Layout Definition document to register widgets with Marveluzz Hub
  static String buildLayoutJson(const String& deviceId, const String& deviceKey) {
    StaticJsonDocument<512> doc;
    doc["p_device_id"] = deviceId.c_str();
    doc["p_device_key"] = deviceKey.c_str();

    JsonObject layoutDef = doc.createNestedObject("p_layout_def");
    layoutDef["title"] = "ESP32 Field Temperature Node";
    layoutDef["type"] = "layout";

    JsonArray layout = layoutDef.createNestedArray("layout");
    
    // Temperature widget (read-only)
    JsonObject item1 = layout.createNestedObject();
    item1["type"] = "number";
    JsonObject prop1 = item1.createNestedObject("properties");
    prop1["label"] = "Field Sensor Temperature (°C)";
    prop1["id"] = "temperature";
    prop1["readonly"] = "true";

    // Water Pump Relay Switch
    JsonObject item2 = layout.createNestedObject();
    item2["type"] = "button";
    JsonObject prop2 = item2.createNestedObject("properties");
    prop2["label"] = "Water Pump Relay";
    prop2["id"] = "pump_relay";

    // Uptime text display
    JsonObject item3 = layout.createNestedObject();
    item3["type"] = "text";
    JsonObject prop3 = item3.createNestedObject("properties");
    prop3["label"] = "Device Uptime";
    prop3["id"] = "uptime";
    prop3["readonly"] = "true";

    String output;
    serializeJson(doc, output);
    return output;
  }

  // Generates JSON Telemetry snapshot payload for ingest_telemetry RPC
  static String buildTelemetryJson(const String& deviceId, const String& deviceKey, 
                                  float temp, bool relayState, unsigned long uptimeSec, 
                                  bool viewersActive, bool hasFault) {
    StaticJsonDocument<512> doc;
    doc["p_device_id"] = deviceId.c_str();
    doc["p_device_key"] = deviceKey.c_str();

    JsonObject telemetry = doc.createNestedObject("p_telemetry_data");
    telemetry["temperature"] = round(temp * 10.0) / 10.0;
    telemetry["pump_relay"] = relayState;
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

  // Parses executed command responses returned by Marveluzz Hub
  static void parseIngestResponse(const String& jsonResponse, DeviceState& state, 
                                  void (*onRelayCommand)(bool newState)) {
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, jsonResponse);
    if (error) return;

    if (doc.is<JsonArray>()) {
      JsonArray commands = doc.as<JsonArray>();
      for (JsonObject cmd : commands) {
        const char* target = cmd["target"];
        if (target == nullptr) continue;

        if (String(target) == "pump_relay") {
          bool val = cmd["value"] | !state.relayState;
          state.relayState = val;
          if (onRelayCommand != nullptr) {
            onRelayCommand(state.relayState);
          }
        } else if (String(target) == "viewers_active") {
          bool val = cmd["value"] | true;
          state.viewersActive = val;
          state.streamIntervalMs = getStreamIntervalMs(state.viewersActive);
        }
      }
    }
  }
};

#endif
