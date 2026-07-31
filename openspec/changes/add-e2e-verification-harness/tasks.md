> **Status: FUTURE / deferred.** Do not start until `add-autonomous-cadence-verification` (Phase 1) has landed. Captured now to hold the deferral and record the decision to revisit `tauri-driver`.

## 1. Spike: choose the driver stack

- [ ] 1.1 Prototype launching the *built* app on Windows and reading a card's rendered text with (a) `tauri-driver` + WebDriver and (b) a Playwright/CDP attach to the WebView2 host. Record setup cost, flakiness, and whether Tauri IPC survives the attach.
- [ ] 1.2 Decide the stack (or the hybrid: driver for input/DOM, Phase-1 probe for cadence ground truth). Write the decision into design.md's open Decision table.

## 2. Harness foundation

- [ ] 2.1 Stand up the chosen driver as a dev-only dependency with a documented Windows setup. Provide a helper that launches the app, waits for first metrics to render, and tears down cleanly.
- [ ] 2.2 Expose primitives the specs need: read card text, count chart DOM points, dispatch pointer-drag and keyboard-reorder sequences, read back `settings.json`.

## 3. Convert manual/exploratory scenarios to driven E2E

- [ ] 3.1 Rendered CPU/GPU readout updates ≥2× within 2s (rendered-layer liveness).
- [ ] 3.2 "1 hour" window chart point count grows ~1/s over a bounded run (rendered-layer fidelity; corroborates Phase-1 probe).
- [ ] 3.3 Drag-to-reorder and keyboard-reorder produce the expected order and persist it to `settings.json`; verified across a relaunch.
- [ ] 3.4 Hidden-card toggle round-trips across relaunch.
- [ ] 3.5 Forced collector panic surfaces the `collector-error` banner in the DOM.

## 4. Exploratory register & CI

- [ ] 4.1 For every manual/exploratory scenario in `add-realistic-usage-test-suite` not covered in section 3, record a one-line reason it stays exploratory (e.g. real physical drive hotplug has no software trigger). No silent drops.
- [ ] 4.2 Wire the harness into a self-hosted, GPU-equipped Windows CI job, gated so it never blocks the existing three jobs. If no such runner exists yet, document the agent-run/local procedure and leave the CI job as a follow-up.

## 5. Verify

- [ ] 5.1 The driven E2E suite passes on a real Windows host with sensors.
- [ ] 5.2 The exploratory register is complete and cross-referenced from the test-suite change's Known Gaps.
- [ ] 5.3 `openspec validate add-e2e-verification-harness --strict` passes.
