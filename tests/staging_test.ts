// Marveluzz Hub - Live Staging Integration Test Suite
// Verifies live endpoints against a Staging Environment (Supabase Cloud + Deno Deploy)

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";

const STAGING_URL = Deno.env.get("STAGING_URL") || "http://localhost:8000";
const TEST_DEVICE_ID = "99999999-9999-4999-8999-999999999999";
const TEST_DEVICE_KEY = "staging_secret_key_999";

Deno.test("Staging Verification 1: Health & Diagnostics API Check", async () => {
  const res = await fetch(`${STAGING_URL}/api/debug/memory`);
  assertEquals(res.status, 200);

  const json = await res.json();
  assert(json.memory !== undefined);
  assert(json.uptimeSeconds >= 0);
  console.log(`✅ Staging Health Check Passed. Mode: ${json.mode}, Uptime: ${json.uptimeSeconds}s`);
});

Deno.test("Staging Verification 2: Register Dynamic UI Layout", async () => {
  const layoutDef = {
    title: "Staging Test Sensor Node",
    type: "layout",
    layout: [{ type: "number", properties: { label: "Temperature", id: "temp" } }]
  };

  const res = await fetch(`${STAGING_URL}/api/device/ui_definition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: TEST_DEVICE_ID,
      deviceKey: TEST_DEVICE_KEY,
      layoutDef
    })
  });

  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  console.log("✅ Staging UI Definition Registered Successfully.");
});

Deno.test("Staging Verification 3: Telemetry Ingest & Command Retrieval", async () => {
  const res = await fetch(`${STAGING_URL}/api/device/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: TEST_DEVICE_ID,
      deviceKey: TEST_DEVICE_KEY,
      data: { temperature: 23.4, humidity: 45.2 }
    })
  });

  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  assert(Array.isArray(json.commands));
  console.log("✅ Staging Telemetry Ingest Passed.");
});

Deno.test("Staging Verification 4: Device Directory Listing", async () => {
  const res = await fetch(`${STAGING_URL}/api/devices`);
  assertEquals(res.status, 200);

  const list = await res.json();
  assert(Array.isArray(list));
  console.log(`✅ Staging Directory Listing Passed. Found ${list.length} registered devices.`);
});

Deno.test("Staging Verification 5: Device Storage Stats Metric", async () => {
  const res = await fetch(`${STAGING_URL}/api/devices/stats?device_id=${TEST_DEVICE_ID}`);
  assertEquals(res.status, 200);

  const stats = await res.json();
  assertEquals(stats.deviceId, TEST_DEVICE_ID);
  console.log("✅ Staging Storage Footprint Stats Passed.");
});
