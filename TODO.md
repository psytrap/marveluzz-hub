# Marveluzz Hub - Development TODO & Backlog

## 🛠️ Infrastructure & Edge Performance
- [ ] **Investigate Deno Deploy Aggressive Spin-Down & Realtime Status**:
  - Analyze Deno Deploy serverless isolate spin-down cycles during idle periods.
  - Evaluate impact on Supabase Realtime WebSockets, background state timers, and edge connection persistence.
  - Benchmark connection re-establishment latency and optimize heartbeat auto-reconnect routines.

## 🎨 UI & Design
- [ ] **Investigate & Fix Live Device State Management**:
  - Audit status transitions between `live`, `control`, `detached`, `stale`, and `disconnected`.
  - Fix edge cases where background keepalive timers or incoming telemetry events incorrectly override status badges or control button visibility across multi-tab web UI views and directory pages.
- [ ] **UI General Cleanup**: Polish overall Hub dashboard UI — review spacing, typography consistency, widget alignment, empty states, and loading skeletons.
- [ ] **Smart Stale & Disconnection Detection**: Refactor client-side keepalive timer into an adaptive heartbeat state machine based on active telemetry stream rates and network jitter.
- [ ] **Device Storage Stats Page** (`/devices/stats?device_id=...`): Implement dedicated storage footprint metrics, retention policy configuration, and secret key rotation page.

## 🧪 Verification & Quality Assurance
- [ ] **Race Conditions & Concurrency Analysis**: Perform formal race condition analysis on concurrent lease takeover (`acquire_control_lease`), simultaneous telemetry ingestion (`ingest_telemetry`), and out-of-order command processing across multi-tab web sessions and edge replicas.
- [ ] **End-to-End Test Suite**: Add tests covering 7-state badge transitions, lease acquisition, storage wipe, and telemetry ingest under mock DB and Supabase production backends.
