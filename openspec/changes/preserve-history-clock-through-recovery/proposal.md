## Why

Each replacement collector session currently samples a new wall-clock origin while appending into the retained history ring. If the system clock changes before recovery, new samples can rewind or jump, invalidating elapsed windows and live/history reconciliation despite each individual session being monotonic.

## What Changes

- Preserve one monotonic timestamp projection for the lifetime of the history store, including automatic recovery and manual retry.
- Keep per-session polling deadlines and rate priming independent from the history clock.
- Add injected-clock and real-loop regression coverage without changing the machine clock.
- Reconcile architecture documentation with the history-lifetime clock ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collector-time-fidelity`: require clock continuity across retained-history session replacement.

## Impact

Rust history state and collector loop, tests and architecture documentation. No serialized fields, schema versions, cadence policy, rate denominators, or operating-system state ownership change.
