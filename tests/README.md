# Marveluzz Hub - Automated Test Suite Overview

This directory contains the automated integration and contract verification test suites for `Marveluzz Hub`.

---

## 📊 Test Suite Overview Table

| Test File | Suite Description & Focus Area | Steps | Target Backend | Command |
| :--- | :--- | :---: | :--- | :--- |
| **`tests/local_test.ts`** | **Local Engine & Unit Verification**: Asserts SSE event protocol, SQL RPC mocks, exclusive control lease locks, storage footprint wiping, key rotation, retention TTL, 7-state machine, multi-device isolation, session security, and 1:1 SQL schema parity. | **26** | Standalone Local Mock Engine (`MockSupabaseEngine`) | `deno task test` |
| **`tests/auth_test.ts`** | **Authentication & Session Lifecycle**: Verifies Developer Mock Login (`MOCK_AUTH=true`), session cookie signing/validation, GitHub OAuth gateway (`MOCK_AUTH=false`), UI command dispatch, Fast/Power-Save telemetry transitions, page unload lease auto-release, and Danger Zone storage wipe vs device deletion. | **15** | Local Edge Server & Session Manager | `deno task test` |
| **`tests/staging_test.ts`** | **Live Staging & Production Contract Parity**: Executes live endpoint verification against Deno Deploy (`https://marveluzz-hub-staging.psytrap.deno.net`), checking version banners, memory diagnostics, RPC execution, directory queries, disconnected layout restoration, and Supabase Realtime WebSocket push-down. | **13** | Live Remote Deno Deploy & Supabase Cloud | `deno task test:staging` |

**Total Automated Coverage**: **54 Test Steps** across 3 test modules.

---

## 🔍 Detailed Test Breakdown Matrix

### 1. `tests/local_test.ts` (26 Steps)
- **Supabase Environment & SSE Event Protocol** (2 steps):
  - Validates Supabase environment credentials and configuration format.
  - Validates Server-Sent Events (SSE) stream headers and protocol formatting.
- **Supabase Mock Schema & Ingest RPCs** (10 steps):
  - Registers dynamic UI layout definition RPC.
  - Asserts un-registered devices return null layout schema requiring empty state.
  - Asserts offline/detached devices retain stored layout schema for WebUI restoration.
  - Enforces secret key authentication and rejects invalid keys (`SEC-3`).
  - Ingests telemetry data and maintains history log entries (`SEC-2`).
  - Enforces strict exclusive WebSocket command push (HTTP ingest returns 0 piggybacked commands) (`DSN-1`).
  - Staging test for `viewers_active` state transitions & WebSocket command dispatch.
  - Device joins while Web UI viewer is open ➔ returns `viewers_active=true` on initial boot ingest.
  - UI `viewers_active` command updates devices table state ➔ returns `viewers_active=true` on telemetry ingest (`DSN-2`).
  - Releasing control lease updates status to `live` and clears `viewers_active`.
- **Exclusive Control Lease & Storage Lifecycle** (5 steps):
  - Acquires and releases exclusive control lease.
  - Wipes device storage data and reverts device to `detached` state (`DSN-3`).
  - Purges expired telemetry history according to retention TTL policy.
  - Rotates secret device key and updates retention TTL.
  - Returns storage footprint statistics and wipe operations.
- **System Diagnostics & 7-State Machine** (3 steps):
  - Validates Deno memory usage diagnostic structure.
  - Evaluates 7-state diagnostic status transitions and keepalive state.
  - Classifies high-level Connected and Disconnected status hierarchies.
- **Concurrency Locks & Multi-Device Security Isolation** (3 steps):
  - Enforces multi-tab lease acquisition and takeover lock synchronization.
  - Isolates layout schemas, telemetry history, auth keys, and command queues across devices.
  - Enforces per-device control lease isolation and automatic release.
- **Schema Parity & Session Unit Tests** (3 steps):
  - Verifies production contract schema version compatibility.
  - Asserts 1:1 parity between `supabase/schema.sql` and `supabase/migrations/20260728000000_initial_schema.sql`.
  - Validates version output banner string formatting.

---

### 2. `tests/auth_test.ts` (15 Steps)
- **Local Session Lifecycle & Developer Mock Login (`MOCK_AUTH=true`)** (13 steps):
  - Redirects unauthenticated requests to `/login`.
  - Renders developer login form and Mock Auth warnings.
  - Rejects unauthorized users (`charlie`) not in `ALLOWED_GITHUB_USERS`.
  - Logs in allowed user (`alice`) and sets signed session cookie.
  - Serves protected page loads with valid session cookie.
  - Queues UI commands via `POST /api/device/command` and ingests via IoT telemetry.
  - **Scenario**: Web UI panel opens FIRST ➔ ESP32 joins/boots ➔ returns `viewers_active=true`.
  - **Scenario**: Web UI panel opens ➔ 5s Fast Mode ➔ panel closes ➔ 30s Power-Save Mode (`DSN-2`).
  - **Scenario**: Closed panel with acquired control ➔ dispatches `release_control_lease` & `viewers_active=false` (`DSN-5`).
  - **Danger Zone**: `POST /api/devices/delete` with `deleteRecord: false` wipes storage but retains device (`DSN-3`).
  - **Danger Zone**: `POST /api/devices/delete` with `deleteRecord: true` unregisters device completely (`DSN-3`).
  - Logout routine invalidates active session and clears cookie.
  - Subsequent requests with logged-out cookies are rejected.
- **Production GitHub OAuth Gateway (`MOCK_AUTH=false`)** (2 steps):
  - Redirects `/login/github` to `github.com/login/oauth/authorize` with `client_id`.
  - Redirects `/login/callback` without authorization code to `/login?error=oauth_failed`.

---

### 3. `tests/staging_test.ts` (13 Steps)
- **Endpoint Verification & Integration** (8 steps):
  - Outputs production self-test and version banner string.
  - Checks health and memory diagnostics API (`/api/debug/memory`).
  - Registers dynamic UI layout schema endpoint.
  - Ingests telemetry and retrieves pending commands.
  - Dispatches UI commands via WebSockets with 0 HTTP piggybacking (`DSN-1`).
  - Fetches device directory listing (`GET /api/devices`).
  - Fetches device storage footprint stats (`GET /api/devices/stats`).
  - Restores stored layout and telemetry for disconnected/detached devices.
- **Deployment Parity & RPC Contract Verification** (5 steps):
  - Validates Deno Deploy and Supabase configuration alignment.
  - Asserts local SQL schema and migration script equivalence.
  - Verifies Direct PostgREST vs Deno Edge RPC contract match.
  - Tests `viewers_active` state transitions over WebSocket push.
  - Verifies Direct Supabase Realtime WebSocket command push-down with Phoenix `phx_reply` handshake (`DSN-6`).

---

## 🎯 Design Decision (DSN-X) & Security (SEC-X) Tracing Map

| Design ID | High-Level Spec Section | Requirement & Scope | Verifying Test Suite |
| :--- | :--- | :--- | :--- |
| **DSN-1** | §2.3 | Strict Exclusive WebSocket Push (0 HTTP Piggyback) | `tests/local_test.ts` (Step 6) & `tests/staging_test.ts` (Step 5) |
| **DSN-2** | §2.4 | Dual-Mode Storage Wipe (`false`) vs Device Deletion (`true`) | `tests/local_test.ts` (Step 12) & `tests/auth_test.ts` (Steps 10, 11) |
| **DSN-3** | §2.5 | Publishable Key Standardization (`SUPABASE_PUBLIC_KEY`) & Session Auth | `tests/local_test.ts` (Step 1) & `tests/auth_test.ts` (Steps 3-5) |
| **DSN-4** | §2.6 | Web UI Dual-Rate Mode (5s/30s), Control Lease & Layouts | `tests/auth_test.ts` (Steps 8, 9) |
| **DSN-5** | §3.2 | Remote Realtime Gateway & Phoenix Handshake (`phx_reply`) | `tests/staging_test.ts` (Step 13) |
| **DSN-6** | §10 | Direct-to-Cloud Ingestion Security Rules (SEC-1, SEC-2, SEC-3) | `tests/local_test.ts` (Steps 4, 5, 22) |
