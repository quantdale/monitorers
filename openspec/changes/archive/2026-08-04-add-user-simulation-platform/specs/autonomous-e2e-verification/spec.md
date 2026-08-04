## MODIFIED Requirements

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
