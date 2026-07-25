# Specification Document: Marveluzz Hub

This project is the official successor to [`every-panel spec.md`](file:///home/mik/Documents/Bastel/2023-/every-panel/every-panel/spec.md).

---

## 1. Project Overview & Evolution

`Marveluzz Hub` inherits and expands upon the core principles defined in `Every-Panel`. It provides an advanced, scalable, self-configuring IoT management server and dashboard system.

### Motivation & Problem Statement
In `Every-Panel`, maintaining persistent 24/7 WebSocket connections and Deno KV Watchers on Deno Deploy's free tier kept Deno isolates alive continuously, leading to high **memory time (GB-hours)** usage. 

To overcome this free-tier limitation, `Marveluzz Hub` introduces a **stateless Edge + Supabase hybrid architecture**.

---

## 2. Hybrid Architecture: Supabase + Deno Deploy

### Core Stack Responsibilities
1. **Supabase (Database & Realtime)**:
   * **PostgreSQL Database**: Persistent storage for telemetry data, device UI definitions, settings, and historical logs.
   * **Supabase Realtime / Webhooks**: Real-time pub/sub messaging and state broadcasts directly to web clients without keeping Deno isolates awake.
   * **Authentication & RLS**: Row Level Security and built-in Auth for user control rights.

2. **Deno Deploy (Stateless Edge Functions)**:
   * **Stateless HTTP Endpoints**: Lightweight, on-demand Edge Functions for device key validation, telemetry processing, and command dispatch.
   * **Zero-Memory Idle Scaling**: Isolate instances execute in milliseconds and immediately spin down to 0 MB memory, eliminating 24/7 memory-time accumulation.

---

## 3. Data & Communication Flow

```mermaid
graph TD
    subgraph IoT Devices
        Device["IoT Device / Node"]
    end

    subgraph Deno Deploy (Stateless Edge)
        EdgeFn["Deno Edge Function / API"]
    end

    subgraph Supabase Backend
        DB[("Supabase PostgreSQL DB")]
        Realtime["Supabase Realtime / PubSub"]
    end

    subgraph Web Clients
        Browser["Dashboard Browser UI"]
    end

    Device -->|"HTTP POST (Telemetry / Layout)"| EdgeFn
    EdgeFn -->|"Validate & Write"| DB
    DB -->|"Trigger Change Stream"| Realtime
    Realtime -->|"WebSocket Stream (Direct)"| Browser
    Browser -->|"HTTP POST (Commands)"| EdgeFn
```

### Advantages of the Hybrid Approach:
* **Near-Zero Deno Deploy Costs**: Memory time on Deno Deploy drops to `< 1 GB-hour/month` because isolates only execute during active request handling.
* **Scalable Data History**: Supabase PostgreSQL handles large historical time-series telemetry querying seamlessly.
* **Decoupled Realtime Layer**: Web clients receive real-time UI updates directly from Supabase Realtime.
