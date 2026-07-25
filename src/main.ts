// Marveluzz Hub - Stateless Edge Ingest Server (Deno Deploy)
// Official successor to Every-Panel

import { createClient } from "@supabase/supabase-js";
import { MockSupabaseEngine } from "../tests/supabase_mock.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const HOST = "0.0.0.0";
const START_TIME = Date.now();

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

console.log(`🚀 Marveluzz Hub Starting on http://${HOST}:${PORT}`);
if (mockDb) {
  console.log("ℹ️ Running in Local Standalone Mode (Using in-memory Supabase Mock Engine).");
} else {
  console.log("⚡ Connected to Supabase Production Backend.");
}

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
    // 1. IoT Ingest API: UI Layout Registration
    // --------------------------------------------------------
    if (path === "/api/device/ui_definition" && req.method === "POST") {
      const body = await req.json();
      const { deviceId, deviceKey, layoutDef } = body;

      if (!deviceId || !deviceKey || !layoutDef) {
        return new Response(JSON.stringify({ success: false, error: "Missing parameters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (supabase) {
        const { data, error } = await supabase.rpc("register_ui_definition", {
          p_device_id: deviceId,
          p_device_key: deviceKey,
          p_layout_def: layoutDef
        });
        if (error) throw error;
      } else if (mockDb) {
        mockDb.registerUIDefinition(deviceId, deviceKey, layoutDef);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 2. IoT Ingest API: Telemetry Packet Ingest & Command Retrieval
    // --------------------------------------------------------
    if (path === "/api/device/telemetry" && req.method === "POST") {
      const body = await req.json();
      const { deviceId, deviceKey, data } = body;

      if (!deviceId || !deviceKey || !data) {
        return new Response(JSON.stringify({ success: false, error: "Missing parameters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let pendingCommands: Array<unknown> = [];

      if (supabase) {
        const { data: cmdData, error } = await supabase.rpc("ingest_telemetry", {
          p_device_id: deviceId,
          p_device_key: deviceKey,
          p_telemetry_data: data
        });
        if (error) throw error;
        pendingCommands = cmdData || [];
      } else if (mockDb) {
        pendingCommands = mockDb.ingestTelemetry(deviceId, deviceKey, data);
      }

      return new Response(JSON.stringify({ success: true, commands: pendingCommands }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 3. Client API: Queue Control Command
    // --------------------------------------------------------
    if (path === "/api/device/command" && req.method === "POST") {
      const body = await req.json();
      const { deviceId, target, action, value } = body;

      if (!deviceId || !target || !action) {
        return new Response(JSON.stringify({ success: false, error: "Missing command parameters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let commandId = "";
      if (supabase) {
        const { data, error } = await supabase
          .from("device_commands")
          .insert({ device_id: deviceId, target, action, value, status: "pending" })
          .select("id")
          .single();
        if (error) throw error;
        commandId = data.id;
      } else if (mockDb) {
        commandId = mockDb.queueCommand(deviceId, target, action, value);
      }

      return new Response(JSON.stringify({ success: true, commandId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 4. Client API: Directory Device List
    // --------------------------------------------------------
    if (path === "/api/devices" && req.method === "GET") {
      let deviceList: Array<unknown> = [];
      if (supabase) {
        const { data, error } = await supabase.from("devices").select("*");
        if (error) throw error;
        deviceList = (data || []).map((d: any) => ({
          deviceId: d.id,
          title: d.title || "IoT Node",
          state: d.status || "detached",
          registeredAt: d.registered_at
        }));
      } else if (mockDb) {
        deviceList = Array.from(mockDb.devices.values()).map(d => ({
          deviceId: d.id,
          title: d.title,
          state: d.status,
          registeredAt: d.registered_at
        }));
      }

      return new Response(JSON.stringify(deviceList), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 5. Client API: Device Storage Stats & Metrics
    // --------------------------------------------------------
    if (path === "/api/devices/stats" && req.method === "GET") {
      const deviceId = url.searchParams.get("device_id");
      if (!deviceId) {
        return new Response(JSON.stringify({ success: false, error: "Missing device_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let stats = {
        deviceId,
        historyCount: 0,
        historyBytes: 0,
        historyTtlDays: 7,
        deviceKey: "••••••••",
        status: "detached"
      };

      if (mockDb) {
        const dev = mockDb.devices.get(deviceId);
        const history = mockDb.getHistory(deviceId, 1000);
        if (dev) {
          stats.deviceKey = dev.device_key;
          stats.status = dev.status;
          stats.historyTtlDays = dev.history_ttl_days;
          stats.historyCount = history.length;
          stats.historyBytes = JSON.stringify(history).length;
        }
      }

      return new Response(JSON.stringify(stats), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 6. Client API: Wipe Device Data
    // --------------------------------------------------------
    if (path === "/api/devices/delete" && req.method === "POST") {
      const body = await req.json();
      const { deviceId } = body;

      if (!deviceId) {
        return new Response(JSON.stringify({ success: false, error: "Missing deviceId" }), {
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
    // 7. Client API: Memory & System Diagnostics
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
        mode: mockDb ? "Standalone Mock Engine" : "Supabase Cloud Production"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 8. Client API: Config / Public Supabase Keys for Frontend
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
    // 9. Static File Serving (Frontend Assets & HTML Views)
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
