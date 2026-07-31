## Context

`add-realistic-usage-test-suite`'s design.md made a deliberate call: **do not** stand up `tauri-driver`/WebDriver, and scope drag-and-drop, real hardware hotplug, and multi-process scenarios as manual/exploratory instead. That was correct for a tests-only change whose goal was pure-function coverage.

Phase 1 (`add-autonomous-cadence-verification`) then automated the one manual gate that *didn't* need a driver, by tapping the emission stream. The residue is exactly the set of behaviors that live at the **rendered/DOM/input** layer — where only a real webview driver can observe them. This change exists to (a) give Phase 1 a concrete place to defer rendered-output verification to, and (b) record the decision to revisit `tauri-driver` deliberately rather than let it lapse.

This is a **future** change: captured now, implemented later, and dependent on Phase 1 landing first.

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

**Decision (open, for design-time evaluation): which driver stack.**

| Option | Description | Notes |
|---|---|---|
| `tauri-driver` + WebDriver | Official Tauri E2E path | The one the test-suite change rejected; re-evaluate now that the goal justifies the setup cost |
| Playwright / CDP attach to WebView2 | Attach to the Edge WebView2 host | Familiar tooling, but Tauri IPC + WebView2 attach on Windows needs validation |
| Hybrid | Driver for input/DOM, Phase-1 probe for cadence ground truth | Likely best: don't re-derive cadence through the DOM when the probe already has it |

Resolve during implementation with a spike; this proposal does not pre-commit.

## Risks / Trade-offs

- **[Risk] Flaky webview automation on Windows** → gate off the critical path; treat as an advisory/nightly signal until stable.
- **[Risk] New heavyweight dev dependency** → justified only by the broad autonomous-E2E goal; explicitly not worth it for cadence alone (Phase 1 proved that).
- **[Trade-off] Some scenarios stay manual forever** (physical hotplug) → accepted and documented, not faked.

## Migration Plan

Additive; new tooling and a new (gated, self-hosted) CI job. No change to app runtime behavior. Depends on Phase 1.

## Open Questions

- Is a self-hosted Windows runner with a GPU actually available for CI, or does this stay agent-run/local until one exists?
- Which exploratory scenarios are genuinely un-drivable vs. merely awkward — settle the register during the spike.
