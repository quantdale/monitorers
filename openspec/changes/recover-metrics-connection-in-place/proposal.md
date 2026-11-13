## Why

A failed history refresh leaves an error with no recovery action; a failed live subscription cannot reconnect without remounting the UI. Users should be able to recover the metrics connection without restarting the app or losing session settings and chart state.

## What Changes

- Add a keyboard-accessible Retry connection action to initial and retained-data error states, with pending feedback and duplicate-activation protection.
- Reattach metrics/lifecycle/error listeners and refetch the selected history window in place, fencing disposed work and retaining last-known data.
- Keep history, live-schema, lifecycle-schema and subscription error recovery independent.
- Verify failure, repeated retry, successful recovery, focus, narrow layouts and real IPC behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `frontend-data-load-resilience`: user-triggered connection recovery, generation-safe resubscription and channel-specific recovery proof.
- `accessible-ui-feedback`: accessible metrics retry pending/focus/containment behavior.

## Impact

Frontend metrics hook, dashboard error presentation, shared controls and regression coverage. No backend payload, command, persisted schema, dependencies or collector changes.
