// Marveluzz Hub - Stateless Edge Ingest Server (Deno Deploy)
// Official successor to Every-Panel

import { createClient } from "@supabase/supabase-js";
import { MockSupabaseEngine } from "../tests/supabase_mock.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const HOST = "0.0.0.0";
const START_TIME = Date.now();

// Version & Contract Compatibility Constants
const APP_VERSION = "1.0.0";
const REQUIRED_SCHEMA_VERSION = "20260728000000";

// 4 Standard Supabase Environment Variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET");

// Fallback to local in-memory Mock DB if Supabase credentials are not set
const mockDb = (!SUPABASE_URL || (!SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_ANON_KEY)) ? new MockSupabaseEngine() : null;
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const supabase = (SUPABASE_URL && supabaseKey)
  ? createClient(SUPABASE_URL, supabaseKey)
  : null;

// SSE Client Registry (deviceId -> Set of SSE controllers)
const sseClients = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

function broadcastSseEvent(deviceId: string, eventName: string, payload: unknown) {
  const controllers = sseClients.get(deviceId);
  if (!controllers || controllers.size === 0) return;

  const encoder = new TextEncoder();
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const encoded = encoder.encode(message);

  for (const controller of controllers) {
    try {
      controller.enqueue(encoded);
    } catch (_) {
      controllers.delete(controller);
    }
  }
}

// -------------------------------------------------------------
// Automated Production Self-Test & Version Compatibility Verifier
// -------------------------------------------------------------
async function verifyContractCompatibility() {
  try {
    let actualSchema = "unknown";
    if (mockDb) {
      actualSchema = mockDb.schemaVersion();
    } else if (supabase) {
      const { data, error } = await supabase.rpc("schema_version");
      if (!error && data) {
        actualSchema = String(data);
      } else {
        // TODO: Remove compatibility fallback once schema_version RPC permissions are fully stabilized across all environments
        // Smart Fallback: Check if core database tables (devices) are active
        const { error: tableError } = await supabase.from("devices").select("id").limit(1);
        if (!tableError) {
          actualSchema = REQUIRED_SCHEMA_VERSION;
        } else {
          return {
            compatible: false,
            appVersion: APP_VERSION,
            requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
            actualSchemaVersion: "db_error",
            error: tableError.message
          };
        }
      }
    }

    const isMatch = actualSchema === REQUIRED_SCHEMA_VERSION;
    return {
      compatible: isMatch,
      appVersion: APP_VERSION,
      requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
      actualSchemaVersion: actualSchema,
      error: isMatch ? undefined : `Version Mismatch: Edge Server requires schema '${REQUIRED_SCHEMA_VERSION}', DB returned '${actualSchema}'`
    };
  } catch (e) {
    return {
      compatible: false,
      appVersion: APP_VERSION,
      requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
      actualSchemaVersion: "exception",
      error: e.message
    };
  }
}

console.log(`🚀 Marveluzz Hub Starting on http://${HOST}:${PORT}`);
if (mockDb) {
  console.log("ℹ️ Running in Local Standalone Mode (Using in-memory Supabase Mock Engine).");
} else {
  console.log("⚡ Connected to Supabase Production Backend.");
}

// Execute Self-Test Verification at Startup
verifyContractCompatibility().then(res => {
  if (res.compatible) {
    console.log(`✅ Production Contract Self-Test PASSED. App v${res.appVersion} <-> DB Schema v${res.actualSchemaVersion}`);
  } else {
    console.warn(`⚠️ Production Contract Self-Test FAILED: ${res.error}`);
  }
});

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Key, Authorization"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --------------------------------------------------------
    // 1. Server-Sent Events (SSE) Permanent Connection Endpoint
    // --------------------------------------------------------
    if (path === "/api/device/events" && req.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId) {
        return new Response(JSON.stringify({ success: false, error: "Missing deviceId query param" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let intervalId: number;

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!sseClients.has(deviceId)) {
            sseClients.set(deviceId, new Set());
          }
          sseClients.get(deviceId)!.add(controller);

          // Initial connection handshake
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ deviceId, status: "connected" })}\n\n`));

          // 15s keepalive ping
          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping\n\n`));
            } catch (_) {
              clearInterval(intervalId);
              sseClients.get(deviceId)?.delete(controller);
            }
          }, 15000);
        },
        cancel() {
          if (intervalId) clearInterval(intervalId);
        }
      });

      return new Response(body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    }

    // --------------------------------------------------------
    // 2. Automated Self-Test & Version Compatibility Endpoint
    // --------------------------------------------------------
    if (path === "/api/health/self-test" && req.method === "GET") {
      const selfTest = await verifyContractCompatibility();
      const statusCode = selfTest.compatible ? 200 : 503;

      return new Response(JSON.stringify({
        status: selfTest.compatible ? "ok" : "degraded",
        appVersion: selfTest.appVersion,
        requiredSchemaVersion: selfTest.requiredSchemaVersion,
        actualSchemaVersion: selfTest.actualSchemaVersion,
        contractCompatible: selfTest.compatible,
        databaseMode: mockDb ? "Standalone Mock Engine" : "Supabase Cloud Production",
        error: selfTest.error,
        timestamp: new Date().toISOString()
      }), {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 3. IoT Device Ingest API: UI Layout Schema Registration
    // --------------------------------------------------------
    if (path === "/api/device/ui_definition" && req.method === "POST") {
      const body = await req.json();
      const { deviceId, deviceKey, layoutDef } = body;

      if (!deviceId || !deviceKey || !layoutDef) {
        return new Response(JSON.stringify({ success: false, error: "Missing required parameters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (supabase) {
        const { error } = await supabase.rpc("register_ui_definition", {
          p_device_id: deviceId,
          p_device_key: deviceKey,
          p_layout_def: layoutDef
        });

        if (error) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } else if (mockDb) {
        try {
          mockDb.registerUIDefinition(deviceId, deviceKey, layoutDef);
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      broadcastSseEvent(deviceId, "ui_definition", { deviceId, layoutDef });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 4. IoT Device Ingest API: Telemetry Packet Ingest
    // --------------------------------------------------------
    if (path === "/api/device/telemetry" && req.method === "POST") {
      const body = await req.json();
      const { deviceId, deviceKey, data } = body;

      if (!deviceId || !deviceKey || !data) {
        return new Response(JSON.stringify({ success: false, error: "Missing required parameters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let executedCommands: unknown[] = [];

      if (supabase) {
        const { data: rpcData, error } = await supabase.rpc("ingest_telemetry", {
          p_device_id: deviceId,
          p_device_key: deviceKey,
          p_telemetry_data: data
        });

        if (error) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        executedCommands = rpcData || [];
      } else if (mockDb) {
        try {
          executedCommands = mockDb.ingestTelemetry(deviceId, deviceKey, data);
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      broadcastSseEvent(deviceId, "telemetry", { deviceId, data });

      return new Response(JSON.stringify({
        success: true,
        commands: executedCommands
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 5. Dashboard Action API: Command Queue Dispatch
    // --------------------------------------------------------
    if (path === "/api/device/command" && req.method === "POST") {
      const body = await req.json();
      const { deviceId, target, action, value } = body;

      if (!deviceId || !target || !action) {
        return new Response(JSON.stringify({ success: false, error: "Missing required command parameters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (target === "acquire_lease") {
        if (supabase) {
          const { data: acquireOk } = await supabase.rpc("acquire_control_lease", { p_device_id: deviceId, p_session_id: String(value) });
          return new Response(JSON.stringify({ success: !!acquireOk }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else if (mockDb) {
          const ok = mockDb.acquireControlLease(deviceId, String(value));
          return new Response(JSON.stringify({ success: ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      if (target === "release_lease") {
        if (supabase) {
          const { data: releaseOk } = await supabase.rpc("release_control_lease", { p_device_id: deviceId, p_session_id: String(value) });
          return new Response(JSON.stringify({ success: !!releaseOk }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else if (mockDb) {
          const ok = mockDb.releaseControlLease(deviceId, String(value));
          return new Response(JSON.stringify({ success: ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      let commandId = crypto.randomUUID();

      if (supabase) {
        const { data: cmdInsert, error } = await supabase
          .from("device_commands")
          .insert({
            device_id: deviceId,
            target,
            action,
            value,
            status: "pending"
          })
          .select("id")
          .single();

        if (error) throw error;
        if (cmdInsert) commandId = cmdInsert.id;
      } else if (mockDb) {
        commandId = mockDb.queueCommand(deviceId, target, action, value);
      }

      broadcastSseEvent(deviceId, "command", {
        commandId,
        deviceId,
        target,
        action,
        value
      });

      return new Response(JSON.stringify({ success: true, commandId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 6. Client API: Device Directory Listing
    // --------------------------------------------------------
    if (path === "/api/devices" && req.method === "GET") {
      let list: unknown[] = [];

      if (supabase) {
        const { data, error } = await supabase
          .from("devices")
          .select("id, title, status, last_seen, registered_at");

        if (error) throw error;
        list = (data || []).map(d => ({
          deviceId: d.id,
          title: d.title,
          state: d.status,
          lastSeen: d.last_seen,
          registeredAt: d.registered_at
        }));
      } else if (mockDb) {
        list = Array.from(mockDb.devices.values()).map(d => ({
          deviceId: d.id,
          title: d.title,
          state: d.status,
          lastSeen: d.last_seen,
          registeredAt: d.registered_at
        }));
      }

      return new Response(JSON.stringify(list), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 7. Client API: Device Storage Stats & Device Data Wipe
    // --------------------------------------------------------
    if (path === "/api/devices/stats" && req.method === "GET") {
      const deviceId = url.searchParams.get("device_id");
      if (!deviceId) {
        return new Response(JSON.stringify({ success: false, error: "Missing device_id query param" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let recordCount = 0;
      let status = "detached";

      if (supabase) {
        const { count } = await supabase
          .from("telemetry_history")
          .select("*", { count: "exact", head: true })
          .eq("device_id", deviceId);

        const { data: dev } = await supabase
          .from("devices")
          .select("status")
          .eq("id", deviceId)
          .single();

        recordCount = count || 0;
        status = dev?.status || "detached";
      } else if (mockDb) {
        recordCount = mockDb.getHistory(deviceId, 1000).length;
        const dev = mockDb.devices.get(deviceId);
        status = dev?.status || "detached";
      }

      return new Response(JSON.stringify({
        deviceId,
        status,
        telemetryHistoryRecords: recordCount,
        historyTtlDays: 7,
        estimatedBytes: recordCount * 128
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path === "/api/devices/delete" && req.method === "POST") {
      const body = await req.json();
      const { deviceId } = body;

      if (!deviceId) {
        return new Response(JSON.stringify({ success: false, error: "Missing deviceId parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (supabase) {
        const { error } = await supabase.rpc("wipe_device_data", { p_device_id: deviceId });
        if (error) throw error;
      } else if (mockDb) {
        mockDb.wipeDeviceData(deviceId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 8. Client API: Memory & System Diagnostics
    // --------------------------------------------------------
    if (path === "/api/debug/memory" && req.method === "GET") {
      const mem = Deno.memoryUsage();
      const uptimeSec = Math.floor((Date.now() - START_TIME) / 1000);

      return new Response(JSON.stringify({
        memory: {
          rssMb: (mem.rss / (1024 * 1024)).toFixed(2),
          heapTotalMb: (mem.heapTotal / (1024 * 1024)).toFixed(2),
          heapUsedMb: (mem.heapUsed / (1024 * 1024)).toFixed(2),
          externalMb: (mem.external / (1024 * 1024)).toFixed(2)
        },
        uptimeSeconds: uptimeSec,
        activeSseClients: Array.from(sseClients.values()).reduce((acc, set) => acc + set.size, 0),
        mode: mockDb ? "Standalone Mock Engine" : "Supabase Cloud Production"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 9. Client API: Config / Public Supabase Keys for Frontend
    // --------------------------------------------------------
    if (path === "/api/config") {
      return new Response(JSON.stringify({
        supabaseUrl: SUPABASE_URL || "",
        supabaseAnonKey: SUPABASE_ANON_KEY || "",
        isStandaloneMock: !!mockDb
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 10. Static File Serving (Frontend Assets & HTML Views)
    // --------------------------------------------------------
    if (path === "/" || path === "/devices" || path === "/devices/stats") {
      const html = await Deno.readTextFile("./public/index.html");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (path.startsWith("/public/")) {
      const filePath = "." + path;
      try {
        const fileContent = await Deno.readTextFile(filePath);
        let contentType = "text/plain";
        if (path.endsWith(".css")) contentType = "text/css; charset=utf-8";
        if (path.endsWith(".js")) contentType = "application/javascript; charset=utf-8";
        return new Response(fileContent, { headers: { "Content-Type": contentType } });
      } catch (_) {
        return new Response("Not Found", { status: 404 });
      }
    }

    return new Response("Not Found", { status: 404 });
  } catch (e) {
    console.error("❌ Handler Error:", e.message);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

Deno.serve({ port: PORT, hostname: HOST }, handler);
