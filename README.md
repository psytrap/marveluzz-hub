# Marveluzz Hub

> **Next-Gen Stateless IoT Management Dashboard & Control Hub**  
> Official successor to [`Every-Panel`](../every-panel/every-panel/spec.md).

---

## ⚡ Overview

`Marveluzz Hub` is an edge-native, self-configuring IoT management server and dashboard system. Built as a hybrid application leveraging **Supabase** (PostgreSQL & Realtime) and **Deno Deploy** (Stateless Edge Functions), it eliminates the high 24/7 memory-time overhead of traditional WebSocket servers while preserving live real-time telemetry streaming and exclusive control leases.

Unlike static dashboards, `Marveluzz Hub` does not hardcode sensor layouts. Connected **IoT devices upload their own UI definitions** (a JSON array of UI widgets), which the browser dashboard dynamically renders at runtime.

---

## ✨ Key Features

* **Zero-Memory Idle Edge Scaling**: Deno Deploy Edge Functions process incoming device requests in milliseconds and instantly spin down to **0 MB memory**, reducing monthly Deno Deploy usage to `< 1 GB-hour`.
* **Supabase Realtime Engine**: Web clients connect directly to Supabase Realtime for instant live telemetry broadcasts and UI schema updates without holding Deno isolates awake.
* **Self-Configuring UI (Device-Driven)**: IoT devices supply their layout schema (buttons, sliders, gauges, text fields, charts, dividers) over HTTP POST.
* **Sleek Glassmorphism UI**: Identical dark-mode aesthetic to `Every-Panel` powered by Google Font *Outfit* and Chart.js telemetry plots.
* **Exclusive Control Lease**: Single-controller write lock for IoT nodes to prevent conflicting inputs across multiple browser tabs.
* **Fast Time-Series History**: PostgreSQL database indexing provides fast O(1) telemetry history retrieval.

---

## 🏗️ Architecture

```mermaid
graph TD
    subgraph IoT Devices
        Device["IoT Node (ESP32 / Raspberry Pi)"]
    end

    subgraph Deno Deploy (Stateless Edge)
        EdgeFn["Deno Edge Ingest Endpoint"]
    end

    subgraph Supabase Cloud
        DB[("Supabase PostgreSQL DB")]
        Realtime["Supabase Realtime Engine"]
    end

    subgraph Web Browsers
        Dashboard["Marveluzz Dashboard UI"]
    end

    Device -->|"1. HTTP POST Ingest (Telemetry / Schema)"| EdgeFn
    EdgeFn -->|"2. Authenticate & Write"| DB
    DB -->|"3. Change Stream Event"| Realtime
    Realtime -->|"4. Realtime Websocket Stream"| Dashboard
    Dashboard -->|"5. Command Action (HTTP POST)"| EdgeFn
```

---

## 📁 Project Structure

```
marveluzz-hub/
├── README.md             # Project documentation & overview
├── spec.md               # Detailed architectural specification
├── supabase_schema.sql   # Complete Supabase SQL schema, RLS, and RPC functions
└── public/
    ├── index.html        # Main dashboard HTML template
    ├── style.css         # Glassmorphism design tokens & styles
    └── app.js            # Frontend logic & Supabase client integration
```

---

## 🚀 Quick Start & Setup

### 1. Set Up Supabase Database
1. Create a new project on [Supabase](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Paste and run the contents of [`supabase_schema.sql`](./supabase_schema.sql).

### 2. Configure Environment Variables
Copy `.env.example` to `.env` (or set environment variables in Deno Deploy):
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Run Locally
```bash
deno run --allow-net --allow-env --allow-read src/main.ts
```

---

## 📜 License

MIT License. See LICENSE for details.
