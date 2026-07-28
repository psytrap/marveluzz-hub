-- ==========================================================
-- Marveluzz Hub - Supabase Database & Realtime Schema
-- Successor to Every-Panel IoT Dashboard Architecture
-- ==========================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Devices Table (Authorization, Status, Leases, Presence & Settings)
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'IoT Device',
    status TEXT NOT NULL DEFAULT 'detached', -- 'detached', 'live', 'control', 'fault'
    controller_session_id TEXT DEFAULT NULL,
    viewers_active BOOLEAN NOT NULL DEFAULT false,
    viewers_last_seen TIMESTAMPTZ DEFAULT NOW(),
    history_ttl_days INTEGER NOT NULL DEFAULT 7,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 2. UI Definitions Table (Device-Driven Dynamic UI Schemas)
CREATE TABLE IF NOT EXISTS public.ui_definitions (
    device_id UUID PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
    layout_def JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Telemetry Latest Table (Current State Cache for Quick Reads)
CREATE TABLE IF NOT EXISTS public.telemetry_latest (
    device_id UUID PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Telemetry History Table (Time-series Log Data)
CREATE TABLE IF NOT EXISTS public.telemetry_history (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast time-series queries (O(1) limited history fetches)
CREATE INDEX IF NOT EXISTS idx_telemetry_history_device_created 
ON public.telemetry_history (device_id, created_at DESC);

-- 5. Device Commands Table (Pending Commands & Control Queue)
CREATE TABLE IF NOT EXISTS public.device_commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    action TEXT NOT NULL,
    value JSONB DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'executed', 'failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- Enable Supabase Realtime for Live Dashboard Updates
-- ==========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ui_definitions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.telemetry_latest;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_commands;

-- ==========================================================
-- Stored Procedures / RPC Functions for IoT Device Ingest & Leases
-- ==========================================================

-- Ingest Telemetry & Return Pending Commands + Viewer Presence
CREATE OR REPLACE FUNCTION public.ingest_telemetry(
    p_device_id UUID,
    p_device_key TEXT,
    p_telemetry_data JSONB
)
RETURNS TABLE (
    command_id UUID,
    target TEXT,
    action TEXT,
    value JSONB,
    viewers_active BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_valid BOOLEAN;
    v_viewers_active BOOLEAN;
BEGIN
    -- 1. Authenticate Device Key
    SELECT EXISTS (
        SELECT 1 FROM public.devices 
        WHERE id = p_device_id AND device_key = p_device_key
    ) INTO v_valid;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'Unauthorized: Invalid Device ID or Device Key.';
    END IF;

    -- 2. Fetch viewers_active state & update last_seen
    SELECT d.viewers_active INTO v_viewers_active
    FROM public.devices d WHERE d.id = p_device_id;

    UPDATE public.devices 
    SET last_seen = NOW(), 
        status = CASE WHEN status = 'detached' THEN 'live' ELSE status END
    WHERE id = p_device_id;

    -- 3. Upsert Telemetry Latest
    INSERT INTO public.telemetry_latest (device_id, data, updated_at)
    VALUES (p_device_id, p_telemetry_data, NOW())
    ON CONFLICT (device_id) 
    DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

    -- 4. Record Telemetry History Log
    INSERT INTO public.telemetry_history (device_id, data, created_at)
    VALUES (p_device_id, p_telemetry_data, NOW());

    -- 5. Fetch and Mark Pending Commands for Execution
    RETURN QUERY
    WITH pending AS (
        SELECT id FROM public.device_commands
        WHERE device_id = p_device_id AND status = 'pending'
        ORDER BY created_at ASC
        FOR UPDATE
    )
    UPDATE public.device_commands dc
    SET status = 'executed'
    FROM pending p
    WHERE dc.id = p.id
    RETURNING dc.id AS command_id, dc.target, dc.action, dc.value, v_viewers_active;
END;
$$;

-- Register or Update UI Definition Schema
CREATE OR REPLACE FUNCTION public.register_ui_definition(
    p_device_id UUID,
    p_device_key TEXT,
    p_layout_def JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_valid BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.devices 
        WHERE id = p_device_id AND device_key = p_device_key
    ) INTO v_valid;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'Unauthorized: Invalid Device ID or Device Key.';
    END IF;

    INSERT INTO public.ui_definitions (device_id, layout_def, updated_at)
    VALUES (p_device_id, p_layout_def, NOW())
    ON CONFLICT (device_id) 
    DO UPDATE SET layout_def = EXCLUDED.layout_def, updated_at = EXCLUDED.updated_at;

    RETURN TRUE;
END;
$$;

-- Acquire Exclusive Control Lease
CREATE OR REPLACE FUNCTION public.acquire_control_lease(
    p_device_id UUID,
    p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_session TEXT;
BEGIN
    SELECT controller_session_id INTO v_current_session
    FROM public.devices
    WHERE id = p_device_id;

    IF v_current_session IS NOT NULL AND v_current_session <> p_session_id THEN
        RETURN FALSE; -- Lease locked by another active session!
    END IF;

    UPDATE public.devices
    SET status = 'control',
        controller_session_id = p_session_id
    WHERE id = p_device_id;

    RETURN TRUE;
END;
$$;

-- Release Exclusive Control Lease
CREATE OR REPLACE FUNCTION public.release_control_lease(
    p_device_id UUID,
    p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.devices
    SET status = 'live',
        controller_session_id = NULL
    WHERE id = p_device_id AND controller_session_id = p_session_id;

    RETURN TRUE;
END;
$$;

-- Wipe Device Storage Data
CREATE OR REPLACE FUNCTION public.wipe_device_data(
    p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.telemetry_history WHERE device_id = p_device_id;
    DELETE FROM public.telemetry_latest WHERE device_id = p_device_id;
    DELETE FROM public.ui_definitions WHERE device_id = p_device_id;
    DELETE FROM public.device_commands WHERE device_id = p_device_id;
    
    UPDATE public.devices 
    SET status = 'detached', controller_session_id = NULL 
    WHERE id = p_device_id;

    RETURN TRUE;
END;
$$;

-- Clean Up Expired Telemetry Logs Based on Retention TTL
CREATE OR REPLACE FUNCTION public.purge_expired_telemetry()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM public.telemetry_history th
        USING public.devices d
        WHERE th.device_id = d.id 
          AND th.created_at < NOW() - (d.history_ttl_days || ' days')::INTERVAL
        RETURNING th.id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;

    RETURN v_deleted_count;
END;
$$;

-- Schema Version & Contract Compatibility Function
CREATE OR REPLACE FUNCTION public.schema_version()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT '20260728000000'::text;
$$;

-- ==========================================================
-- Row Level Security (RLS) Policies
-- ==========================================================
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_latest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Devices" ON public.devices FOR SELECT USING (true);
CREATE POLICY "Public Read UI Definitions" ON public.ui_definitions FOR SELECT USING (true);
CREATE POLICY "Public Read Telemetry Latest" ON public.telemetry_latest FOR SELECT USING (true);
CREATE POLICY "Public Read Telemetry History" ON public.telemetry_history FOR SELECT USING (true);
CREATE POLICY "Public Read Device Commands" ON public.device_commands FOR SELECT USING (true);

-- Grant Public & Service Role Access for Schema Version Compatibility RPC
GRANT EXECUTE ON FUNCTION public.schema_version() TO anon, authenticated, service_role;

-- Force PostgREST Schema Cache Reload
NOTIFY pgrst, 'reload schema';
