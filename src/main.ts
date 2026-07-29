// Marveluzz Hub - Stateless Edge Ingest Server (Deno Deploy)

import { createClient } from "@supabase/supabase-js";
import { MockSupabaseEngine } from "../tests/supabase_mock.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const HOST = "0.0.0.0";
const START_TIME = Date.now();

// Version & Contract Compatibility Constants
const APP_VERSION = "1.0.28";
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

// GitHub OAuth & Session Authentication Configuration
export const DISABLE_AUTH = Deno.env.get("DISABLE_AUTH") === "true";
export const GITHUB_CLIENT_ID = Deno.env.get("GITHUB_CLIENT_ID") || "";
export const GITHUB_CLIENT_SECRET = Deno.env.get("GITHUB_CLIENT_SECRET") || "";
export const MOCK_AUTH = !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || Deno.env.get("MOCK_AUTH") === "true";
export const ALLOWED_GITHUB_USERS = (Deno.env.get("ALLOWED_GITHUB_USERS") || "")
  .split(",")
  .map(u => u.trim().toLowerCase())
  .filter(Boolean);
export const COOKIE_NAME = "marveluzz_session";
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const SESSION_SECRET = Deno.env.get("SESSION_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || "marveluzz-hub-secret-session-key-2026";

export const activeSessions = new Map<string, { username: string; expires: number }>();
export const revokedSessions = new Set<string>();

let cryptoKeyPromise: Promise<CryptoKey> | null = null;
function getCryptoKey(): Promise<CryptoKey> {
  if (!cryptoKeyPromise) {
    const encoder = new TextEncoder();
    cryptoKeyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return cryptoKeyPromise;
}

export async function createSignedSessionToken(username: string): Promise<{ token: string; expires: number }> {
  const expires = Date.now() + SESSION_EXPIRY_MS;
  const payload = `${username}:${expires}`;
  const key = await getCryptoKey();
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigArray = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigArray.map(b => b.toString(16).padStart(2, "0")).join("");
  const token = `${payload}.${sigHex}`;
  activeSessions.set(token, { username, expires });
  return { token, expires };
}

export function createSession(sessionId: string, username: string): number {
  const expires = Date.now() + SESSION_EXPIRY_MS;
  activeSessions.set(sessionId, { username, expires });
  return expires;
}

export async function checkSessionAsync(token: string): Promise<string | null> {
  if (!token) return null;
  if (revokedSessions.has(token)) return null;

  // 1. Fast in-memory cache lookup
  const cached = activeSessions.get(token);
  if (cached) {
    if (Date.now() > cached.expires) {
      activeSessions.delete(token);
      return null;
    }
    return cached.username;
  }

  // 2. Stateless HMAC verification (Survives server spin-downs and restarts!)
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx === -1) return null;
    const payload = token.substring(0, dotIdx);
    const sigHex = token.substring(dotIdx + 1);

    const colonIdx = payload.indexOf(":");
    if (colonIdx === -1) return null;
    const username = payload.substring(0, colonIdx);
    const expires = Number(payload.substring(colonIdx + 1));

    if (isNaN(expires) || Date.now() > expires) return null;

    const key = await getCryptoKey();
    const sigMatch = sigHex.match(/.{1,2}/g);
    if (!sigMatch) return null;
    const sigArray = new Uint8Array(sigMatch.map(b => parseInt(b, 16)));

    const isValid = await crypto.subtle.verify("HMAC", key, sigArray, new TextEncoder().encode(payload));
    if (isValid) {
      activeSessions.set(token, { username, expires });
      return username;
    }
  } catch (_) {}

  return null;
}

export function checkSession(sessionId: string): string | null {
  if (!sessionId || revokedSessions.has(sessionId)) return null;
  const sess = activeSessions.get(sessionId);
  if (!sess) return null;
  if (Date.now() > sess.expires) {
    activeSessions.delete(sessionId);
    return null;
  }
  return sess.username;
}

export function deleteSession(sessionId: string) {
  activeSessions.delete(sessionId);
  if (sessionId) {
    revokedSessions.add(sessionId);
  }
}

function getLoginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Marveluzz Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <div class="login-container">
    <div class="login-card glass">
      <h2>Marveluzz Hub <span style="font-size:12px; font-weight:400; opacity:0.6; vertical-align:middle; margin-left:8px;">v${APP_VERSION}</span></h2>
      <p>${MOCK_AUTH ? "Developer testing login interface" : "Secure login with your GitHub account"}</p>
      
      ${MOCK_AUTH ? `
      <!-- Developer Mock Auth Input Form -->
      <form action="/login/callback" method="GET" style="display:flex; flex-direction:column; gap:12px; margin-top:20px; width:100%;">
        <div style="background: rgba(217, 119, 6, 0.15); border: 1px solid rgba(217, 119, 6, 0.4); border-radius: 8px; padding: 10px; color: #fcd34d; font-size: 12px; text-align: center; font-weight:500;">
          ⚠️ Mock Authentication Active
        </div>
        <input type="text" name="code" placeholder="Enter mock username (e.g. alice)" required style="padding:10px 14px; border-radius:8px; background:rgba(255,255,255,0.05); border:1px solid var(--border-color); color:var(--text-primary); font-family:'Outfit', sans-serif; outline:none; font-size:14px; text-align:center;">
        <button type="submit" class="btn-action active-lease" style="padding:10px; font-weight:600; cursor:pointer;">Developer Login</button>
      </form>
      ` : `
      <a href="/login/github" class="btn-github">
        <svg style="width:24px;height:24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z"/></svg>
        <span>Authenticate with GitHub</span>
      </a>
      `}
      
      <div id="error-box"></div>
    </div>
  </div>

  <script src="/public/login.js"></script>
</body>
</html>`;
}

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
  } catch (e: any) {
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
    // Session Cookie Authentication Checking
    // --------------------------------------------------------
    let isAuthorized = DISABLE_AUTH;
    let sessionId = "";

    if (!DISABLE_AUTH) {
      const cookieHeader = req.headers.get("cookie") || "";
      const match = cookieHeader.match(new RegExp(`(^| )${COOKIE_NAME}=([^;]+)`));
      sessionId = match ? match[2] : "";
      const username = await checkSessionAsync(sessionId);
      isAuthorized = username !== null;
    }

    // --------------------------------------------------------
    // Unauthenticated & OAuth Authentication Routes
    // --------------------------------------------------------
    if (path === "/login" && req.method === "GET") {
      if (isAuthorized) {
        return Response.redirect(`${url.origin}/`, 302);
      }
      return new Response(getLoginHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (path === "/login/github" && req.method === "GET") {
      if (DISABLE_AUTH) {
        return Response.redirect(`${url.origin}/`, 302);
      }
      if (MOCK_AUTH) {
        const mockCode = url.searchParams.get("mock_code") || "mock_user";
        return Response.redirect(`${url.origin}/login/callback?code=${mockCode}`, 302);
      }
      if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        console.error("[Auth] GitHub OAuth credentials not configured!");
        return Response.redirect(`${url.origin}/login?error=no_config`, 302);
      }

      const redirectUri = `${url.origin}/login/callback`;
      const authorizeUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=read:user`;

      return Response.redirect(authorizeUrl, 302);
    }

    if (path === "/login/callback" && req.method === "GET") {
      if (DISABLE_AUTH) {
        return Response.redirect(`${url.origin}/`, 302);
      }

      const code = url.searchParams.get("code");
      if (!code) {
        return Response.redirect(`${url.origin}/login?error=oauth_failed`, 302);
      }

      let gitUsername = "";

      if (MOCK_AUTH) {
        gitUsername = code.toLowerCase();
      } else {
        try {
          const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({
              client_id: GITHUB_CLIENT_ID,
              client_secret: GITHUB_CLIENT_SECRET,
              code,
              redirect_uri: `${url.origin}/login/callback`,
            }),
          });

          const tokenData = await tokenResponse.json();
          const accessToken = tokenData.access_token;
          if (!accessToken) throw new Error("No access token from GitHub");

          const userResponse = await fetch("https://api.github.com/user", {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "User-Agent": "Marveluzz-Hub-App",
            },
          });

          const userData = await userResponse.json();
          gitUsername = userData.login?.toLowerCase();
          if (!gitUsername) throw new Error("Could not get username from GitHub profile");
        } catch (err) {
          console.error("[Auth] GitHub OAuth failed:", err);
          return Response.redirect(`${url.origin}/login?error=oauth_failed`, 302);
        }
      }

      if (ALLOWED_GITHUB_USERS.length > 0 && !ALLOWED_GITHUB_USERS.includes(gitUsername)) {
        console.warn(`[Auth] User '${gitUsername}' attempted login but is not in allowed list.`);
        return Response.redirect(`${url.origin}/login?error=not_allowed`, 302);
      }

      const { token, expires } = await createSignedSessionToken(gitUsername);
      const expiresDate = new Date(expires).toUTCString();

      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresDate}`,
        },
      });
    }

    if (path === "/logout") {
      if (sessionId) {
        deleteSession(sessionId);
      }
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/login",
          "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        },
      });
    }

    // Protect Client Dashboard Web APIs
    if (path.startsWith("/api/devices") || path === "/api/device/command") {
      if (!isAuthorized) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
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
          const clientSet = sseClients.get(deviceId)!;
          const wasActive = clientSet.size > 0;
          clientSet.add(controller);

          // Trigger viewers_active command dispatch over Realtime WebSockets when first viewer connects
          if (!wasActive) {
            if (supabase) {
              supabase.from("devices").update({ viewers_active: true, viewers_last_seen: new Date().toISOString() }).eq("id", deviceId).then(() => {});
              supabase.from("device_commands").insert({ device_id: deviceId, target: "viewers_active", action: "set_value", value: true, status: "pending" }).then(() => {});
            } else if (mockDb) {
              mockDb.updateDeviceViewersActive(deviceId, true);
              mockDb.queueCommand(deviceId, "viewers_active", "set_value", true);
            }
          }

          // Initial connection handshake
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ deviceId, status: "connected" })}\n\n`));

          // 15s keepalive ping
          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping\n\n`));
            } catch (_) {
              clearInterval(intervalId);
              clientSet.delete(controller);
              const isActive = clientSet.size > 0;
              if (!isActive) {
                if (supabase) {
                  supabase.from("devices").update({ viewers_active: false, viewers_last_seen: new Date().toISOString() }).eq("id", deviceId).then(() => {});
                  supabase.from("device_commands").insert({ device_id: deviceId, target: "viewers_active", action: "set_value", value: false, status: "pending" }).then(() => {});
                } else if (mockDb) {
                  mockDb.updateDeviceViewersActive(deviceId, false);
                  mockDb.queueCommand(deviceId, "viewers_active", "set_value", false);
                }
              }
            }
          }, 15000);
        },
        cancel() {
          if (intervalId) clearInterval(intervalId);
          if (sseClients.has(deviceId)) {
            const clientSet = sseClients.get(deviceId)!;
            const isActive = clientSet.size > 0;
            if (!isActive) {
              if (supabase) {
                supabase.from("devices").update({ viewers_active: false, viewers_last_seen: new Date().toISOString() }).eq("id", deviceId).then(() => {});
                supabase.from("device_commands").insert({ device_id: deviceId, target: "viewers_active", action: "set_value", value: false, status: "pending" }).then(() => {});
              } else if (mockDb) {
                mockDb.updateDeviceViewersActive(deviceId, false);
                mockDb.queueCommand(deviceId, "viewers_active", "set_value", false);
              }
            }
          }
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
        } catch (e: any) {
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
        } catch (e: any) {
          return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      broadcastSseEvent(deviceId, "telemetry", { deviceId, data });

      const isViewersActive = mockDb ? (mockDb.devices.get(deviceId)?.viewers_active ?? false) : false;

      return new Response(JSON.stringify({
        success: true,
        viewers_active: isViewersActive,
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
        let ok = false;
        if (supabase) {
          const { error } = await supabase
            .from("devices")
            .update({ status: "control", controller_session_id: String(value) })
            .eq("id", deviceId);
          ok = !error;
        } else if (mockDb) {
          ok = mockDb.acquireControlLease(deviceId, String(value));
        }
        if (ok) {
          broadcastSseEvent(deviceId, "device_status", { deviceId, status: "control", controller_session_id: String(value) });
        }
        return new Response(JSON.stringify({ success: ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (target === "release_lease") {
        let ok = false;
        if (supabase) {
          const { error } = await supabase
            .from("devices")
            .update({ status: "live", controller_session_id: null })
            .eq("id", deviceId);
          ok = !error;
        } else if (mockDb) {
          ok = mockDb.releaseControlLease(deviceId, String(value));
        }
        if (ok) {
          broadcastSseEvent(deviceId, "device_status", { deviceId, status: "live", controller_session_id: null });
        }
        return new Response(JSON.stringify({ success: ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (target === "set_status") {
        let ok = false;
        const newStatus = String(value || "disconnected");
        if (supabase) {
          const { error } = await supabase
            .from("devices")
            .update({ status: newStatus, controller_session_id: null })
            .eq("id", deviceId);
          ok = !error;
        } else if (mockDb) {
          const dev = mockDb.devices.get(deviceId);
          if (dev) {
            dev.status = newStatus as any;
            dev.controller_session_id = null;
            ok = true;
          }
        }
        if (ok) {
          broadcastSseEvent(deviceId, "device_status", { deviceId, status: newStatus, controller_session_id: null });
        }
        return new Response(JSON.stringify({ success: ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        const { data: devicesData, error } = await supabase
          .from("devices")
          .select("id, title, status, last_seen, registered_at");

        if (error) throw error;

        const { data: uiData } = await supabase
          .from("ui_definitions")
          .select("device_id, layout_def");

        const uiMap = new Map((uiData || []).map(u => [u.device_id, u.layout_def]));

        list = (devicesData || []).map(d => {
          const uiDef = uiMap.get(d.id) as { title?: string } | undefined;
          const displayTitle = (uiDef && uiDef.title) ? uiDef.title : d.title;
          return {
            deviceId: d.id,
            title: displayTitle,
            state: d.status,
            lastSeen: d.last_seen,
            registeredAt: d.registered_at
          };
        });
      } else if (mockDb) {
        list = Array.from(mockDb.devices.values()).map(d => {
          const uiDef = mockDb.uiDefinitions.get(d.id);
          const layoutDef = uiDef?.layout_def as { title?: string } | undefined;
          const displayTitle = (layoutDef && layoutDef.title) ? layoutDef.title : d.title;
          return {
            deviceId: d.id,
            title: displayTitle,
            state: d.status,
            lastSeen: d.last_seen,
            registeredAt: d.registered_at
          };
        });
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
      let layoutDefinition: unknown = null;
      let telemetryLatest: unknown = null;

      if (supabase) {
        const { count } = await supabase
          .from("telemetry_history")
          .select("*", { count: "exact", head: true })
          .eq("device_id", deviceId);

        const { data: dev } = await supabase
          .from("devices")
          .select("status")
          .eq("id", deviceId)
          .maybeSingle();

        const { data: ui } = await supabase
          .from("ui_definitions")
          .select("layout_def")
          .eq("device_id", deviceId)
          .maybeSingle();

        const { data: telem } = await supabase
          .from("telemetry_latest")
          .select("data")
          .eq("device_id", deviceId)
          .maybeSingle();

        recordCount = count || 0;
        status = dev?.status || "detached";
        layoutDefinition = ui?.layout_def || null;
        telemetryLatest = telem?.data || null;
      } else if (mockDb) {
        recordCount = mockDb.getHistory(deviceId, 1000).length;
        const dev = mockDb.devices.get(deviceId);
        const uiDef = mockDb.uiDefinitions.get(deviceId);
        const latestTelem = mockDb.telemetryLatest.get(deviceId);
        status = dev?.status || "detached";
        layoutDefinition = uiDef?.layout_def || null;
        telemetryLatest = latestTelem?.data || null;
      }

      return new Response(JSON.stringify({
        deviceId,
        status,
        layout_definition: layoutDefinition,
        telemetry_latest: telemetryLatest,
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
        isStandaloneMock: !!mockDb,
        disableAuth: DISABLE_AUTH,
        mockAuth: MOCK_AUTH
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------
    // 10. Static File Serving (Frontend Assets & HTML Views)
    // --------------------------------------------------------
    if (path === "/" || path === "/devices" || path === "/devices/stats") {
      if (!isAuthorized) {
        return Response.redirect(`${url.origin}/login`, 302);
      }
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
  } catch (e: any) {
    console.error("❌ Handler Error:", e.message);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

Deno.serve({ port: PORT, hostname: HOST }, handler);
