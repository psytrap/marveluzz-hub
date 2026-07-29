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
let deviceFastTimeout = 5000;
let deviceSlowTimeout = 30000;

// -------------------------------------------------------------
// 1. App Initialization & Page Routing
// -------------------------------------------------------------
async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const hasDeviceIdParam = urlParams.has("device_id");
  if (hasDeviceIdParam) {
    currentDeviceId = urlParams.get("device_id");
  }

  try {
    const configRes = await fetch("/api/config");
    const config = await configRes.json();

    if (config.supabaseUrl && config.supabaseAnonKey) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    } else {
      console.log("ℹ️ Running with Standalone Local Ingest Server.");
    }
    setupRealtimeSubscriptions();

    if (config.disableAuth === false) {
      const logoutBtn = document.getElementById("logout-btn");
      if (logoutBtn) logoutBtn.style.display = "inline-block";
    }
    if (config.mockAuth && !config.disableAuth) {
      const mockBadge = document.getElementById("mock-auth-badge");
      if (mockBadge) mockBadge.style.display = "inline-block";
    }

    if (!hasDeviceIdParam) {
      loadDeviceDirectory();
    } else {
      const uuidDisplay = document.getElementById("device-uuid-display");
      const statusBadge = document.getElementById("status-badge");
      const uuidEl = document.getElementById("device-uuid-text");
      const navDirBtn = document.getElementById("nav-directory-btn");

      if (uuidDisplay) uuidDisplay.style.display = "inline-flex";
      if (statusBadge) statusBadge.style.display = "inline-flex";
      if (uuidEl) uuidEl.textContent = currentDeviceId;
      if (navDirBtn) {
        navDirBtn.style.display = "inline-block";
        navDirBtn.textContent = "Device Directory";
        navDirBtn.setAttribute("href", "/");
      }

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
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");
  const controlBtn = document.getElementById("btn-control");

  if (isDirectoryPage) {
    if (controlBtn) controlBtn.style.display = "none";
    return;
  }

  currentStatus = status;
  const badge = document.getElementById("status-badge");
  const textEl = document.getElementById("status-text");

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
    } else if (status === "live" || status === "detached" || status === "stale") {
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
    // Dynamic stale threshold: 2.5x the device fast_timeout specified in ui_definitions (default 12.5s)
    const staleThresholdMs = deviceFastTimeout * 2.5;
    const elapsedMs = Date.now() - lastSeenTimestamp;
    if (elapsedMs > staleThresholdMs && currentStatus !== "disconnected" && currentStatus !== "fault") {
      updateStatusBadge("stale", "Stale Connection");
    }
  }, 2000);
}

function toggleInputLockOverlay(isOwner) {
  // Never disable action buttons on Device Directory page (when no device_id param in URL)
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");
  if (isDirectoryPage) return;

  const container = document.getElementById("layout-root");
  if (!container) return;

  const interactiveElements = container.querySelectorAll(".widget-card input, .widget-card button, .widget-card select");
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
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");

  if (supabaseClient) {
    const channel = supabaseClient
      .channel('public:dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, payload => {
        if (isDirectoryPage) {
          loadDeviceDirectory();
          return;
        }
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'telemetry_latest' }, payload => {
        if (isDirectoryPage) return;
        if (payload.new && payload.new.device_id === currentDeviceId) {
          lastSeenTimestamp = Date.now();
          updateTelemetryData(payload.new.data);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ui_definitions' }, payload => {
        if (isDirectoryPage) {
          loadDeviceDirectory();
          return;
        }
        if (payload.new && payload.new.device_id === currentDeviceId) {
          lastSeenTimestamp = Date.now();
          renderUIDefinition(payload.new.layout_def);
        }
      })
      .subscribe();

    console.log("⚡ Supabase Realtime Subscribed for device:", currentDeviceId);
  } else {
    // Edge Gateway / Standalone Local SSE Stream Listener (Option 1)
    try {
      const sseSource = new EventSource(`/api/device/events?deviceId=${encodeURIComponent(currentDeviceId)}`);
      sseSource.addEventListener("telemetry", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.data) {
            lastSeenTimestamp = Date.now();
            updateTelemetryData(data.data);
          }
        } catch (_) {}
      });
      sseSource.addEventListener("ui_definition", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.layoutDef) {
            lastSeenTimestamp = Date.now();
            renderUIDefinition(data.layoutDef);
          }
        } catch (_) {}
      });
      sseSource.addEventListener("device_status", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.status) {
            lastSeenTimestamp = Date.now();
            const serverSession = data.controller_session_id;
            if (serverSession === currentSessionId) {
              isControlAcquired = true;
              updateStatusBadge("control");
            } else if (serverSession !== null && serverSession !== undefined) {
              isControlAcquired = false;
              updateStatusBadge("control");
            } else {
              isControlAcquired = false;
              updateStatusBadge(data.status);
            }
          }
        } catch (_) {}
      });
      console.log("⚡ Edge Gateway SSE Stream Subscribed for device:", currentDeviceId);
    } catch (err) {
      console.warn("SSE Setup warning:", err);
    }
  }
}

// -------------------------------------------------------------
// 4. Initial Data Load & Telemetry Polling
// -------------------------------------------------------------
async function loadInitialData() {
  updateStatusBadge("initializing", "Initializing...");

  try {
    let stats = null;
    let layoutDef = null;
    let telemetryLatest = null;

    if (supabaseClient) {
      const { data: dev } = await supabaseClient
        .from("devices")
        .select("status, layout_definition, telemetry_latest")
        .eq("id", currentDeviceId)
        .maybeSingle();

      if (dev) {
        stats = { status: dev.status };
        layoutDef = dev.layout_definition;
        telemetryLatest = dev.telemetry_latest;
      }
    }

    if (!layoutDef || !stats) {
      const res = await fetch(`/api/devices/stats?device_id=${currentDeviceId}`);
      const apiStats = await res.json();
      if (apiStats && apiStats.status) {
        stats = apiStats;
        layoutDef = apiStats.layout_definition || layoutDef;
        telemetryLatest = apiStats.telemetry_latest || telemetryLatest;
      }
    }

    if (stats && stats.status) {
      lastSeenTimestamp = Date.now();
      updateStatusBadge(stats.status);
    } else {
      updateStatusBadge("detached", "Detached");
    }

    if (layoutDef) {
      renderUIDefinition(layoutDef);
      if (telemetryLatest) {
        updateTelemetryValues(telemetryLatest);
      }
    } else {
      // Render Awaiting Schema Empty State if device has never uploaded a layout schema to DB
      renderUIDefinition({
        title: "Device Panel",
        layout: [
          { type: "indicator", properties: { label: "UI Layout Schema", id: "layout_status", value: "Awaiting Device Layout Schema" } },
          { type: "text", properties: { label: "Notice", id: "layout_notice", value: "This device has not uploaded its UI layout definition yet. Interactive controls will appear here automatically once the device connects and registers its layout schema.", readonly: "true" } }
        ]
      });
    }

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

  const props = layoutDef.properties || {};
  if (props.fast_timeout || layoutDef.fast_timeout) {
    deviceFastTimeout = Number(props.fast_timeout || layoutDef.fast_timeout);
  }
  if (props.slow_timeout || layoutDef.slow_timeout) {
    deviceSlowTimeout = Number(props.slow_timeout || layoutDef.slow_timeout);
  }

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
      const isActive = String(widget.properties.value).toLowerCase() === "true";
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <button id="val-${widget.properties.id}" class="widget-btn${isActive ? ' widget-btn-active' : ''}" onclick="sendControlCommand('${widget.properties.id}', 'toggle', true)">
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
      if (el.tagName === "BUTTON") {
        // Boolean telemetry → toggle active state on button widget
        const isActive = data[key] === true || data[key] === "true" || data[key] === 1;
        el.classList.toggle("widget-btn-active", isActive);
      } else {
        el.textContent = data[key];
      }
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

// Auto-Release Control Lease on Page Unload / Navigation / Tab Switch
function releaseControlLeaseOnLeave() {
  if (isControlAcquired && currentDeviceId) {
    const payload = JSON.stringify({
      deviceId: currentDeviceId,
      target: "release_lease",
      action: "release",
      value: currentSessionId
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/device/command", blob);
    } else {
      fetch("/api/device/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true
      });
    }
    isControlAcquired = false;
  }
}

window.addEventListener("beforeunload", releaseControlLeaseOnLeave);
window.addEventListener("pagehide", releaseControlLeaseOnLeave);

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
  const uuidDisplay = document.getElementById("device-uuid-display");
  const statusBadge = document.getElementById("status-badge");
  const controlBtn = document.getElementById("btn-control");
  const navDirBtn = document.getElementById("nav-directory-btn");

  if (titleEl) titleEl.textContent = "Device Directory";
  if (uuidDisplay) uuidDisplay.style.display = "none";
  if (statusBadge) statusBadge.style.display = "none";
  if (controlBtn) controlBtn.style.display = "none";
  if (navDirBtn) navDirBtn.style.display = "none";

  if (!container) return;

  container.innerHTML = `<div class="glass empty-state"><p style="color:var(--text-secondary);">Loading registered devices...</p></div>`;

  try {
    let list = [];
    if (supabaseClient) {
      const { data: devRows } = await supabaseClient
        .from("devices")
        .select("id, title, status, last_seen, registered_at");

      const { data: uiRows } = await supabaseClient
        .from("ui_definitions")
        .select("device_id, layout_def");

      const uiMap = new Map((uiRows || []).map(u => [u.device_id, u.layout_def]));

      if (devRows && devRows.length > 0) {
        list = devRows.map(d => {
          const uiDef = uiMap.get(d.id);
          const displayTitle = (uiDef && uiDef.title) ? uiDef.title : d.title;
          return {
            deviceId: d.id,
            title: displayTitle,
            state: d.status,
            lastSeen: d.last_seen,
            registeredAt: d.registered_at
          };
        });
      }
    }

    if (!list || list.length === 0) {
      const res = await fetch("/api/devices");
      list = await res.json();
    }

    container.innerHTML = "";

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div class="glass empty-state">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:15px;">
            <h3 style="margin:0;">No registered devices found</h3>
            <button class="btn-action" style="font-size:12px; padding:6px 14px; cursor:pointer;" onclick="loadDeviceDirectory()">🔄 Refresh Directory</button>
          </div>
          <p style="color:var(--text-secondary); font-size:14px;">Connect an IoT node simulator or device to register it in the index.</p>
        </div>
      `;
      return;
    }

    const dirContainer = document.createElement("div");
    dirContainer.className = "directory-container";
    dirContainer.style.width = "100%";

    const dirHeader = document.createElement("div");
    dirHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; width:100%;";
    dirHeader.innerHTML = `
      <div style="font-size:14px; font-weight:600; color:var(--text-secondary);">Registered Devices (${list.length})</div>
      <button class="btn-action" style="font-size:12px; padding:6px 14px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;" onclick="loadDeviceDirectory()">
        <span>🔄</span> Refresh Directory
      </button>
    `;
    dirContainer.appendChild(dirHeader);

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
          <div style="margin-top:6px;">
            <span class="device-uuid" style="background:rgba(255,255,255,0.06); border:1px solid var(--border-color); padding:3px 8px; border-radius:4px; font-size:11px; user-select:all; cursor:text;" title="Device UUID">UUID: ${dev.deviceId}</span>
          </div>
        </div>

        <div class="device-actions">
          <a href="/?device_id=${dev.deviceId}" class="btn-action active-lease" style="text-decoration:none; font-size:12px; padding:6px 12px;">Open Panel</a>
          <button class="btn-delete" style="font-size:12px; padding:6px 12px;" onclick="wipeDeviceData('${dev.deviceId}')">Wipe Data</button>
        </div>
      `;
      dirContainer.appendChild(row);
    });

    container.appendChild(dirContainer);
  } catch (e) {
    container.innerHTML = `
      <div class="glass empty-state">
        <p style="color:var(--danger-color); margin-bottom:10px;">Error loading directory list.</p>
        <button class="btn-action" style="font-size:12px; padding:6px 14px; cursor:pointer;" onclick="loadDeviceDirectory()">🔄 Retry</button>
      </div>
    `;
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
