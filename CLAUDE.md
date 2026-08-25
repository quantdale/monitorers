# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Single app, not a monorepo. Repo root is `monitorers/`; **all code lives in `sys-monitor-tauri/`**. Run every command below from `sys-monitor-tauri/` unless noted. A Windows-only real-time system monitor: a Rust/Tauri v2 backend collects CPU/mem/disk/network/GPU metrics via Win32 PDH/WMI/NVAPI/NVML, streams them over Tauri IPC, and a React + TypeScript (Vite) frontend renders live Recharts area charts with drag-to-reorder cards.

**`.cursorrules` at the repo root is the detailed architectural source of truth** — read it for coding conventions, anti-patterns, and the full invariant list. It has been reconciled against source (schema version, modular backend layout, plugin-store persistence, cargo features all verified); if this file and `.cursorrules` ever disagree again, trust the source and fix both. Key facts both files agree on:
- The project is **Tauri v2** (`Cargo.toml` `tauri = "2"`, `@tauri-apps/api` v2).
- Cargo default features are **`["nvapi", "nvml"]`** — both Nvidia paths on by default (NVML primary, NVAPI fallback).
- Card order / view mode / window / hidden cards **are persisted** via `@tauri-apps/plugin-store` (`useSettings.ts`) with a versioned migration layer.
- CI calls the canonical verification scripts (`npm run verify:*`, defined in `scripts/verify.mjs`) plus separate E2E/simulation workflows.

## Commands (from `sys-monitor-tauri/`)

```bash
npm install                 # install frontend deps (needed if node_modules missing or package.json changed)
npm run tauri dev           # full app: Vite + Tauri hot-reload (real Windows metrics)
npm run dev                 # frontend only in browser at http://127.0.0.1:5180 — mock sine-wave data, no Rust
npm run tauri build         # production .msi/.exe bundle; does not launch
npm run build               # tsc + vite build (frontend only)
npm test -- --run           # frontend tests (Vitest; count intentionally drifts)
npm run e2e                 # Playwright e2e — mock-data harness on the Vite dev server (12 tests)
npx tsc --noEmit            # frontend type check

cd src-tauri && cargo test                  # Rust tests (Cargo reports the current count)
cd src-tauri && cargo test test_name        # single Rust test
cd src-tauri && cargo test collector::disk  # one module
cd src-tauri && cargo fmt -- --check        # format check (CI-enforced)
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings # CI-enforced
npm run verify:fast         # canonical local fast gate
npm run verify:full         # fast gate + E2E + simulation + Tauri executable
```

## CI readiness gate

Before considering any task done, run the checks for whatever you changed and confirm they pass. CI calls the canonical verification scripts. The Rust workflow runs the Windows Rust gate, frontend gate, and a production no-bundle Tauri build; installer bundles run on version tags/manual dispatch. Separate E2E and mock simulation workflows are required PR checks. Current action versions are immutable SHA pins in `.github/workflows/`.

Never commit with fmt/clippy/tsc/test failing. Fix clippy warnings rather than `#[allow(...)]`-ing them. Test counts are intentionally not hard-coded in documentation; use the command results as evidence.

## Backend architecture (`src-tauri/src/`)

The whole backend is one background thread doing a polling loop. Understanding the concurrency model requires `main.rs` + `snapshot.rs` + `state.rs` + `sensor.rs` + `collector/mod.rs` + `collector/run_loop.rs` together:

- **`main.rs`** — thin Tauri shell: `setup()` spawns the collector thread (which runs `run_collector_loop`), and registers the commands `get_history(window_secs)`, `get_hardware_profile()`, and the simulation-only `sim_store_override()`.
- **`collector/snapshot.rs`** — the IPC payload structs (`MetricsSnapshot`, `GpuSnapshot`, `DiskSnapshot`, `HistoryPayload`, `GpuHistory`, `DiskHistory`), `SCHEMA_VERSION`, and `build_snapshot` / `build_history_payload`. GPU entries carry stable keys and optional per-device Nvidia telemetry.
- **`state.rs`** — `CollectorState` (owns all OS handles: sysinfo, `PdhHandles`, WMI, NVAPI/NVML state, the hardware profile) lives on the background thread and is **never behind a Mutex**. `HistoryStore` (ring buffers) is the **only** type behind `Mutex` (aliased `SafeHistoryStore` / `SafeAppState`). `RawPoll` carries one poll's values from I/O to commit.
- **`collector/`** — `mod.rs` has `new_pdh_gpu_query()`, `poll()` (all slow Win32 I/O, no lock), the granular `commit_cpu` / `commit_gpu` / `commit_disk_network`, and `push_history()`. Submodules: `cpu.rs` (WMI thermal), `disk.rs` (PDH active%/throughput/response + physical-disk enumeration), `gpu.rs` (PDH 3D util + WMI vendor classification), `nvidia.rs` (NVAPI/NVML, feature-gated).
- **`collector/run_loop.rs`** — `run_collector_loop()`, the tick loop extracted behind emit/error sinks (see below).
- **`sensor.rs`** — `SensorProvider` trait + `SensorRegistry`. `CpuSensorProvider` and `GpuSensorProvider` poll at 250ms for snapshot freshness.
- **`hardware.rs`** — hardware detection (`detect`, `classify_gpu`) producing a degraded-but-useful `HardwareProfile`; profile-ready events refresh it when the stable hardware set changes.
- **`pdh.rs`** — PDH helper layer.

**The tick loop (`run_collector_loop` in `collector/run_loop.rs`, spawned from `main.rs`'s `setup()`), and its non-obvious rules:**
- The loop targets a **250ms monotonic deadline**. A tick counter drives a 4-tick cadence: every 4th tick is a **full poll** (`collector::poll` — CPU+mem+net+disk+GPU, one `PdhCollectQueryData`); the other 3 ticks run only the **sensor registry** (CPU + GPU) for a fresh live snapshot. Missed deadlines are rebased rather than replayed in a busy catch-up burst.
- **History (`push_history` / `push_timestamp`) is written on full ticks (1 Hz) only** — gated inside `if let Some(ref r) = raw`. Providers may *poll* at 250ms but must **never commit to history more than once per second**, or chart scroll rate desyncs at long windows. Any new sensor provider must follow this rule.
- **Lock scope is microseconds**: I/O happens lock-free in `poll()`, then a short lock covers `commit_*` + `build_snapshot`, then unlock and `app_handle.emit("metrics-update", snapshot)`. **Never hold the `HistoryStore` lock during PDH/WMI/sysinfo I/O** — that causes UI jank. Locks use `.unwrap_or_else(|e| e.into_inner())` (poison-safe).
- **PDH handles are opened once** in `CollectorState::new()` and never recreated — recreating resets rate-counter baselines (first reading is always 0%, by design). A single `PdhCollectQueryData` per tick snapshots GPU and disk counters atomically.
- **WMI/COM thread affinity**: winit initializes COM as STA on the main thread, so `WMIConnection::new()` runs on the spawned MTA background thread (with exponential-backoff retry: base 1s, max 30s, 8 attempts) and **never leaves it**. Core metrics start while WMI enrichment retries in the background.
- Hardware profile detection starts with PDH/sysinfo fallbacks and emits `hardware-profile-ready`; later stable hardware-set changes emit an updated profile.
- **Supervised recovery**: each tick body runs inside `std::panic::catch_unwind`; a caught panic ends that SESSION with `LoopOutcome::Panicked` and `collector/supervisor.rs` replaces it — bounded automatic recovery (3 attempts per streak, staged backoff 500ms→8s, a healthy period ≥30s resets the streak) and a persistent `failed` state with manual retry via the `retry_collection` command. Every session rebuilds fresh OS-facing state (PDH/sysinfo/NVML/WMI bootstrap/registry) on its own thread and primes rate baselines before its first deadline, so post-recovery commits are real ~250ms deltas. Shutdown wins from every state.

## Frontend architecture (`src/`)

- **`hooks/useMetrics.ts`** — single source of truth for metrics. `invoke("get_history", { windowSecs })` on mount/window-change for the initial snapshot, then `listen("metrics-update")` appends incrementally (`appendToHistory` / `mergeDiskHistory` / `mergeGpuHistory`) into ring buffers of `MAX_HISTORY = 3600`. `sliceWindow()` selects recorded timestamps by elapsed time. Schema mismatches fail closed with an actionable UI error; stale history requests are generation-guarded and replay live full-tick events. In the browser (no `window.__TAURI_INTERNALS__`) it uses the scriptable mock backend.
- **`hooks/useSettings.ts`** — persists `cardOrder`, `hiddenCardIds`, `sidebarCardOrder`, `viewMode`, `windowSecs`, and the versioned settings schema to `settings.json` via `@tauri-apps/plugin-store`. In browser simulation runs it uses the per-run bridge/localStorage shim; ordinary browser development keeps settings in memory.
- **`hooks/useHardwareProfile.ts`** — fetches `get_hardware_profile` and refreshes on the `hardware-profile-ready` event.
- **`App.tsx`** — card layout, dnd-kit drag-to-reorder, view modes, hidden cards, hardware sidebar. Uses `export default` (the one allowed default export).
- **`types/metrics.ts`** — TS interfaces that **manually mirror** the Rust serde structs. No codegen — keep them in sync by hand.

### IPC contract (Tauri v2) — easy to get wrong
- Rust command params are `snake_case` (`window_secs`) but JS **must pass camelCase**: `invoke('get_history', { windowSecs })`. A mismatch fails silently — history stays `null` and the UI hangs on "Collecting metrics…".
- Emit with `app_handle.emit("event", &payload)` — `emit_all` was removed in Tauri v2. Events emitted: `metrics-update` (`MetricsSnapshot`), `hardware-profile-ready` (profile), `collector-error` (legacy `string` message, still fired per panic for diagnostics), and `collector-status` (typed `CollectorStatus` lifecycle contract with its own `LIFECYCLE_SCHEMA_VERSION`, also served by the `get_collector_status` command; `retry_collection` is honored only while `failed`).
- Detect the runtime with `window.__TAURI_INTERNALS__` (v2), **not** `window.__TAURI__`.
- **`SCHEMA_VERSION` (Rust `collector/snapshot.rs`) must equal `EXPECTED_SCHEMA_VERSION` (TS `useMetrics.ts`) — currently `5`.** Bump both together when payload shape changes.

## Conventions worth internalizing (see `.cursorrules` for the full list)
- **Add an IPC field**: struct in `collector/snapshot.rs` → `build_snapshot` + `build_history_payload` → mirror in `types/metrics.ts`.
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
