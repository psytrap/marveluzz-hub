// Marveluzz Hub - Frontend Dashboard Core Engine
// Orchestrates devices.js (Directory) and panel.js (Single Device Panel)

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

// Expose variables globally for module interoperability
window.supabaseClient = supabaseClient;

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
      window.supabaseClient = supabaseClient;
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
      if (typeof loadDeviceDirectory === "function") {
        loadDeviceDirectory();
      }
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

      if (typeof loadInitialData === "function") loadInitialData();
      startKeepaliveStaleDetector();
      if (typeof updateViewerPresence === "function") updateViewerPresence(true);
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

  toggleInputLockOverlay(status === "control" && isControlAcquired);
}

function startKeepaliveStaleDetector() {
  if (lastSeenTimer) clearInterval(lastSeenTimer);

  lastSeenTimer = setInterval(() => {
    const staleThresholdMs = deviceFastTimeout * 2.5;
    const elapsedMs = Date.now() - lastSeenTimestamp;
    if (elapsedMs > staleThresholdMs && currentStatus !== "disconnected" && currentStatus !== "fault") {
      updateStatusBadge("stale", "Stale Connection");
    }
  }, 2000);
}

function toggleInputLockOverlay(isOwner) {
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");
  if (isDirectoryPage) return;

  const container = document.getElementById("layout-root");
  if (!container) return;

  const cards = container.querySelectorAll(".widget-card");
  cards.forEach(card => {
    const overlay = card.querySelector(".input-lock-overlay");
    if (overlay) overlay.remove();

    const inputs = card.querySelectorAll("input, button");
    inputs.forEach(el => el.disabled = !isOwner);
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'devices' }, payload => {
        if (isDirectoryPage && typeof loadDeviceDirectory === "function") {
          loadDeviceDirectory();
          return;
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'devices' }, payload => {
        if (isDirectoryPage && typeof loadDeviceDirectory === "function") {
          loadDeviceDirectory();
          return;
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
        if (isDirectoryPage && typeof loadDeviceDirectory === "function") {
          const old = payload.old || {};
          const next = payload.new || {};
          if (old.display_name !== next.display_name || old.status !== next.status) {
            loadDeviceDirectory();
          }
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
          if (typeof updateTelemetryData === "function") updateTelemetryData(payload.new.data);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ui_definitions' }, payload => {
        if (isDirectoryPage) return;
        if (payload.new && payload.new.device_id === currentDeviceId) {
          lastSeenTimestamp = Date.now();
          if (typeof renderUIDefinition === "function") renderUIDefinition(payload.new.layout_def);
        }
      })
      .subscribe();

    console.log("⚡ Supabase Realtime Subscribed for device:", currentDeviceId);
  }
}

// -------------------------------------------------------------
// 4. Command Dispatch Utility
// -------------------------------------------------------------
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

// Expose shared functions globally
window.updateStatusBadge = updateStatusBadge;
window.toggleInputLockOverlay = toggleInputLockOverlay;
window.sendControlCommand = sendControlCommand;

document.addEventListener("DOMContentLoaded", initApp);
