# System Monitor (Tauri)

Desktop system monitor built with **Tauri 2** (Rust backend) and **React + TypeScript** (Vite) frontend. Shows CPU, memory, disk, network, and GPU metrics with live charts.

---

## Prerequisites

- **Node.js** (v24+, matching CI)
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

### Build the app (production)

Builds the frontend and Rust backend. A build does not launch the app:

```bash
npm run tauri build
```

Run the built binary directly when the build completes:

- **Windows:** `src-tauri\target\release\sys-monitor-tauri.exe`
- Installer (if configured): `src-tauri\target\release\bundle\`

### Frontend only (browser, mock data)

Run the React app in the browser with mock metrics (no Rust backend):

```bash
npm run dev
```

Then open the URL shown (`http://127.0.0.1:5180`, strict port).

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

### Verification gates

The canonical gates are shared by local development and CI:

```bash
npm run verify:fast       # frontend + Rust checks, including audits
npm run verify:full       # fast checks + E2E + mock simulation + Tauri executable
npm run verify:version    # package/Cargo/Tauri release-version consistency
npm run verify:packaged   # build the exe, then drive the real app via CDP:
                          # real IPC history, live collector data, per-run isolated
                          # settings store, clean exit, no orphan processes
```

The MSI/NSIS installer build runs automatically for version tags and manual
workflow dispatch. `.github/workflows/release-qualification.yml` (dispatch/tag
too) additionally qualifies each installer on a clean Windows runner — silent
install, registry-verified product/version identity, smoke test of the
**installed** executable, silent uninstall with removal assertions — and uploads
installers plus a hashed `release-manifest.json` (version, commit, sizes,
SHA-256, signing status, qualification result). Installers are unsigned: no code
signing certificate exists for this project.

The backend is Windows-only; frontend tests and builds can run elsewhere.

---

## Project layout

| Path | Description |
|------|-------------|
| `src/` | React frontend (App, components, hooks, types) |
| `src-tauri/` | Rust backend (Tauri app, collector, state, main) |
| `src-tauri/src/` | Rust source (`main.rs`, `lib.rs`, `state.rs`, `cadence.rs`, `sensor.rs`, `hardware.rs`, `pdh.rs`, `collector/`, `bin/cadence_probe.rs`) |
| `dist/` | Built frontend (after `npm run build`) |
| `src-tauri/target/release/` | Built binary and bundle after `npm run tauri build` |

---

## Notes

- **Collector recovery:** Collection runs as supervised sessions. A panic ends
  one session; bounded automatic recovery replaces it (staged backoff, healthy-
  period streak reset) and an exhausted budget surfaces a persistent failure
  state with a working Retry metrics control — no application restart needed.
  History survives sessions; downtime stays a truthful timestamp gap, and rate
  counters are re-baselined so recovery introduces neither fabricated zeros nor
  spikes.
- **CPU name:** The app uses sysinfo for the processor name. Optional WMI
  enrichment may be unavailable without hiding core metrics.
- **Metrics:** Live scalars refresh at roughly 250ms and history commits on
  full ticks at the intended 1Hz cadence. History windows use recorded
  timestamps, not assumed sample counts.
- **Missing data:** A disk or GPU discovered after startup has a genuine chart
  gap before its first observation; missing is never rendered as numeric zero.
- **Hardware identity:** Dashboard, sidebar, persisted layout, and GPU
  telemetry use stable hardware keys; display names are presentation-only.
- **Disk temperature:** No reliable per-disk temperature provider is enabled,
  so the dashboard does not display an unsupported temperature badge.
- **Platform:** The collector uses Windows-specific APIs (PDH, WMI); the app is intended for Windows.
