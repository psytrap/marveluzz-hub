// Marveluzz Hub - Mock IoT Device Emulator (ESP32 Simulation)
// Simulates an ESP32 Temperature Node registering UI layout & streaming telemetry

const SERVER_URL = Deno.env.get("SERVER_URL") || "http://localhost:8000";
const DEVICE_ID = Deno.env.get("DEVICE_ID") || "32323232-3232-4232-8232-28c13340c86c";
const DEVICE_KEY = Deno.env.get("DEVICE_KEY") || "secret_passcode_123";

const UI_DEFINITION = {
  title: "ESP32 Temperature Node",
  type: "layout",
  properties: { id: "layout_root", flow: "row" },
  layout: [
    {
      type: "number",
      properties: { label: "DS18B20 Temperature (°C)", id: "temperature", step: ".1", value: "24.5", readonly: "true" }
    },
    { type: "divider", properties: { id: "divider_1" } },
    {
      type: "button",
      properties: { label: "Cooling Fan Switch", id: "fan_toggle", value: "false" }
    },
    {
      type: "text",
      properties: { label: "Device Uptime", id: "uptime", value: "0s", readonly: "true" }
    }
  ]
};

console.log(`🤖 Starting Mock IoT Device Emulator (${DEVICE_ID})...`);

// 1. Upload UI Definition Layout
async function registerLayout() {
  try {
    const res = await fetch(`${SERVER_URL}/api/device/ui_definition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        deviceKey: DEVICE_KEY,
        layoutDef: UI_DEFINITION
      })
    });
    const data = await res.json();
    console.log("✅ UI Layout Registration:", data);
  } catch (e) {
    console.error("❌ Layout Registration Failed:", e.message);
  }
}

// 2. Telemetry Stream Loop (Every 5 seconds)
let startTime = Date.now();
async function sendTelemetry() {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const temp = (23 + Math.random() * 4).toFixed(1);

  const payload = {
    deviceId: DEVICE_ID,
    deviceKey: DEVICE_KEY,
    data: {
      temperature: parseFloat(temp),
      uptime: `${uptimeSec}s`,
      status_text: "Running Normally"
    }
  };

  try {
    const res = await fetch(`${SERVER_URL}/api/device/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    const responseData = await res.json();
    console.log(`📡 [${new Date().toLocaleTimeString()}] Telemetry Sent (${temp}°C, ${uptimeSec}s). Server Response:`, responseData);

    // If server returned executed commands from the queue, log them
    if (responseData.commands && responseData.commands.length > 0) {
      console.log("⚡ Executing Commands Received from Queue:", responseData.commands);
    }
  } catch (e) {
    console.error("❌ Telemetry Stream Error:", e.message);
  }
}

// Bootstrapping
await registerLayout();
setInterval(sendTelemetry, 5000);
sendTelemetry();
