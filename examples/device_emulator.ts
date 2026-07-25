// Marveluzz Hub - Interactive IoT Device Emulator Web Panel (Port 8001)
// Preserves Every-Panel's interactive hardware knob controls & web UI

const PORT = Number(Deno.env.get("PORT")) || 8001;

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Marveluzz IoT Device Emulator Panel</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
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
      grid-template-columns: 350px 1fr;
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
      height: 600px;
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
        <h3>Server Config</h3>
        <div class="form-group">
          <label>Marveluzz Hub URL</label>
          <input type="text" id="hub-url" class="input-field" value="http://localhost:8000">
        </div>
        <div class="form-group">
          <label>Emulator Device ID</label>
          <input type="text" id="device-id" class="input-field" value="32323232-3232-4232-8232-28c13340c86c">
        </div>
        <div class="form-group">
          <label>Emulator Device Key</label>
          <input type="password" id="device-key" class="input-field" value="secret_passcode_123">
        </div>
        <button id="connect-btn" class="btn" onclick="toggleConnection()">Connect to Hub</button>
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
          <label>Constant Sensor Updates</label>
          <div class="knob-row">
            <span>Auto-Stream Telemetry (3s)</span>
            <input type="checkbox" id="knob-autostream" style="width:20px; height:20px; cursor:pointer;" checked onchange="toggleAutoStream(this.checked)">
          </div>
        </div>

        <div class="form-group" style="margin-top:10px;">
          <button id="fault-btn" class="btn-fault" onclick="toggleFault()">Simulate Hardware Fault</button>
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
        <div class="log-line"><span class="log-time">[System]</span> Ready. Click Connect to Hub to start streaming telemetry.</div>
      </div>
    </div>
  </main>

  <script>
    let isConnected = false;
    let telemetryTimer = null;
    let startTime = Date.now();

    let tempVal = 24.5;
    let fanVal = false;
    let hasFault = false;
    let autoStreamActive = true;

    function log(message, category = "Info") {
      const term = document.getElementById("terminal");
      const time = new Date().toLocaleTimeString();
      const line = document.createElement("div");
      line.className = "log-line";
      
      let categoryColor = "#34d399";
      if (category === "Command") categoryColor = "#60a5fa";
      if (category === "Error") categoryColor = "#ef4444";
      if (category === "System") categoryColor = "#9ca3af";

      line.innerHTML = \`<span class="log-time">[\${time}]</span> <span style="color:\${categoryColor}; font-weight:500;">[\${category}]</span> \${message}\`;
      term.appendChild(line);
      term.scrollTop = term.scrollHeight;
    }

    function clearLogs() {
      document.getElementById("terminal").innerHTML = "";
      log("Logs cleared.", "System");
    }

    function updateKnobVal(type, val) {
      if (type === 'temp') {
        tempVal = Number(val);
        document.getElementById("val-temp").innerText = tempVal.toFixed(1) + "°C";
      }
      sendTelemetryPacket();
    }

    function updateFanVal(checked) {
      fanVal = !!checked;
      log(\`Desk Fan Switch manually set to: \${fanVal ? 'ON' : 'OFF'}\`, "Info");
      sendTelemetryPacket();
    }

    function toggleFault() {
      hasFault = !hasFault;
      const btn = document.getElementById("fault-btn");
      if (hasFault) {
        btn.classList.add("active");
        btn.innerText = "Clear Hardware Fault";
        log("Simulated Hardware Fault triggered!", "Error");
      } else {
        btn.classList.remove("active");
        btn.innerText = "Simulate Hardware Fault";
        log("Hardware Fault cleared.", "System");
      }
      sendTelemetryPacket();
    }

    function toggleAutoStream(checked) {
      autoStreamActive = !!checked;
      log("Auto-Stream Telemetry set to: " + autoStreamActive, "System");
      if (isConnected) {
        if (autoStreamActive) {
          if (telemetryTimer) clearInterval(telemetryTimer);
          telemetryTimer = setInterval(sendTelemetryPacket, 3000);
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
      if (isConnected) {
        disconnect();
      } else {
        connect();
      }
    }

    async function connect() {
      const hubUrl = document.getElementById("hub-url").value.trim();
      const deviceId = document.getElementById("device-id").value.trim();
      const deviceKey = document.getElementById("device-key").value.trim();
      const connectBtn = document.getElementById("connect-btn");
      const badge = document.getElementById("connection-badge");
      const statusText = document.getElementById("status-text");

      log("Connecting to Marveluzz Hub: " + hubUrl, "System");

      // 1. Upload UI Layout Definition
      try {
        const layoutRes = await fetch(\`\${hubUrl}/api/device/ui_definition\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId,
            deviceKey,
            layoutDef: {
              title: "ESP32 Temperature Node",
              type: "layout",
              layout: [
                { type: "number", properties: { label: "DS18B20 Temperature (°C)", id: "temperature", value: String(tempVal), readonly: "true" } },
                { type: "button", properties: { label: "Cooling Fan Switch", id: "fan_toggle", value: String(fanVal) } },
                { type: "text", properties: { label: "Device Uptime", id: "uptime", value: "0s", readonly: "true" } }
              ]
            }
          })
        });

        const layoutData = await layoutRes.json();
        if (layoutData.success) {
          log("✅ UI Layout Schema registered successfully.", "System");
          isConnected = true;
          connectBtn.innerText = "Disconnect";
          connectBtn.className = "btn btn-disconnect";
          badge.className = "status-badge connected";
          statusText.innerText = "Connected";

          // Start Telemetry Ingest Loop
          sendTelemetryPacket();
          if (autoStreamActive) {
            telemetryTimer = setInterval(sendTelemetryPacket, 3000);
          }
        } else {
          log("❌ Layout Registration Failed: " + (layoutData.error || "Unauthorized"), "Error");
        }
      } catch (e) {
        log("❌ Connection Error: " + e.message, "Error");
      }
    }

    function disconnect() {
      isConnected = false;
      if (telemetryTimer) {
        clearInterval(telemetryTimer);
        telemetryTimer = null;
      }
      const connectBtn = document.getElementById("connect-btn");
      const badge = document.getElementById("connection-badge");
      const statusText = document.getElementById("status-text");

      connectBtn.innerText = "Connect to Hub";
      connectBtn.className = "btn";
      badge.className = "status-badge disconnected";
      statusText.innerText = "Disconnected";
      log("Disconnected from Hub.", "System");
    }

    async function sendTelemetryPacket() {
      if (!isConnected) return;

      const hubUrl = document.getElementById("hub-url").value.trim();
      const deviceId = document.getElementById("device-id").value.trim();
      const deviceKey = document.getElementById("device-key").value.trim();
      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);

      const payload = {
        deviceId,
        deviceKey,
        data: {
          temperature: Number(tempVal.toFixed(1)),
          fan_toggle: fanVal,
          uptime: \`\${uptimeSec}s\`,
          status_text: hasFault ? "Fault Code E-04" : "Running Normally"
        }
      };

      try {
        const res = await fetch(\`\${hubUrl}/api/device/telemetry\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          log(\`Telemetry Sent -> Temp: \${tempVal.toFixed(1)}°C, Fan: \${fanVal ? 'ON' : 'OFF'}, Uptime: \${uptimeSec}s\`, "Info");

          // Handle executed commands returned from the server queue
          if (data.commands && data.commands.length > 0) {
            data.commands.forEach(cmd => {
              log(\`Incoming Command Executed -> Target: '\${cmd.target}', Action: \${cmd.action}, Value: \${JSON.stringify(cmd.value)}\`, "Command");
              if (cmd.target === "fan_toggle") {
                fanVal = !fanVal;
                document.getElementById("knob-fan").checked = fanVal;
              }
            });
          }
        } else {
          log("❌ Telemetry Ingest Error: " + data.error, "Error");
        }
      } catch (e) {
        log("❌ Telemetry Request Failed: " + e.message, "Error");
      }
    }
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
  return new Response("Not Found", { status: 404 });
}

console.log(`🤖 Marveluzz IoT Device Emulator Panel starting on http://localhost:${PORT}...`);
Deno.serve({ port: PORT }, handler);
