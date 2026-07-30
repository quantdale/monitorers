# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Single app, not a monorepo. Repo root is `monitorers/`; **all code lives in `sys-monitor-tauri/`**. Run every command below from `sys-monitor-tauri/` unless noted. A Windows-only real-time system monitor: a Rust/Tauri v2 backend collects CPU/mem/disk/network/GPU metrics via Win32 PDH/WMI/NVAPI/NVML, streams them over Tauri IPC, and a React + TypeScript (Vite) frontend renders live Recharts area charts with drag-to-reorder cards.

**`.cursorrules` at the repo root is the detailed architectural source of truth** — read it for coding conventions, anti-patterns, and the full invariant list. It is mostly current but has drifted in a few places; where this file and `.cursorrules` disagree, this file (verified against source) wins:
- The project is **Tauri v2** (`Cargo.toml` `tauri = "2"`, `@tauri-apps/api` v2), not v1. Some `.cursorrules` prose still says v1.
- Cargo default features are **`["nvapi", "nvml"]`** — both Nvidia paths on by default, not nvapi-only.
- Card order / view mode / window / hidden cards **are now persisted** via `@tauri-apps/plugin-store` (`useSettings.ts`) — `.cursorrules` claim of "no persistence by design" is stale.
- CI is **three jobs** (see below), not one.

## Commands (from `sys-monitor-tauri/`)

```bash
npm install                 # install frontend deps (needed if node_modules missing or package.json changed)
npm run tauri dev           # full app: Vite + Tauri hot-reload (real Windows metrics)
npm run dev                 # frontend only in browser at http://127.0.0.1:5180 — mock sine-wave data, no Rust
npm run tauri build         # production .msi/.exe bundle
npm run build               # tsc + vite build (frontend only)
npm test -- --run           # frontend tests (Vitest, 77 tests)
npx tsc --noEmit            # frontend type check

cd src-tauri && cargo test                  # Rust tests (88 tests)
cd src-tauri && cargo test test_name        # single Rust test
cd src-tauri && cargo test collector::disk  # one module
cd src-tauri && cargo fmt -- --check        # format check (CI-enforced)
cd src-tauri && cargo clippy -- -D warnings # lint, zero warnings allowed (CI-enforced)
```

## CI readiness gate

Before considering any task done, run the checks for whatever you changed and confirm they pass. CI (`.github/workflows/rust.yml`) runs three parallel jobs:
- **rust-test** (windows-latest): `cargo test --verbose`
- **rust-lint** (windows-latest): `cargo fmt -- --check`, `cargo clippy --verbose -- -D warnings`, `cargo audit`
- **frontend** (ubuntu-latest): `npm audit --audit-level=high`, `npx tsc --noEmit`, `npm test -- --run`

Never commit with fmt/clippy/tsc/test failing. Fix clippy warnings rather than `#[allow(...)]`-ing them. If a test count drops below 88 (Rust) / 77 (frontend) — the counts as of the latest merged change — investigate before committing.

## Backend architecture (`src-tauri/src/`)

The whole backend is one background thread doing a polling loop. Understanding the concurrency model requires `main.rs` + `state.rs` + `sensor.rs` + `collector/mod.rs` together:

- **`main.rs`** — Tauri `setup()` spawns the collector thread; defines all IPC payload structs (`MetricsSnapshot`, `GpuSnapshot`, `DiskSnapshot`, `HistoryPayload`, `GpuHistory`, `DiskHistory`) and `build_snapshot` / `build_history_payload`. `MetricsSnapshot` carries six `#[cfg(feature = "nvml")]`-gated `nvidia_*` fields (power/mem/fan/clock). Commands: `get_history(window_secs)` and `get_hardware_profile()`.
- **`state.rs`** — `CollectorState` (owns all OS handles: sysinfo, `PdhHandles`, WMI, NVAPI/NVML state, the hardware profile) lives on the background thread and is **never behind a Mutex**. `HistoryStore` (ring buffers) is the **only** type behind `Mutex` (aliased `SafeHistoryStore` / `SafeAppState`). `RawPoll` carries one poll's values from I/O to commit.
- **`collector/`** — `mod.rs` has `new_pdh_gpu_query()`, `poll()` (all slow Win32 I/O, no lock), the granular `commit_cpu` / `commit_gpu` / `commit_disk_network`, and `push_history()`. Submodules: `cpu.rs` (WMI thermal), `disk.rs` (PDH active%/throughput/response + physical-disk enumeration), `gpu.rs` (PDH 3D util + WMI vendor classification), `nvidia.rs` (NVAPI/NVML, feature-gated).
- **`sensor.rs`** — `SensorProvider` trait + `SensorRegistry`. `CpuSensorProvider` and `GpuSensorProvider` poll at 250ms for snapshot freshness.
- **`hardware.rs`** — one-time hardware detection (`detect`, `classify_gpu`) producing the `HardwareProfile` served to the sidebar/about panel.
- **`pdh.rs`** — PDH helper layer.

**The tick loop (in `main.rs`), and its non-obvious rules:**
- Loop sleeps **250ms**. A `tick` counter drives a 4-tick cadence: every 4th tick is a **full poll** (`collector::poll` — CPU+mem+net+disk+GPU, one `PdhCollectQueryData`); the other 3 ticks run only the **sensor registry** (CPU + GPU) for a fresh live snapshot.
- **History (`push_history` / `push_timestamp`) is written on full ticks (1 Hz) only** — gated inside `if let Some(ref r) = raw`. Providers may *poll* at 250ms but must **never commit to history more than once per second**, or chart scroll rate desyncs at long windows. Any new sensor provider must follow this rule.
- **Lock scope is microseconds**: I/O happens lock-free in `poll()`, then a short lock covers `commit_*` + `build_snapshot`, then unlock and `app_handle.emit("metrics-update", snapshot)`. **Never hold the `HistoryStore` lock during PDH/WMI/sysinfo I/O** — that causes UI jank. Locks use `.unwrap_or_else(|e| e.into_inner())` (poison-safe).
- **PDH handles are opened once** in `CollectorState::new()` and never recreated — recreating resets rate-counter baselines (first reading is always 0%, by design). A single `PdhCollectQueryData` per tick snapshots GPU and disk counters atomically.
- **WMI/COM thread affinity**: winit initializes COM as STA on the main thread, so `WMIConnection::new()` runs on the spawned MTA background thread (with exponential-backoff retry: base 1s, max 30s, 8 attempts) and **never leaves it**.
- On startup the thread detects the hardware profile, stores it, and emits `hardware-profile-ready`.
- **Panic recovery**: each tick body runs inside `std::panic::catch_unwind`. On a caught panic the loop emits `app_handle.emit("collector-error", "metrics collection stopped — restart the app")` and **breaks** — the collector thread stops permanently (no auto-restart), so metrics freeze until the app is relaunched.

## Frontend architecture (`src/`)

- **`hooks/useMetrics.ts`** — single source of truth for metrics. `invoke("get_history", { windowSecs })` on mount/window-change for the initial snapshot, then `listen("metrics-update")` appends incrementally (`appendToHistory` / `mergeDiskHistory` / `mergeGpuHistory`) into ring buffers of `MAX_HISTORY = 3600`. `sliceWindow()` clips to the active time range. A second `listen<string>("collector-error")` sets a `collectorError: string | null` field on `SlicedHistory`; `App.tsx` renders a red error banner when it is set. Returns `SlicedHistory` or `null` while loading. In the browser (no `window.__TAURI_INTERNALS__`) it generates mock sine-wave data via `setInterval(1000)`.
- **`hooks/useSettings.ts`** — persists `cardOrder`, `hiddenCardIds`, `sidebarCardOrder`, `viewMode`, `windowSecs` to `settings.json` via `@tauri-apps/plugin-store`. No-ops (returns defaults) in the browser.
- **`hooks/useHardwareProfile.ts`** — fetches `get_hardware_profile` and refreshes on the `hardware-profile-ready` event.
- **`App.tsx`** — card layout, dnd-kit drag-to-reorder, view modes, hidden cards, hardware sidebar. Uses `export default` (the one allowed default export).
- **`types/metrics.ts`** — TS interfaces that **manually mirror** the Rust serde structs. No codegen — keep them in sync by hand.

### IPC contract (Tauri v2) — easy to get wrong
- Rust command params are `snake_case` (`window_secs`) but JS **must pass camelCase**: `invoke('get_history', { windowSecs })`. A mismatch fails silently — history stays `null` and the UI hangs on "Collecting metrics…".
- Emit with `app_handle.emit("event", &payload)` — `emit_all` was removed in Tauri v2. Events emitted: `metrics-update` (`MetricsSnapshot`), `hardware-profile-ready` (profile), and `collector-error` (a `string` message) when the collector thread panics and halts.
- Detect the runtime with `window.__TAURI_INTERNALS__` (v2), **not** `window.__TAURI__`.
- **`SCHEMA_VERSION` (Rust `main.rs`) must equal `EXPECTED_SCHEMA_VERSION` (TS `useMetrics.ts`) — currently `2`.** Bump both together when payload shape changes.

## Conventions worth internalizing (see `.cursorrules` for the full list)
- **Add an IPC field**: struct in `main.rs` → `build_snapshot` + `build_history_payload` → mirror in `types/metrics.ts`.
- **Add a Rust collector**: `collector/{metric}.rs`, re-export from `collector/mod.rs`, wire into `poll()` and a `commit_*`.
- Frontend: **named exports only** (except `App.tsx`); **inline React styles only** (no CSS modules/Tailwind/styled-components); Recharts `<Area isAnimationActive={false}>` always (live 1 Hz data can't animate).
- Rust: prefer `Option<T>` over panics for fallible OS queries (callers use `.unwrap_or(...)`); IPC payload structs derive `Serialize` only, never `Deserialize`; every `unsafe` block needs a `// SAFETY:` comment; guard all Nvidia code with `#[cfg(feature = "nvapi")]` / `#[cfg(feature = "nvml")]`.
- Never `push` directly to a history `VecDeque` — always `push_history()`.

## Domain gotchas
- First PDH reading after init is always `0%` (baseline). 
- Disk keys are drive-letter combos (`"C:"`, `"C: D:"`) parsed from PDH instance names like `"0 C: D:"`.
- GPU display names are brand-stripped (`"NVIDIA GeForce RTX 4050"` → `"GeForce RTX 4050"`); GPU LUIDs are machine-specific and change across reboots — never hardcode them.
- Critical config: Vite dev port **5180** (strict, in `vite.config.ts` + `tauri.conf.json`); window 900×1100 (min 400×300); bundle id `com.quantdale.systemmonitor`. No env vars — all config is compile-time.
- `tauri.conf.json` sets a strict **CSP** (`default-src 'self'`; `connect-src 'self' ipc: http://ipc.localhost`) — no external fonts/CDN/network can load. `style-src 'unsafe-inline'` is what keeps the inline-React-styles convention working; don't remove it.
