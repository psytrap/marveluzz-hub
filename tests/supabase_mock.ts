// Marveluzz Hub - Realistic Supabase Mock Engine (Phase 1 Enhanced)
// Mirrors public.devices, public.ui_definitions, public.telemetry_latest,
// public.telemetry_history, public.device_commands & SQL RPCs from supabase_schema.sql

export interface DeviceRecord {
  id: string;
  device_key: string;
  title: string;
  status: string; // 'detached', 'live', 'control', 'fault'
  controller_session_id: string | null;
  viewers_active: boolean;
  viewers_last_seen: string;
  history_ttl_days: number;
  registered_at: string;
  last_seen: string;
}

export interface UIDefinitionRecord {
  device_id: string;
  layout_def: Record<string, unknown>;
  updated_at: string;
}

export interface TelemetryLatestRecord {
  device_id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

export interface TelemetryHistoryRecord {
  id: number;
  device_id: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface DeviceCommandRecord {
  id: string;
  device_id: string;
  target: string;
  action: string;
  value: unknown;
  status: string; // 'pending', 'executed', 'failed'
  created_at: string;
}

export class MockSupabaseEngine {
  public devices = new Map<string, DeviceRecord>();
  public uiDefinitions = new Map<string, UIDefinitionRecord>();
  public telemetryLatest = new Map<string, TelemetryLatestRecord>();
  public telemetryHistory: TelemetryHistoryRecord[] = [];
  public deviceCommands = new Map<string, DeviceCommandRecord>();
  private historyIdCounter = 1;

  constructor() {
    this.seedDevice("32323232-3232-4232-8232-28c13340c86c", "secret_passcode_123", "IoT Device Emulator Node");
  }

  public seedDevice(id: string, key: string, title = "Test Node") {
    this.devices.set(id, {
      id,
      device_key: key,
      title,
      status: "detached",
      controller_session_id: null,
      viewers_active: false,
      viewers_last_seen: new Date().toISOString(),
      history_ttl_days: 7,
      registered_at: new Date().toISOString(),
      last_seen: new Date().toISOString()
    });
  }

  // Mirrors RPC: register_ui_definition
  public registerUIDefinition(deviceId: string, deviceKey: string, layoutDef: Record<string, unknown>): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.device_key !== deviceKey) {
      throw new Error("Unauthorized: Invalid Device ID or Device Key.");
    }

    this.uiDefinitions.set(deviceId, {
      device_id: deviceId,
      layout_def: layoutDef,
      updated_at: new Date().toISOString()
    });
    return true;
  }

  // Mirrors RPC: ingest_telemetry
  public ingestTelemetry(deviceId: string, deviceKey: string, telemetryData: Record<string, unknown>) {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.device_key !== deviceKey) {
      throw new Error("Unauthorized: Invalid Device ID or Device Key.");
    }

    const now = new Date().toISOString();

    dev.last_seen = now;
    if (dev.status === "detached") {
      dev.status = "live";
    }

    this.telemetryLatest.set(deviceId, {
      device_id: deviceId,
      data: telemetryData,
      updated_at: now
    });

    this.telemetryHistory.push({
      id: this.historyIdCounter++,
      device_id: deviceId,
      data: telemetryData,
      created_at: now
    });

    return [{
      command_id: null,
      target: null,
      action: null,
      value: null,
      viewers_active: dev.viewers_active
    }];
  }

  public updateDeviceViewersActive(deviceId: string, active: boolean) {
    const dev = this.devices.get(deviceId);
    if (dev) {
      dev.viewers_active = active;
      dev.viewers_last_seen = new Date().toISOString();
    }
  }

  // Mirrors RPC: acquire_control_lease
  public acquireControlLease(deviceId: string, sessionId: string): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;

    dev.status = "control";
    dev.controller_session_id = sessionId;
    return true;
  }

  // Mirrors RPC: release_control_lease
  public releaseControlLease(deviceId: string, sessionId: string): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.controller_session_id !== sessionId) return false;

    dev.status = "live";
    dev.controller_session_id = null;
    return true;
  }

  // Mirrors RPC: wipe_device_data
  public wipeDeviceData(deviceId: string): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;

    this.telemetryLatest.delete(deviceId);
    this.uiDefinitions.delete(deviceId);

    this.telemetryHistory = this.telemetryHistory.filter(item => item.device_id !== deviceId);

    for (const [id, cmd] of this.deviceCommands.entries()) {
      if (cmd.device_id === deviceId) {
        this.deviceCommands.delete(id);
      }
    }

    dev.status = "detached";
    dev.controller_session_id = null;
    return true;
  }

  // Mirrors RPC: purge_expired_telemetry
  public purgeExpiredTelemetry(): number {
    let deletedCount = 0;
    const now = Date.now();

    this.telemetryHistory = this.telemetryHistory.filter(item => {
      const dev = this.devices.get(item.device_id);
      if (!dev) return false;

      const ttlMs = dev.history_ttl_days * 24 * 60 * 60 * 1000;
      const ageMs = now - new Date(item.created_at).getTime();

      if (ageMs > ttlMs) {
        deletedCount++;
        return false;
      }
      return true;
    });

    return deletedCount;
  }

  public getHistory(deviceId: string, limit = 50): TelemetryHistoryRecord[] {
    return this.telemetryHistory
      .filter(item => item.device_id === deviceId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  public queueCommand(deviceId: string, target: string, action: string, value: unknown = null): string {
    const id = crypto.randomUUID();
    this.deviceCommands.set(id, {
      id,
      device_id: deviceId,
      target,
      action,
      value,
      status: "pending",
      created_at: new Date().toISOString()
    });
    return id;
  }

  // Key rotation, retention TTL, and purge helpers
  public rotateDeviceKey(deviceId: string, newKey: string): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;
    dev.device_key = newKey;
    return true;
  }

  public updateRetention(deviceId: string, ttlDays: number): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;
    dev.history_ttl_days = ttlDays;
    return true;
  }

  public purgeTelemetry(deviceId: string): number {
    const initialLen = this.telemetryHistory.length;
    this.telemetryHistory = this.telemetryHistory.filter(item => item.device_id !== deviceId);
    return initialLen - this.telemetryHistory.length;
  }

  // Mirrors RPC: schema_version
  public schemaVersion(): string {
    return "20260728000000";
  }
}
