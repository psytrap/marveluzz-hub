// Marveluzz Hub - Edge API Endpoint Routes (routes.ts)

import { APP_VERSION, REQUIRED_SCHEMA_VERSION, START_TIME, SUPABASE_URL, SUPABASE_ANON_KEY, mockDb, supabase } from "./db.ts";
import { DISABLE_AUTH, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, MOCK_AUTH, ALLOWED_GITHUB_USERS, COOKIE_NAME, checkSessionAsync, createSignedSessionToken, deleteSession, getLoginHtml } from "./auth.ts";

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Static File Serving
  if (pathname === "/public/style.css") {
    try {
      const content = await Deno.readTextFile("./public/style.css");
      return new Response(content, { headers: { "Content-Type": "text/css" } });
    } catch (_) {
      return new Response("CSS not found", { status: 404 });
    }
  }

  if (pathname === "/public/app.js") {
    try {
      const content = await Deno.readTextFile("./public/app.js");
      return new Response(content, { headers: { "Content-Type": "application/javascript" } });
    } catch (_) {
      return new Response("JS not found", { status: 404 });
    }
  }

  if (pathname === "/public/devices.js") {
    try {
      const content = await Deno.readTextFile("./public/devices.js");
      return new Response(content, { headers: { "Content-Type": "application/javascript" } });
    } catch (_) {
      return new Response("JS not found", { status: 404 });
    }
  }

  if (pathname === "/public/panel.js") {
    try {
      const content = await Deno.readTextFile("./public/panel.js");
      return new Response(content, { headers: { "Content-Type": "application/javascript" } });
    } catch (_) {
      return new Response("JS not found", { status: 404 });
    }
  }

  // Authentication & OAuth Routes
  if (pathname === "/login") {
    if (req.method === "GET") {
      return new Response(getLoginHtml(), { headers: { "Content-Type": "text/html" } });
    }
    if (req.method === "POST" && MOCK_AUTH) {
      try {
        const formData = await req.formData();
        const username = (formData.get("username") || "developer").toString().trim().toLowerCase();

        if (ALLOWED_GITHUB_USERS.length > 0 && !ALLOWED_GITHUB_USERS.includes(username)) {
          console.warn(`[Auth] User '${username}' attempted login but is not in allowed list.`);
          return new Response(null, {
            status: 302,
            headers: { "Location": `${url.origin}/login?error=user_not_allowed` }
          });
        }

        const { token, expires } = await createSignedSessionToken(username);
        const expiresUtc = new Date(expires).toUTCString();
        return new Response(null, {
          status: 302,
          headers: {
            "Location": `${url.origin}/`,
            "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresUtc}`
          }
        });
      } catch (_) {
        return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login?error=invalid_form` } });
      }
    }
  }

  if (pathname === "/login/github" && req.method === "GET") {
    const mockCode = url.searchParams.get("mock_code");
    if (MOCK_AUTH) {
      if (mockCode) {
        return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login/callback?code=${encodeURIComponent(mockCode)}` } });
      }
      return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login` } });
    }
    const redirectUri = `${url.origin}/login/callback`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
    return new Response(null, { status: 302, headers: { "Location": githubAuthUrl } });
  }

  if (pathname === "/login/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) {
      return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login?error=oauth_failed` } });
    }

    if (MOCK_AUTH) {
      const username = code.toLowerCase();
      if (ALLOWED_GITHUB_USERS.length > 0 && !ALLOWED_GITHUB_USERS.includes(username)) {
        return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login?error=not_allowed` } });
      }
      const { token, expires } = await createSignedSessionToken(username);
      const expiresUtc = new Date(expires).toUTCString();
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${url.origin}/`,
          "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresUtc}`
        }
      });
    }

    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code
        })
      });
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login?error=token_failed` } });
      }

      const userRes = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": "Marveluzz-Hub" }
      });
      const userData = await userRes.json();
      const username = (userData.login || "").toLowerCase();

      if (ALLOWED_GITHUB_USERS.length > 0 && !ALLOWED_GITHUB_USERS.includes(username)) {
        console.warn(`[Auth] User '${username}' attempted OAuth login but is not in allowed list.`);
        return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login?error=not_allowed` } });
      }

      const { token, expires } = await createSignedSessionToken(username);
      const expiresUtc = new Date(expires).toUTCString();
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${url.origin}/`,
          "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresUtc}`
        }
      });
    } catch (e) {
      console.error("[Auth] OAuth callback error:", e);
      return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login?error=callback_error` } });
    }
  }

  if (pathname === "/logout") {
    const cookies = req.headers.get("Cookie") || "";
    const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (match) {
      deleteSession(match[1]);
    }
    return new Response(null, {
      status: 302,
      headers: {
        "Location": `${url.origin}/login`,
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      }
    });
  }

  // Session verification helper
  async function getAuthenticatedUser(): Promise<string | null> {
    if (DISABLE_AUTH) return "anonymous";
    const cookies = req.headers.get("Cookie") || "";
    const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (!match) return null;
    return await checkSessionAsync(match[1]);
  }

  // Public Configuration Endpoint
  if (pathname === "/api/config" && req.method === "GET") {
    return new Response(JSON.stringify({
      supabaseUrl: SUPABASE_URL || null,
      supabaseAnonKey: SUPABASE_ANON_KEY || null,
      disableAuth: DISABLE_AUTH,
      mockAuth: MOCK_AUTH
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Health and Contract Verification
  if (pathname === "/api/health/self-test" && req.method === "GET") {
    let actualVersion = REQUIRED_SCHEMA_VERSION;
    let databaseMode = mockDb ? "Standalone In-Memory Mock Engine" : "Supabase Cloud Production";
    let isCompatible = true;

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc("get_schema_version");
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

  // Device Storage Footprint Statistics Endpoint
  // Device Management: Get Stats & Settings Endpoint
  if ((pathname === "/api/devices/stats" || pathname === "/api/device/stats") && req.method === "GET") {
    const deviceId = url.searchParams.get("device_id");
    let layoutDef: any = null;
    let historyCount = 0;
    let title = "IoT Device";
    let status = "detached";
    let lastSeen: string | null = null;
    let historyTtlDays = 7;
    let deviceKey = "";

    if (supabase && deviceId) {
      const { data: devRow } = await supabase.from("devices").select("title, status, last_seen, history_ttl_days, device_key").eq("id", deviceId).single();
      if (devRow) {
        title = devRow.title;
        status = devRow.status;
        lastSeen = devRow.last_seen;
        historyTtlDays = devRow.history_ttl_days || 7;
        deviceKey = devRow.device_key || "";
      }
      const { data: uiRow } = await supabase.from("ui_definitions").select("layout_def").eq("device_id", deviceId).single();
      if (uiRow) layoutDef = uiRow.layout_def;

      const { count } = await supabase.from("telemetry_history").select("id", { count: "exact", head: true }).eq("device_id", deviceId);
      historyCount = count || 0;
    } else if (mockDb && deviceId) {
      const dev = mockDb.devices.get(deviceId);
      if (dev) {
        title = dev.title;
        status = dev.status;
        lastSeen = dev.last_seen;
        historyTtlDays = dev.history_ttl_days || 7;
        deviceKey = dev.device_key || "";
      }
      layoutDef = mockDb.uiDefinitions.get(deviceId) || null;
      historyCount = mockDb.telemetryHistory.filter(item => item.device_id === deviceId).length;
    }

    const maskedKey = deviceKey.length > 4 ? `••••••••••••${deviceKey.slice(-4)}` : "••••••••••••";

    return new Response(JSON.stringify({
      deviceId,
      title,
      status,
      lastSeen,
      historyTtlDays,
      historyCount,
      estimatedBytes: historyCount * 128,
      maskedKey,
      layout_definition: layoutDef
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Device Management: Secret Key Rotation Endpoint
  if (pathname === "/api/device/rotate_key" && req.method === "POST") {
    const user = await getAuthenticatedUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
      const { deviceId } = await req.json();
      if (!deviceId) return new Response(JSON.stringify({ error: "Missing deviceId" }), { status: 400 });

      const newKey = `sec_${crypto.randomUUID().replace(/-/g, "")}`;

      if (supabase) {
        const { error } = await supabase.rpc("rotate_device_key", { p_device_id: deviceId, p_new_key: newKey });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      } else if (mockDb) {
        mockDb.rotateDeviceKey(deviceId, newKey);
      }

      return new Response(JSON.stringify({ success: true, newKey }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Device Management: Retention TTL Update Endpoint
  if (pathname === "/api/device/update_retention" && req.method === "POST") {
    const user = await getAuthenticatedUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
      const { deviceId, historyTtlDays } = await req.json();
      if (!deviceId || !historyTtlDays) return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });

      if (supabase) {
        await supabase.from("devices").update({ history_ttl_days: parseInt(historyTtlDays) }).eq("id", deviceId);
      } else if (mockDb) {
        mockDb.updateRetention(deviceId, parseInt(historyTtlDays));
      }

      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Device Management: Purge Telemetry Endpoint
  if (pathname === "/api/device/purge_telemetry" && req.method === "POST") {
    const user = await getAuthenticatedUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
      const { deviceId } = await req.json();
      if (!deviceId) return new Response(JSON.stringify({ error: "Missing deviceId" }), { status: 400 });

      let deletedCount = 0;
      if (supabase) {
        const { count } = await supabase.from("telemetry_history").delete({ count: "exact" }).eq("device_id", deviceId);
        deletedCount = count || 0;
      } else if (mockDb) {
        deletedCount = mockDb.purgeTelemetry(deviceId);
      }

      return new Response(JSON.stringify({ success: true, deletedCount }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Protected Page Views
  if (pathname === "/" || pathname === "/devices" || pathname === "/devices/manage" || pathname === "/devices/stats") {
    const user = await getAuthenticatedUser();
    if (!user) {
      return new Response(null, { status: 302, headers: { "Location": `${url.origin}/login` } });
    }
    try {
      const html = await Deno.readTextFile("./public/index.html");
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    } catch (_) {
      return new Response("Index file missing", { status: 500 });
    }
  }

  // API Endpoints
  if (pathname === "/api/devices" && req.method === "GET") {
    const user = await getAuthenticatedUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    if (supabase) {
      const { data: devRows } = await supabase.from("devices").select("id, title, status, last_seen, registered_at");
      const { data: uiRows } = await supabase.from("ui_definitions").select("device_id, layout_def");
      const uiMap = new Map((uiRows || []).map(u => [u.device_id, u.layout_def]));

      const list = (devRows || []).map(d => {
        const uiDef = uiMap.get(d.id);
        const displayTitle = (uiDef && uiDef.title) ? uiDef.title : d.title;
        return {
          deviceId: d.id,
          title: displayTitle,
          state: d.status,
          lastSeen: d.last_seen,
          registeredAt: d.registered_at
        };
      });
      return new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } });
    } else if (mockDb) {
      const db = mockDb;
      const list = Array.from(db.devices.values()).map(d => {
        const uiDef = db.uiDefinitions.get(d.id);
        const layoutObj = uiDef ? uiDef.layout_def : null;
        const displayTitle = (layoutObj && (layoutObj as any).title) ? (layoutObj as any).title : d.title;
        return {
          deviceId: d.id,
          title: displayTitle,
          state: d.status,
          lastSeen: d.last_seen,
          registeredAt: d.registered_at
        };
      });
      return new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  if (pathname === "/api/device/layout" && req.method === "GET") {
    const deviceId = url.searchParams.get("device_id");
    if (!deviceId) return new Response(JSON.stringify({ error: "Missing device_id" }), { status: 400 });

    if (supabase) {
      const { data } = await supabase.from("ui_definitions").select("layout_def").eq("device_id", deviceId).single();
      return new Response(JSON.stringify({ layout: data?.layout_def || null }), { headers: { "Content-Type": "application/json" } });
    } else if (mockDb) {
      const layout = mockDb.uiDefinitions.get(deviceId) || null;
      return new Response(JSON.stringify({ layout }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ layout: null }), { headers: { "Content-Type": "application/json" } });
  }

  if (pathname === "/api/device/command" && req.method === "POST") {
    try {
      const body = await req.json();
      const { deviceId, target, action, value } = body;

      if (!deviceId || !target) {
        return new Response(JSON.stringify({ error: "Missing required command parameters" }), { status: 400 });
      }

      if (target === "acquire_control_lease") {
        const sessionId = String(value);
        if (supabase) {
          await supabase.from("devices").update({ status: "control", controller_session_id: sessionId }).eq("id", deviceId);
        } else if (mockDb) {
          mockDb.acquireControlLease(deviceId, sessionId);
        }
        return new Response(JSON.stringify({ success: true, status: "control" }), { headers: { "Content-Type": "application/json" } });
      }

      if (target === "release_control_lease") {
        const sessionId = String(value);
        if (supabase) {
          await supabase.from("devices").update({ status: "live", controller_session_id: null }).eq("id", deviceId);
        } else if (mockDb) {
          mockDb.releaseControlLease(deviceId, sessionId);
        }
        return new Response(JSON.stringify({ success: true, status: "live" }), { headers: { "Content-Type": "application/json" } });
      }

      if (target === "viewers_active") {
        const isActive = value === true || value === "true";
        if (supabase) {
          await supabase
            .from("devices")
            .update({ viewers_active: isActive, viewers_last_seen: new Date().toISOString() })
            .eq("id", deviceId);
        } else if (mockDb) {
          mockDb.updateDeviceViewersActive(deviceId, isActive);
        }
      }

      let commandId: string = crypto.randomUUID();

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

      return new Response(JSON.stringify({ success: true, commandId }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message || "Failed to send command" }), { status: 500 });
    }
  }

  // IoT Device Telemetry RPC Endpoint
  if ((pathname === "/rest/v1/rpc/ingest_telemetry" || pathname === "/api/device/telemetry") && req.method === "POST") {
    try {
      const body = await req.json();
      const deviceId = body.p_device_id || body.deviceId;
      const deviceKey = body.p_device_key || body.deviceKey;
      const telemetry = body.p_telemetry_data || body.data;

      if (!deviceId || !deviceKey) {
        return new Response(JSON.stringify({ error: "Missing authentication parameters" }), { status: 401 });
      }

      if (supabase) {
        const { data, error } = await supabase.rpc("ingest_telemetry", {
          p_device_id: deviceId,
          p_device_key: deviceKey,
          p_telemetry_data: telemetry
        });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 401 });
        const viewersActive = (Array.isArray(data) && data.length > 0) ? Boolean(data[0].viewers_active) : false;
        return new Response(JSON.stringify({ success: true, viewers_active: viewersActive, commands: [] }), { headers: { "Content-Type": "application/json" } });
      } else if (mockDb) {
        const result = mockDb.ingestTelemetry(deviceId, deviceKey, telemetry);
        if (!result) return new Response(JSON.stringify({ error: "Invalid device key" }), { status: 401 });
        const dev = mockDb.devices.get(deviceId);
        const viewersActive = dev ? dev.viewers_active : false;
        return new Response(JSON.stringify({ success: true, viewers_active: viewersActive, commands: [] }), { headers: { "Content-Type": "application/json" } });
      }
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // UI Layout Registration RPC Endpoint
  if ((pathname === "/rest/v1/rpc/register_ui_definition" || pathname === "/api/device/ui_definition") && req.method === "POST") {
    try {
      const body = await req.json();
      const deviceId = body.p_device_id || body.deviceId;
      const deviceKey = body.p_device_key || body.deviceKey;
      const layoutDef = body.p_layout_def || body.layoutDef;

      if (!deviceId || !deviceKey) {
        return new Response(JSON.stringify({ error: "Missing authentication parameters" }), { status: 401 });
      }

      if (supabase) {
        const { data, error } = await supabase.rpc("register_ui_definition", {
          p_device_id: deviceId,
          p_device_key: deviceKey,
          p_layout_def: layoutDef
        });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 401 });
        return new Response(JSON.stringify({ success: true, registered: Boolean(data) }), { headers: { "Content-Type": "application/json" } });
      } else if (mockDb) {
        const ok = mockDb.registerUIDefinition(deviceId, deviceKey, layoutDef);
        if (!ok) return new Response(JSON.stringify({ error: "Invalid device key" }), { status: 401 });
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
      }
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Wipe Device Storage Endpoint
  if (pathname === "/api/devices/delete" && req.method === "POST") {
    const user = await getAuthenticatedUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
      const { deviceId } = await req.json();
      if (!deviceId) return new Response(JSON.stringify({ error: "Missing deviceId" }), { status: 400 });

      if (supabase) {
        await supabase.from("telemetry_history").delete().eq("device_id", deviceId);
        await supabase.from("telemetry_latest").delete().eq("device_id", deviceId);
        await supabase.from("ui_definitions").delete().eq("device_id", deviceId);
        await supabase.from("device_commands").delete().eq("device_id", deviceId);
        await supabase.from("devices").update({ status: "detached", controller_session_id: null }).eq("id", deviceId);
      } else if (mockDb) {
        mockDb.wipeDeviceData(deviceId);
      }
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
}
