# Design: system-wide real-user simulation platform

## Context

sys-monitor-tauri is a single-process, no-auth, no-server, no-multi-tenant Windows desktop app. "System-wide real-user simulation" therefore means driving **the desktop app the way a human does** across its entire interaction surface and session lifecycle — not orchestrating APIs or accounts (none exist). The complete user surface is small but stateful (verified by codebase exploration):

- **Toolbar**: sidebar toggle (session-only), time-window `<select>` (6 options, persisted, triggers full history refetch), Metrics dropdown (checkbox hide/show, Escape + click-outside close, persisted), view-mode segmented control (default/tile/list, persisted).
- **Dashboard**: pointer drag-reorder (dnd-kit `PointerSensor`), keyboard drag-reorder (`Space` → arrows → `Enter`), per-card `ErrorBoundary` with Retry.
- **Hardware sidebar**: independent drag-reorder (`sidebarCardOrder`, persisted), positional card ids (characterized known gap).
- **Window**: native OS decorations only; no in-app window controls.
- **Session state machine**: settings load (fatal error state possible) → `null` until loaded → parallel `get_history` + hardware profile → exclusive body states (history error inline/fatal, all-hidden empty state, "Collecting metrics…", cards grid) → live 250 ms events with 1 Hz history gating → mid-session events (disk/GPU appear/ghost/prune, history-load recovery, collector-error banner that never clears).

Current automation and its hard boundaries (from `openspec/specs/autonomous-e2e-verification/spec.md` and `e2e/playwright.config.ts:3-9`):

- Playwright drives **only the Vite mock server** (port 5180, `isTauri()` false). The built app's WebView2 window is unreachable; `tauri-driver` was previously evaluated and rejected in favor of CDP-attach, which was never implemented.
- The mock backend is **hardcoded sine data inside `useMetrics.ts:31-88`** — no fault injection, so driven tests cannot reach collector-error, PDH-freeze, hotplug, schema-mismatch, or corrupt-settings states.
- `settings.json` persistence is untestable in the browser harness (mock `save()` is a no-op); it is unit-tested instead.
- `cadence_probe` (headless binary over the shared `lib.rs` facade) provides emission-layer ground truth; `SYSMON_CADENCE_LOG` taps the assembled app.
- 8 physically-undrivable scenarios live in `e2e/exploratory-register.md` — faking them is explicitly forbidden by convention.

Stakeholders: developers (replace manual verification), CI (continuous regression detection), future OpenSpec changes (a reusable platform to hang new-feature journeys on).

## Goals / Non-Goals

**Goals:**

- Automated execution of **complete user journeys** (launch → customize → watch → fault → restart) with no per-run manual work.
- **Realistic behavior**: human-plausible action timing, dwell, decision points, and fault reactions, driven by seeded randomness so any session is reproducible from its logged seed.
- **Reusable, configurable building blocks**: personas, journey step libraries, and data pools that new features can compose without rewriting infrastructure.
- Validation at **three layers**: rendered DOM (what the user sees), real-backend behavior (IPC, `settings.json`, sensors — via the new CDP driver), and emission cadence (via the existing probe).
- Detection of broken workflows, regressions, unexpected states, and **automation failures themselves** (distinguish app-bug vs harness-bug in reports).
- Execution in **local dev, CI, and packaged-app ("staging")** environments with per-run isolation of all persisted state.
- Detailed **artifacts**: action/event logs, traces, videos, screenshots, journey reports, failure-triage bundles.

**Non-Goals:**

- No server, API, auth, or multi-user simulation — the app has none; those sections are N/A by design (per `realistic-usage-testing` pillar discipline).
- No AI-driven exploratory agents in this change. The engine is deterministic-script + seeded-behavior-model; an LLM agent mode is a possible future change layered on the same driver interface.
- No load/stress/performance benchmarking of the OS or the collector beyond what the cadence probe already owns.
- No production-hardening features (single-instance guard, telemetry) — simulation must not change shipped behavior.
- No faking of physically-undrivable scenarios (hotplug of real hardware, lid close, multi-process); they stay in the exploratory register.
- No replacement of existing Vitest/Rust/E2E suites — the platform composes on top of them.

## Decisions

### Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│ DECLARATIVE LAYER  (e2e/sim/personas, e2e/sim/journeys, data)  │
│   personas/*.persona.ts · journeys/*.journey.ts · data pools   │
├────────────────────────────────────────────────────────────────┤
│ SIMULATION ENGINE  (e2e/sim/engine)                            │
│   seeded PRNG → behavior model (think time, dwell, mistakes)   │
│   journey runner (steps, checkpoints, assertions, reporting)   │
├───────────────────────┬────────────────────────────────────────┤
│ DRIVER: mock-harness  │ DRIVER: real-app (NEW)                 │
│ Playwright → Vite:5180│ Playwright CDP → WebView2 (built app)  │
│ + simulation bridge   │ real IPC · real settings.json · sensors│
│ (fault injection)     │                                        │
├───────────────────────┴────────────────────────────────────────┤
│ GROUND TRUTH: cadence_probe (unchanged) · exploratory register │
├────────────────────────────────────────────────────────────────┤
│ ARTIFACTS: JSONL action log (+seed) · trace/video/screenshot   │
│            journey report (HTML + JUnit) · triage bundle       │
└────────────────────────────────────────────────────────────────┘
```

**Decision: one driver interface, two backends.** Journeys are written once against a `SimDriver` TypeScript interface (`launch`, `gotoState`, `act`, `read`, `injectFault`, `restart`, `close`) with two implementations: `MockHarnessDriver` (existing Playwright + Vite + simulation bridge) and `RealAppDriver` (Playwright CDP attach to the packaged app's WebView2). Journeys declare which drivers they support; persona behavior is driver-agnostic.

| Option | Description | Decision |
|---|---|---|
| Playwright CDP attach to WebView2 | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>`, launch app, `chromium.connectOverCDP(http://127.0.0.1:<p>)` | **Chosen** for the real-app driver — previously preferred in the e2e design, no new native deps, full DOM + input access |
| tauri-driver + WebDriver | WebDriver protocol via `tauri-driver` + Microsoft Edge WebDriver | Rejected (again): extra native toolchain, was already evaluated and rejected in `add-e2e-verification-harness` |
| Windows UI Automation (UIA) | Drive the window at the OS level | Rejected: accessibility-tree granularity, flaky input synthesis, no DOM access for assertions |
| Mock harness only | Extend the Vite harness, never drive the real app | Rejected: leaves real IPC/`settings.json`/sensors permanently automation-blind — the core gap this change exists to close |

**Decision: scriptable simulation bridge instead of hardcoded mock.** Extract `mockHistoryPayload`/`mockMetricsSnapshot` from `useMetrics.ts` into `src/sim/mockBackend.ts`, a class implementing the same snapshot/history contract, driven by a **scenario script** (keyframe timeline + fault queue) exposed to the harness on `window.__SIM__` (only when `!isTauri()`). Faults: `collector-error` emission, PDH-freeze (GPU/disk values hold then ghost), disk/GPU appear/disappear, slow or failing history load, `schema_version` mismatch, corrupt-settings payload. Default script reproduces today's sine behavior exactly, so the five existing E2E specs pass unmodified.

*Alternative considered: keep mock in the hook and add fault query-params.* Rejected — a growing matrix of URL flags is not composable and can't express timelines; a scripted backend is the reusable platform piece.

*Alternative considered: drive faults through a real Rust test build.* Rejected for the mock harness (the whole point of the bridge is not needing the OS), but the real-app driver covers genuine backend faults where reachable (e.g. real PDH behavior).

**Decision: deterministic seeded behavior model, not recorded scripts.** Personas carry distributions, not fixed scripts: think-time range, dwell range, action preferences (e.g. power-user reorders 70% of sessions), mistake probability (mis-drag, Escape-out-of-dropdown), fault reaction (retry vs ignore). The engine draws from a seeded PRNG (e.g. `pure-rand`-style, devDependency) and logs `seed + persona + journey + driver` as the run header. Same seed → identical action sequence → CI failures are reproducible locally with one command.

*Alternative considered: fully scripted journeys (fixed waits).* Rejected as the primary mode — fixed waits are exactly the "simple UI test scripts" this platform must go beyond, and they never explore timing-dependent races. Fixed-step journeys remain available as personas with zero variance for smoke runs.

*Alternative considered: AI-agent-driven exploration.* Deferred — non-deterministic, expensive, unauditable in CI; the `SimDriver` seam leaves room for it later.

**Decision: journeys are code, personas are data.** Journeys are TypeScript modules composing typed steps (`launch`, `waitForState('collecting'|'live'|'error-banner')`, `dragCard`, `toggleMetric`, `setWindow`, `setViewMode`, `injectFault`, `restartApp`, `assertPersisted`, `assertRendered`, …) — type-safe, reviewable, debuggable, co-located with helpers. Personas and data pools are plain data (JSON/TS literals) so non-authors can add users without touching engine code.

*Alternative considered: YAML/JSON journey DSL.* Rejected for v1 — a DSL needs a parser, schema validation, and poor debugging for marginal authoring gain; data-level configurability lives in personas.

**Decision: restart is a first-class step.** Because the persistence boundary (settings survive, history does not) is the app's most important cross-session contract, `restartApp()` is a primitive on both drivers: full process relaunch on `RealAppDriver` (new temp app-data dir optionally retained), page reload on `MockHarnessDriver` (with a bridge-backed settings store shim so mock-mode persistence journeys are meaningful).

**Decision: per-run isolation via temp app-data dirs.** Every real-app run sets the app's data directory to a per-run temp dir, so simulation never reads or writes a developer's real `settings.json`, and runs are parallel-safe and hermetic. **Implementation note (corrected at build time):** setting the child's `APPDATA` env var does NOT redirect Tauri's store on Windows — `tauri-plugin-store` resolves `BaseDirectory::AppData` through Win32 KnownFolders (`SHGetKnownFolderPath`), which ignores env vars. The working mechanism is a tiny env-gated command: `sim_store_override()` returns `SYSMON_SIM_APP_DATA` when set (None otherwise — production unchanged), and the frontend loads the store from `join(override, 'settings.json')` (an absolute path; Tauri's `PathResolver::resolve` returns absolute paths unchanged). The driver sets the env + `WEBVIEW2_USER_DATA_FOLDER` per run. Runs are flagged in-app via the temp environment only — no shipped-code awareness of "test mode".

**Decision: artifacts and failure triage are engine responsibilities, not per-journey.** The runner captures: JSONL action log (timestamp, persona decision, PRNG draw metadata, driver call, assertion result), Playwright trace + video + screenshot-on-failure, console/pageerror capture, and (real-app driver) the app's stderr incl. `SYSMON_CADENCE_LOG` lines. On failure it emits a triage bundle (log slice + trace + screenshot + seed) and classifies the failure as `app-defect | harness-defect | undrivable` by which layer rejected. Reports: JUnit XML for CI + HTML for humans.

**Decision: CI placement mirrors the existing E2E gate.** New `simulation` job on windows-latest: mock-harness journeys on push to `main` (fast personas, time-compressed), packaged-app journeys on `workflow_dispatch` (slow, real-time segments). Non-blocking at introduction; promotion to blocking is a separate change after a flake budget is observed. Existing four jobs untouched.

**Decision: time compression for long-window journeys.** A 1-hour-window journey cannot take a real hour in CI. The simulation bridge supports a speed factor (mock clock emits ticks faster than 250 ms); journeys asserting *real-time* cadence defer to the cadence probe (which owns real-time truth), while journeys asserting *workflow* correctness run compressed. Real-time spot journeys run only in the packaged-app/on-demand lane.

**Decision: spec placement.** New capability `user-simulation-platform` owns the platform contract. `autonomous-e2e-verification` gets one MODIFIED requirement: the "built Tauri app is NOT drivable" boundary is replaced by a two-driver boundary statement. No changes to `realistic-usage-testing`, `metrics-history-streaming`, or other specs — the platform consumes their contracts as journey assertions rather than re-asserting them.

## Risks / Trade-offs

- **[Risk] WebView2 CDP attach proves unreliable** (port races, WebView2 runtime version differences, attach flakiness) → **Mitigation**: the real-app driver is additive; the mock-harness driver plus existing suites still deliver most value. A bring-up spike (task 2.1) validates CDP attach before the rest of the driver is built; if it fails, the change descopes to the bridge + mock driver and the real-app driver moves back to the register with a reason.
- **[Risk] Remote debugging left enabled in a shipped build** → **Mitigation**: the flag is only ever set by the dev launch wrapper reading an env var; `tauri.conf.json` is untouched; a CI lint task greps the shipped config and bundle scripts for the flag.
- **[Risk] Simulation writes clobber a developer's real `settings.json`** → **Mitigation**: per-run temp app-data dir is mandatory in `RealAppDriver.launch()` (no opt-out); a platform self-test asserts the developer store path is untouched after a run.
- **[Risk] Mock fidelity drifts from the real backend** → **Mitigation**: bridge payloads are generated from the same `types/metrics.ts` shapes and pinned by `SCHEMA_VERSION`/`EXPECTED_SCHEMA_VERSION`; cadence truth stays with the real-hardware probe; a journey cross-checks bridge cadence against probe JSONL invariants.
- **[Risk] Flaky journeys erode CI trust** → **Mitigation**: determinism by seed; per-journey flake budget (quarantine list after N seed-stable failures); assertion steps use driver-level waits, never fixed sleeps, except where human-timing variance is the point of the step.
- **[Risk] Scope creep — "platform" becomes a framework project** → **Mitigation**: v1 ships exactly three personas and five journeys (below); everything else is future changes.
- **[Trade-off] Real-time fidelity vs CI runtime**: compressed clocks can mask real-time races; accepted because the cadence probe owns real-time truth and spot real-time journeys run on demand.
- **[Trade-off] Two drivers double maintenance of the driver layer**; accepted because journey/persona logic (the bulk) is driver-agnostic.

### v1 content (the shipped scope)

**Personas** (data): `glancer` (30–90 s sessions, defaults, closes app), `customizer` (reorders, hides cards, changes window + view mode, restarts to check persistence), `sentinel` (long watch, 10–60 m windows, encounters injected faults, reacts per profile).

**Journeys** (code): (1) first-launch onboarding — default card order computed and persisted; (2) customization round-trip — full customize → restart → exact layout restored; (3) long-watch cadence — window switching at compressed speed, chart growth consistent; (4) fault response — injected collector-error → banner appears, never clears; (5) fault-disk-ghost — disk removed → card hidden, id retained, re-appear restores position; (6) degraded startup — corrupt settings → per-field fallback; failed history load → recovery on first live tick. (Fault-response was split into two journeys at implementation: collector-error and disk-ghost flows are independent, each with its own persona affinity.) Journeys 1–2 run on both drivers; journeys 3–6 run on the mock driver (bridge-scripted), with undrivable real-lane steps registered in the exploratory register.

## Migration Plan

1. Land the simulation bridge (default script = today's sine mock) — existing E2E suite must pass unmodified; this is the regression gate for the extraction.
2. Bring up the real-app CDP driver behind `npm run sim:real` (local only) with one smoke journey.
3. Add engine + personas + the five v1 journeys; `npm run sim` (mock) and `npm run sim:real` (packaged).
4. Wire the CI simulation job (non-blocking), artifact uploads, and the flake-quarantine list.
5. Update `e2e/exploratory-register.md` and docs; archive via `/opsx-archive-change` + `/opsx-sync-specs` (the `autonomous-e2e-verification` delta lands at sync).

Rollback: the platform is additive under `e2e/sim/` and `src/sim/`; reverting is a directory removal plus restoring the inline mock in `useMetrics.ts` (kept intact until step 1's gate passes).

## Open Questions

- Does WebView2's remote-debugging port interact badly with the app's fixed 900×1100 window or min-size constraints under CDP-driven resize? **RESOLVED (2.1 spike, 2026-08-04):** the app launches with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=<p> --remote-allow-origins=*"` and Playwright attaches via `chromium.connectOverCDP`; all 7 real cards render over real IPC/sensors. `--remote-allow-origins=*` is required (Chromium 111+ rejects the CDP websocket origin otherwise). The `waitForSelector` for cards needs `state:'attached'` (they sit below the ~900px fold) — a driver detail, not a blocker. v1 journeys do not resize the real window.
- Can per-run app-data isolation be done purely with environment redirection, or does the launch wrapper need a Tauri config override? **RESOLVED (2.2):** zero Rust changes. Redirecting the child's `APPDATA` (plugin-store default base) + `WEBVIEW2_USER_DATA_FOLDER` to a per-run temp dir isolates `settings.json` and WebView2 state; the debug port is allocated per run. The developer's real store is byte-identical after a run (isolation self-test).
- Should the settings store shim in the mock bridge persist to `localStorage` (per-origin, realistic round-trip) or memory-only? **RESOLVED (3.x):** `localStorage` under a per-run key (`sysmon_sim_settings_<runId>`), active only when a sim run is present (`?__sim_run=`); plain `npm run dev` keeps the legacy no-op save so existing E2E/tests are unaffected.
