// Marveluzz Hub - Frontend App & Supabase Realtime Integration
// Preserves Every-Panel's UI widget dynamic rendering architecture

let supabaseClient = null;
let currentDeviceId = "32323232-3232-4232-8232-28c13340c86c";
let telemetryChart = null;

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

    if (isDirectoryPage) {
      loadDeviceDirectory();
    } else {
      loadInitialData();
    }
  } catch (e) {
    console.error("Failed to initialize app:", e);
  }
}

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

async function loadInitialData() {
  try {
    // Render default UI cards
    renderUIDefinition({
      title: "ESP32 Temperature Node",
      layout: [
        { type: "number", properties: { label: "Temperature (°C)", id: "temperature", value: "24.5", readonly: "true" } },
        { type: "button", properties: { label: "Cooling Fan Switch", id: "fan_toggle", value: "false" } },
        { type: "text", properties: { label: "Device Uptime", id: "uptime", value: "0s", readonly: "true" } }
      ]
    });

    initChart();
  } catch (e) {
    console.error("Error loading initial data:", e);
  }
}

function setupRealtimeSubscriptions() {
  if (!supabaseClient) return;

  const channel = supabaseClient
    .channel('public:telemetry')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'telemetry_latest' }, payload => {
      if (payload.new && payload.new.device_id === currentDeviceId) {
        updateTelemetryData(payload.new.data);
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ui_definitions' }, payload => {
      if (payload.new && payload.new.device_id === currentDeviceId) {
        renderUIDefinition(payload.new.layout_def);
      }
    })
    .subscribe();

  console.log("⚡ Supabase Realtime Subscribed.");
}

function renderUIDefinition(layoutDef) {
  const container = document.getElementById("layout-root");
  if (!container || !layoutDef || !layoutDef.layout) return;

  container.innerHTML = "";

  layoutDef.layout.forEach(widget => {
    const card = document.createElement("div");
    card.className = "glass widget-card";

    if (widget.type === "number" || widget.type === "indicator") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label || widget.properties.id}</span>
        <div class="widget-indicator">
          <span id="val-${widget.properties.id}">${widget.properties.value || "--"}</span>
        </div>
      `;
    } else if (widget.type === "button") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <button class="widget-btn" onclick="sendControlCommand('${widget.properties.id}', 'toggle', true)">
          ${widget.properties.label}
        </button>
      `;
    } else if (widget.type === "text") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <div class="widget-text-view" id="val-${widget.properties.id}">${widget.properties.value || "--"}</div>
      `;
    } else if (widget.type === "divider") {
      card.style.height = "1px";
      card.style.padding = "0";
      card.style.background = "var(--border-color)";
    }

    container.appendChild(card);
  });
}

function updateTelemetryData(data) {
  if (!data) return;

  Object.keys(data).forEach(key => {
    const el = document.getElementById(`val-${key}`);
    if (el) {
      el.textContent = data[key];
    }
  });

  if (data.temperature && telemetryChart) {
    const nowLabel = new Date().toLocaleTimeString();
    telemetryChart.data.labels.push(nowLabel);
    telemetryChart.data.datasets[0].data.push(data.temperature);
    if (telemetryChart.data.labels.length > 20) {
      telemetryChart.data.labels.shift();
      telemetryChart.data.datasets[0].data.shift();
    }
    telemetryChart.update();
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
      alert(`Command sent to queue for ${target}!`);
    }
  } catch (e) {
    alert("Failed to send command.");
  }
}

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
