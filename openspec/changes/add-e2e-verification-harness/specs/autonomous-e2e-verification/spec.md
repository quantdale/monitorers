## ADDED Requirements

### Requirement: The running app is drivable by an automated webview harness
The built Tauri app SHALL be launchable and controllable by an automated E2E harness on Windows that can wait for first metrics, read the rendered text of a card, count chart data points in the DOM, dispatch pointer and keyboard input, and read back the persisted `settings.json`. The harness SHALL be runnable unattended by an AI agent or a self-hosted Windows CI job, and SHALL NOT block or replace the existing three CI jobs.

#### Scenario: Harness launches the app and reads a rendered value
- **WHEN** the harness starts the built app and waits for the first `metrics-update` to render
- **THEN** it can read the CPU card's displayed percentage text and observe it change at least twice within two seconds, confirming live readout refresh from the rendered layer (not just the emission layer)

#### Scenario: Harness drives and verifies drag-to-reorder persistence
- **WHEN** the harness dispatches a drag (or keyboard reorder) that moves one card before another and then relaunches the app
- **THEN** the new order is reflected on relaunch and matches the `cardOrder` written to `settings.json`

### Requirement: Manual/exploratory scenarios are converted to driven E2E specs where feasible
The scenarios previously scoped as manual/exploratory in `add-realistic-usage-test-suite` SHALL each be either (a) implemented as a driven E2E assertion, or (b) explicitly retained in an exploratory register with a stated reason they cannot be driven in software. No such scenario SHALL be silently dropped.

#### Scenario: Rendered 1-hour window tracks elapsed time
- **WHEN** the harness selects the "1 hour" window and lets the app run a bounded period
- **THEN** the rendered chart's data-point count increases at ~1 per second, corroborating the cadence probe's emission-layer result at the DOM layer

#### Scenario: Genuinely un-drivable events remain documented
- **WHEN** a scenario requires a real physical hardware change (drive unplug, GPU dock/undock) with no software trigger
- **THEN** it stays in the exploratory register with a one-line reason, rather than being implemented as a flaky or fake automated test
