# System Monitor (Tauri)

Desktop system monitor built with **Tauri 1** (Rust backend) and **React + TypeScript** (Vite) frontend. Shows CPU, memory, disk, network, and GPU metrics with live charts.

---

## Prerequisites

- **Node.js** (v16+)
- **Rust** ([rustup](https://rustup.rs))
- **Windows:** WebView2 (usually already installed on Windows 10/11)
- **Tauri CLI** is installed as a dev dependency; no global install needed.

---

## Installation

From the project root (`sys-monitor-tauri`):

```bash
npm install
```

---

## Commands

All commands below are run from **`sys-monitor-tauri`** unless stated otherwise.

### Run the app (development)

Starts the Vite dev server and opens the Tauri desktop window with live metrics:

```bash
npm run tauri dev
```

### Run the app (production build)

Builds the frontend and Rust backend, then runs the compiled app:

```bash
npm run tauri build
npm run tauri dev
```

Or run the built binary directly:

- **Windows:** `src-tauri\target\release\sys-monitor-tauri.exe`
- Installer (if configured): `src-tauri\target\release\bundle\`

### Frontend only (browser, mock data)

Run the React app in the browser with mock metrics (no Rust backend):

```bash
npm run dev
```

Then open the URL shown (e.g. `http://localhost:5173`).

### Build frontend only

Type-check and bundle the React app (no Tauri window):

```bash
npm run build
```

Output: `dist/`

### Preview frontend build

Serve the built frontend locally:

```bash
npm run preview
```

### Rust tests

Run the backend unit tests from the Tauri crate directory:

```bash
cd src-tauri
cargo test
```

Or from repo root:

```bash
cd sys-monitor-tauri/src-tauri && cargo test
```

### Other Tauri CLI commands

- **Tauri dev:** `npm run tauri dev`
- **Tauri build:** `npm run tauri build`
- **Tauri info:** `npm run tauri info` (versions, environment)

---

## Project layout

| Path | Description |
|------|-------------|
| `src/` | React frontend (App, components, hooks, types) |
| `src-tauri/` | Rust backend (Tauri app, collector, state, main) |
| `src-tauri/src/` | Rust source (`main.rs`, `collector.rs`, `state.rs`) |
| `dist/` | Built frontend (after `npm run build`) |
| `src-tauri/target/release/` | Built binary and bundle after `npm run tauri build` |

---

## Notes

- **CPU name:** The app uses sysinfo and, on Windows, a WMI fallback so the real processor name is shown when possible.
- **Metrics:** Utilization and similar values are clamped to non-negative; charts use a minimum y-axis of 0.
- **Platform:** The collector uses Windows-specific APIs (PDH, WMI); the app is intended for Windows.
