## Why

`add-autonomous-cadence-verification` (Phase 1) automates the runtime cadence check by tapping the *emission* stream — it proves the backend emits at 1 Hz history / 4 Hz liveness against real hardware. That is the source of truth and closes the outstanding manual gate (tasks 8.7 / 5.5).

It deliberately stops short of the *rendered* layer: it does not prove the literal number on a card visibly changes, that the chart actually scrolls with real time, that a drag-to-reorder produces the persisted order, or that pulling a drive updates the sidebar. Those are the scenarios `add-realistic-usage-test-suite`'s design.md explicitly scoped as **manual/exploratory only**, having rejected `tauri-driver` to avoid standing up a browser-automation harness for a tests-only change.

This change (Phase 2, **future**) revisits that decision now that Phase 1 has established the pattern of autonomous verification. If we want an AI agent to close *any* "manual/exploratory only" item — not just cadence — it needs to drive the real webview and observe the real DOM. This proposal scopes that harness.

## What Changes

- **Stand up a webview/E2E driver** for the Tauri app on Windows (candidate: `tauri-driver` + WebDriver, or a Playwright/CDP attach to the WebView2 host — to be evaluated in design). Enough to: launch the built app, wait for first metrics, read rendered text of a card, count chart data points in the DOM, dispatch pointer/keyboard drag sequences, and read back persisted `settings.json`.
- **Convert the Known-Gaps manual/exploratory scenarios into driven E2E specs** where feasible: rendered CPU/GPU number updates multiple times per second; "1 hour" window chart point count tracks elapsed time; drag-to-reorder + keyboard-reorder produce and persist the expected order; hidden-card toggle round-trips; collector-error banner appears on a forced collector panic.
- **Provide an agent-runnable E2E procedure and a CI story** (a self-hosted Windows runner job, gated so it doesn't block the existing three jobs).

## Capabilities

### New Capabilities
- `autonomous-e2e-verification`: formalizes that the user-observable behaviors previously reachable only by manual/exploratory testing (rendered updates, drag-and-drop, hardware-change reactions, error surfacing) are drivable and assertable by an automated webview harness, with an explicit register of which remain genuinely un-drivable (e.g. real physical drive hotplug) and why.

## Impact

- **Depends on**: `add-autonomous-cadence-verification` landing first (shares the "autonomous verification" framing and the sensor-equipped-runner assumption).
- **New dev dependency + tooling**: a WebDriver/CDP stack and its Windows setup — the cost the test-suite change avoided; justified here only because the goal is broad autonomous E2E coverage, not one cadence check.
- **Scope boundary**: this is a *future* change. It is captured now so the Phase-1 proposal has a concrete place to point its "rendered-output verification is out of scope" deferral, and so the decision to revisit `tauri-driver` is recorded rather than lost. It is not intended to be implemented in the same cycle as Phase 1.
- **Out of scope**: anything the cadence probe already covers (backend emission cadence); genuinely physical events with no software trigger (actual drive unplug, GPU dock/undock) stay in the exploratory register with a documented reason.
