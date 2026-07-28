// Marveluzz Hub - Frontend Dashboard Engine & Realtime Parity
// Implements Phase 3: 7-State Status Machine & 8-Widget Renderer Engine

let supabaseClient = null;
let currentDeviceId = "32323232-3232-4232-8232-28c13340c86c";
let currentSessionId = sessionStorage.getItem("marveluzz_session_id");
if (!currentSessionId) {
  currentSessionId = "session_" + Math.random().toString(36).substring(2, 9);
  sessionStorage.setItem("marveluzz_session_id", currentSessionId);
}
let telemetryChart = null;
let lastSeenTimer = null;
let lastSeenTimestamp = Date.now();
let currentStatus = "disconnected";
let isControlAcquired = false;

// -------------------------------------------------------------
// 1. App Initialization & Page Routing
// -------------------------------------------------------------
async function initApp() {
  const isDirectoryPage = window.location.pathname === "/devices";
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("device_id")) {
    currentDeviceId = urlParams.get("device_id");
  }

  try {
    const configRes = await fetch("/api/config");
    const config = await configRes.json();

    if (config.supabaseUrl && config.supabaseAnonKey) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      setupRealtimeSubscriptions();
    } else {
      console.log("ℹ️ Running with Standalone Local Ingest Server.");
    }

    if (config.disableAuth === false) {
      const logoutBtn = document.getElementById("logout-btn");
      if (logoutBtn) logoutBtn.style.display = "inline-block";
    }
    if (config.mockAuth && !config.disableAuth) {
      const mockBadge = document.getElementById("mock-auth-badge");
      if (mockBadge) mockBadge.style.display = "inline-block";
    }

    if (isDirectoryPage) {
      loadDeviceDirectory();
    } else {
      loadInitialData();
      startKeepaliveStaleDetector();
    }

    loadVersionAndSelfTest();
  } catch (e) {
    console.error("Failed to initialize app:", e);
    updateStatusBadge("disconnected", "Server Offline");
  }
}

async function loadVersionAndSelfTest() {
  try {
    const res = await fetch("/api/health/self-test");
    const data = await res.json();

    const uiEl = document.getElementById("ui-version-badge");
    const dbEl = document.getElementById("db-version-badge");
    const testBadge = document.getElementById("self-test-badge");
    const testText = document.getElementById("self-test-text");

    if (uiEl && data.appVersion) uiEl.textContent = `v${data.appVersion}`;
    if (dbEl) {
      if (data.contractCompatible) {
        dbEl.textContent = `v${data.appVersion}`;
      } else {
        dbEl.textContent = data.actualSchemaVersion ? `v${data.actualSchemaVersion}` : "Mismatch";
      }
    }

    if (testBadge && testText) {
      if (data.contractCompatible) {
        testBadge.className = "self-test-status ok";
        testText.textContent = "Contract OK";
      } else {
        testBadge.className = "self-test-status degraded";
        testText.textContent = "Version Mismatch";
      }
    }

    // Show database engine mode in footer
    const dbModeBadge = document.getElementById("db-mode-badge");
    const dbModeText = document.getElementById("db-mode-text");
    if (dbModeBadge && dbModeText && data.databaseMode) {
      const isMock = data.databaseMode.toLowerCase().includes("mock");
      dbModeText.textContent = isMock ? "🧪 Standalone Mock" : "⚡ Supabase Cloud";
      dbModeBadge.className = isMock ? "db-mode-badge mock" : "db-mode-badge";
    }
  } catch (e) {
    console.error("Failed to fetch self-test status:", e);
  }
}

// -------------------------------------------------------------
// 2. 7-State Diagnostic Status Badge Machine
// -------------------------------------------------------------
function updateStatusBadge(status, customLabel = null) {
  currentStatus = status;
  const badge = document.getElementById("status-badge");
  const textEl = document.getElementById("status-text");
  const controlBtn = document.getElementById("btn-control");

  if (!badge || !textEl) return;

  let labelText = customLabel;
  if (!labelText) {
    if (status === "control") {
      labelText = isControlAcquired ? "Control (You)" : "Live (In Use)";
    } else {
      const defaultLabels = {
        disconnected: "Disconnected",
        detached: "Detached",
        initializing: "Initializing...",
        stale: "Stale Connection",
        fault: "Fault",
        live: "Live"
      };
      labelText = defaultLabels[status] || status;
    }
  }

  // Clear previous state classes
  badge.className = "status-badge " + status;
  textEl.textContent = labelText;

  if (controlBtn) {
    if (status === "control") {
      controlBtn.style.display = "inline-block";
      if (isControlAcquired) {
        controlBtn.className = "btn-action active-lease";
        controlBtn.textContent = "Release Control";
      } else {
        controlBtn.className = "btn-action";
        controlBtn.textContent = "Take Over Control";
      }
    } else if (status === "live") {
      controlBtn.style.display = "inline-block";
      controlBtn.className = "btn-action";
      controlBtn.textContent = "Acquire Control";
    } else {
      controlBtn.style.display = "none";
    }
  }

  // Update input lock overlays for view-only mode
  toggleInputLockOverlay(status === "control" && isControlAcquired);
}

function startKeepaliveStaleDetector() {
  if (lastSeenTimer) clearInterval(lastSeenTimer);

  lastSeenTimer = setInterval(() => {
    const elapsedSec = (Date.now() - lastSeenTimestamp) / 1000;
    if (elapsedSec > 12 && currentStatus !== "disconnected" && currentStatus !== "fault") {
      updateStatusBadge("stale", "Stale Connection");
    }
  }, 4000);
}

function toggleInputLockOverlay(isOwner) {
  const container = document.getElementById("layout-root");
  if (!container) return;

  const interactiveElements = container.querySelectorAll("input, button, select");
  interactiveElements.forEach(el => {
    if (el.id !== "btn-control") {
      if (isOwner) {
        el.removeAttribute("disabled");
        el.classList.remove("disabled-overlay");
      } else {
        el.setAttribute("disabled", "true");
        el.classList.add("disabled-overlay");
      }
    }
  });
}

// -------------------------------------------------------------
// 3. Supabase Realtime Subscriptions
// -------------------------------------------------------------
function setupRealtimeSubscriptions() {
  if (!supabaseClient) return;

  const channel = supabaseClient
    .channel('public:dashboard')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
      if (payload.new && payload.new.id === currentDeviceId) {
        lastSeenTimestamp = Date.now();
        const serverSession = payload.new.controller_session_id;
        if (serverSession === currentSessionId) {
          isControlAcquired = true;
          updateStatusBadge("control");
        } else if (serverSession !== null && serverSession !== undefined) {
          isControlAcquired = false;
          updateStatusBadge("control");
        } else {
          isControlAcquired = false;
          const newStatus = payload.new.status === "control" ? "live" : (payload.new.status || "live");
          updateStatusBadge(newStatus);
        }
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'telemetry_latest' }, payload => {
      if (payload.new && payload.new.device_id === currentDeviceId) {
        lastSeenTimestamp = Date.now();
        updateTelemetryData(payload.new.data);
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ui_definitions' }, payload => {
      if (payload.new && payload.new.device_id === currentDeviceId) {
        lastSeenTimestamp = Date.now();
        renderUIDefinition(payload.new.layout_def);
      }
    })
    .subscribe();

  console.log("⚡ Supabase Realtime Subscribed for device:", currentDeviceId);
}

// -------------------------------------------------------------
// 4. Initial Data Load & Telemetry Polling
// -------------------------------------------------------------
async function loadInitialData() {
  updateStatusBadge("initializing", "Initializing...");

  try {
    const res = await fetch(`/api/devices/stats?device_id=${currentDeviceId}`);
    const stats = await res.json();

    if (stats && stats.status) {
      lastSeenTimestamp = Date.now();
      updateStatusBadge(stats.status);
    } else {
      updateStatusBadge("detached", "Detached");
    }

    // Default 8-Widget Renderer Demonstration Layout
    renderUIDefinition({
      title: "ESP32 Temperature Node",
      layout: [
        { type: "number", properties: { label: "DS18B20 Temperature", id: "temperature", value: "24.5", unit: "°C" } },
        { type: "range", properties: { label: "Fan Speed Target", id: "fan_speed", value: "75", min: "0", max: "100", unit: "%" } },
        { type: "button", properties: { label: "Toggle Cooling Fan Relay", id: "fan_toggle", value: "false" } },
        { type: "indicator", properties: { label: "System Status", id: "status_text", value: "Running Normally" } },
        { type: "text", properties: { label: "Device Uptime", id: "uptime", value: "0s" } },
        { type: "divider", properties: {} },
        { type: "img", properties: { label: "Field Camera Stream", id: "webcam", url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80" } }
      ]
    });

    initChart();
  } catch (e) {
    console.error("Error loading initial data:", e);
    updateStatusBadge("disconnected", "Disconnected");
  }
}

// -------------------------------------------------------------
// 5. Complete 8-Widget Renderer Engine
// -------------------------------------------------------------
function renderUIDefinition(layoutDef) {
  const container = document.getElementById("layout-root");
  const titleEl = document.getElementById("dashboard-title");

  if (!container || !layoutDef || !layoutDef.layout) return;

  if (titleEl && layoutDef.title) {
    titleEl.textContent = layoutDef.title;
  }

  container.innerHTML = "";

  layoutDef.layout.forEach(widget => {
    const card = document.createElement("div");
    card.className = "glass widget-card";

    // 1 & 2. Widget: Number & Indicator
    if (widget.type === "number" || widget.type === "indicator") {
      const unitStr = widget.properties.unit ? ` <span class="widget-unit">${widget.properties.unit}</span>` : "";
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label || widget.properties.id}</span>
        <div class="widget-indicator">
          <span id="val-${widget.properties.id}">${widget.properties.value || "--"}</span>${unitStr}
        </div>
      `;
    } 
    // 3. Widget: Range / Slider
    else if (widget.type === "range") {
      const val = widget.properties.value || "50";
      const min = widget.properties.min || "0";
      const max = widget.properties.max || "100";
      const unit = widget.properties.unit || "";

      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <div class="widget-range-container">
          <div class="widget-range-row">
            <input type="range" class="widget-range" min="${min}" max="${max}" value="${val}"
              oninput="document.getElementById('val-${widget.properties.id}').innerText = this.value + '${unit}'"
              onchange="sendControlCommand('${widget.properties.id}', 'set_value', Number(this.value))">
            <span class="widget-range-value" id="val-${widget.properties.id}">${val}${unit}</span>
          </div>
        </div>
      `;
    } 
    // 4. Widget: Click Button
    else if (widget.type === "button") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <button class="widget-btn" onclick="sendControlCommand('${widget.properties.id}', 'toggle', true)">
          ${widget.properties.label}
        </button>
      `;
    } 
    // 5. Widget: Text View
    else if (widget.type === "text") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <div class="widget-text-view" id="val-${widget.properties.id}">${widget.properties.value || "--"}</div>
      `;
    } 
    // 6. Widget: Image Viewer
    else if (widget.type === "img") {
      const src = widget.properties.url || widget.properties.value || "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80";
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label || "Image Stream"}</span>
        <img class="widget-img" id="img-${widget.properties.id}" src="${src}" alt="Device Stream">
      `;
    } 
    // 7. Widget: Divider
    else if (widget.type === "divider") {
      card.style.height = "1px";
      card.style.padding = "0";
      card.style.background = "var(--border-color)";
    }

    container.appendChild(card);
  });

  // Re-apply input locks based on lease ownership
  toggleInputLockOverlay(currentStatus === "control" && isControlAcquired);
}

// -------------------------------------------------------------
// 6. Telemetry Update & Chart Visualization
// -------------------------------------------------------------
function updateTelemetryData(data) {
  if (!data) return;

  lastSeenTimestamp = Date.now();
  if (currentStatus === "stale" || currentStatus === "detached") {
    updateStatusBadge("live", "Live");
  }

  // Handle hardware fault code
  if (data.status_text && data.status_text.includes("Fault")) {
    updateStatusBadge("fault", "Fault");
  }

  Object.keys(data).forEach(key => {
    const el = document.getElementById(`val-${key}`);
    if (el) {
      const unitMatch = el.nextElementSibling ? el.nextElementSibling.outerHTML : "";
      el.textContent = data[key];
    }

    const imgEl = document.getElementById(`img-${key}`);
    if (imgEl && typeof data[key] === "string") {
      imgEl.src = data[key];
    }
  });

  // Append to time-series temperature chart
  if (data.temperature !== undefined && telemetryChart) {
    const nowLabel = new Date().toLocaleTimeString();
    telemetryChart.data.labels.push(nowLabel);
    telemetryChart.data.datasets[0].data.push(Number(data.temperature));
    if (telemetryChart.data.labels.length > 20) {
      telemetryChart.data.labels.shift();
      telemetryChart.data.datasets[0].data.shift();
    }
    telemetryChart.update();
  }
}

// -------------------------------------------------------------
// 7. Exclusive Control Lease Lock & Command Dispatch
// -------------------------------------------------------------
async function toggleControlLease() {
  try {
    if (isControlAcquired) {
      // Release Lease
      await fetch("/api/device/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: currentDeviceId,
          target: "release_lease",
          action: "release",
          value: currentSessionId
        })
      });
      isControlAcquired = false;
      updateStatusBadge("live", "Live");
    } else {
      // Acquire Lease
      await fetch("/api/device/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: currentDeviceId,
          target: "acquire_lease",
          action: "acquire",
          value: currentSessionId
        })
      });
      isControlAcquired = true;
      updateStatusBadge("control");
    }
  } catch (e) {
    console.error("Failed to toggle control lease:", e);
  }
}

async function sendControlCommand(target, action, value) {
  try {
    const res = await fetch("/api/device/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: currentDeviceId,
        target,
        action,
        value
      })
    });
    const data = await res.json();
    if (data.success) {
      console.log(`Command '${target}' sent successfully.`);
    }
  } catch (e) {
    console.error("Failed to send command:", e);
  }
}

// -------------------------------------------------------------
// 8. Device Directory & Storage Wipe Modal
// -------------------------------------------------------------
async function loadDeviceDirectory() {
  const container = document.getElementById("layout-root");
  const titleEl = document.getElementById("dashboard-title");
  if (titleEl) titleEl.textContent = "Marveluzz Hub - Device Directory";

  if (!container) return;

  container.innerHTML = `<div class="glass empty-state"><p style="color:var(--text-secondary);">Loading registered devices...</p></div>`;

  try {
    const res = await fetch("/api/devices");
    const list = await res.json();

    container.innerHTML = "";

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div class="glass empty-state">
          <h3 style="margin-bottom:10px;">No registered devices found</h3>
          <p style="color:var(--text-secondary); font-size:14px;">Connect an IoT node simulator or device to register it in the index.</p>
        </div>
      `;
      return;
    }

    const dirContainer = document.createElement("div");
    dirContainer.className = "directory-container";

    list.forEach(dev => {
      const row = document.createElement("div");
      row.className = "glass device-row";
      row.innerHTML = `
        <div class="device-info">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="status-badge ${dev.state}">
              <span class="status-dot"></span>
              <span style="font-size:11px; text-transform:capitalize;">${dev.state}</span>
            </div>
            <span class="device-title">${dev.title}</span>
          </div>
          <span class="device-uuid">${dev.deviceId}</span>
        </div>

        <div class="device-actions">
          <button class="btn-delete" onclick="wipeDeviceData('${dev.deviceId}')">Wipe Data</button>
          <a href="/?device_id=${dev.deviceId}" class="btn-action active-lease" style="text-decoration:none; padding:8px 16px;">Open Panel</a>
        </div>
      `;
      dirContainer.appendChild(row);
    });

    container.appendChild(dirContainer);
  } catch (e) {
    container.innerHTML = `<div class="glass empty-state"><p style="color:var(--danger-color);">Error loading directory list.</p></div>`;
  }
}

async function wipeDeviceData(deviceId) {
  if (!confirm(`Are you sure you want to wipe all telemetry logs and configuration for device ${deviceId}?`)) {
    return;
  }

  try {
    const res = await fetch("/api/devices/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId })
    });
    const json = await res.json();
    if (json.success) {
      alert("Device storage data wiped successfully.");
      loadDeviceDirectory();
    }
  } catch (e) {
    alert("Failed to wipe device data.");
  }
}

// -------------------------------------------------------------
// 9. Time-Series Telemetry Chart Initialization
// -------------------------------------------------------------
function initChart() {
  const chartCard = document.getElementById("telemetry-chart-card");
  const ctx = document.getElementById("telemetryChart");
  if (!ctx) return;

  chartCard.style.display = "block";
  telemetryChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "DS18B20 Temperature (°C)",
        data: [],
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#f3f4f6" } } },
      scales: {
        x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", initApp);
