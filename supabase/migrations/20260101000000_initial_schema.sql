-- Marveluzz Hub - Initial PostgreSQL Database Schema

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Core Entities: devices Table
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled IoT Device',
    status TEXT NOT NULL DEFAULT 'disconnected',
    controller_session_id TEXT,
    viewers_active BOOLEAN DEFAULT false,
    viewers_last_seen TIMESTAMPTZ DEFAULT NOW(),
    history_ttl_days INTEGER DEFAULT 7,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 3. UI Layout Schemas Table
CREATE TABLE IF NOT EXISTS public.ui_definitions (
    device_id UUID PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
    layout_def JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Latest Telemetry Snapshot Table
CREATE TABLE IF NOT EXISTS public.telemetry_latest (
    device_id UUID PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Time-Series Telemetry History Log Table
CREATE TABLE IF NOT EXISTS public.telemetry_history (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for high-performance history querying
CREATE INDEX IF NOT EXISTS idx_telemetry_history_device_created 
ON public.telemetry_history (device_id, created_at DESC);

-- 6. Command Dispatch Queue Table
CREATE TABLE IF NOT EXISTS public.device_commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'set_value',
    value JSONB DEFAULT 'true'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Enable Supabase Realtime Publication for WAL Change Broadcasts
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ui_definitions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.telemetry_latest;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_commands;

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_latest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read access for public dashboard views
CREATE POLICY "Allow public read access on devices" ON public.devices FOR SELECT USING (true);
CREATE POLICY "Allow public read access on ui_definitions" ON public.ui_definitions FOR SELECT USING (true);
CREATE POLICY "Allow public read access on telemetry_latest" ON public.telemetry_latest FOR SELECT USING (true);
CREATE POLICY "Allow public read access on telemetry_history" ON public.telemetry_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on device_commands" ON public.device_commands FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read access on device_commands" ON public.device_commands FOR SELECT USING (true);

-- 9. Atomic SQL RPC: ingest_telemetry
CREATE OR REPLACE FUNCTION public.ingest_telemetry(
    p_device_id UUID,
    p_device_key TEXT,
    p_telemetry_data JSONB
)
RETURNS TABLE (
    success BOOLEAN,
    viewers_active BOOLEAN,
    commands JSONB
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_key_match BOOLEAN;
    v_viewers_active BOOLEAN;
    v_commands JSONB;
BEGIN
    SELECT (device_key = p_device_key) INTO v_key_match
    FROM public.devices
    WHERE id = p_device_id;

    IF v_key_match IS NOT TRUE THEN
        RETURN QUERY SELECT false, false, '[]'::jsonb;
        RETURN;
    END IF;

    UPDATE public.devices
    SET last_seen = NOW(),
        status = CASE WHEN status = 'disconnected' THEN 'live' ELSE status END
    WHERE id = p_device_id
    RETURNING devices.viewers_active INTO v_viewers_active;

    INSERT INTO public.telemetry_latest (device_id, data, updated_at)
    VALUES (p_device_id, p_telemetry_data, NOW())
    ON CONFLICT (device_id) DO UPDATE 
    SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;

    INSERT INTO public.telemetry_history (device_id, data, created_at)
    VALUES (p_device_id, p_telemetry_data, NOW());

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'commandId', id,
        'target', target,
        'action', action,
        'value', value
    )), '[]'::jsonb) INTO v_commands
    FROM public.device_commands
    WHERE device_id = p_device_id AND status = 'pending';

    UPDATE public.device_commands
    SET status = 'executed'
    WHERE device_id = p_device_id AND status = 'pending';

    RETURN QUERY SELECT true, COALESCE(v_viewers_active, false), v_commands;
END;
$$;

-- 10. Atomic SQL RPC: register_ui_definition
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
    v_existing_key TEXT;
    v_title TEXT;
BEGIN
    SELECT device_key INTO v_existing_key
    FROM public.devices
    WHERE id = p_device_id;

    IF v_existing_key IS NULL THEN
        v_title := COALESCE(p_layout_def->>'title', 'Untitled IoT Device');
        INSERT INTO public.devices (id, device_key, title, status)
        VALUES (p_device_id, p_device_key, v_title, 'live');
    ELSIF v_existing_key <> p_device_key THEN
        RETURN false;
    END IF;

    INSERT INTO public.ui_definitions (device_id, layout_def, updated_at)
    VALUES (p_device_id, p_layout_def, NOW())
    ON CONFLICT (device_id) DO UPDATE
    SET layout_def = EXCLUDED.layout_def, updated_at = EXCLUDED.updated_at;

    RETURN true;
END;
$$;

-- 11. Atomic SQL RPC: acquire_control_lease
CREATE OR REPLACE FUNCTION public.acquire_control_lease(
    p_device_id UUID,
    p_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_lease TEXT;
BEGIN
    SELECT controller_session_id INTO v_current_lease
    FROM public.devices
    WHERE id = p_device_id;

    IF v_current_lease IS NULL OR v_current_lease = p_session_id THEN
        UPDATE public.devices
        SET controller_session_id = p_session_id,
            status = 'control'
        WHERE id = p_device_id;
        RETURN true;
    ELSE
        RETURN false;
    END IF;
END;
$$;

-- 12. Atomic SQL RPC: release_control_lease
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
    SET controller_session_id = NULL,
        status = 'live'
    WHERE id = p_device_id AND controller_session_id = p_session_id;

    RETURN FOUND;
END;
$$;

-- 13. Atomic SQL RPC: wipe_device_data
CREATE OR REPLACE FUNCTION public.wipe_device_data(
    p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.telemetry_history WHERE device_id = p_device_id;
    DELETE FROM public.device_commands WHERE device_id = p_device_id;
    DELETE FROM public.telemetry_latest WHERE device_id = p_device_id;
    DELETE FROM public.ui_definitions WHERE device_id = p_device_id;
    DELETE FROM public.devices WHERE id = p_device_id;
    RETURN true;
END;
$$;

-- 14. Atomic SQL RPC: purge_expired_telemetry
CREATE OR REPLACE FUNCTION public.purge_expired_telemetry()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM public.telemetry_history th
    USING public.devices d
    WHERE th.device_id = d.id
      AND th.created_at < NOW() - (d.history_ttl_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$;
