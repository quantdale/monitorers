# Tasks: add-user-simulation-platform

> **Status: PROPOSED.** Implements `openspec/changes/add-user-simulation-platform/` (proposal, design, specs). See design.md for the architecture and decisions each task references.

## 1. Simulation bridge (mock backend extraction + fault injection)

- [x] 1.1 Extract `mockHistoryPayload`/`mockMetricsSnapshot` from `src/hooks/useMetrics.ts` into `src/sim/mockBackend.ts` as a scriptable class with the identical default script (sine data, 250 ms ticks, 4:1 cadence, 2 disks, 2 GPUs, schema_version 3)
- [x] 1.2 Wire `useMetrics.ts` to use the bridge when `!isTauri()`; expose `window.__SIM__` handle in browser mode only
- [x] 1.3 Implement bridge fault injection: collector-error emission, GPU/disk freeze+ghost, disk/GPU appear/disappear, slow/failing history load, schema-version mismatch, corrupt-settings payload
- [x] 1.4 Implement per-run-namespaced settings store shim in the bridge (localStorage-backed) so mock-mode persistence journeys round-trip
- [x] 1.5 Implement bridge clock speed factor (time compression) for long-window journeys
- [x] 1.6 Gate: existing five Playwright specs pass unmodified against the bridge (`npm run e2e`); `npx tsc --noEmit` and `npm test -- --run` green

## 2. Real-app CDP driver

- [x] 2.1 Spike: launch the built app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` (loopback) and attach Playwright via `connectOverCDP`; record feasibility and WebView2 runtime constraints in design.md Open Questions — if infeasible, descope driver to exploratory register per spec
- [x] 2.2 Implement `RealAppDriver.launch()` with mandatory per-run temp app-data isolation and per-run debug port allocation; prefer zero Rust changes (env redirection), document any needed Tauri config override
- [x] 2.3 Implement the shared `SimDriver` interface (`launch`, `act`, `read`, `injectFault`, `restartApp`, `close`) with `MockHarnessDriver` wrapping the existing Playwright harness + bridge
- [x] 2.4 Implement `restartApp()` on both drivers (process relaunch / page reload with persisted bridge state)
- [x] 2.5 Platform self-test: after a real-app run, developer's real `settings.json` is byte-identical; all writes landed in the temp dir
- [x] 2.6 CI lint: shipped `tauri.conf.json` and build scripts contain no remote-debugging flag

## 3. Engine, personas, journeys

- [x] 3.1 Implement the simulation engine in `e2e/sim/engine/`: seeded PRNG, behavior model (think time, dwell, decision points, mistakes), journey runner with checkpoints/assertions, run-header logging (seed, persona, journey, driver)
- [x] 3.2 Implement the typed step library covering the full interaction surface (toolbar controls, dropdown incl. Escape/click-outside, view modes, pointer + keyboard drag on dashboard and sidebar, ErrorBoundary retry, state checkpoints)
- [x] 3.3 Author the three v1 personas as data: `glancer`, `customizer`, `sentinel`
- [x] 3.4 Author journey: first-launch onboarding (default card order computed + persisted)
- [x] 3.5 Author journey: customization round-trip (reorder/hide/window/view-mode → restart → exact restore, real `settings.json` on the real driver)
- [x] 3.6 Author journey: long-watch cadence at compressed speed, cross-checking cadence-probe invariants rather than re-deriving timing truth
- [x] 3.7 Author journey: fault response (collector-error banner persistence; disk ghost/retain/restore via bridge script)
- [x] 3.8 Author journey: degraded startup (corrupt settings → per-field fallback; history load failure → inline warning → recovery on first live tick)
- [x] 3.9 Verify determinism: same seed reproduces identical action sequence; document the reproduce-from-seed command

## 4. Artifacts, reporting, triage

- [x] 4.1 Implement JSONL action/event log capture (run header, ordered actions with drawn timings, assertion results)
- [x] 4.2 Wire Playwright trace/video/screenshot-on-failure plus console/page-error capture; capture app stderr on the real driver
- [x] 4.3 Implement failure classification (app-defect / harness-defect / undrivable) and triage-bundle emission
- [x] 4.4 Implement JUnit XML + HTML journey reports

## 5. CI, environments, governance

- [x] 5.1 Add `npm run sim` (mock lane, time-compressed) and `npm run sim:real` (packaged lane) scripts
- [x] 5.2 Add CI simulation job on windows-latest: mock lane on push to `main` (non-blocking), packaged lane on `workflow_dispatch`, artifact uploads
- [x] 5.3 Implement the flake-quarantine list and budget mechanics; document promotion-to-blocking as a future change
- [x] 5.4 Update `e2e/exploratory-register.md` with any newly-registered undrivable steps and revisit entries made drivable by the CDP driver
- [x] 5.5 Update `AGENTS.md`/docs with the sim commands, driver lanes, and isolation guarantees

## 6. Finalize

- [x] 6.1 Full gate: `cargo test`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`, `npx tsc --noEmit`, `npm test -- --run`, `npm run build`, `npm run e2e`, `npm run sim`
- [x] 6.2 `openspec validate add-user-simulation-platform --strict` passes
- [x] 6.3 Archive the change and sync specs (`/opsx-archive-change`, `/opsx-sync-specs`)
