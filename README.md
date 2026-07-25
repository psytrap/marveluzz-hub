# Marveluzz Hub

> **Next-Gen Stateless IoT Management Dashboard & Control Hub**  
> Official successor to [`Every-Panel`](../every-panel/every-panel/spec.md).

---

## ⚡ Overview

`Marveluzz Hub` is an edge-native, self-configuring IoT management server and dashboard system. Built as a hybrid application leveraging **Supabase** (PostgreSQL & Realtime) and **Deno Deploy** (Stateless Edge Functions), it eliminates the high 24/7 memory-time overhead of traditional WebSocket servers while preserving live real-time telemetry streaming and exclusive control leases.

Unlike static dashboards, `Marveluzz Hub` does not hardcode sensor layouts. Connected **IoT nodes upload their own UI definitions** (a JSON array of UI widgets), which the browser dashboard dynamically renders at runtime.

---

## ✨ Key Features

* **Zero-Memory Idle Edge Scaling**: Deno Deploy Edge Functions process incoming device requests in milliseconds and instantly spin down to **0 MB memory**, reducing monthly Deno Deploy usage to `< 1 GB-hour`.
* **Supabase Realtime Engine**: Web clients connect directly to Supabase Realtime for instant live telemetry broadcasts and UI schema updates without holding Deno isolates awake.
* **Self-Configuring UI (Device-Driven)**: IoT nodes supply their layout schema (buttons, sliders, gauges, text fields, charts, dividers) over HTTP POST.
* **Sleek Glassmorphism UI**: Identical dark-mode aesthetic to `Every-Panel` powered by Google Font *Outfit* and Chart.js telemetry plots.
* **Exclusive Control Lease**: Single-controller write lock for IoT nodes to prevent conflicting inputs across multiple browser tabs.
* **Fast Time-Series History**: PostgreSQL database indexing provides fast O(1) telemetry history retrieval.

---

## 🏗️ Architecture

```mermaid
graph TD
    subgraph IoT Devices
        Device["IoT Node Simulator (ESP32 / Raspberry Pi)"]
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
├── spec.md               # Detailed architectural specification & migration guide
├── supabase_schema.sql   # Complete Supabase SQL schema, RLS, and RPC functions
├── deno.json             # Task runner configuration
├── src/
│   └── main.ts           # Stateless Deno Edge Server
├── public/
│   ├── index.html        # Main dashboard HTML template
│   ├── style.css         # Glassmorphism design tokens & styles
│   └── app.js            # Frontend logic & Supabase client integration
├── examples/
│   └── device_emulator.ts # Interactive IoT node simulator web panel (Port 8001)
└── tests/
    ├── integration_test.ts # Integration test suite
    └── supabase_mock.ts    # Realistic Supabase mock engine
```

---

## 🛠️ Step-by-Step Production Setup Guide (Supabase Cloud + Deno Deploy)

### Prerequisites
* **Deno 2.x** installed locally (`deno --version`).
* Free account on **[Supabase Cloud](https://supabase.com)**.
* Free account on **[Deno Deploy](https://dash.deno.com)**.

---

### Step 1: Set Up Supabase Database (Production Mode)
1. Log in to [Supabase Cloud](https://supabase.com) and create a new project to obtain your `<project-id>`.
2. Open the **SQL Editor** in your Supabase project dashboard.
3. Copy the entire contents of [`supabase_schema.sql`](./supabase_schema.sql), paste into the SQL Editor, and click **Run**.
4. Go to **Project Settings -> API** and copy:
   - **Project URL**: `https://<project-id>.supabase.co`
   - **anon public key**: `<your-anon-public-key>`
   - **service_role secret key**: `<your-service-role-secret-key>`

---

### Step 2: Deploy Edge Server to Deno Deploy
1. Log in to [Deno Deploy Dashboard](https://dash.deno.com).
2. Click **New Project** and select your repository.
3. Set the **Entrypoint** to `src/main.ts`.
4. Go to **Project Settings -> Environment Variables** and add:
   ```env
   SUPABASE_URL=https://<project-id>.supabase.co
   SUPABASE_ANON_KEY=<your-anon-public-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-secret-key>
   ```
5. Click **Deploy**. Your Deno Deploy production dashboard will be live at:
   ```
   https://<deno-project-id>.deno.dev
   ```

---

### Step 3: Local Development & Standalone Testing Setup

#### Option A: Local Dev Mode (No Supabase Account Required)
If `SUPABASE_URL` is omitted from environment variables, `src/main.ts` automatically runs in **Standalone Local Mode** using the in-memory Supabase Engine Mock:
```bash
# 1. Start local edge server
deno task dev

# 2. Run IoT Node Simulator in another terminal
deno task emulator

# 3. Open http://localhost:8000 in your browser
```

#### Option B: Run Integration Tests
```bash
deno task test
```

---

## 🔄 Deployment Synchronization & Staging CLI Workflows

For complete deployment specifications, CLI promotion pipelines (`supabase db push`, `deployctl`), and staging environment workflows, refer to [`spec.md`](./spec.md).

---

## 📜 License

MIT License. See LICENSE for details.
