// Marveluzz Hub - Interactive IoT Device Emulator Web Panel (Port 8001)
// Supports both Direct-to-Supabase Cloud Ingest & Edge Gateway Ingest

const PORT = Number(Deno.env.get("EMULATOR_PORT") || Deno.env.get("PORT")) || 8001;
const DEFAULT_HUB_URL = Deno.env.get("EMULATOR_URL") || "https://qmketwlyeexumcxboagc.supabase.co";
const DEFAULT_ANON_KEY = Deno.env.get("EMULATOR_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_Tp40f-fYpbtF1_4-6UdWmw_g5AJMM2d";
const DEFAULT_DEVICE_ID = Deno.env.get("EMULATOR_DEVICE_ID") || Deno.env.get("TEST_DEVICE_ID") || "32323232-3232-4232-8232-28c13340c86c";
const DEFAULT_DEVICE_KEY = Deno.env.get("EMULATOR_DEVICE_KEY") || Deno.env.get("TEST_DEVICE_KEY") || "secret_passcode_123";

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Marveluzz IoT Device Emulator Panel</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <style>
    :root {
      --bg-color: #0d0e15;
      --panel-bg: rgba(22, 28, 45, 0.45);
      --border-color: rgba(255, 255, 255, 0.08);
      --accent-color: #f59e0b; /* Amber/orange theme for device emulator */
      --accent-glow: rgba(245, 158, 11, 0.3);
      --success-color: #10b981;
      --danger-color: #ef4444;
      --text-primary: #f3f4f6;
      --text-secondary: #9ca3af;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 30px;
    }

    header {
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto 30px auto;
    }

    h1 {
      font-size: 22px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .glass {
      background: var(--panel-bg);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      box-shadow: 0 10px 40px 0 rgba(0, 0, 0, 0.45);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-secondary);
      box-shadow: 0 0 8px var(--text-secondary);
    }

    .status-badge.connected .status-dot {
      background: var(--success-color);
      box-shadow: 0 0 10px var(--success-color);
    }

    .status-badge.disconnected .status-dot {
      background: var(--danger-color);
      box-shadow: 0 0 10px var(--danger-color);
    }

    main {
      flex: 1;
      display: grid;
      grid-template-columns: 380px 1fr;
      gap: 30px;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
    }

    @media (max-width: 900px) {
      main {
        grid-template-columns: 1fr;
      }
    }

    .control-section {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      height: fit-content;
    }

    .config-card {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    label {
      font-size: 13px;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .input-field {
      width: 100%;
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
    }

    .input-field:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .btn {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: var(--accent-color);
      color: #000;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .btn:hover {
      box-shadow: 0 0 15px var(--accent-glow);
      background: #fbbf24;
    }

    .btn.btn-disconnect {
      background: var(--danger-color);
      color: #fff;
    }

    .btn.btn-disconnect:hover {
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
      background: #dc2626;
    }

    .knob-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }

    .knob-slider {
      accent-color: var(--accent-color);
      cursor: pointer;
    }

    .btn-fault {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--danger-color);
      padding: 10px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: all 0.3s ease;
    }

    .btn-fault.active {
      background: var(--danger-color);
      color: #fff;
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
    }

    .console-panel {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      height: 640px;
    }

    .console-header {
      font-weight: 600;
      font-size: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .console-terminal {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 13px;
      overflow-y: auto;
      color: #34d399; /* Green terminal text */
      line-height: 1.6;
    }

    .log-line {
      margin-bottom: 6px;
      border-bottom: 1px solid rgba(255,255,255,0.02);
      padding-bottom: 4px;
    }

    .log-time {
      color: var(--text-secondary);
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <header>
    <h1>
      <svg style="width:28px;height:28px;color:var(--accent-color);" viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>
      <span>Marveluzz IoT Device Emulator Panel</span>
    </h1>

    <div id="connection-badge" class="status-badge disconnected">
      <span class="status-dot"></span>
      <span id="status-text">Disconnected</span>
    </div>
  </header>

  <main>
    <!-- Left Configuration Side -->
    <div style="display:flex; flex-direction:column; gap:30px;">
      <div class="glass config-card">
        <h3 style="margin-bottom:4px;">Target Server Config</h3>
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">Supports Direct Supabase Cloud Ingest or Edge Server Gateway</p>
        
        <div class="form-group">
          <label>Ingest Target URL</label>
          <input type="text" id="hub-url" class="input-field" value="${DEFAULT_HUB_URL}">
        </div>

        <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
          <label style="color:#f59e0b; font-weight:600;">Supabase Anon Key (Publishable Key)</label>
          <input type="text" id="anon-key" class="input-field" value="${DEFAULT_ANON_KEY}" placeholder="Paste SUPABASE_ANON_KEY here for Direct Mode">
        </div>

        <div class="form-group">
          <label>Device ID (UUID)</label>
          <input type="text" id="device-id" class="input-field" value="${DEFAULT_DEVICE_ID}">
        </div>

        <div class="form-group">
          <label>Device Passcode / Secret Key</label>
          <input type="password" id="device-key" class="input-field" value="${DEFAULT_DEVICE_KEY}">
        </div>

        <button id="connect-btn" class="btn" onclick="toggleConnection()">Connect & Stream</button>
      </div>

      <!-- Simulated hardware state controls -->
      <div class="glass control-section">
        <h3>Device Hardware Knobs</h3>
        
        <div class="form-group">
          <label>Office Temperature</label>
          <div class="knob-row">
            <input type="range" id="knob-temp" class="knob-slider" min="15" max="35" step="0.1" value="24.5" oninput="updateKnobVal('temp', this.value)">
            <span id="val-temp" style="font-weight:600; color:var(--accent-color);">24.5°C</span>
          </div>
        </div>

        <div class="form-group">
          <label>Desk Fan Switch Relay</label>
          <div class="knob-row">
            <span>Fan Status</span>
            <input type="checkbox" id="knob-fan" style="width:20px; height:20px; cursor:pointer;" onchange="updateFanVal(this.checked)">
          </div>
        </div>

        <div class="form-group">
          <label>Power-Saving & Viewer Feedback Mode</label>
          <div class="knob-row">
            <span>Viewers Active (5s Fast Stream)</span>
            <input type="checkbox" id="knob-viewers" style="width:20px; height:20px; cursor:pointer;" checked onchange="toggleViewersActive(this.checked)">
          </div>
        </div>

        <div class="form-group">
          <label>Constant Sensor Updates</label>
          <div class="knob-row">
            <span id="stream-rate-label">Auto-Stream Telemetry (5s)</span>
            <input type="checkbox" id="knob-autostream" style="width:20px; height:20px; cursor:pointer;" checked onchange="toggleAutoStream(this.checked)">
          </div>
        </div>

        <div class="form-group" style="margin-top:10px;">
          <button id="fault-btn" class="btn-fault" onclick="toggleFault()">🚨 Trigger Hardware Fault</button>
        </div>
      </div>
    </div>

    <!-- Right Side Logger Terminal -->
    <div class="glass console-panel">
      <div class="console-header">
        <span>Device Telemetry Logs</span>
        <button onclick="clearLogs()" class="btn-action" style="font-size:11px; padding:4px 8px; border:1px solid var(--border-color); background:transparent; color:var(--text-secondary); border-radius:4px; cursor:pointer;">Clear Logs</button>
      </div>
      <div id="terminal" class="console-terminal">
        <div class="log-line"><span class="log-time">[System]</span> Ready. Paste SUPABASE_ANON_KEY and click Connect & Stream.</div>
      </div>
    </div>
  </main>

  <script>
    let isConnected = false;
    let telemetryTimer = null;
    let realtimeChannel = null;
    let executedCommandIds = new Set();
    let isSendingTelemetry = false;
    let startTime = Date.now();

    let tempVal = 24.5;
    let fanVal = false;
    let hasFault = false;
    let autoStreamActive = true;
    let viewersActive = true;

    function executeIncomingCommand(cmd, source = "Push") {
      if (!cmd || !cmd.target || cmd.target === "undefined") return;

      const cmdId = cmd.id || cmd.commandId;
      if (cmdId && executedCommandIds.has(cmdId)) {
        console.log("[CMD] Ignoring duplicate command ID:", cmdId);
        return;
      }
      if (cmdId) {
        executedCommandIds.add(cmdId);
        if (executedCommandIds.size > 200) {
          const first = executedCommandIds.values().next().value;
          executedCommandIds.delete(first);
        }
      }

      log("⚡ Incoming Command Executed (" + source + ") -> Target: '" + cmd.target + "', Action: " + cmd.action + ", Value: " + JSON.stringify(cmd.value), "Command");

      if (cmd.target === "led_toggle" || cmd.target === "fan_toggle") {
        if (cmd.action === "toggle") {
          fanVal = !fanVal;
        } else if (cmd.action === "set_value") {
          fanVal = Boolean(cmd.value);
        } else {
          fanVal = !fanVal;
        }
        const knobFan = document.getElementById("knob-fan");
        if (knobFan) knobFan.checked = fanVal;
      } else if (cmd.target === "fan_speed") {
        const speedVal = Number(cmd.value);
        if (!isNaN(speedVal)) {
          log("Fan Speed Target Set -> " + speedVal + "%", "Command");
        }
      } else if (cmd.target === "viewers_active") {
        toggleViewersActive(!!cmd.value);
        const knobViewers = document.getElementById("knob-viewers");
        if (knobViewers) knobViewers.checked = viewersActive;
      }

      // Immediately send updated state via telemetry packet back to server
      sendTelemetryPacket();
    }

    function getStreamIntervalMs() {
      return viewersActive ? 5000 : 10000;
    }

    function getCleanHubUrl() {
      const rawUrl = document.getElementById("hub-url").value.trim();
      return rawUrl.replace(new RegExp("/+$"), "");
    }

    function isDirectSupabaseMode() {
      const url = getCleanHubUrl();
      return url.includes(".supabase.co");
    }

    function log(message, category = "Info") {
      const term = document.getElementById("terminal");
      const time = new Date().toLocaleTimeString();
      const line = document.createElement("div");
      line.className = "log-line";
      
      let categoryColor = "#34d399";
      if (category === "Command") categoryColor = "#60a5fa";
      if (category === "Error") categoryColor = "#ef4444";
      if (category === "System") categoryColor = "#9ca3af";

      line.innerHTML = '<span class="log-time">[' + time + ']</span> <span style="color:' + categoryColor + '; font-weight:500;">[' + category + ']</span> ' + message;
      term.appendChild(line);
      term.scrollTop = term.scrollHeight;
    }

    function clearLogs() {
      console.log("[BTN] clearLogs clicked");
      const term = document.getElementById("terminal");
      if (term) {
        term.innerHTML = "";
        log("Logs cleared.", "System");
      } else {
        console.error("[BTN] clearLogs: #terminal element not found!");
      }
    }

    function updateKnobVal(type, val) {
      console.log("[BTN] updateKnobVal type=", type, "val=", val);
      if (type === 'temp') {
        tempVal = Number(val);
        document.getElementById("val-temp").innerText = tempVal.toFixed(1) + "°C";
      }
      sendTelemetryPacket();
    }

    function updateFanVal(checked) {
      console.log("[BTN] updateFanVal clicked, checked=", checked);
      fanVal = !!checked;
      log("Desk Fan Switch manually set to: " + (fanVal ? "ON" : "OFF"), "Info");
      sendTelemetryPacket();
    }

    function toggleViewersActive(checked) {
      console.log("[BTN] toggleViewersActive clicked, checked=", checked);
      viewersActive = !!checked;
      const intervalSec = getStreamIntervalMs() / 1000;
      document.getElementById("stream-rate-label").innerText = "Auto-Stream Telemetry (" + intervalSec + "s)";
      log("⚡ Viewer feedback state update: Viewers " + (viewersActive ? "ACTIVE (Fast 5s stream)" : "INACTIVE (Power-Saving 10s stream)"), "System");
      
      if (isConnected && autoStreamActive) {
        if (telemetryTimer) clearInterval(telemetryTimer);
        telemetryTimer = setInterval(sendTelemetryPacket, getStreamIntervalMs());
      }
      sendTelemetryPacket();
    }

    function toggleFault() {
      console.log("[BTN] toggleFault clicked, hasFault=", hasFault);
      hasFault = !hasFault;
      const btn = document.getElementById("fault-btn");
      if (hasFault) {
        btn.classList.add("active");
        btn.innerText = "🚨 Clear Hardware Fault";
        log("🚨 EMERGENCY HARDWARE FAULT TRIGGERED! Flagging critical telemetry payload.", "Error");
      } else {
        btn.classList.remove("active");
        btn.innerText = "🚨 Trigger Hardware Fault";
        log("Hardware Fault cleared. Normal operation restored.", "System");
      }
      sendTelemetryPacket();
    }

    function toggleAutoStream(checked) {
      console.log("[BTN] toggleAutoStream clicked, checked=", checked);
      autoStreamActive = !!checked;
      log("Auto-Stream Telemetry set to: " + autoStreamActive, "System");
      if (isConnected) {
        if (autoStreamActive) {
          if (telemetryTimer) clearInterval(telemetryTimer);
          telemetryTimer = setInterval(sendTelemetryPacket, getStreamIntervalMs());
          log("Constant sensor updates started.", "System");
        } else {
          if (telemetryTimer) {
            clearInterval(telemetryTimer);
            telemetryTimer = null;
          }
          log("Constant sensor updates paused.", "System");
        }
      }
    }

    function toggleConnection() {
      console.log("[BTN] toggleConnection clicked, isConnected=", isConnected);
      if (isConnected) {
        disconnect();
      } else {
        connect();
      }
    }

    async function connect() {
      const hubUrl = getCleanHubUrl();
      const deviceId = document.getElementById("device-id").value.trim();
      const deviceKey = document.getElementById("device-key").value.trim();
      const anonKey = document.getElementById("anon-key").value.trim();
      const connectBtn = document.getElementById("connect-btn");
      const badge = document.getElementById("connection-badge");
      const statusText = document.getElementById("status-text");

      const isDirect = isDirectSupabaseMode();
      if (isDirect && !anonKey) {
        log("⚠️ Direct Supabase Cloud Mode requires a valid SUPABASE_ANON_KEY in the amber box!", "Error");
      }

      log("Connecting target: " + hubUrl + (isDirect ? " (Direct Supabase Cloud Mode)" : " (Edge Server Mode)"), "System");

      const layoutDef = {
        title: "IoT Device Emulator Node",
        type: "layout",
        layout: [
          { type: "number", properties: { label: "DS18B20 Temperature (°C)", id: "temperature", value: String(tempVal), readonly: "true" } },
          { type: "button", properties: { label: "Status LED Light", id: "led_toggle", value: String(fanVal) } },
          { type: "text", properties: { label: "Device Uptime", id: "uptime", value: "0s", readonly: "true" } }
        ]
      };

      log("📋 Layout Schema -> " + JSON.stringify(layoutDef), "System");

      try {
        let endpoint = hubUrl + "/api/device/ui_definition";
        let headers = { "Content-Type": "application/json" };
        let bodyPayload = { deviceId, deviceKey, layoutDef };

        if (isDirect) {
          endpoint = hubUrl + "/rest/v1/rpc/register_ui_definition";
          headers["apikey"] = anonKey;
          headers["Authorization"] = "Bearer " + anonKey;
          bodyPayload = { p_device_id: deviceId, p_device_key: deviceKey, p_layout_def: layoutDef };
        }

        log("📡 Sending Layout Registration Request -> POST " + endpoint, "System");

        const layoutRes = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload)
        });

        if (!layoutRes.ok) {
          const errText = await layoutRes.text();
          log("❌ HTTP Error " + layoutRes.status + ": " + errText, "Error");
          return;
        }

        const layoutData = await layoutRes.json();
        const isSuccess = isDirect ? (layoutData === true || layoutData.success === true) : layoutData.success;

        if (isSuccess) {
          log("✅ UI Layout Schema registered successfully (HTTP " + layoutRes.status + ").", "System");
          isConnected = true;
          connectBtn.innerText = "Disconnect";
          connectBtn.className = "btn btn-disconnect";
          badge.className = "status-badge connected";
          statusText.innerText = "Connected";

          // -------------------------------------------------------------
          // MANDATED DIRECT-TO-SUPABASE REALTIME WEBSOCKET PUSH CHANNEL
          // -------------------------------------------------------------
          if (window.supabase) {
            try {
              const supabaseCloudUrl = isDirect ? hubUrl : "https://qmketwlyeexumcxboagc.supabase.co";
              const supabaseAnonKey = anonKey || "sb_publishable_Tp40f-fYpbtF1_4-6UdWmw_g5AJMM2d";
              const spClient = window.supabase.createClient(supabaseCloudUrl, supabaseAnonKey);

              realtimeChannel = spClient.channel('emulator_push_' + deviceId)
                .on('postgres_changes', {
                  event: 'INSERT',
                  schema: 'public',
                  table: 'device_commands',
                  filter: 'device_id=eq.' + deviceId
                }, (payload) => {
                  console.log("[INSTANT PUSH] Supabase Realtime WebSocket payload received:", payload);
                  if (payload && payload.new) {
                    executeIncomingCommand(payload.new, "Direct Supabase Realtime WebSocket Push (<5ms)");
                  }
                })
                .subscribe((status) => {
                  console.log("[INSTANT PUSH] Supabase Realtime WebSocket status:", status);
                  if (status === 'SUBSCRIBED') {
                    log("⚡ Mandated Direct-to-Supabase Realtime WebSocket Channel Active (<5ms push).", "System");
                  }
                });
            } catch (e) {
              console.error("[INSTANT PUSH] Supabase Realtime setup error:", e);
            }
          } else {
            log("⚠️ Supabase JS library unavailable. Falling back to HTTP telemetry piggyback polling.", "Error");
          }

          // Start Telemetry Ingest Loop (10s default / 5s fast)
          sendTelemetryPacket();
          if (autoStreamActive) {
            telemetryTimer = setInterval(sendTelemetryPacket, getStreamIntervalMs());
          }
        } else {
          log("❌ Layout Registration Failed: " + (layoutData.error || "Unauthorized"), "Error");
        }
      } catch (e) {
        log("❌ Connection Error: " + e.message, "Error");
      }
    }

    async function sendDisconnectSignal() {
      try {
        const hubUrl = getCleanHubUrl();
        const deviceId = document.getElementById("device-id").value.trim();
        const anonKey = document.getElementById("anon-key").value.trim();
        if (hubUrl.indexOf("supabase.co") !== -1) {
          const url = hubUrl + "/rest/v1/devices?id=eq." + deviceId;
          const body = JSON.stringify({ status: "disconnected", controller_session_id: null });
          if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: "application/json" });
            navigator.sendBeacon(url, blob);
          } else {
            fetch(url, {
              method: "PATCH",
              headers: { "apikey": anonKey, "Authorization": "Bearer " + anonKey, "Content-Type": "application/json" },
              body: body,
              keepalive: true
            }).catch(function() {});
          }
        }
      } catch (_) {}
    }

    function disconnect() {
      sendDisconnectSignal();
      isConnected = false;
      if (telemetryTimer) {
        clearInterval(telemetryTimer);
        telemetryTimer = null;
      }
      if (realtimeChannel) {
        try {
          realtimeChannel.unsubscribe();
        } catch (_) {}
        realtimeChannel = null;
      }
      const connectBtn = document.getElementById("connect-btn");
      const badge = document.getElementById("connection-badge");
      const statusText = document.getElementById("status-text");

      connectBtn.innerText = "Connect & Stream";
      connectBtn.className = "btn";
      badge.className = "status-badge disconnected";
      statusText.innerText = "Disconnected";
      log("🔴 Connection with UI / Target Gateway closed or lost.", "Error");
    }

    window.addEventListener("beforeunload", () => { if (isConnected) sendDisconnectSignal(); });
    window.addEventListener("pagehide", () => { if (isConnected) sendDisconnectSignal(); });


    async function sendTelemetryPacket() {
      if (!isConnected || isSendingTelemetry) return;
      isSendingTelemetry = true;

      try {
        const hubUrl = getCleanHubUrl();
        const deviceId = document.getElementById("device-id").value.trim();
        const deviceKey = document.getElementById("device-key").value.trim();
        const anonKey = document.getElementById("anon-key").value.trim();
        const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
        const isDirect = isDirectSupabaseMode();

        const telemetryData = {
          temperature: Number(tempVal.toFixed(1)),
          led_toggle: fanVal,
          uptime: uptimeSec + "s",
          viewers_active: viewersActive,
          power_save_mode: !viewersActive,
          status_text: hasFault ? "CRITICAL: Fault" : (viewersActive ? "Live Streaming" : "Power-Saving Idle"),
          ...(hasFault ? { fault: true, emergency_stop: true } : {})
        };

        let endpoint = hubUrl + "/api/device/telemetry";
        let headers = { "Content-Type": "application/json" };
        let bodyPayload = { deviceId, deviceKey, data: telemetryData };

        if (isDirect) {
          endpoint = hubUrl + "/rest/v1/rpc/ingest_telemetry";
          headers["apikey"] = anonKey;
          headers["Authorization"] = "Bearer " + anonKey;
          bodyPayload = { p_device_id: deviceId, p_device_key: deviceKey, p_telemetry_data: telemetryData };
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload)
        });

        if (!res.ok) {
          if (res.status === 401 && isDirect) {
            log("🔴 Connection Lost: Direct Supabase Mode returned HTTP 401 Unauthorized (Invalid API Key).", "Error");
          } else {
            log("🔴 Connection Lost: Telemetry request rejected with HTTP Error " + res.status, "Error");
          }
          return;
        }

        const data = await res.json();
        const isSuccess = isDirect ? Array.isArray(data) : data.success;
        const rawCommands = isDirect ? (Array.isArray(data) ? data : []) : (data.commands || []);
        const commandList = (Array.isArray(rawCommands) ? rawCommands : []).flatMap(c => (c && Array.isArray(c.commands)) ? c.commands : [c]);

        if (isSuccess) {
          log("Telemetry Ingest (" + (viewersActive ? '5s Fast' : '10s Default') + ") -> Temp: " + tempVal.toFixed(1) + "°C, Fan: " + (fanVal ? 'ON' : 'OFF') + ", Fault: " + (hasFault ? 'Active' : 'None'), "Info");

          if (commandList && commandList.length > 0) {
            commandList.forEach(cmd => {
              executeIncomingCommand(cmd, "HTTP Ingest Piggyback Fallback");
            });
          }
        } else {
          log("❌ Telemetry Ingest Error: " + (data.error || "Failed"), "Error");
        }
      } catch (e) {
        log("❌ Telemetry Request Failed: " + e.message, "Error");
      } finally {
        isSendingTelemetry = false;
      }
    }

    let lastServerStartedAt = null;
    function checkServerRestartPing() {
      setInterval(async () => {
        try {
          const res = await fetch("/api/info");
          if (!res.ok) throw new Error("Offline");
          const info = await res.json();
          if (lastServerStartedAt && lastServerStartedAt !== info.startedAt) {
            log("🔄 Emulator Server restarted! (Started at: " + info.startedAt + ")", "Warning");
            const badge = document.getElementById("connection-badge");
            const statusText = document.getElementById("status-text");
            if (badge && statusText) {
              badge.className = "status-badge disconnected";
              statusText.innerText = "Server Restarted";
            }
          }
          lastServerStartedAt = info.startedAt;
        } catch (_) {}
      }, 2000);
    }
    checkServerRestartPing();
  </script>
</body>
</html>`;

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/") {
    return new Response(HTML_CONTENT, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (url.pathname === "/api/info") {
    return new Response(JSON.stringify({ startedAt: STARTED_AT, status: "online" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  return new Response("Not Found", { status: 404 });
}

const STARTED_AT = new Date().toLocaleString("en-GB", { hour12: false });
console.log(`
=======================================================
🤖 MARVELUZZ IOT DEVICE EMULATOR (v1.0.13)
⏱  STARTED AT          : ${STARTED_AT}
=======================================================
🌐 DEFAULT TARGET URL : ${DEFAULT_HUB_URL}
🔑 SUPABASE ANON KEY  : ${DEFAULT_ANON_KEY ? (DEFAULT_ANON_KEY.substring(0, 20) + "...") : "NOT CONFIGURED"}
🆔 DEVICE ID (UUID)   : ${DEFAULT_DEVICE_ID}
🔐 DEVICE SECRET KEY  : ${DEFAULT_DEVICE_KEY}
⚡ EMULATOR PORT      : ${PORT}
=======================================================
Listening on http://localhost:${PORT}/
=======================================================
`);

const notifyDeviceOfflineOnShutdown = async () => {
  try {
    const hubUrl = DEFAULT_HUB_URL.replace(/\/+$/, "");
    if (hubUrl.includes("supabase.co")) {
      await fetch(`${hubUrl}/rest/v1/devices?id=eq.${DEFAULT_DEVICE_ID}`, {
        method: "PATCH",
        headers: {
          "apikey": DEFAULT_ANON_KEY,
          "Authorization": `Bearer ${DEFAULT_ANON_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "disconnected", controller_session_id: null })
      });
    }
    console.log("🔴 Device Emulator sent offline status signal to Hub.");
  } catch (_) {}
};

if (typeof Deno.addSignalListener === "function") {
  try {
    Deno.addSignalListener("SIGINT", async () => {
      console.log("\n🛑 Stopping Emulator server... Sending offline status signal.");
      await notifyDeviceOfflineOnShutdown();
      Deno.exit(0);
    });
    Deno.addSignalListener("SIGTERM", async () => {
      console.log("\n🛑 Terminating Emulator server... Sending offline status signal.");
      await notifyDeviceOfflineOnShutdown();
      Deno.exit(0);
    });
  } catch (_) {}
}

globalThis.addEventListener("unload", () => {
  notifyDeviceOfflineOnShutdown();
});

Deno.serve({ port: PORT }, handler);
