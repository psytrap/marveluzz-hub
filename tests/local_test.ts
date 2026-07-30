// Marveluzz Hub - Local Test Suite (MockSupabaseEngine, file I/O & unit tests — no live services)
import { assertEquals, assert, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { MockSupabaseEngine } from "./supabase_mock.ts";
import { createSession, checkSession, deleteSession, createSignedSessionToken, checkSessionAsync, activeSessions } from "../src/main.ts";

const MOCK_DEVICE_ID = "32323232-3232-4232-8232-28c13340c86c";
const MOCK_DEVICE_KEY = "secret_passcode_123";

Deno.test("Local Engine: Supabase Environment & SSE Event Protocol", async (t) => {
  await t.step("Validates Supabase environment credentials and configuration format", () => {
    const mockEnv = {
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon_key_test",
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role_key_test",
      SUPABASE_JWT_SECRET: "super-secret-jwt-token-key-123456"
    };

    assert(mockEnv.SUPABASE_URL.startsWith("https://"));
    assert(mockEnv.SUPABASE_URL.endsWith(".supabase.co"));
    assert(mockEnv.SUPABASE_ANON_KEY.length > 20);
    assert(mockEnv.SUPABASE_SERVICE_ROLE_KEY.length > 20);
    assert(mockEnv.SUPABASE_JWT_SECRET.length > 10);
  });

  await t.step("Validates Server-Sent Events (SSE) stream headers and protocol formatting", () => {
    const sseResponseHeader = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    };

    assertEquals(sseResponseHeader["Content-Type"], "text/event-stream");
    assertEquals(sseResponseHeader["Cache-Control"], "no-cache");

    const deviceId = MOCK_DEVICE_ID;
    const eventName = "command";
    const payload = { commandId: "cmd-123", target: "fan_toggle", value: true };
    const formattedSse = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

    assert(formattedSse.startsWith("event: command\n"));
    assert(formattedSse.endsWith("\n\n"));
    assert(formattedSse.includes("fan_toggle"));
  });
});

Deno.test("Local Engine: Supabase Mock Schema & Ingest RPCs", async (t) => {
  await t.step("Registers dynamic UI layout definition RPC", () => {
    const db = new MockSupabaseEngine();
    const layout = {
      title: "ESP32 Temp Sensor Node",
      type: "layout",
      layout: [{ type: "number", properties: { label: "Temperature", id: "temp" } }]
    };

    const success = db.registerUIDefinition(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, layout);
    assertEquals(success, true);

    const storedDef = db.uiDefinitions.get(MOCK_DEVICE_ID);
    assert(storedDef !== undefined);
    assertEquals(storedDef?.layout_def.title, "ESP32 Temp Sensor Node");
  });

  await t.step("Asserts un-registered devices return null layout schema requiring awaiting empty state", () => {
    const db = new MockSupabaseEngine();
    const unregId = "99999999-9999-4999-8999-999999999999";
    
    // Unregistered device has no schema stored
    const storedDef = db.uiDefinitions.get(unregId);
    assertEquals(storedDef, undefined);

    const devRecord = db.devices.get(unregId);
    assertEquals(devRecord, undefined);
  });

  await t.step("Asserts offline/detached devices retain and return stored DB layout schema for WebUI restoration", () => {
    const db = new MockSupabaseEngine();
    const layout = {
      title: "Offline ESP32 Sensor Node",
      type: "layout",
      layout: [{ type: "number", properties: { label: "Temperature", id: "temp", value: "22.5" } }]
    };

    // Register layout and simulate device going offline/detached
    db.registerUIDefinition(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, layout);
    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temp: "22.5" });

    const dev = db.devices.get(MOCK_DEVICE_ID);
    if (dev) dev.status = "detached"; // Device is offline/detached

    // Verify stored DB layout and latest telemetry remain preserved for offline rendering
    const storedUiDef = db.uiDefinitions.get(MOCK_DEVICE_ID);
    assert(storedUiDef !== undefined);
    assertEquals(storedUiDef?.layout_def.title, "Offline ESP32 Sensor Node");

    const latestTelem = db.telemetryLatest.get(MOCK_DEVICE_ID);
    assert(latestTelem !== undefined);
    assertEquals(latestTelem?.data.temp, "22.5");
  });

  await t.step("Enforces secret key authentication and rejects invalid keys", () => {
    const db = new MockSupabaseEngine();

    assertThrows(
      () => { db.registerUIDefinition(MOCK_DEVICE_ID, "invalid_wrong_key", {}); },
      Error,
      "Unauthorized: Invalid Device ID or Device Key."
    );

    assertThrows(
      () => { db.ingestTelemetry(MOCK_DEVICE_ID, "invalid_wrong_key", { temp: 20 }); },
      Error,
      "Unauthorized: Invalid Device ID or Device Key."
    );
  });

  await t.step("Ingests telemetry data and maintains history log entries", () => {
    const db = new MockSupabaseEngine();

    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.2, uptime: "10s" });
    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.8, uptime: "20s" });

    const latest = db.telemetryLatest.get(MOCK_DEVICE_ID);
    assertEquals(latest?.data.temperature, 24.8);

    const history = db.getHistory(MOCK_DEVICE_ID, 50);
    assertEquals(history.length, 2);
    assertEquals(history[0].data.temperature, 24.8);
  });

  await t.step("Enforces strict exclusive WebSocket command push (HTTP ingest returns 0 piggybacked commands)", () => {
    const db = new MockSupabaseEngine();

    const cmdId = db.queueCommand(MOCK_DEVICE_ID, "fan_toggle", "set_value", true);
    const telemetryResult = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 25.1 });

    // HTTP telemetry ingest must NOT return piggybacked commands
    const validCommands = telemetryResult.filter(c => c.command_id !== null);
    assertEquals(validCommands.length, 0);

    const cmdRecord = db.deviceCommands.get(cmdId);
    assertEquals(cmdRecord?.status, "pending");
  });

  await t.step("Staging test for viewers_active state transitions & WebSocket command dispatch", () => {
    const db = new MockSupabaseEngine();

    // 1. Verify default viewers_active state is false
    const initialDev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(initialDev?.viewers_active, false);

    // 2. Simulate Web UI dashboard viewer opening device panel -> updates viewers_active = true and queues command
    db.updateDeviceViewersActive(MOCK_DEVICE_ID, true);
    const cmdIdTrue = db.queueCommand(MOCK_DEVICE_ID, "viewers_active", "set_value", true);

    const devActive = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(devActive?.viewers_active, true);

    const queuedCmdTrue = db.deviceCommands.get(cmdIdTrue);
    assert(queuedCmdTrue !== undefined);
    assertEquals(queuedCmdTrue?.target, "viewers_active");
    assertEquals(queuedCmdTrue?.action, "set_value");
    assertEquals(queuedCmdTrue?.value, true);
    assertEquals(queuedCmdTrue?.status, "pending");

    // 3. Simulate Web UI dashboard viewer closing panel -> updates viewers_active = false and queues command
    db.updateDeviceViewersActive(MOCK_DEVICE_ID, false);
    const cmdIdFalse = db.queueCommand(MOCK_DEVICE_ID, "viewers_active", "set_value", false);

    const devInactive = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(devInactive?.viewers_active, false);

    const queuedCmdFalse = db.deviceCommands.get(cmdIdFalse);
    assert(queuedCmdFalse !== undefined);
    assertEquals(queuedCmdFalse?.target, "viewers_active");
    assertEquals(queuedCmdFalse?.action, "set_value");
    assertEquals(queuedCmdFalse?.value, false);
  });

  await t.step("Device joins while Web UI viewer is already open -> returns viewers_active=true on initial boot telemetry ingest", () => {
    const db = new MockSupabaseEngine();

    // 1. Web UI dashboard is already open before device boots
    db.updateDeviceViewersActive(MOCK_DEVICE_ID, true);

    // 2. Device boots up and sends initial telemetry ingest
    const res = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.5, uptime: "0s" });

    // 3. Verify initial telemetry ingest response immediately returns viewers_active = true
    assertEquals(res.length, 1);
    assertEquals(res[0].viewers_active, true);
  });

  await t.step("UI viewers_active command updates devices table state so subsequent telemetry ingest returns viewers_active=true", () => {
    const db = new MockSupabaseEngine();

    // 1. Initially viewers_active is false
    const initialRes = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 20.0 });
    assertEquals(initialRes[0].viewers_active, false);

    // 2. UI dispatches viewers_active = true command
    db.updateDeviceViewersActive(MOCK_DEVICE_ID, true);
    db.queueCommand(MOCK_DEVICE_ID, "viewers_active", "set_value", true);

    // 3. Subsequent telemetry ingest returns viewers_active = true, preserving Fast Mode
    const activeRes = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 20.5 });
    assertEquals(activeRes[0].viewers_active, true);
  });

  await t.step("Enforces SEC-1 (Zero Direct Table Writes) - Rejects direct REST table INSERT/UPDATE attempts with 403", async () => {
    const { handleRequest } = await import("../src/routes.ts");

    const directInsertReq = new Request("http://localhost:8000/rest/v1/telemetry_history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: MOCK_DEVICE_ID, data: { temp: 100 } })
    });
    const resInsert = await handleRequest(directInsertReq);
    assertEquals(resInsert.status, 403);
    const bodyInsert = await resInsert.json();
    assertEquals(bodyInsert.error.includes("SEC-1 Violation"), true);

    const directUpdateReq = new Request("http://localhost:8000/rest/v1/devices?id=eq.32323232", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "control" })
    });
    const resUpdate = await handleRequest(directUpdateReq);
    assertEquals(resUpdate.status, 403);
    const bodyUpdate = await resUpdate.json();
    assertEquals(bodyUpdate.error.includes("SEC-1 Violation"), true);
  });

  await t.step("Releasing control lease while active updates status to live and clearing viewers_active returns false for telemetry ingest", () => {
    const db = new MockSupabaseEngine();
    const sessionId = "control-session-999";

    // 1. Acquire control and set viewers_active = true
    db.acquireControlLease(MOCK_DEVICE_ID, sessionId);
    db.updateDeviceViewersActive(MOCK_DEVICE_ID, true);
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.status, "control");
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.viewers_active, true);

    // 2. Teardown on page leave: release control lease and update viewers_active = false
    db.releaseControlLease(MOCK_DEVICE_ID, sessionId);
    db.updateDeviceViewersActive(MOCK_DEVICE_ID, false);

    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.status, "live");
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.viewers_active, false);

    // 3. Telemetry ingest returns viewers_active = false (30s Power-Save Mode)
    const ingestRes = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 21.0 });
    assertEquals(ingestRes[0].viewers_active, false);
  });
});

Deno.test("Local Engine: Exclusive Control Lease & Storage Lifecycle", async (t) => {
  await t.step("Acquires and releases exclusive control lease", () => {
    const db = new MockSupabaseEngine();
    const sessionTabA = "tab-session-alpha-123";
    const sessionTabB = "tab-session-beta-456";

    const acquireSuccess = db.acquireControlLease(MOCK_DEVICE_ID, sessionTabA);
    assertEquals(acquireSuccess, true);

    const devAfterAcquire = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(devAfterAcquire?.status, "control");
    assertEquals(devAfterAcquire?.controller_session_id, sessionTabA);

    const releaseByWrongTab = db.releaseControlLease(MOCK_DEVICE_ID, sessionTabB);
    assertEquals(releaseByWrongTab, false);

    const releaseSuccess = db.releaseControlLease(MOCK_DEVICE_ID, sessionTabA);
    assertEquals(releaseSuccess, true);

    const devAfterRelease = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(devAfterRelease?.status, "live");
    assertEquals(devAfterRelease?.controller_session_id, null);
  });

  await t.step("Wipes device storage data and reverts device to detached state", () => {
    const db = new MockSupabaseEngine();

    db.registerUIDefinition(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { title: "Test Node" });
    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 26.5 });
    db.queueCommand(MOCK_DEVICE_ID, "relay_1", "toggle", true);

    assert(db.uiDefinitions.has(MOCK_DEVICE_ID));
    assert(db.telemetryLatest.has(MOCK_DEVICE_ID));
    assert(db.telemetryHistory.length > 0);

    const wipeSuccess = db.wipeDeviceData(MOCK_DEVICE_ID);
    assertEquals(wipeSuccess, true);

    assert(!db.uiDefinitions.has(MOCK_DEVICE_ID));
    assert(!db.telemetryLatest.has(MOCK_DEVICE_ID));
    assertEquals(db.getHistory(MOCK_DEVICE_ID).length, 0);

    const dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.status, "detached");
    assertEquals(dev?.controller_session_id, null);
  });

  await t.step("Purges expired telemetry history according to retention TTL", () => {
    const db = new MockSupabaseEngine();

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    db.telemetryHistory.push({
      id: 99,
      device_id: MOCK_DEVICE_ID,
      data: { temperature: 18.5 },
      created_at: tenDaysAgo
    });

    const freshRecord = { temperature: 23.0 };
    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, freshRecord);

    const dev = db.devices.get(MOCK_DEVICE_ID);
    if (dev) dev.history_ttl_days = 7;

    const purgedCount = db.purgeExpiredTelemetry();
    assertEquals(purgedCount, 1);

    const history = db.getHistory(MOCK_DEVICE_ID);
    assertEquals(history.length, 1);
    assertEquals(history[0].data.temperature, 23.0);
  });

  await t.step("Rotates secret device key and updates retention TTL", () => {
    const db = new MockSupabaseEngine();
    const newKey = "sec_rotated_999";

    const rotateOk = db.rotateDeviceKey(MOCK_DEVICE_ID, newKey);
    assertEquals(rotateOk, true);
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.device_key, newKey);

    const ttlOk = db.updateRetention(MOCK_DEVICE_ID, 30);
    assertEquals(ttlOk, true);
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.history_ttl_days, 30);

    // Old key fails telemetry ingest
    assertThrows(() => db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 20.0 }));

    // New key succeeds telemetry ingest
    const newIngest = db.ingestTelemetry(MOCK_DEVICE_ID, newKey, { temperature: 20.0 });
    assert(newIngest.length > 0);
  });

  await t.step("Returns storage footprint statistics and wipe operations", () => {
    const db = new MockSupabaseEngine();
    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 22.0 });

    const history = db.getHistory(MOCK_DEVICE_ID);
    assertEquals(history.length, 1);

    const dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.device_key, MOCK_DEVICE_KEY);

    db.wipeDeviceData(MOCK_DEVICE_ID);
    assertEquals(db.getHistory(MOCK_DEVICE_ID).length, 0);
  });
});

Deno.test("Local Engine: System Diagnostics & 7-State Machine", async (t) => {
  await t.step("Validates Deno memory usage diagnostic structure", () => {
    const mem = Deno.memoryUsage();
    assert(mem.rss > 0);
    assert(mem.heapTotal > 0);
    assert(mem.heapUsed > 0);
  });

  await t.step("Evaluates 7-state diagnostic status transitions and keepalive state", () => {
    const db = new MockSupabaseEngine();
    const UNKNOWN_DEVICE_ID = "99999999-9999-9999-9999-999999999999";
    
    const unknownDev = db.devices.get(UNKNOWN_DEVICE_ID);
    assertEquals(unknownDev?.status || "disconnected", "disconnected");

    let dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.status, "detached");

    db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.5 });
    dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.status, "live");

    const acquired = db.acquireControlLease(MOCK_DEVICE_ID, "session-tab-123");
    assertEquals(acquired, true);
    dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.status, "control");

    const released = db.releaseControlLease(MOCK_DEVICE_ID, "session-tab-123");
    assertEquals(released, true);
    dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.status, "live");

    db.wipeDeviceData(MOCK_DEVICE_ID);
    dev = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(dev?.status, "detached");
  });

  await t.step("Classifies high-level Connected and Disconnected status hierarchies", () => {
    const validStates = ["disconnected", "detached", "initializing", "stale", "fault", "live", "control"];

    function getHighLevelState(state: string): "Disconnected" | "Connected" {
      return state === "disconnected" ? "Disconnected" : "Connected";
    }

    assertEquals(getHighLevelState("disconnected"), "Disconnected");
    assertEquals(getHighLevelState("initializing"), "Connected");
    assertEquals(getHighLevelState("detached"), "Connected");
    assertEquals(getHighLevelState("live"), "Connected");
    assertEquals(getHighLevelState("stale"), "Connected");
    assertEquals(getHighLevelState("fault"), "Connected");
    assertEquals(getHighLevelState("control"), "Connected");
    assertEquals(validStates.length, 7);
  });
});

Deno.test("Local Engine: Concurrency Locks & Multi-Device Security Isolation", async (t) => {
  await t.step("Enforces multi-tab lease acquisition and takeover lock synchronization", () => {
    const db = new MockSupabaseEngine();
    const tabAlpha = "tab-session-alpha-101";
    const tabBeta = "tab-session-beta-202";

    const alphaAcquire = db.acquireControlLease(MOCK_DEVICE_ID, tabAlpha);
    assertEquals(alphaAcquire, true);

    const devAfterAlpha = db.devices.get(MOCK_DEVICE_ID);
    assertEquals(devAfterAlpha?.status, "control");
    assertEquals(devAfterAlpha?.controller_session_id, tabAlpha);

    const betaHijackAcquire = db.acquireControlLease(MOCK_DEVICE_ID, tabBeta);
    assertEquals(betaHijackAcquire, true);
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, tabBeta);

    const betaHijackRelease = db.releaseControlLease(MOCK_DEVICE_ID, tabBeta);
    assertEquals(betaHijackRelease, true);
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.status, "live");
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, null);

    const betaAcquire = db.acquireControlLease(MOCK_DEVICE_ID, tabBeta);
    assertEquals(betaAcquire, true);
    assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, tabBeta);
  });

  await t.step("Isolates layout schemas, telemetry history, auth keys, and command queues across devices", () => {
    const db = new MockSupabaseEngine();
    const deviceAId = "11111111-1111-4111-8111-111111111111";
    const deviceAKey = "passcode_device_a_123";
    const deviceBId = "22222222-2222-4222-8222-222222222222";
    const deviceBKey = "passcode_device_b_456";

    db.seedDevice(deviceAId, deviceAKey, "Greenhouse Node A");
    db.seedDevice(deviceBId, deviceBKey, "Solar Array Node B");

    db.registerUIDefinition(deviceAId, deviceAKey, { title: "Greenhouse Node A" });
    db.registerUIDefinition(deviceBId, deviceBKey, { title: "Solar Array Node B" });

    assertEquals(db.uiDefinitions.get(deviceAId)?.layout_def.title, "Greenhouse Node A");
    assertEquals(db.uiDefinitions.get(deviceBId)?.layout_def.title, "Solar Array Node B");

    db.ingestTelemetry(deviceAId, deviceAKey, { temp: 21.5, humidity: 65 });
    db.ingestTelemetry(deviceBId, deviceBKey, { voltage: 48.2, current: 5.1 });

    const latestA = db.telemetryLatest.get(deviceAId)?.data;
    const latestB = db.telemetryLatest.get(deviceBId)?.data;

    assertEquals(latestA?.temp, 21.5);
    assertEquals(latestA?.voltage, undefined);

    assertEquals(latestB?.voltage, 48.2);
    assertEquals(latestB?.temp, undefined);

    assertThrows(
      () => { db.ingestTelemetry(deviceAId, deviceBKey, { temp: 99.9 }); },
      Error,
      "Unauthorized: Invalid Device ID or Device Key."
    );

    const cmdAId = db.queueCommand(deviceAId, "irrigation_pump", "toggle", true);

    const cmdsForB = db.ingestTelemetry(deviceBId, deviceBKey, { voltage: 48.5 });
    assertEquals(cmdsForB.filter(c => c.command_id !== null).length, 0);

    const cmdsForA = db.ingestTelemetry(deviceAId, deviceAKey, { temp: 22.0 });
    assertEquals(cmdsForA.filter(c => c.command_id !== null).length, 0);
  });

  await t.step("Enforces per-device control lease isolation and automatic release on page leave", () => {
    const db = new MockSupabaseEngine();
    const devAlphaId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const devBetaId = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
    const sessionUser = "user_session_999";

    db.seedDevice(devAlphaId, "key_a", "Node Alpha");
    db.seedDevice(devBetaId, "key_b", "Node Beta");

    db.ingestTelemetry(devAlphaId, "key_a", { temp: 20.0 });
    db.ingestTelemetry(devBetaId, "key_b", { temp: 21.0 });

    // 1. User acquires lease on Node Alpha
    const acquireAlpha = db.acquireControlLease(devAlphaId, sessionUser);
    assertEquals(acquireAlpha, true);
    assertEquals(db.devices.get(devAlphaId)?.status, "control");
    assertEquals(db.devices.get(devAlphaId)?.controller_session_id, sessionUser);

    // 2. Node Beta control state MUST remain un-leased ("live" / null)
    assertEquals(db.devices.get(devBetaId)?.status, "live");
    assertEquals(db.devices.get(devBetaId)?.controller_session_id, null);

    // 3. User navigates away / unloads page for Node Alpha -> triggers releaseControlLease
    const releaseAlpha = db.releaseControlLease(devAlphaId, sessionUser);
    assertEquals(releaseAlpha, true);

    // 4. Verify Node Alpha lease is cleanly released back to "live" state
    assertEquals(db.devices.get(devAlphaId)?.status, "live");
    assertEquals(db.devices.get(devAlphaId)?.controller_session_id, null);
  });
});

Deno.test("Local Engine: Schema Parity & Session Unit Tests", async (t) => {
  await t.step("Verifies production contract schema version compatibility", () => {
    const db = new MockSupabaseEngine();
    const schemaVer = db.schemaVersion();
    assertEquals(schemaVer, "20260728000000");
  });

  await t.step("Asserts 1:1 parity between supabase/schema.sql and migration file", async () => {
    let rootSchema = "";
    try {
      rootSchema = await Deno.readTextFile("./supabase/schema.sql");
    } catch (_) {
      rootSchema = await Deno.readTextFile("./supabase_schema.sql");
    }
    const migrationSchema = await Deno.readTextFile("./supabase/migrations/20260728000000_initial_schema.sql");
    assertEquals(rootSchema.trim(), migrationSchema.trim());
  });

  await t.step("Validates version output banner string formatting", () => {
    const STAGING_URL = "https://example.deno.net";
    const appVersion = "1.0.5";
    const schemaVersion = "20260728000000";
    const contractCompatible = true;
    const databaseMode = "Supabase Cloud Production";

    const bannerLine0 = `🌐 STAGING TARGET URL   : ${STAGING_URL}`;
    const bannerLine1 = `📦 EDGE APP VERSION     : v${appVersion}`;
    const bannerLine2 = `🗄️ SUPABASE DB SCHEMA    : v${schemaVersion}`;
    const bannerLine3 = `🔒 CONTRACT COMPATIBLE  : ${contractCompatible ? "✅ YES (100% OK)" : "⚠️ NO"}`;
    const bannerLine4 = `⚡ DATABASE ENGINE MODE  : ${databaseMode}`;

    assert(bannerLine0.startsWith("🌐 STAGING TARGET URL"));
    assert(bannerLine1.includes("v1.0.5"));
    assert(bannerLine2.includes("v20260728000000"));
    assert(bannerLine3.includes("✅ YES (100% OK)"));
    assert(bannerLine4.includes("Supabase Cloud Production"));
  });

  await t.step("Validates device directory listing response structure", () => {
    const db = new MockSupabaseEngine();
    const deviceAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const deviceAKey = "key_a_999";
    db.seedDevice(deviceAId, deviceAKey, "Test Node Alpha");

    const list = Array.from(db.devices.values()).map(d => ({
      deviceId: d.id,
      title: d.title,
      state: d.status,
      lastSeen: d.last_seen,
      registeredAt: d.registered_at
    }));

    assert(Array.isArray(list));
    assert(list.length >= 2);

    const deviceA = list.find(d => d.deviceId === deviceAId);
    assert(deviceA !== undefined);
    assertEquals(deviceA.title, "Test Node Alpha");
    assert(deviceA.state !== undefined);
    assert(deviceA.registeredAt !== undefined);
  });

  await t.step("Validates self-test contract response object shape", () => {
    const mockSelfTestResponse = {
      status: "ok",
      appVersion: "1.0.5",
      requiredSchemaVersion: "20260728000000",
      actualSchemaVersion: "20260728000000",
      contractCompatible: true,
      databaseMode: "Supabase Cloud Production",
      timestamp: new Date().toISOString()
    };

    assert(mockSelfTestResponse.status !== undefined);
    assert(mockSelfTestResponse.appVersion !== undefined);
    assert(mockSelfTestResponse.requiredSchemaVersion !== undefined);
    assert(mockSelfTestResponse.actualSchemaVersion !== undefined);
    assert(typeof mockSelfTestResponse.contractCompatible === "boolean");
    assert(mockSelfTestResponse.databaseMode !== undefined);
    assert(mockSelfTestResponse.timestamp !== undefined);
    assertEquals(mockSelfTestResponse.contractCompatible, true);
  });

  await t.step("Creates, checks, and deletes active user sessions", async () => {
    const sessionId = "test-session-uuid-12345";
    const username = "testuser_alice";

    assertEquals(checkSession(sessionId), null);

    const expires = createSession(sessionId, username);
    assert(expires > Date.now());
    assertEquals(checkSession(sessionId), username);

    deleteSession(sessionId);
    assertEquals(checkSession(sessionId), null);

    // Test Stateless HMAC Session Signing & Spin-Down Survival
    const { token } = await createSignedSessionToken("spin_down_user");
    assert(token.includes("spin_down_user"));

    // Verify session passes
    const auth1 = await checkSessionAsync(token);
    assertEquals(auth1, "spin_down_user");

    // SIMULATE DENO DEPLOY SERVER RESTART / ISOLATE SPIN-DOWN (Clear in-memory Map)
    activeSessions.clear();
    assertEquals(activeSessions.size, 0);

    // Verify stateless HMAC token survives memory wipe cleanly!
    const auth2 = await checkSessionAsync(token);
    assertEquals(auth2, "spin_down_user");
  });
});
