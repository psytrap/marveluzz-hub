// Marveluzz Hub - Authentication & Session Management Module (auth.ts)

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
/** Lazy-loads and returns cached HMAC CryptoKey for session token signing. */
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

/** Generates signed HMAC session token and records session expiration. */
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

/** Registers new active user session ID with expiration timestamp. */
export function createSession(sessionId: string, username: string): number {
  const expires = Date.now() + SESSION_EXPIRY_MS;
  activeSessions.set(sessionId, { username, expires });
  return expires;
}

/** Asynchronously verifies signed HMAC session token or active session ID. */
export async function checkSessionAsync(token: string): Promise<string | null> {
  if (!token) return null;
  if (revokedSessions.has(token)) return null;

  const cached = activeSessions.get(token);
  if (cached) {
    if (Date.now() > cached.expires) {
      activeSessions.delete(token);
      return null;
    }
    return cached.username;
  }

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

/** Synchronously validates active session ID in memory map. */
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

/** Revokes active user session ID and adds token to revocation list. */
export function deleteSession(sessionId: string) {
  activeSessions.delete(sessionId);
  if (sessionId) {
    revokedSessions.add(sessionId);
  }
}

/** Renders HTML markup for Developer Mock Login and GitHub OAuth sign-in page. */
export function getLoginHtml(): string {
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
      <div class="login-header">
        <svg style="width:40px; height:40px; color:var(--accent-color); margin-bottom:12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        <h1 style="font-size:24px; margin-bottom:6px;">Marveluzz Hub</h1>
        <p style="color:var(--text-secondary); font-size:14px;">Sign in to access your IoT Control Dashboard</p>
      </div>

      ${MOCK_AUTH ? `
      <div style="background:rgba(217,119,6,0.15); border:1px solid #d97706; padding:12px; border-radius:8px; margin-bottom:20px; font-size:13px; color:#fef3c7;">
        <strong>⚠️ Mock Authentication Active (MOCK_AUTH=true)</strong>
        <p style="margin-top:4px; font-size:12px; opacity:0.9;">GitHub OAuth keys not configured. Developer Login enabled below.</p>
      </div>
      <form action="/login" method="POST" class="login-form">
        <div class="form-group">
          <label style="font-size:12px; color:var(--text-secondary); display:block; margin-bottom:6px;">Developer Username</label>
          <input type="text" name="username" placeholder="e.g. alice, bob, admin" required style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:rgba(0,0,0,0.3); color:white;">
        </div>
        <button type="submit" class="btn-action active-lease" style="width:100%; padding:12px; font-size:14px; font-weight:600; margin-top:10px; cursor:pointer;">Developer Login</button>
      </form>
      ` : `
      <a href="/login/github" class="btn-action active-lease" style="display:flex; align-items:center; justify-content:center; gap:10px; text-decoration:none; padding:14px; border-radius:8px; font-weight:600; font-size:15px; width:100%;">
        <svg style="width:20px; height:20px;" fill="currentColor" viewBox="0 0 24 24">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
        </svg>
        Sign in with GitHub
      </a>
      `}
    </div>
  </div>
</body>
</html>`;
}
