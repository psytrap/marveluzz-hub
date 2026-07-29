// Marveluzz Hub - Device Management Frontend Module (manage.js)

async function loadDeviceManagementPage() {
  const container = document.getElementById("layout-root");
  const titleEl = document.getElementById("dashboard-title");
  const uuidDisplay = document.getElementById("device-uuid-display");
  const statusBadge = document.getElementById("status-badge");
  const controlBtn = document.getElementById("btn-control");
  const navDirBtn = document.getElementById("nav-directory-btn");

  const urlParams = new URLSearchParams(window.location.search);
  let deviceId = urlParams.get("device_id");
  if (!deviceId && window.currentDeviceId) {
    deviceId = window.currentDeviceId;
  }

  if (!deviceId) {
    if (container) {
      container.innerHTML = `
        <div class="glass empty-state">
          <h3>No Device Specified</h3>
          <p>Please select a device from the <a href="/">Device Directory</a>.</p>
        </div>`;
    }
    return;
  }

  if (titleEl) titleEl.textContent = "Device Management";
  if (uuidDisplay) {
    uuidDisplay.style.display = "inline-flex";
    const uuidTextEl = document.getElementById("device-uuid-text");
    if (uuidTextEl) uuidTextEl.textContent = deviceId;
  }
  if (statusBadge) statusBadge.style.display = "none";
  if (controlBtn) controlBtn.style.display = "none";
  if (navDirBtn) {
    navDirBtn.style.display = "inline-block";
    navDirBtn.href = "/";
    navDirBtn.textContent = "Device Directory";
  }

  if (!container) return;

  container.innerHTML = `<div class="glass empty-state"><p style="color:var(--text-secondary);">Loading device management metrics...</p></div>`;

  try {
    const res = await fetch(`/api/device/stats?device_id=${deviceId}`);
    if (!res.ok) throw new Error("Failed to load device statistics");
    const stats = await res.json();

    const formattedBytes = (stats.estimatedBytes > 1048576)
      ? `${(stats.estimatedBytes / 1048576).toFixed(2)} MB`
      : `${(stats.estimatedBytes / 1024).toFixed(1)} KB`;

    const lastSeenStr = stats.lastSeen ? new Date(stats.lastSeen).toLocaleString() : "Never";

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:20px; width:100%; max-width:1100px; margin:0 auto;">
        
        <!-- Card 1: Identity & Status -->
        <div class="glass widget-card">
          <h3 style="margin-top:0; margin-bottom:15px; color:var(--text-primary); font-size:1.1rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
            🪪 Identity & Status
          </h3>
          <div style="display:flex; flex-direction:column; gap:10px; font-size:0.95rem; color:var(--text-secondary);">
            <div><strong>Device Name:</strong> <span style="color:var(--text-primary); font-weight:600;">${stats.title || 'IoT Device'}</span></div>
            <div><strong>Status:</strong> <span class="status-pill status-${stats.status || 'detached'}">${(stats.status || 'detached').toUpperCase()}</span></div>
            <div><strong>Last Active:</strong> <span style="color:var(--text-primary);">${lastSeenStr}</span></div>
            <div style="margin-top:10px;">
              <a href="/devices?device_id=${deviceId}" class="btn-action" style="display:inline-block; text-decoration:none; width:100%; text-align:center;">Open Control Panel</a>
            </div>
          </div>
        </div>

        <!-- Card 2: Storage & History Retention -->
        <div class="glass widget-card">
          <h3 style="margin-top:0; margin-bottom:15px; color:var(--text-primary); font-size:1.1rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
            💾 Telemetry Storage & Retention
          </h3>
          <div style="display:flex; flex-direction:column; gap:10px; font-size:0.95rem; color:var(--text-secondary);">
            <div><strong>Telemetry Records:</strong> <span style="color:var(--text-primary); font-weight:600;">${stats.historyCount || 0} entries</span></div>
            <div><strong>Storage Footprint:</strong> <span style="color:var(--text-primary); font-weight:600;">${formattedBytes}</span></div>
            
            <div style="margin-top:10px;">
              <label for="retention-ttl-select" style="display:block; margin-bottom:5px; font-weight:600; color:var(--text-primary);">History Retention TTL:</label>
              <div style="display:flex; gap:8px;">
                <select id="retention-ttl-select" class="glass-input" style="flex:1; padding:8px 12px; border-radius:6px; background:rgba(0,0,0,0.3); color:#fff; border:1px solid rgba(255,255,255,0.2);">
                  <option value="7" ${stats.historyTtlDays === 7 ? 'selected' : ''}>7 Days</option>
                  <option value="14" ${stats.historyTtlDays === 14 ? 'selected' : ''}>14 Days</option>
                  <option value="30" ${stats.historyTtlDays === 30 ? 'selected' : ''}>30 Days</option>
                  <option value="90" ${stats.historyTtlDays === 90 ? 'selected' : ''}>90 Days</option>
                </select>
                <button id="btn-save-retention" class="btn-action" style="padding:8px 14px;">Save</button>
              </div>
            </div>

            <div style="margin-top:10px;">
              <button id="btn-purge-telemetry" class="btn-action btn-danger" style="width:100%;">Purge Telemetry History</button>
            </div>
          </div>
        </div>

        <!-- Card 3: Security & Secret Key Rotation -->
        <div class="glass widget-card">
          <h3 style="margin-top:0; margin-bottom:15px; color:var(--text-primary); font-size:1.1rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
            🔐 Security & Secret Key Rotation
          </h3>
          <div style="display:flex; flex-direction:column; gap:10px; font-size:0.95rem; color:var(--text-secondary);">
            <div><strong>Active Secret Key:</strong> <code style="color:var(--text-primary); font-size:1rem; background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px; font-family:monospace;">${stats.maskedKey || '••••••••••••'}</code></div>
            <p style="font-size:0.85rem; color:var(--text-secondary); margin:0;">Rotating the key invalidates existing firmware credentials immediately.</p>
            
            <div style="margin-top:10px;">
              <button id="btn-rotate-key" class="btn-action" style="width:100%; background:linear-gradient(135deg, #f39c12, #d35400);">🔑 Rotate Secret Key</button>
            </div>
            
            <div id="new-key-banner" style="display:none; margin-top:10px; padding:12px; border-radius:8px; background:rgba(39, 174, 96, 0.2); border:1px solid rgba(39, 174, 96, 0.4);">
              <div style="font-weight:600; color:#2ecc71; margin-bottom:4px;">New Key Generated!</div>
              <p style="font-size:0.8rem; margin:0 0 8px 0; color:#eee;">Copy this key now. Update your ESP32 / NVS config:</p>
              <div style="display:flex; gap:6px;">
                <input type="text" id="new-key-input" readonly style="flex:1; padding:6px; font-family:monospace; font-size:0.85rem; background:rgba(0,0,0,0.4); color:#fff; border:1px solid rgba(255,255,255,0.2); border-radius:4px;" />
                <button id="btn-copy-key" class="btn-action" style="padding:6px 10px;">Copy</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Card 4: Danger Zone -->
        <div class="glass widget-card" style="border:1px solid rgba(231, 76, 60, 0.4);">
          <h3 style="margin-top:0; margin-bottom:15px; color:#e74c3c; font-size:1.1rem; border-bottom:1px solid rgba(231, 76, 60, 0.2); padding-bottom:8px;">
            ⚠️ Danger Zone
          </h3>
          <div style="display:flex; flex-direction:column; gap:10px; font-size:0.95rem; color:var(--text-secondary);">
            <p style="font-size:0.85rem; margin:0;">Wiping device data will purge all layout definitions, telemetry records, and reset status to detached.</p>
            <div style="margin-top:10px;">
              <button id="btn-wipe-device" class="btn-action btn-danger" style="width:100%; font-weight:600;">Wipe Storage & Reset Device</button>
            </div>
          </div>
        </div>

      </div>`;

    // Event Handlers
    document.getElementById("btn-save-retention")?.addEventListener("click", async () => {
      const select = document.getElementById("retention-ttl-select");
      if (!select) return;
      const ttl = select.value;
      try {
        const r = await fetch("/api/device/update_retention", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, historyTtlDays: ttl })
        });
        const resData = await r.json();
        if (resData.success) {
          alert(`Retention TTL updated to ${ttl} days.`);
        } else {
          alert(`Failed to update retention: ${resData.error}`);
        }
      } catch (err) {
        alert("Network error updating retention TTL.");
      }
    });

    document.getElementById("btn-purge-telemetry")?.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to purge all telemetry history for this device?")) return;
      try {
        const r = await fetch("/api/device/purge_telemetry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId })
        });
        const resData = await r.json();
        if (resData.success) {
          alert(`Purged ${resData.deletedCount} telemetry records.`);
          loadDeviceManagementPage();
        } else {
          alert(`Failed to purge telemetry: ${resData.error}`);
        }
      } catch (err) {
        alert("Network error purging telemetry.");
      }
    });

    document.getElementById("btn-rotate-key")?.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to rotate the device secret key? Existing IoT connections using the old key will be rejected.")) return;
      try {
        const r = await fetch("/api/device/rotate_key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId })
        });
        const resData = await r.json();
        if (resData.success && resData.newKey) {
          const banner = document.getElementById("new-key-banner");
          const input = document.getElementById("new-key-input");
          if (banner && input) {
            input.value = resData.newKey;
            banner.style.display = "block";
          }
        } else {
          alert(`Failed to rotate key: ${resData.error}`);
        }
      } catch (err) {
        alert("Network error rotating key.");
      }
    });

    document.getElementById("btn-copy-key")?.addEventListener("click", () => {
      const input = document.getElementById("new-key-input");
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        alert("Secret key copied to clipboard!");
      }
    });

    document.getElementById("btn-wipe-device")?.addEventListener("click", async () => {
      if (!confirm("CRITICAL WARNING: This will permanently wipe all telemetry history, layouts, and commands for this device. Proceed?")) return;
      try {
        const r = await fetch("/api/devices/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId })
        });
        const resData = await r.json();
        if (resData.success) {
          alert("Device storage wiped successfully.");
          window.location.href = "/";
        } else {
          alert(`Failed to wipe device: ${resData.error}`);
        }
      } catch (err) {
        alert("Network error wiping device.");
      }
    });

  } catch (err) {
    container.innerHTML = `
      <div class="glass empty-state">
        <h3 style="color:#e74c3c;">Failed to load device metrics</h3>
        <p style="color:var(--text-secondary);">${err.message}</p>
      </div>`;
  }
}

window.loadDeviceManagementPage = loadDeviceManagementPage;
