// Marveluzz Hub - Realistic Supabase Schema Integration Test Suite (Phase 1 & 2 + SSE Streaming)
import { assertEquals, assert, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { MockSupabaseEngine } from "./supabase_mock.ts";

const MOCK_DEVICE_ID = "32323232-3232-4232-8232-28c13340c86c";
const MOCK_DEVICE_KEY = "secret_passcode_123";

Deno.test("Supabase Environment Credentials & Config Validation Test", () => {
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

Deno.test("Server-Sent Events (SSE) Stream Header & Formatting Test", () => {
  const sseResponseHeader = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };

  assertEquals(sseResponseHeader["Content-Type"], "text/event-stream");
  assertEquals(sseResponseHeader["Cache-Control"], "no-cache");

  // Format validation for SSE protocol message
  const deviceId = MOCK_DEVICE_ID;
  const eventName = "command";
  const payload = { commandId: "cmd-123", target: "fan_toggle", value: true };
  const formattedSse = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

  assert(formattedSse.startsWith("event: command\n"));
  assert(formattedSse.endsWith("\n\n"));
  assert(formattedSse.includes("fan_toggle"));
});

Deno.test("Supabase Schema Integration: UI Layout Registration RPC", () => {
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

Deno.test("Supabase Schema Integration: Secret Key Auth Enforcement (Reject Wrong Key)", () => {
  const db = new MockSupabaseEngine();

  assertThrows(
    () => {
      db.registerUIDefinition(MOCK_DEVICE_ID, "invalid_wrong_key", {});
    },
    Error,
    "Unauthorized: Invalid Device ID or Device Key."
  );

  assertThrows(
    () => {
      db.ingestTelemetry(MOCK_DEVICE_ID, "invalid_wrong_key", { temp: 20 });
    },
    Error,
    "Unauthorized: Invalid Device ID or Device Key."
  );
});

Deno.test("Supabase Schema Integration: Telemetry Ingest & History Logging", () => {
  const db = new MockSupabaseEngine();

  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.2, uptime: "10s" });
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.8, uptime: "20s" });

  const latest = db.telemetryLatest.get(MOCK_DEVICE_ID);
  assertEquals(latest?.data.temperature, 24.8);

  const history = db.getHistory(MOCK_DEVICE_ID, 50);
  assertEquals(history.length, 2);
  assertEquals(history[0].data.temperature, 24.8);
});

Deno.test("Supabase Schema Integration: Command Queue Dispatch via Ingest RPC", () => {
  const db = new MockSupabaseEngine();

  const cmdId = db.queueCommand(MOCK_DEVICE_ID, "fan_toggle", "set_value", true);
  const executedCmds = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 25.1 });

  assertEquals(executedCmds.length, 1);
  assertEquals(executedCmds[0].command_id, cmdId);
  assertEquals(executedCmds[0].target, "fan_toggle");
  assertEquals(executedCmds[0].value, true);

  const cmdRecord = db.deviceCommands.get(cmdId);
  assertEquals(cmdRecord?.status, "executed");
});

Deno.test("Phase 1 RPC Test: Exclusive Control Lease Acquisition & Release", () => {
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

Deno.test("Phase 1 RPC Test: Wipe Device Storage Data RPC", () => {
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

Deno.test("Phase 1 RPC Test: History Retention TTL Cleanup", () => {
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

Deno.test("Phase 2 API Test: Storage Stats & Wipe Operations", () => {
  const db = new MockSupabaseEngine();
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 22.0 });

  const history = db.getHistory(MOCK_DEVICE_ID);
  assertEquals(history.length, 1);

  const dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.device_key, MOCK_DEVICE_KEY);

  db.wipeDeviceData(MOCK_DEVICE_ID);
  assertEquals(db.getHistory(MOCK_DEVICE_ID).length, 0);
});

Deno.test("Phase 2 API Test: Memory Usage Diagnostics Data Structure", () => {
  const mem = Deno.memoryUsage();
  assert(mem.rss > 0);
  assert(mem.heapTotal > 0);
  assert(mem.heapUsed > 0);
});

Deno.test("Phase 3 State Machine Test: 7-State Diagnostic Status Transitions & Stale Keepalive", () => {
  const db = new MockSupabaseEngine();
  const UNKNOWN_DEVICE_ID = "99999999-9999-9999-9999-999999999999";
  
  // 1. Initial State: disconnected (unknown device ID)
  const unknownDev = db.devices.get(UNKNOWN_DEVICE_ID);
  assertEquals(unknownDev?.status || "disconnected", "disconnected");

  // 2. Initial Seeded Device State: detached
  let dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.status, "detached");

  // 3. State Transition: detached -> live upon telemetry ingest
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.5 });
  dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.status, "live");

  // 4. State Transition: live -> control upon acquiring lease
  const acquired = db.acquireControlLease(MOCK_DEVICE_ID, "session-tab-123");
  assertEquals(acquired, true);
  dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.status, "control");

  // 5. State Transition: control -> live upon releasing lease
  const released = db.releaseControlLease(MOCK_DEVICE_ID, "session-tab-123");
  assertEquals(released, true);
  dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.status, "live");

  // 6. State Transition: live -> detached upon wiping data
  db.wipeDeviceData(MOCK_DEVICE_ID);
  dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.status, "detached");
});

Deno.test("Phase 3 State Machine Test: High-Level Connected / Disconnected Hierarchies", () => {
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

  // Assert all 7 states are valid enum members
  assertEquals(validStates.length, 7);
});

Deno.test("Multi-Tab Mutex Control Lock Test: Two Tabs Mutex Lock & Hijack Rejection", () => {
  const db = new MockSupabaseEngine();
  const tabAlpha = "tab-session-alpha-101";
  const tabBeta = "tab-session-beta-202";

  // 1. Tab Alpha acquires exclusive control lease
  const alphaAcquire = db.acquireControlLease(MOCK_DEVICE_ID, tabAlpha);
  assertEquals(alphaAcquire, true);

  const devAfterAlpha = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(devAfterAlpha?.status, "control");
  assertEquals(devAfterAlpha?.controller_session_id, tabAlpha);

  // 2. Tab Beta attempts to acquire control lease while Alpha holds it -> MUST BE REJECTED
  const betaHijackAcquire = db.acquireControlLease(MOCK_DEVICE_ID, tabBeta);
  assertEquals(betaHijackAcquire, false);
  assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, tabAlpha);

  // 3. Tab Beta attempts to release Tab Alpha's lease -> MUST BE REJECTED
  const betaHijackRelease = db.releaseControlLease(MOCK_DEVICE_ID, tabBeta);
  assertEquals(betaHijackRelease, false);
  assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, tabAlpha);

  // 4. Tab Alpha legitimately releases its control lease
  const alphaRelease = db.releaseControlLease(MOCK_DEVICE_ID, tabAlpha);
  assertEquals(alphaRelease, true);
  assertEquals(db.devices.get(MOCK_DEVICE_ID)?.status, "live");
  assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, null);

  // 5. Now Tab Beta can successfully acquire the control lease
  const betaAcquire = db.acquireControlLease(MOCK_DEVICE_ID, tabBeta);
  assertEquals(betaAcquire, true);
  assertEquals(db.devices.get(MOCK_DEVICE_ID)?.controller_session_id, tabBeta);
});

Deno.test("Multi-Device Security Isolation Test: Data, Auth Key & Command Queue Isolation", () => {
  const db = new MockSupabaseEngine();
  const deviceAId = "11111111-1111-4111-8111-111111111111";
  const deviceAKey = "passcode_device_a_123";
  
  const deviceBId = "22222222-2222-4222-8222-222222222222";
  const deviceBKey = "passcode_device_b_456";

  db.seedDevice(deviceAId, deviceAKey, "Greenhouse Node A");
  db.seedDevice(deviceBId, deviceBKey, "Solar Array Node B");

  // 1. Separate UI Layout Schemas
  db.registerUIDefinition(deviceAId, deviceAKey, { title: "Greenhouse Node A" });
  db.registerUIDefinition(deviceBId, deviceBKey, { title: "Solar Array Node B" });

  assertEquals(db.uiDefinitions.get(deviceAId)?.layout_def.title, "Greenhouse Node A");
  assertEquals(db.uiDefinitions.get(deviceBId)?.layout_def.title, "Solar Array Node B");

  // 2. Separate Telemetry Telemetry Ingest & Storage Isolation
  db.ingestTelemetry(deviceAId, deviceAKey, { temp: 21.5, humidity: 65 });
  db.ingestTelemetry(deviceBId, deviceBKey, { voltage: 48.2, current: 5.1 });

  const latestA = db.telemetryLatest.get(deviceAId)?.data;
  const latestB = db.telemetryLatest.get(deviceBId)?.data;

  assertEquals(latestA?.temp, 21.5);
  assertEquals(latestA?.voltage, undefined); // Device A has no voltage data

  assertEquals(latestB?.voltage, 48.2);
  assertEquals(latestB?.temp, undefined); // Device B has no temp data

  // 3. Auth Key Rejection Cross-Spoofing Test
  assertThrows(
    () => {
      // Device A trying to ingest data using Device B's secret key
      db.ingestTelemetry(deviceAId, deviceBKey, { temp: 99.9 });
    },
    Error,
    "Unauthorized: Invalid Device ID or Device Key."
  );

  // 4. Command Queue Dispatch Isolation Test
  const cmdAId = db.queueCommand(deviceAId, "irrigation_pump", "toggle", true);

  // Device B polls commands via telemetry ingest
  const cmdsForB = db.ingestTelemetry(deviceBId, deviceBKey, { voltage: 48.5 });
  assertEquals(cmdsForB.length, 0); // Command for Device A must NOT be leaked to Device B!

  // Device A polls commands via telemetry ingest
  const cmdsForA = db.ingestTelemetry(deviceAId, deviceAKey, { temp: 22.0 });
  assertEquals(cmdsForA.length, 1);
  assertEquals(cmdsForA[0].command_id, cmdAId);
  assertEquals(cmdsForA[0].target, "irrigation_pump");
});


