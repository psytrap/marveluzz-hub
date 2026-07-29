# Marveluzz Hub - Development TODO & Backlog

## 🛠️ Infrastructure & Edge Performance
- [ ] **Investigate Deno Deploy Aggressive Spin-Down & Realtime Status**:
  - Analyze Deno Deploy serverless isolate spin-down cycles during idle periods.
  - Evaluate impact on Supabase Realtime WebSockets, background state timers, and edge connection persistence.
  - Benchmark connection re-establishment latency and optimize heartbeat auto-reconnect routines.

## 🎨 UI & Design
- [x] **Device Directory: Meaningless Realtime Refresh on Any `devices` Table Change**:
  - ~~Currently the directory page (`setupRealtimeSubscriptions()`) calls `loadDeviceDirectory()` on **every** `postgres_changes` event on `public.devices` — including telemetry-driven heartbeats that update only `last_seen_at` but leave the directory list unchanged.~~
  - **Fixed**: Split `event: '*'` into three separate handlers. `INSERT`/`DELETE` always reload the directory. `UPDATE` only reloads when `display_name` or `status` changes — `last_seen_at`, `viewers_active`, `controller_session_id` are ignored.
  - **Fixed**: `ui_definitions` changes no longer trigger a directory reload (layout registration is irrelevant to the device list).

- [ ] **Define Layout Load & Fill Behavior**:
  - Specify and implement the exact load and empty-state fill sequence for `renderUIDefinition()` in `public/app.js`:
    1. **Load**: On device panel open, fetch stored layout from DB (`GET /api/device/layout?device_id=...`). While pending, show a skeleton loader (pulsing placeholder widgets).
    2. **Fill**: Once the device sends its first telemetry ingest (POST → RPC `ingest_telemetry`), the layout is registered/updated and the skeleton is replaced with rendered widgets.
    3. **Empty state**: If no layout is registered after N seconds of polling, show a "Waiting for device to register its UI layout..." empty state with a spinner.
    4. **Stale layout**: If the device is `detached` or `disconnected`, restore the last stored layout from DB as a read-only view with a "Disconnected" overlay.
  - Document this sequence in `spec.md` §2.6.2.

- [x] **LED Toggle Button Color Convention — Green (ON) / Blue (OFF)**:
  - **Root cause found & removed**: The `button` widget was reading `widget.properties.value` from the static layout schema (set at ESP32 registration time) to pre-apply `.widget-btn-active` at render time. This was stale and meaningless.
  - **Fixed**: Button always renders blue (`.widget-btn`) on layout load. Color only changes dynamically via `updateTelemetryData()` which applies `.widget-btn-active` when the ESP32 reports the actual live state (e.g. `data.led_toggle = true`).
  - **Convention**: Blue = OFF/ready. Green = ON/active. Applied exclusively from live telemetry, not static layout values.

- [ ] **Investigate & Fix Live Device State Management**:
  - Audit status transitions between `live`, `control`, `detached`, `stale`, and `disconnected`.
  - Fix edge cases where background keepalive timers or incoming telemetry events incorrectly override status badges or control button visibility across multi-tab web UI views and directory pages.
- [ ] **UI General Cleanup**: Polish overall Hub dashboard UI — review spacing, typography consistency, widget alignment, empty states, and loading skeletons.
- [ ] **Smart Stale & Disconnection Detection**: Refactor client-side keepalive timer into an adaptive heartbeat state machine based on active telemetry stream rates and network jitter.
- [ ] **Device Storage Stats Page** (`/devices/stats?device_id=...`): Implement dedicated storage footprint metrics, retention policy configuration, and secret key rotation page.
- [ ] **Container Flow Layout Handling** (`properties.flow`): Implement dynamic container flex layout handling in `renderUIDefinition()` (`public/app.js`) to support `"row"` (horizontal flex wrapping) and `"column"` (vertical stacked layout) as specified in §2.6.2.
- [ ] **Dynamic Chart Widget Type** (`type: "chart"`): Implement dynamic Chart.js widget renderer in `renderUIDefinition()` (`public/app.js`) to support device-declared time-series plots bound to `widget.properties.target_key` as specified in §2.6.2.

## 🧪 Verification & Quality Assurance
- [ ] **Race Conditions & Concurrency Analysis**: Perform formal race condition analysis on concurrent lease takeover (`acquire_control_lease`), simultaneous telemetry ingestion (`ingest_telemetry`), and out-of-order command processing across multi-tab web sessions and edge replicas.
- [ ] **End-to-End Test Suite**: Add tests covering 7-state badge transitions, lease acquisition, storage wipe, and telemetry ingest under mock DB and Supabase production backends.

## 🔒 Security & Access Control
- [ ] **Undefined Device Onboarding & Registration Security ("Add Device")**:
  - Define formal security model for adding new IoT devices. Currently, raw `device_id` and `device_key` pairs are pre-seeded or ingested without a standardized user-authorized onboarding flow.
  - Design & implement secure pairing workflow (e.g. 6-digit PIN / QR code handshake, temporary pair tokens, and mandatory secret key generation).
  - Enforce permission boundaries so unauthenticated users or unauthorized devices cannot claim unregistered device slots or spoof telemetry ingest RPCs.
- [ ] **Device Secret Key Rotation & Revocation**: Implement secure endpoint (`POST /api/device/rotate_key`) allowing authenticated dashboard owners to rotate or revoke compromise-suspected device secret keys.

