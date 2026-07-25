-- ==========================================================
-- Marveluzz Hub - Supabase Database & Realtime Schema
-- Successor to Every-Panel IoT Dashboard Architecture
-- ==========================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Devices Table (Authorization, Status, and Control Leases)
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'IoT Device',
    status TEXT NOT NULL DEFAULT 'detached', -- 'detached', 'live', 'control', 'fault'
    controller_session_id TEXT DEFAULT NULL,
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
-- Stored Procedures / RPC Functions for IoT Device Ingest
-- ==========================================================

-- Ingest Telemetry & Return Pending Commands (Atomically)
CREATE OR REPLACE FUNCTION public.ingest_telemetry(
    p_device_id UUID,
    p_device_key TEXT,
    p_telemetry_data JSONB
)
RETURNS TABLE (
    command_id UUID,
    target TEXT,
    action TEXT,
    value JSONB
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_valid BOOLEAN;
BEGIN
    -- 1. Authenticate Device Key
    SELECT EXISTS (
        SELECT 1 FROM public.devices 
        WHERE id = p_device_id AND device_key = p_device_key
    ) INTO v_valid;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'Unauthorized: Invalid Device ID or Device Key.';
    END IF;

    -- 2. Update Device Last Seen & Status
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
    RETURNING dc.id AS command_id, dc.target, dc.action, dc.value;
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
    -- Authenticate Device Key
    SELECT EXISTS (
        SELECT 1 FROM public.devices 
        WHERE id = p_device_id AND device_key = p_device_key
    ) INTO v_valid;

    IF NOT v_valid THEN
        RAISE EXCEPTION 'Unauthorized: Invalid Device ID or Device Key.';
    END IF;

    -- Upsert UI Definition
    INSERT INTO public.ui_definitions (device_id, layout_def, updated_at)
    VALUES (p_device_id, p_layout_def, NOW())
    ON CONFLICT (device_id) 
    DO UPDATE SET layout_def = EXCLUDED.layout_def, updated_at = EXCLUDED.updated_at;

    RETURN TRUE;
END;
$$;

-- ==========================================================
-- Row Level Security (RLS) Policies
-- ==========================================================
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_latest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

-- Allow public read access to dashboards (or restrict to authenticated users)
CREATE POLICY "Public Read Devices" ON public.devices FOR SELECT USING (true);
CREATE POLICY "Public Read UI Definitions" ON public.ui_definitions FOR SELECT USING (true);
CREATE POLICY "Public Read Telemetry Latest" ON public.telemetry_latest FOR SELECT USING (true);
CREATE POLICY "Public Read Telemetry History" ON public.telemetry_history FOR SELECT USING (true);
CREATE POLICY "Public Read Device Commands" ON public.device_commands FOR SELECT USING (true);
