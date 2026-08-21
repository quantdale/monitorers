# AGENTS.md

Windows-only real-time system monitor: Rust/Tauri v2 backend (Win32 PDH/WMI/NVML/NVAPI) streams metrics over Tauri IPC to a React/TypeScript (Vite) frontend rendering live Recharts area charts. **All code lives in `sys-monitor-tauri/`**; run every command from there. The Rust backend only builds/runs on Windows.

## Instruction sources

- `CLAUDE.md` (root) and `.cursorrules` (root) hold the detailed architecture. Both were re-reconciled against source on 2026-08-21; if they ever appear to disagree again, trust the source and fix the docs. Previously-stale claims, now corrected in all three files:
  - Schema version is **4** (`src-tauri/src/collector/snapshot.rs` ↔ `src/hooks/useMetrics.ts`); bump both together for payload changes.
  - The backend is not a `main.rs` monolith: `main.rs` is a thin Tauri shell; payload structs/`SCHEMA_VERSION` live in `collector/snapshot.rs`, the tick loop in `collector/run_loop.rs`, cadence checks in `cadence.rs`. `lib.rs` is the library facade shared by the app binary and the headless probe `src/bin/cadence_probe.rs`.
  - Card order / view mode / hidden cards / window **are persisted** via `@tauri-apps/plugin-store`.
  - Cargo default features are `["nvapi", "nvml"]`.

## Commands (from `sys-monitor-tauri/`)

```bash
npm run tauri dev        # full app: Vite + Tauri hot-reload (real Windows metrics)
npm run dev              # frontend only at http://127.0.0.1:5180 — mock sine data, no Rust
npm run build            # tsc + vite build (frontend only)
npx tsc --noEmit         # frontend typecheck
npm test -- --run        # Vitest unit tests
npm run e2e              # Playwright against the Vite mock harness (auto-starts dev server)
npm run sim              # user-simulation mock lane (journeys × personas, engine + artifacts)
npm run sim:real         # user-simulation packaged lane — drives the BUILT app via CDP (needs app built)
npm run sim:typecheck    # typecheck the e2e/sim code (tsc -p e2e/tsconfig.sim.json)
```

Simulation run knobs (`SIM_LANE`, `SIM_JOURNEYS`, `SIM_PERSONAS`, `SIM_SEED`, `SIM_SPEED`,
`SIM_OUT`, `SIM_APP_EXE`): e.g. `SIM_SEED=42 SIM_JOURNEYS=first-launch-onboarding npm run sim`.
Same seed reproduces the same seeded decisions and simulated metric sequence; wall-clock
timestamps and browser/video artifacts are intentionally not byte-identical. Failures are
reproducible from the run header
(`run.jsonl` under `e2e-results/sim/`). The real lane requires a built exe
(`src-tauri/target/release/sys-monitor-tauri.exe` or `SIM_APP_EXE`).

```bash
# from src-tauri/ (cargo commands):
cargo test                # test count is reported by Cargo; do not hard-code it in docs
cargo test collector::disk   # one module
cargo fmt -- --check      # CI-enforced; run `cargo fmt` first if it fails
cargo clippy --all-targets --all-features -- -D warnings  # CI-enforced; fix warnings, don't #[allow] them
cargo test --ignored cadence_real_hardware  # opt-in real-hardware cadence check (>=60s)
cargo run --bin cadence_probe -- --secs 90  # headless probe for the above
```

## CI gate (never commit failing; CI runs the same checks)

- Rust changed: `cargo test`, `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo audit`
- Frontend changed: `npx tsc --noEmit`, `npm test -- --run`, `npm run build`
- Sim code changed: `npm run sim:typecheck`; the mock lane (`npm run sim`) is a required PR/push gate in `.github/workflows/simulation.yml`
- CI: `.github/workflows/rust.yml` — Rust, frontend, production Windows executable, and manual/tag installer jobs; `.github/workflows/e2e.yml` (mock-harness E2E on Windows); `.github/workflows/simulation.yml` (blocking mock lane on PR/push, packaged lane on workflow_dispatch, shipped-config lint).

## Backend invariants (do not violate)

- `CollectorState` is **never** behind a Mutex (owns all OS handles, lives on the background thread). Only `HistoryStore` is `Mutex`-wrapped (`SafeHistoryStore`/`SafeAppState` aliases). Lock scope is microseconds: I/O in `poll()` lock-free, commit under short lock. Never hold the lock during PDH/WMI/sysinfo I/O.
- Locks use `.unwrap_or_else(|e| e.into_inner())` (poison-safe).
- Tick loop: monotonic 250 ms deadlines, 4-tick cadence — full poll every 4th tick, sensor registry on the others. Missed deadlines are rebased instead of replayed in a catch-up burst. **History (`push_history`) writes only on full ticks (1 Hz)**; providers may poll at 250 ms but must never commit history faster, or chart scroll rate desyncs at long windows.
- PDH handles are opened once in `CollectorState::new()` and never recreated (recreating resets rate-counter baselines — first reading is always 0%). One `PdhCollectQueryData` per tick.
- `WMIConnection` is `!Send`: created on the background MTA thread (exponential backoff, base 1s, max 30s, 8 attempts), never leaves it.
- Never push directly to a history `VecDeque` — always `push_history()` (`MAX_HISTORY = 3600`).
- Every tick body runs in `catch_unwind`; on panic it emits `collector-error` and the thread stops permanently (no auto-restart).
- Nvidia code is feature-gated `#[cfg(feature = "nvml")]` (primary) / `#[cfg(feature = "nvapi")]` (fallback). Every `unsafe` block needs `// SAFETY:`.
- IPC payload structs derive `Serialize` only — never `Deserialize`.

## IPC contract (Tauri v2) — easy to get wrong

- Rust params are `snake_case` (`window_secs`); JS **must pass camelCase** (`{ windowSecs }`). Mismatch fails silently — history stays `null`, UI hangs on "Collecting metrics…".
- `app_handle.emit("event", &payload)` — `emit_all` was removed in v2. Events: `metrics-update`, `hardware-profile-ready`, `collector-error` (string).
- Detect Tauri v2 runtime with `window.__TAURI_INTERNALS__`, **not** `window.__TAURI__`.
- `SCHEMA_VERSION` (Rust `collector/snapshot.rs`) must equal `EXPECTED_SCHEMA_VERSION` (TS `hooks/useMetrics.ts`) — currently **5**. Bump both together when the payload shape changes.

## Frontend conventions

- `hooks/useMetrics.ts` is the single source of truth (invoke `get_history` + listen `metrics-update`); in the browser it serves the scriptable mock backend (`src/sim/mockBackend.ts` — default sine script identical to the old inline mock). `hooks/useSettings.ts` persists `cardOrder`/`hiddenCardIds`/`viewMode`/`windowSecs` to `settings.json` via plugin-store (in browser mode, to the bridge's per-run localStorage shim when a sim run is active, no-op otherwise); `main.tsx` mounts a single `SettingsProvider` so every `useSettings()` consumer shares one store instance and one `save()` path (no lost updates between dashboard and sidebar).
- Named exports only (exception: `App.tsx` default export). Inline React styles only — no CSS modules/Tailwind (CSP needs `style-src 'unsafe-inline'`; no external network/fonts). Recharts `<Area isAnimationActive={false}>` always — live 1 Hz data can't animate.
- `types/metrics.ts` **manually mirrors** the Rust serde structs — no codegen; keep in sync by hand.
- Vite dev port **5180** is strict (`vite.config.ts` + `tauri.conf.json`); window 900×1100 (min 400×300); bundle id `com.quantdale.systemmonitor`; no env vars — all config is compile-time.

## OpenSpec workflow — how changes land in this repo

This repo is spec-driven. Changes go through `openspec/changes/`; specs live in `openspec/specs/`; archived changes in `openspec/changes/archive/`. Use the bundled skills/commands (`.opencode/skills/openspec-*`, `/opsx-*` commands in `.opencode/commands/`):

1. `/opsx-propose` — create the change (proposal.md, design.md, tasks.md)
2. `/opsx-apply-change` — implement the tasks
3. `/opsx-archive-change` — finalize once done (and/or `/opsx-sync-specs`)

Git history shows merged changes arrive as OpenSpec applications — propose before implementing non-trivial work.

## Testing gotchas

- E2E (Playwright, `e2e/tests/`) drives only the Vite mock-data harness — WebView2 can't be automated, so real-backend paths (IPC, settings persistence, real sensors) are covered by unit tests instead; anything physically undrivable is registered in `e2e/exploratory-register.md`.
- The simulation platform (`e2e/sim/`) runs on top: the mock lane drives the Vite harness plus the scriptable bridge (`src/sim/mockBackend.ts`, faults via `window.__SIM__`, per-run localStorage settings shim); the real lane launches the BUILT app with WebView2 remote debugging (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p> --remote-allow-origins=*`, env-only, loopback) and attaches via CDP — real IPC, real settings store, real sensors. **Isolation**: the driver redirects `WEBVIEW2_USER_DATA_FOLDER` and sets `SYSMON_SIM_APP_DATA` to a per-run temp dir; the frontend loads the plugin-store from that absolute path (`sim_store_override` command) so a sim run never touches the developer's real `settings.json` (a plain `APPDATA` env redirect does NOT work on Windows — Tauri resolves store paths via Win32 KnownFolders). The real lane needs a built exe (`npx tauri build --no-bundle` or `cargo build --release --features custom-protocol`) and is opt-in.
- Rust tests are `#[cfg(test)]` modules co-located in source files; PDH/WMI functions needing real handles are not unit-tested — only their pure parsing helpers.
