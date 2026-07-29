// Marveluzz Hub - Stateless Edge Ingest Server Entry Point (Deno Deploy)

import { APP_VERSION, REQUIRED_SCHEMA_VERSION, mockDb, supabase } from "./db.ts";
import { handleRequest } from "./routes.ts";

export { APP_VERSION, REQUIRED_SCHEMA_VERSION, mockDb, supabase };
export { DISABLE_AUTH, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, MOCK_AUTH, ALLOWED_GITHUB_USERS, COOKIE_NAME, SESSION_EXPIRY_MS, SESSION_SECRET, activeSessions, revokedSessions, createSignedSessionToken, createSession, checkSessionAsync, checkSession, deleteSession } from "./auth.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const HOST = "0.0.0.0";

if (import.meta.main) {
  console.log(`🚀 Marveluzz Hub Starting on http://${HOST}:${PORT}`);
  if (mockDb) {
    console.log("ℹ️ Running in Local Standalone Mode (Using in-memory Supabase Mock Engine).");
  }

  Deno.serve({ port: PORT, hostname: HOST }, handleRequest);
}
