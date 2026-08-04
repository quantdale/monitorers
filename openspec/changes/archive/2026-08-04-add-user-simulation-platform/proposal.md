# add-user-simulation-platform

## Why

The app's automation today is a set of narrow, single-purpose probes: five Playwright specs drive isolated behaviors against a hardcoded sine-wave mock, unit tests pin logic, and the cadence probe checks the emission layer. Nothing exercises **whole user journeys** — a real person launching the app, customizing the dashboard, watching it for an hour, hitting a fault, and coming back tomorrow — and nothing can drive the real packaged app at all (WebView2 is unreachable by the current harness, so real IPC, `settings.json` persistence, and real sensors are automated-blind). Every new feature therefore requires repetitive manual verification, and cross-feature regressions (settings ↔ hardware identity ↔ cadence ↔ error states) are only caught by humans. We need a reusable platform that simulates realistic end users end-to-end, deterministically, in local and CI environments.

## What Changes

- Introduce a **user-simulation platform** under `sys-monitor-tauri/e2e/sim/`: declarative, reusable **personas** (timing profile, preferences, fault-reaction behavior), **journeys** (composable scripts over the full interaction surface with checkpoints), and **test-data pools**, executed by a deterministic, seed-driven **simulation engine** (seeded PRNG; same seed = same session, logged for reproduction).
- Add a **simulation bridge**: extract the hardcoded mock in `useMetrics.ts` into an injectable, scriptable mock backend with **fault injection** (collector panic, PDH freeze, disk/GPU hotplug, slow/failed history load, schema-version mismatch, corrupt settings). Dev/test-only; production IPC paths untouched.
- Add a **real-app driver**: launch the built Tauri app with WebView2 remote debugging (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`, loopback only, env-gated) and attach Playwright over CDP, unlocking journeys against the real backend — real IPC, real `settings.json` persistence, real sensors — for the first time.
- Add **multi-layer validation**: rendered-DOM assertions, persistence round-trips across real-app restarts, and cadence cross-checks against the existing `cadence_probe` ground truth.
- Add **artifact capture**: per-run JSONL action/event logs (with seed), Playwright traces/videos/screenshots, machine-readable journey reports, and a failure-triage bundle per failed journey.
- Extend CI with a **simulation job** (windows-latest, alongside the existing E2E job, initially non-blocking) covering mock-harness journeys; packaged-app journeys run locally and on `workflow_dispatch`.
- Keep the exploratory-register discipline: any journey step that cannot be software-driven is registered with a reason, never faked or silently dropped.
- **BREAKING (test-only)**: the mock-data generation moves out of `useMetrics.ts` into a `src/sim/` module; mock behavior stays identical by default, but the internal location changes. No production runtime behavior changes.

## Capabilities

### New Capabilities

- `user-simulation-platform`: Declarative personas, journeys, and test data executed by a deterministic simulation engine over drivable surfaces (mock harness and real packaged app), with a scriptable fault-injecting mock backend, multi-layer validation, artifact capture, environment matrix, and test-activity isolation.

### Modified Capabilities

- `autonomous-e2e-verification`: The requirement stating the built Tauri app is NOT drivable is updated — a CDP-attached real-app driver becomes a second, distinct driver alongside the mock-harness Playwright driver, with its own boundary and safety gating.

## Impact

- **Frontend**: `src/hooks/useMetrics.ts` mock code extracted to `src/sim/mockBackend.ts` (scriptable, fault-injecting); `isTauri()` unchanged; no production-path behavior change. `src/sim/` is excluded from the production bundle logic except in browser/mock mode.
- **E2E**: new `e2e/sim/` tree (engine, personas, journeys, drivers, reporters); existing `e2e/tests/` specs untouched and must keep passing.
- **Rust backend**: no functional changes. Optional dev-only launch wrapper reads `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` from the environment (WebView2 native behavior); app-data isolation via per-run temp dirs for `settings.json`.
- **CI**: new simulation job in `.github/workflows/` (windows-latest; mock journeys on push to main, packaged-app journeys on `workflow_dispatch`); existing four jobs unchanged.
- **Dependencies**: Playwright (already present) gains CDP-attach usage; no new runtime dependencies. Dev-only additions (seeded PRNG, YAML/JSON journey loading) kept to devDependencies.
- **OpenSpec**: new capability spec `user-simulation-platform`; delta to `autonomous-e2e-verification`.
- **Security**: remote-debugging port is loopback-only and env-gated, never enabled in shipped config; per-run isolation prevents simulation writes to a developer's real `settings.json`.
