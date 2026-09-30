# AGENTS.md

Windows-only real-time system monitor: Rust/Tauri v2 backend (Win32 PDH/WMI/NVML/NVAPI) streams metrics over Tauri IPC to a React/TypeScript (Vite) frontend rendering live Recharts area charts. **All code lives in `sys-monitor-tauri/`**; run every command from there. The Rust backend only builds/runs on Windows.

## Instruction sources

- `CLAUDE.md` (root) and `.cursorrules` (root) hold the detailed architecture. Both were re-reconciled against source on 2026-08-21; if they ever appear to disagree again, trust the source and fix the docs. Previously-stale claims, now corrected in all three files:
  - The metrics schema version is **not restated here** — read it from the IPC contract section below, which is the single place in this file that names a current value; `SCHEMA_VERSION` (`src-tauri/src/collector/snapshot.rs`) and `EXPECTED_SCHEMA_VERSION` (`src/hooks/useMetrics.ts`) must always move together for payload changes.
  - The backend is not a `main.rs` monolith: `main.rs` is a thin Tauri shell; payload structs/`SCHEMA_VERSION` live in `collector/snapshot.rs`, the tick loop in `collector/run_loop.rs`, cadence checks in `cadence.rs`. `lib.rs` is the library facade shared by the app binary and the headless probe `examples/cadence_probe.rs`.
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
npm run verify:packaged  # packaged-app qualification: build exe, drive it via CDP (real IPC/settings/data), assert clean teardown
npm run assert:webview2-policy-absent  # check no machine-wide HKLM WebView2 debug value leaked
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
cargo build --example cadence_probe               # probe lives as an example target (single-bin app crate)
cargo run --example cadence_probe -- --secs 90    # headless probe for the above
cargo run --example startup_probe                 # session-bootstrap timing probe (startup-cost regressions)
```

## CI gate (never commit failing; CI runs the same checks)

- Rust changed: `cargo test`, `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo audit`
- Frontend changed: `npx tsc --noEmit`, `npm run typecheck:test`, `npm test -- --run`, `npm run build`. `npm run typecheck:test` (`tsconfig.test.json`) is the only `tsc` invocation that sees the Vitest sources, because `tsconfig.json` excludes `src/**/*.test.ts(x)`; `e2e/tsconfig.sim.json` (a shim that extends `e2e/tsconfig.json`, so editors and language servers — which resolve the nearest `tsconfig.json` — find the `@types/node` these files need) owns `e2e/**` + `src/sim/**`. Together the three projects type-check every first-party `.ts`/`.tsx`. Frontend **linting is not enforced** (no ESLint configured; `typescript-eslint` declares `peer typescript ">=4.8.4 <6.1.0"` and cannot be adopted while the repo is on TypeScript 7) — React-hooks rules are a known, recorded gap, not an oversight.
- Dependency audit gate has **two scopes** and they must never be conflated: the **application** scope (`cd sys-monitor-tauri && npm audit --audit-level=high`, also `npm run audit:app`) is the authoritative one because it is what CI's `frontend` job and `.husky/pre-push` actually gate on; the **repository-root** scope holds only `husky` and can never fail on an application advisory. Report both with their scope, never as an unqualified "npm audit 0".
- Sim code changed: `npm run sim:typecheck`; the mock lane (`npm run sim`) is a required PR/push gate in `.github/workflows/simulation.yml`
- CI: `.github/workflows/rust.yml` — Rust, frontend, production Windows executable, and manual/tag installer jobs; `.github/workflows/e2e.yml` (mock-harness E2E on Windows); `.github/workflows/simulation.yml` (blocking mock lane on PR/push, packaged lane + shipped-config fault-surface lint on dispatch); `.github/workflows/release-qualification.yml` (dispatch/tag only: MSI/NSIS install/run/uninstall qualification + hashed release manifest).

## Backend invariants (do not violate)

- `CollectorState` is **never** behind a Mutex (owns all OS handles, lives on the background thread). Only `HistoryStore` is `Mutex`-wrapped (`SafeHistoryStore`/`SafeAppState` aliases). Lock scope is microseconds: I/O in `poll()` lock-free, commit under short lock. Never hold the lock during PDH/WMI/sysinfo I/O.
- Locks use `.unwrap_or_else(|e| e.into_inner())` (poison-safe).
- Tick loop: monotonic 250 ms deadlines, 4-tick cadence — full poll every 4th tick, sensor registry on the others. Missed deadlines are rebased instead of replayed in a catch-up burst. **History (`push_history`) writes only on full ticks (1 Hz)**; providers may poll at 250 ms but must never commit history faster, or chart scroll rate desyncs at long windows.
- PDH handles are opened once in `CollectorState::new()` and never recreated (recreating resets rate-counter baselines — first reading is always 0%). One `PdhCollectQueryData` per tick.
- `WMIConnection` is `!Send`: created on the background MTA thread (exponential backoff, base 1s, max 30s, 8 attempts), never leaves it.
- Never push directly to a history `VecDeque` — always `push_history()` (`MAX_HISTORY = 3600`).
- Every tick body runs in `catch_unwind`; a caught panic ends the SESSION with `LoopOutcome::Panicked` and the supervisor (`collector/supervisor.rs`) replaces it: bounded automatic recovery (3 attempts/streak, staged backoff 500ms→8s, healthy ≥30s resets the streak), then persistent `failed` with manual retry via the `retry_collection` command. Shutdown wins from every state; at most one session ever emits.
- Fresh sessions rebuild ALL OS-facing state (PDH/sysinfo/NVML/WMI bootstrap/registry) on their own thread and prime rate baselines, then WAIT for the initial tick deadline before the first poll/commit — post-recovery first commits are real ~250ms deltas, never fabricated 0% or downtime spikes. The loop waits at the TOP of each iteration; never move the wait back below the tick body.
- Tauri managed state is keyed by Rust TYPE: two independent flags MUST be distinct newtypes (`StopFlag`, `RetryRequest` in `main.rs`, registered via `register_lifecycle_flags` which asserts each registration). Never register two values of the same raw type (`manage` silently refuses the duplicate and everything aliases the first value).
- Nvidia code is feature-gated `#[cfg(feature = "nvml")]` (primary) / `#[cfg(feature = "nvapi")]` (fallback). Every `unsafe` block needs `// SAFETY:`.
- IPC payload structs derive `Serialize` only — never `Deserialize`.

## IPC contract (Tauri v2) — easy to get wrong

- Rust params are `snake_case` (`window_secs`); JS **must pass camelCase** (`{ windowSecs }`). Mismatch fails silently — history stays `null`, UI hangs on "Collecting metrics…".
- `app_handle.emit("event", &payload)` — `emit_all` was removed in v2. Events: `metrics-update`, `hardware-profile-ready`, `collector-status` (typed `CollectorStatus`), `collector-error` (legacy string, still fired per panic for diagnostics).
- Detect Tauri v2 runtime with `window.__TAURI_INTERNALS__`, **not** `window.__TAURI__`.
- `SCHEMA_VERSION` (Rust `collector/snapshot.rs`) must equal `EXPECTED_SCHEMA_VERSION` (TS `hooks/useMetrics.ts`) — currently **6** (bumped from 5 when `MetricsSnapshot` gained `timestamp_ms`). The lifecycle contract has its own version: `LIFECYCLE_SCHEMA_VERSION` (Rust `collector/supervisor.rs`) must equal `EXPECTED_LIFECYCLE_SCHEMA_VERSION` (TS) — currently **1**. Bump each pair together when its payload shape changes.
- **Single clock for the history ring.** The ring and every live sample share ONE timestamp source: `monotonic_timestamp_ms(wall_origin_ms, loop_epoch, …)` fixes a wall-clock origin once per collector session and advances it with a monotonic `Instant`. `MetricsSnapshot.timestamp_ms` carries that same value, and the frontend appends live events at the payload's timestamp — never `Date.now()`. Consequence: a mid-session wall-clock adjustment (NTP step, user change, suspend/resume) cannot make live samples disagree with the ring. `on_tick` remains the ONLY history growth gate, including for registry-only ticks that carry a timestamp.
- **Missing-timestamp fallback.** If a `metrics-update` payload has no usable `timestamp_ms`, the frontend logs `console.warn` once and appends at the newest timestamp it already knows, so the sample is preserved in order rather than dropped. It never falls back to `Date.now()`.
- Commands: `get_history`, `get_hardware_profile`, `get_collector_status`, `retry_collection` (honored ONLY while `failed`: signals the retry flag and answers `Failed`; any other answered state means the click was coalesced — a `Failed` answer never means ignored), `sim_store_override` (simulation-only).

## Frontend conventions

- `hooks/useMetrics.ts` is the single source of truth (invoke `get_history` + listen `metrics-update`; on mount/reload it ALSO bootstraps the current managed status via `get_collector_status` after the status listener attaches, fenced by an applied-status sequence so an older fetch response can never overwrite a newer observed event); in the browser it serves the scriptable mock backend (`src/sim/mockBackend.ts` — default sine script identical to the old inline mock; lifecycle parity: a generation reports `healthy` only after its FIRST successful snapshot, and `stop()` invalidates every staged crash/recovery timer via a run token so stale callbacks can never resurrect the singleton). `hooks/useSettings.ts` persists `cardOrder`/`hiddenCardIds`/`viewMode`/`windowSecs` to `settings.json` via plugin-store (in browser mode, to the bridge's per-run localStorage shim when a sim run is active, no-op otherwise); `main.tsx` mounts a single `SettingsProvider` so every `useSettings()` consumer shares one store instance and one `save()` path (no lost updates between dashboard and sidebar).
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

- Three verification lanes, three different capabilities — do not conflate them: (1) plain Playwright E2E (`e2e/tests/`) drives the Vite mock-data harness, because a stock WebView2 window exposes no automation endpoint; (2) the mock simulation lane scripts faults through the bridge; (3) the real lane launches the BUILT app with remote debugging and drives it over CDP — real IPC, real store, true process relaunch. Only genuinely hardware-bound events (physical hotplug, lid/power) stay in `e2e/exploratory-register.md`.
- The simulation platform (`e2e/sim/`) runs on top: the mock lane drives the Vite harness plus the scriptable bridge (`src/sim/mockBackend.ts`, faults via `window.__SIM__`, per-run localStorage settings shim); the real lane launches the BUILT app with WebView2 remote debugging (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p> --remote-allow-origins=*`, env-only, loopback; an HKLM policy fallback covers elevated hosts) and attaches via CDP — real IPC, real settings store, real sensors, full restart via `restartApp()`. **Isolation**: the driver redirects `WEBVIEW2_USER_DATA_FOLDER` and sets `SYSMON_SIM_APP_DATA` to a per-run temp dir; the frontend loads the plugin-store from that absolute path (`sim_store_override` command) so a sim run never touches the developer's real `settings.json` (a plain `APPDATA` env redirect does NOT work on Windows — Tauri resolves store paths via Win32 KnownFolders). The runner enforces an orphan-process guard plus a developer-store byte-identity self-test on every real-lane run. The real lane needs a built exe (`npx tauri build --no-bundle` or `cargo build --release --features custom-protocol`) and is opt-in.

**After a packaged/real-lane run — check the machine-wide WebView2 policy.** On an *elevated* host the driver writes a value named `*` under `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`; `*` applies to **every WebView2 host on the machine**, not just this app. The value is removed on every termination path (normal close, spawn failure, Ctrl-C, SIGTERM, `process.exit`, uncaught throw) and removal is *verified* by reading it back — a still-present value fails the run rather than being reported as clean. If you ever suspect one leaked:

```bash
# check (exit 0 = absent, exit 1 = still present; same command CI runs)
npm run assert:webview2-policy-absent

# manual check
reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" /v *

# remove it if present
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" /v * /f
```

`simulation-real` and both release-qualification jobs assert this with `if: always()`, so a failed run is checked too. A non-elevated host cannot write the value at all (access denied) and the driver falls back to the environment variable; that is expected, not a leak.
- Rust tests are `#[cfg(test)]` modules co-located in source files; PDH/WMI functions needing real handles are not unit-tested — only their pure parsing helpers.
