## Why

Opening Hardware and Metrics at desktop width and then narrowing the window leaves the portaled Metrics dialog above the modal hardware drawer. Both focus boundaries stay active, so the modal's close action no longer owns keyboard focus.

## What Changes

- Suspend and dismiss metric visibility while the hardware drawer is modal, including breakpoint transitions.
- Make drawer focus ownership immediate, retain metric selections, and allow the selector to reopen after dismissal.
- Add resize/focus/Escape regressions and inspect the actual narrow-window render.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `accessible-ui-feedback`: one active temporary focus boundary when the hardware rail becomes a modal drawer.

## Impact

Dashboard-to-selector presentation state and browser regressions only. Existing design, drag sensors, settings, collector and IPC remain intact.
