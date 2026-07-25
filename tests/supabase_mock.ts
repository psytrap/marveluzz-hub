// Marveluzz Hub - Realistic Supabase Mock Engine
// Mirrors public.devices, public.ui_definitions, public.telemetry_latest,
// public.telemetry_history, public.device_commands & SQL RPCs from supabase_schema.sql

export interface DeviceRecord {
  id: string;
  device_key: string;
  title: string;
  status: string; // 'detached', 'live', 'control', 'fault'
  controller_session_id: string | null;
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

  // Pre-seed a registered device for testing
  constructor() {
    this.seedDevice("32323232-3232-4232-8232-28c13340c86c", "secret_passcode_123", "ESP32 Temperature Node");
  }

  public seedDevice(id: string, key: string, title = "Test Node") {
    this.devices.set(id, {
      id,
      device_key: key,
      title,
      status: "detached",
      controller_session_id: null,
      registered_at: new Date().toISOString(),
      last_seen: new Date().toISOString()
    });
  }

  // Mirrors RPC function: register_ui_definition
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

  // Mirrors RPC function: ingest_telemetry
  public ingestTelemetry(deviceId: string, deviceKey: string, telemetryData: Record<string, unknown>) {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.device_key !== deviceKey) {
      throw new Error("Unauthorized: Invalid Device ID or Device Key.");
    }

    const now = new Date().toISOString();

    // 1. Update last seen & status
    dev.last_seen = now;
    if (dev.status === "detached") {
      dev.status = "live";
    }

    // 2. Upsert telemetry latest
    this.telemetryLatest.set(deviceId, {
      device_id: deviceId,
      data: telemetryData,
      updated_at: now
    });

    // 3. Append to telemetry history
    this.telemetryHistory.push({
      id: this.historyIdCounter++,
      device_id: deviceId,
      data: telemetryData,
      created_at: now
    });

    // 4. Fetch and mark pending commands as executed
    const executedCommands: Array<{ command_id: string; target: string; action: string; value: unknown }> = [];
    for (const cmd of this.deviceCommands.values()) {
      if (cmd.device_id === deviceId && cmd.status === "pending") {
        cmd.status = "executed";
        executedCommands.push({
          command_id: cmd.id,
          target: cmd.target,
          action: cmd.action,
          value: cmd.value
        });
      }
    }

    return executedCommands;
  }

  // Fetch telemetry history with O(1) limit & reverse ordering (matching PostgreSQL id DESC)
  public getHistory(deviceId: string, limit = 50): TelemetryHistoryRecord[] {
    return this.telemetryHistory
      .filter(item => item.device_id === deviceId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  // Queue a command from web client
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
}
