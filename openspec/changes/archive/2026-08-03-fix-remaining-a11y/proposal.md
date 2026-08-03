## Why

Three smaller, independent UI/UX findings (UX-004, UX-005, UX-006) from the 2026-07-25 audit remain open, re-confirmed against current source. Unlike the drag-handle cluster (`fix-drag-handle-keyboard-a11y`), these three touch different components with no shared code — bundled here purely as a low-risk "remaining accessibility/UX quick wins" batch, the same pattern used for the docs sweep.

## What Changes

- **UX-004**: The "Collecting metrics…" message (`App.tsx:458-468`, `color: '#666'` on a `#141414` background, ≈3.21:1 contrast) and the "Detecting hardware…" message (`HardwareSidebar.tsx:284-287`, `color: '#666'` on a `#0f0f0f` background, ≈3.34:1 contrast) both fall below the 4.5:1 WCAG AA minimum for normal text — on exactly the two messages a user stares at while waiting for data. Lighten both text colors to a value meeting 4.5:1 against their respective backgrounds.
- **UX-005**: `MetricCardSelector.tsx:18-28`'s dropdown closes only via a click-outside handler; no Escape-key handling exists, and its trigger button (`MetricCardSelector.tsx:34-50`) has no `aria-haspopup`/`aria-expanded`. Add an Escape-key listener that closes the dropdown, and add `aria-haspopup="true"` (or `"listbox"`/`"menu"` as appropriate to its actual role) and `aria-expanded={isOpen}` to the trigger button.
- **UX-006**: `App.tsx:371` computes the correctly-filtered `visibleCardOrder` (excluding hidden/absent card ids), but the empty-state gate at `App.tsx:458` checks the raw, unfiltered `cardOrder.length === 0` instead — so hiding every card via `MetricCardSelector` leaves a blank canvas with no explanatory message, since `cardOrder` itself is still non-empty. Change the empty-state gate to check `visibleCardOrder.length === 0`.

## Capabilities

### New Capabilities
- `accessible-ui-feedback`: formalizes, as a durable requirement, that the app's status/loading messages meet WCAG AA contrast, that dismissable UI controls (dropdowns) support standard keyboard dismissal and expose their state to assistive technology, and that empty-state messaging is driven by the same filtered data the UI actually renders. No such capability currently exists in `openspec/specs/`.

### Modified Capabilities
(none)

## Impact

- **Code**: `sys-monitor-tauri/src/App.tsx` (UX-004's loading-message color, UX-006's empty-state gate), `src/components/HardwareSidebar.tsx` (UX-004's loading-message color), `src/components/MetricCardSelector.tsx` (UX-005's Escape handling and aria attributes).
- **APIs/schema**: none.
- **Dependencies**: none.
- **Tests**: Frontend baseline currently 46 tests. No component-level testing library exists yet (`@testing-library/react` absent), so UX-005's Escape-key behavior and UX-006's empty-state gate are likely verified manually rather than via new automated component tests, unless a plain-function extraction (e.g. the empty-state boolean condition itself) allows a lightweight unit test without full component-test infrastructure.
- **Out of scope**: everything else in the wider audit backlog, including the drag-handle-specific accessibility cluster (`fix-drag-handle-keyboard-a11y`, a separate change) and the component-test infrastructure gap (TEST-005, tracked by the in-progress `add-realistic-usage-test-suite` change).
