// Marveluzz Hub - Realistic Supabase Schema Integration Test Suite (Phase 1 Complete)
import { assertEquals, assert, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { MockSupabaseEngine } from "./supabase_mock.ts";

const MOCK_DEVICE_ID = "32323232-3232-4232-8232-28c13340c86c";
const MOCK_DEVICE_KEY = "secret_passcode_123";

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

  // Client Tab A acquires lease
  const acquireSuccess = db.acquireControlLease(MOCK_DEVICE_ID, sessionTabA);
  assertEquals(acquireSuccess, true);

  const devAfterAcquire = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(devAfterAcquire?.status, "control");
  assertEquals(devAfterAcquire?.controller_session_id, sessionTabA);

  // Client Tab B attempts release (should fail because lease is held by Tab A)
  const releaseByWrongTab = db.releaseControlLease(MOCK_DEVICE_ID, sessionTabB);
  assertEquals(releaseByWrongTab, false);

  // Client Tab A releases lease
  const releaseSuccess = db.releaseControlLease(MOCK_DEVICE_ID, sessionTabA);
  assertEquals(releaseSuccess, true);

  const devAfterRelease = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(devAfterRelease?.status, "live");
  assertEquals(devAfterRelease?.controller_session_id, null);
});

Deno.test("Phase 1 RPC Test: Wipe Device Storage Data RPC", () => {
  const db = new MockSupabaseEngine();

  // Populate data
  db.registerUIDefinition(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { title: "Test Node" });
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 26.5 });
  db.queueCommand(MOCK_DEVICE_ID, "relay_1", "toggle", true);

  // Verify records exist
  assert(db.uiDefinitions.has(MOCK_DEVICE_ID));
  assert(db.telemetryLatest.has(MOCK_DEVICE_ID));
  assert(db.telemetryHistory.length > 0);

  // Execute wipe
  const wipeSuccess = db.wipeDeviceData(MOCK_DEVICE_ID);
  assertEquals(wipeSuccess, true);

  // Verify records are wiped
  assert(!db.uiDefinitions.has(MOCK_DEVICE_ID));
  assert(!db.telemetryLatest.has(MOCK_DEVICE_ID));
  assertEquals(db.getHistory(MOCK_DEVICE_ID).length, 0);

  const dev = db.devices.get(MOCK_DEVICE_ID);
  assertEquals(dev?.status, "detached");
  assertEquals(dev?.controller_session_id, null);
});

Deno.test("Phase 1 RPC Test: History Retention TTL Cleanup", () => {
  const db = new MockSupabaseEngine();

  // Inject old telemetry record (10 days old)
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  db.telemetryHistory.push({
    id: 99,
    device_id: MOCK_DEVICE_ID,
    data: { temperature: 18.5 },
    created_at: tenDaysAgo
  });

  // Inject fresh telemetry record (1 hour old)
  const freshRecord = { temperature: 23.0 };
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, freshRecord);

  // Set TTL retention to 7 days and run purge
  const dev = db.devices.get(MOCK_DEVICE_ID);
  if (dev) dev.history_ttl_days = 7;

  const purgedCount = db.purgeExpiredTelemetry();
  assertEquals(purgedCount, 1); // 1 old record purged

  const history = db.getHistory(MOCK_DEVICE_ID);
  assertEquals(history.length, 1);
  assertEquals(history[0].data.temperature, 23.0);
});
