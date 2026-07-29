// Marveluzz Hub - Database & Engine Initialization Module (db.ts)

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { MockSupabaseEngine } from "../tests/supabase_mock.ts";

export const APP_VERSION = "1.0.44";
export const REQUIRED_SCHEMA_VERSION = "20260728000000";
export const START_TIME = Date.now();

// 4 Standard Supabase Environment Variables
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
export const SUPABASE_JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET");

// Fallback to local in-memory Mock DB if Supabase credentials are not set
export const mockDb: MockSupabaseEngine | null = (!SUPABASE_URL || (!SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_ANON_KEY)) ? new MockSupabaseEngine() : null;
export const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
export const supabase: SupabaseClient | null = (SUPABASE_URL && supabaseKey)
  ? createClient(SUPABASE_URL, supabaseKey)
  : null;
