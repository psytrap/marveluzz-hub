window.directoryDeviceStateCache = window.directoryDeviceStateCache || new Map();

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

  if (!container.children.length) {
    container.innerHTML = `<div class="glass empty-state"><p style="color:var(--text-secondary);">Loading registered devices...</p></div>`;
  }

  try {
    let list = [];
    if (window.supabaseClient) {
      const { data: devRows } = await window.supabaseClient
        .from("devices")
        .select("id, title, status, last_seen, registered_at");

      const { data: uiRows } = await window.supabaseClient
        .from("ui_definitions")
        .select("device_id, layout_def");

      const uiMap = new Map((uiRows || []).map(u => [u.device_id, u.layout_def]));

      if (devRows && devRows.length > 0) {
        list = devRows.map(d => {
          const uiDef = uiMap.get(d.id);
          const displayTitle = (uiDef && uiDef.title) ? uiDef.title : d.title;
          window.directoryDeviceStateCache.set(d.id, { name: displayTitle, status: d.status });
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
      (list || []).forEach(item => {
        window.directoryDeviceStateCache.set(item.deviceId, { name: item.title, status: item.state });
      });
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

window.loadDeviceDirectory = loadDeviceDirectory;
window.wipeDeviceData = wipeDeviceData;
