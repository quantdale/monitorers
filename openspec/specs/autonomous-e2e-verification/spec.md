## Purpose

Defines the autonomous E2E verification contract between the Playwright harness and the frontend, and documents the boundary of what the harness can and cannot drive. The harness drives the Vite mock-data server only — the browser cannot attach to the app's WebView2 window, so the built Tauri app itself is not driven by E2E. Rendered-layer behaviors (metrics rendering, chart point counts, drag-to-reorder, hidden-card toggle) are exercised against the mock DOM; real-backend behaviors (Tauri IPC, `settings.json` persistence, the `collector-error` panic path) are covered by unit tests and Rust tests instead. Manual/exploratory scenarios are either converted to driven E2E assertions or explicitly retained in an exploratory register.
## Requirements
### Requirement: The frontend is drivable by an automated E2E harness on the Vite mock-data server
The frontend SHALL be launchable and controllable by an automated Playwright harness on the Vite dev server (port 5180), where `isTauri()` is false and `useMetrics` serves mock data. The harness SHALL be able to wait for first metrics, read the rendered text of a card, count chart data points in the DOM, and dispatch pointer and keyboard input. The harness SHALL be runnable unattended by an AI agent or a Windows CI job. The built Tauri app is additionally drivable by a second, distinct driver owned by the `user-simulation-platform` capability: a CDP-attached Playwright connection to the packaged app's WebView2 window (loopback-only, env-gated at launch, never enabled via shipped configuration). That real-app driver supplements — and does not change the scope of — this mock harness: mock-harness specs continue to cover rendered-layer behaviors against mock data, while real-backend behaviors (Tauri IPC, `settings.json` persistence, real sensors) are covered by unit tests (e.g. `useSettings.persistence.test.ts`), Rust tests, and real-app simulation journeys.

#### Scenario: Harness loads the mock frontend and reads a rendered value
- **WHEN** the harness loads the Vite dev server and waits for the first `metrics-update` to render
- **THEN** it can read the CPU card's displayed percentage text and observe it change at least twice within two seconds, confirming live readout refresh from the rendered layer (not just the emission layer)

#### Scenario: Harness drives and verifies drag-to-reorder in the DOM
- **WHEN** the harness dispatches a drag (or keyboard reorder) that moves one card before another
- **THEN** the new order is reflected in the rendered DOM. Persistence of that order across a relaunch is NOT asserted here — it is covered by `useSettings.persistence.test.ts` unit tests and by real-app simulation journeys that restart the packaged app against an isolated `settings.json`

#### Scenario: Mock harness and real-app driver remain distinct lanes
- **WHEN** the E2E suite runs in CI
- **THEN** the mock-harness specs run without a Rust build or packaged app, and no mock-harness spec depends on the CDP real-app driver being available

### Requirement: Manual/exploratory scenarios are converted to driven E2E specs where feasible
The scenarios previously scoped as manual/exploratory in `add-realistic-usage-test-suite` SHALL each be either (a) implemented as a driven E2E assertion on the mock DOM, or (b) explicitly retained in an exploratory register with a stated reason they cannot be driven in software. No such scenario SHALL be silently dropped.

#### Scenario: Rendered 1-hour window tracks elapsed time
- **WHEN** the harness selects the "1 hour" window and lets the app run a bounded period
- **THEN** the rendered chart's data-point count increases at ~1 per second, corroborating the cadence probe's emission-layer result at the DOM layer

#### Scenario: Genuinely un-drivable events remain documented
- **WHEN** a scenario requires a real physical hardware change (drive unplug, GPU dock/undock) or a real backend event (collector panic) with no software trigger
- **THEN** it stays in the exploratory register with a one-line reason, or is covered by unit/Rust tests where the behavior is reachable without the backend, rather than being implemented as a flaky or fake automated test

### Requirement: E2E chart assertions use app-owned behavior signals
E2E tests SHALL assert user-observable time-span/window behavior through stable app-owned metadata or pure chart-pipeline tests, not Recharts internal SVG class names or path-command counts. At least one E2E SHALL prove a range change changes displayed time span and live history advances.

#### Scenario: Chart implementation can change without false failure
- **WHEN** Recharts changes its internal SVG path structure without changing the app's point/time metadata
- **THEN** the E2E remains valid

### Requirement: Pointer reorder has a deterministic semantic completion signal
The pointer drag journey SHALL retain a before/after card identity assertion and SHALL use a stable drag handle/target and observable reorder completion so hosted timing differences cannot turn a completed user action into a false timeout.

#### Scenario: Hosted pointer drag reorders
- **WHEN** the test drags a card using the user-facing pointer handle
- **THEN** the first card identity changes and the set of cards remains unchanged within the test's semantic wait

