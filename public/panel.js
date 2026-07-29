// Marveluzz Hub - Single Device Panel Frontend Module (panel.js)

async function loadInitialData() {
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");
  if (isDirectoryPage) return;

  try {
    let hasLoadedLayout = false;

    if (window.supabaseClient) {
      const { data: uiRow } = await window.supabaseClient
        .from("ui_definitions")
        .select("layout_def")
        .eq("device_id", currentDeviceId)
        .single();

      if (uiRow && uiRow.layout_def) {
        renderUIDefinition(uiRow.layout_def);
        hasLoadedLayout = true;
      }

      const { data: devRow } = await window.supabaseClient
        .from("devices")
        .select("status, controller_session_id")
        .eq("id", currentDeviceId)
        .single();

      if (devRow) {
        if (devRow.controller_session_id === currentSessionId) {
          isControlAcquired = true;
          updateStatusBadge("control");
        } else if (devRow.controller_session_id !== null && devRow.controller_session_id !== undefined) {
          isControlAcquired = false;
          updateStatusBadge("control");
        } else {
          isControlAcquired = false;
          updateStatusBadge(devRow.status || "live");
        }
      }

      const { data: telemetryRow } = await window.supabaseClient
        .from("telemetry_latest")
        .select("data, created_at")
        .eq("device_id", currentDeviceId)
        .single();

      if (telemetryRow && telemetryRow.data) {
        lastSeenTimestamp = new Date(telemetryRow.created_at).getTime();
        updateTelemetryData(telemetryRow.data);
      }
    }

    if (!hasLoadedLayout) {
      const resLayout = await fetch(`/api/device/layout?device_id=${encodeURIComponent(currentDeviceId)}`);
      const layoutData = await resLayout.json();
      if (layoutData.layout) {
        renderUIDefinition(layoutData.layout);
      } else {
        const container = document.getElementById("layout-root");
        if (container) {
          container.innerHTML = `
            <div class="glass empty-state">
              <h3 style="margin-bottom:10px;">Awaiting Device Registration...</h3>
              <p style="color:var(--text-secondary); font-size:14px;">This device slot (${currentDeviceId}) has not registered its UI layout yet.</p>
            </div>
          `;
        }
      }

      const resDev = await fetch(`/api/devices`);
      const list = await resDev.json();
      const dev = (list || []).find(d => d.deviceId === currentDeviceId);
      if (dev) {
        updateStatusBadge(dev.state || "live");
      }
    }
  } catch (e) {
    console.error("Failed to load initial panel data:", e);
    updateStatusBadge("disconnected", "Server Offline");
  }
}

function renderUIDefinition(schema) {
  if (!schema) return;

  const container = document.getElementById("layout-root");
  const titleEl = document.getElementById("dashboard-title");

  if (!container) return;

  if (schema.title && titleEl) {
    titleEl.textContent = schema.title;
  }

  const layoutType = (schema.properties && schema.properties.flow) || schema.type || "row";
  container.className = layoutType === "column" ? "layout-column" : "layout-row";
  container.innerHTML = "";

  const widgets = schema.layout || [];
  let chartWidgetTargetKey = null;

  widgets.forEach(widget => {
    if (widget.type === "chart" && widget.properties) {
      chartWidgetTargetKey = widget.properties.target_key || widget.properties.id;
      return;
    }

    const card = document.createElement("div");
    card.className = "glass widget-card";

    if (widget.type === "number" || widget.type === "indicator") {
      const unitStr = widget.properties.unit ? ` <span class="widget-unit">${widget.properties.unit}</span>` : "";
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label || widget.properties.id}</span>
        <div class="widget-indicator">
          <span id="val-${widget.properties.id}">${widget.properties.value || "--"}</span>${unitStr}
        </div>
      `;
    } else if (widget.type === "range") {
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
    } else if (widget.type === "button") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <button id="val-${widget.properties.id}" class="widget-btn" onclick="sendControlCommand('${widget.properties.id}', 'toggle', true)">
          ${widget.properties.label}
        </button>
      `;
    } else if (widget.type === "text") {
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label}</span>
        <div class="widget-text-view" id="val-${widget.properties.id}">${widget.properties.value || "--"}</div>
      `;
    } else if (widget.type === "img") {
      const src = widget.properties.url || widget.properties.value || "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80";
      card.innerHTML = `
        <span class="widget-label">${widget.properties.label || "Image Stream"}</span>
        <img class="widget-img" id="img-${widget.properties.id}" src="${src}" alt="Device Stream">
      `;
    } else if (widget.type === "divider") {
      card.style.height = "1px";
      card.style.padding = "0";
      card.style.background = "var(--border-color)";
    }

    container.appendChild(card);
  });

  if (chartWidgetTargetKey || widgets.some(w => w.type === "chart")) {
    initChart();
  }

  toggleInputLockOverlay(currentStatus === "control" && isControlAcquired);
}

function updateTelemetryData(data) {
  if (!data) return;

  lastSeenTimestamp = Date.now();
  if (currentStatus === "stale" || currentStatus === "detached") {
    updateStatusBadge("live", "Live");
  }

  if (data.status_text && data.status_text.includes("Fault")) {
    updateStatusBadge("fault", "Fault");
  }

  Object.keys(data).forEach(key => {
    const el = document.getElementById(`val-${key}`);
    if (el && el.tagName !== "BUTTON") {
      el.textContent = data[key];
    }

    const imgEl = document.getElementById(`img-${key}`);
    if (imgEl && data[key]) {
      imgEl.src = data[key];
    }
  });

  if (telemetryChart && data.temperature !== undefined) {
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    telemetryChart.data.labels.push(timeLabel);
    telemetryChart.data.datasets[0].data.push(data.temperature);

    if (telemetryChart.data.labels.length > 20) {
      telemetryChart.data.labels.shift();
      telemetryChart.data.datasets[0].data.shift();
    }
    telemetryChart.update("quiet");
  }
}

async function updateViewerPresence(active) {
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");
  if (isDirectoryPage || !currentDeviceId) return;

  const payload = JSON.stringify({
    deviceId: currentDeviceId,
    target: "viewers_active",
    action: "set_value",
    value: active
  });

  try {
    if (window.supabaseClient) {
      await window.supabaseClient
        .from("devices")
        .update({ viewers_active: active, viewers_last_seen: new Date().toISOString() })
        .eq("id", currentDeviceId);

      await window.supabaseClient
        .from("device_commands")
        .insert({
          device_id: currentDeviceId,
          target: "viewers_active",
          action: "set_value",
          value: active,
          status: "pending"
        });
    }
  } catch (e) {
    console.warn("Direct Supabase viewer presence update fallback to API:", e);
  }

  if (active) {
    sendControlCommand("viewers_active", "set_value", true);
  } else {
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
  }
}

async function toggleControlLease() {
  try {
    if (!isControlAcquired) {
      const res = await fetch("/api/device/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: currentDeviceId,
          target: "acquire_control_lease",
          action: "set_value",
          value: currentSessionId
        })
      });
      const data = await res.json();
      if (data.success) {
        isControlAcquired = true;
        updateStatusBadge("control");
      }
    } else {
      const res = await fetch("/api/device/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: currentDeviceId,
          target: "release_control_lease",
          action: "set_value",
          value: currentSessionId
        })
      });
      const data = await res.json();
      if (data.success) {
        isControlAcquired = false;
        updateStatusBadge("live");
      }
    }
  } catch (e) {
    console.error("Failed to toggle control lease:", e);
  }
}

function releaseControlLeaseOnLeave() {
  const isDirectoryPage = !(new URLSearchParams(window.location.search)).has("device_id");
  if (isDirectoryPage || !currentDeviceId) return;

  updateViewerPresence(false);

  if (isControlAcquired) {
    const payload = JSON.stringify({
      deviceId: currentDeviceId,
      target: "release_control_lease",
      action: "set_value",
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
  }
}

window.addEventListener("beforeunload", releaseControlLeaseOnLeave);
window.addEventListener("pagehide", releaseControlLeaseOnLeave);

window.loadInitialData = loadInitialData;
window.renderUIDefinition = renderUIDefinition;
window.updateTelemetryData = updateTelemetryData;
window.updateViewerPresence = updateViewerPresence;
window.toggleControlLease = toggleControlLease;
