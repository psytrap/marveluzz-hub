// Marveluzz Hub - Realistic Supabase Schema Integration Test Suite
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

  // Ingest first packet
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.2, uptime: "10s" });
  // Ingest second packet
  db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 24.8, uptime: "20s" });

  const latest = db.telemetryLatest.get(MOCK_DEVICE_ID);
  assertEquals(latest?.data.temperature, 24.8);

  const history = db.getHistory(MOCK_DEVICE_ID, 50);
  assertEquals(history.length, 2);
  assertEquals(history[0].data.temperature, 24.8); // Reverse sorted by created_at DESC
});

Deno.test("Supabase Schema Integration: Command Queue Dispatch via Ingest RPC", () => {
  const db = new MockSupabaseEngine();

  // Web Client queues a command
  const cmdId = db.queueCommand(MOCK_DEVICE_ID, "fan_toggle", "set_value", true);

  // Ingest telemetry should return and mark command as executed
  const executedCmds = db.ingestTelemetry(MOCK_DEVICE_ID, MOCK_DEVICE_KEY, { temperature: 25.1 });

  assertEquals(executedCmds.length, 1);
  assertEquals(executedCmds[0].command_id, cmdId);
  assertEquals(executedCmds[0].target, "fan_toggle");
  assertEquals(executedCmds[0].value, true);

  const cmdRecord = db.deviceCommands.get(cmdId);
  assertEquals(cmdRecord?.status, "executed");
});
