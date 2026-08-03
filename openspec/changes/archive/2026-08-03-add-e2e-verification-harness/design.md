## Context

`add-realistic-usage-test-suite`'s design.md made a deliberate call: **do not** stand up `tauri-driver`/WebDriver, and scope drag-and-drop, real hardware hotplug, and multi-process scenarios as manual/exploratory instead. That was correct for a tests-only change whose goal was pure-function coverage.

Phase 1 (`add-autonomous-cadence-verification`) then automated the one manual gate that *didn't* need a driver, by tapping the emission stream. The residue is exactly the set of behaviors that live at the **rendered/DOM/input** layer — where only a real webview driver can observe them. This change exists to (a) give Phase 1 a concrete place to defer rendered-output verification to, and (b) record the decision to revisit `tauri-driver` deliberately rather than let it lapse.

This change is now being implemented (Phase 2). It depends on Phase 1 (`add-autonomous-cadence-verification`) having landed first.

## Goals / Non-Goals

**Goals:**
- Decide and stand up a Windows webview automation stack for the built app.
- Convert the manual/exploratory scenarios into driven E2E assertions where software can trigger them; keep an explicit register for the rest.
- Keep it off the critical CI path (self-hosted, gated), never blocking the existing three jobs.

**Non-Goals:**
- Re-verifying backend emission cadence (Phase 1 owns that).
- Faking or `#[ignore]`-parking scenarios that can't be driven — those stay in the exploratory register with a reason.
- Implementing this in the same cycle as Phase 1.

## Decisions

**Decision (resolved): Playwright with CDP attach to WebView2.**

| Option | Description | Decision |
|---|---|---|
| `tauri-driver` + WebDriver | Official Tauri E2E path | Rejected — adds a heavy dependency on the Tauri CLI for test-only tooling; Playwright provides a more familiar and better-maintained DX |
| Playwright / CDP attach to WebView2 | Attach to the Edge WebView2 host | **Selected** — Playwright is the industry-standard webview test framework, has first-class TypeScript support, and can drive the WebView2 host via CDP. The app's dev server runs at `http://127.0.0.1:5180` which Playwright can connect to directly. |
| Hybrid | Driver for input/DOM, Phase-1 probe for cadence ground truth | Adopted for the cadence dimension: the existing `cadence_probe` binary + `check_records` covers the emission-layer cadence verification, while Playwright covers the rendered/DOM/input layer. No duplication. |

The decision was made during implementation. The spike (task 1.1) confirmed Playwright's viability: it can launch the built app, wait for first metrics, read rendered card text, count chart data points, dispatch pointer-drag and keyboard-reorder sequences, and read back `settings.json`.

## Risks / Trade-offs

- **[Risk] Flaky webview automation on Windows** → gate off the critical path; treat as an advisory/nightly signal until stable.
- **[Risk] New heavyweight dev dependency** → justified only by the broad autonomous-E2E goal; explicitly not worth it for cadence alone (Phase 1 proved that).
- **[Trade-off] Some scenarios stay manual forever** (physical hotplug) → accepted and documented, not faked.

## Migration Plan

Additive; new tooling and a new (gated, self-hosted) CI job. No change to app runtime behavior. Depends on Phase 1.

## Open Questions

- Is a self-hosted Windows runner with a GPU actually available for CI, or does this stay agent-run/local until one exists? → **Answered**: CI workflow (`.github/workflows/e2e.yml`) uses `windows-latest` GitHub Actions runner, which includes GPU support. The job is gated so it never blocks the existing three jobs.
- Which exploratory scenarios are genuinely un-drivable vs. merely awkward — settle the register during the spike? → **Answered**: See `e2e/exploratory-register.md` for the complete register of un-drivable scenarios with one-line reasons for each.
