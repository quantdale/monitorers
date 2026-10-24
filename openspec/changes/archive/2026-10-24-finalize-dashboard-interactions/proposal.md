## Why

Review of this session's two commits found a failing canonical frontend gate, incomplete keyboard containment in both new dialog flows, and unqualified claims in archived evidence. Finalization must fix these regressions, validate actual long-content and minimum-window states, and preserve the remotely added repository instructions before pushing main.

## What Changes

- Remove the production helper used only by its own tests; test the actual media-query contract.
- Contain focus in the hardware modal and the metrics panel on entry, forward/reverse Tab, dynamic content, and breakpoint changes, without swallowing keyboard drag cancellation.
- Keep selector content within short/narrow windows and long metric/model names and rates within cards.
- Retain unavailable readings as unavailable, not fabricated zero ranges or rates.
- Remove unnecessary helper copy and reconcile documentation/evidence against actual checks and current token values.
- Resolve the application audit's newly published Vite/Vitest advisories with compatible patch updates; document and enforce jsdom's existing Node 24.15 engine floor.
- Run canonical frontend/Rust/build, E2E, simulation, packaged qualification where supported; merge the current remote main non-destructively and push the verified result.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `accessible-ui-feedback`: complete focus containment, bounded overlays, and truthful unavailable summaries.
- `dashboard-layout-containment`: long hardware names and large rate values fit at minimum size in all view modes.

## Impact

Frontend controls/cards and regression tests, archived evidence corrections, current progress and architecture docs. No IPC schema, collector behavior, persisted identity, or permission changes. Vite 8.3.1 → 8.3.5 and Vitest 4.1.11 → 4.1.12 patch updates address concrete audit failures; no unrelated direct dependency upgrade.
