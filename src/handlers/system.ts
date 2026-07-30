// Marveluzz Hub - System Diagnostics & Configuration Route Handler (system.ts)

import { APP_VERSION, REQUIRED_SCHEMA_VERSION, START_TIME, SUPABASE_URL, SUPABASE_ANON_KEY, mockDb, supabase } from "../db.ts";
import { DISABLE_AUTH, MOCK_AUTH } from "../auth.ts";

export async function handleSystemRoutes(req: Request, url: URL): Promise<Response | null> {
  const pathname = url.pathname;

  // Runtime Config Gateway Endpoint for Web UI
  if (pathname === "/api/config" && req.method === "GET") {
    return new Response(JSON.stringify({
      supabaseUrl: SUPABASE_URL || null,
      supabaseAnonKey: SUPABASE_ANON_KEY || null,
      disableAuth: DISABLE_AUTH,
      mockAuth: MOCK_AUTH
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Contract Self-Test & Version Banner Endpoint
  if (pathname === "/api/health/self-test" && req.method === "GET") {
    let actualVersion = "unknown";
    let isCompatible = false;
    const databaseMode = supabase ? "Supabase Cloud Production" : "Standalone Local Mock Engine";

    if (mockDb) {
      actualVersion = mockDb.getSchemaVersion();
      isCompatible = (actualVersion === REQUIRED_SCHEMA_VERSION);
    } else if (supabase) {
      try {
        const { data, error } = await supabase.rpc("schema_version");
        if (!error && data) {
          actualVersion = String(data);
          isCompatible = (actualVersion === REQUIRED_SCHEMA_VERSION);
        }
      } catch (_) {
        isCompatible = false;
      }
    }

    return new Response(JSON.stringify({
      status: isCompatible ? "ok" : "degraded",
      appVersion: APP_VERSION,
      requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
      actualSchemaVersion: actualVersion,
      contractCompatible: isCompatible,
      databaseMode
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });
  }

  // Memory & Diagnostic Endpoint
  if (pathname === "/api/debug/memory" && req.method === "GET") {
    const mem = Deno.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
    return new Response(JSON.stringify({
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external
      },
      uptimeSeconds
    }), { headers: { "Content-Type": "application/json" } });
  }

  return null;
}
