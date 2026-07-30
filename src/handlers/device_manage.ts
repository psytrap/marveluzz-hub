// Marveluzz Hub - Device Management & Storage Lifecycle Route Handler (device_manage.ts)

import { mockDb, supabase } from "../db.ts";
import { getAuthenticatedUser } from "../auth.ts";

export async function handleDeviceManageRoutes(req: Request, url: URL): Promise<Response | null> {
  const pathname = url.pathname;

  // Device Storage Footprint Statistics & Metrics Endpoint
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

  // Device Management: Retention TTL Update Endpoint
  if (pathname === "/api/device/update_retention" && req.method === "POST") {
    const user = await getAuthenticatedUser(req);
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
    const user = await getAuthenticatedUser(req);
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

  // Device Management: Rotate Device Secret Key Endpoint
  if (pathname === "/api/device/rotate_key" && req.method === "POST") {
    const user = await getAuthenticatedUser(req);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
      const { deviceId } = await req.json();
      if (!deviceId) return new Response(JSON.stringify({ error: "Missing deviceId" }), { status: 400 });

      const newKey = `sk_live_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`;

      if (supabase) {
        const { error } = await supabase.rpc("rotate_device_key", {
          p_device_id: deviceId,
          p_new_key: newKey
        });
        if (error) throw error;
      } else if (mockDb) {
        mockDb.rotateDeviceKey(deviceId, newKey);
      }

      return new Response(JSON.stringify({ success: true, newKey }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Wipe Device Storage & Delete Device Record Endpoint
  if ((pathname === "/api/devices/delete" || pathname === "/api/device/delete") && req.method === "POST") {
    const user = await getAuthenticatedUser(req);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
      const { deviceId, deleteRecord } = await req.json();
      if (!deviceId) return new Response(JSON.stringify({ error: "Missing deviceId" }), { status: 400 });

      if (supabase) {
        await supabase.from("telemetry_history").delete().eq("device_id", deviceId);
        await supabase.from("telemetry_latest").delete().eq("device_id", deviceId);
        await supabase.from("ui_definitions").delete().eq("device_id", deviceId);
        await supabase.from("device_commands").delete().eq("device_id", deviceId);
        if (deleteRecord) {
          await supabase.from("devices").delete().eq("id", deviceId);
        } else {
          await supabase.from("devices").update({ status: "detached", controller_session_id: null }).eq("id", deviceId);
        }
      } else if (mockDb) {
        mockDb.wipeDeviceData(deviceId);
        if (deleteRecord) {
          mockDb.devices.delete(deviceId);
        }
      }
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  return null;
}
