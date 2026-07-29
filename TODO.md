# Marveluzz Hub - Development TODO & Backlog

## 🛠️ Infrastructure & Edge Performance
- [ ] **Investigate Deno Deploy Aggressive Spin-Down & Realtime Status**:
  - Analyze Deno Deploy serverless isolate spin-down cycles during idle periods.
  - Evaluate impact on Supabase Realtime WebSockets, background state timers, and edge connection persistence.
  - Benchmark connection re-establishment latency and optimize heartbeat auto-reconnect routines.

## 🎨 UI & Design
- [ ] **Define Layout Load & Fill Behavior**:
  - Specify and implement the exact load and empty-state fill sequence for `renderUIDefinition()` in `public/panel.js`:
    1. **Load**: On device panel open, fetch stored layout from DB (`GET /api/device/layout?device_id=...`). While pending, show a skeleton loader (pulsing placeholder widgets).
    2. **Fill**: Once the device sends its first telemetry ingest (POST → RPC `ingest_telemetry`), the layout is registered/updated and the skeleton is replaced with rendered widgets.
    3. **Empty state**: If no layout is registered after N seconds of polling, show a "Waiting for device to register its UI layout..." empty state with a spinner.
    4. **Stale layout**: If the device is `detached` or `disconnected`, restore the last stored layout from DB as a read-only view with a "Disconnected" overlay.
  - Document this sequence in `spec.md` §2.6.2.

- [ ] **Investigate & Fix Live Device State Management**:
  - Audit status transitions between `live`, `control`, `detached`, `stale`, and `disconnected`.
  - Fix edge cases where background keepalive timers or incoming telemetry events incorrectly override status badges or control button visibility across multi-tab web UI views and directory pages.
- [ ] **Mobile Responsiveness & Responsive Layouts**: Make all dashboard views (Device Directory, Device Panel, and Device Management) fully mobile-friendly with responsive media queries, touch-friendly control targets, flexible card wrapping, and viewport optimizations.
- [ ] **UI General Cleanup**: Polish overall Hub dashboard UI — review spacing, typography consistency, widget alignment, empty states, and loading skeletons.
- [ ] **Container Flow Layout Handling** (`properties.flow`): Implement dynamic container flex layout handling in `renderUIDefinition()` (`public/panel.js`) to support `"row"` (horizontal flex wrapping) and `"column"` (vertical stacked layout) as specified in §2.6.2.
- [ ] **Dynamic Chart Widget Type** (`type: "chart"`): Implement dynamic Chart.js widget renderer in `renderUIDefinition()` (`public/panel.js`) to support device-declared time-series plots bound to `widget.properties.target_key` as specified in §2.6.2.

## 🧪 Verification & Quality Assurance
- [ ] **Race Conditions & Concurrency Analysis**: Perform formal race condition analysis on concurrent lease takeover (`acquire_control_lease`), simultaneous telemetry ingestion (`ingest_telemetry`), and out-of-order command processing across multi-tab web sessions and edge replicas.
- [ ] **End-to-End Test Suite**: Add tests covering 7-state badge transitions, lease acquisition, storage wipe, and telemetry ingest under mock DB and Supabase production backends.

## 🔒 Security & Access Control
- [ ] **Undefined Device Onboarding & Registration Security ("Add Device")**:
  - Define formal security model for adding new IoT devices. Currently, raw `device_id` and `device_key` pairs are pre-seeded or ingested without a standardized user-authorized onboarding flow.
  - Design & implement secure pairing workflow (e.g. 6-digit PIN / QR code handshake, temporary pair tokens, and mandatory secret key generation).
  - Enforce permission boundaries so unauthenticated users or unauthorized devices cannot claim unregistered device slots or spoof telemetry ingest RPCs.
- [ ] **Device Secret Key Rotation & Revocation**: Implement secure endpoint (`POST /api/device/rotate_key`) allowing authenticated dashboard owners to rotate or revoke compromise-suspected device secret keys.
