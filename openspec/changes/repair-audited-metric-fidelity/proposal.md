## Why

The repository audit found that failed PDH reads and temporarily missing devices shift retained utilization readings onto later timestamps. It also found an initial subscribe/read race, repeated unavailable thermal queries, and disconnected network interfaces whose stale deltas keep contributing traffic.

## What Changes

- Preserve null device-history samples at every committed timestamp, including failures and absence during the pruning grace period.
- **BREAKING**: advance the metrics schema together on Rust, TypeScript, and the mock; allow unavailable snapshot disk/GPU utilization to be null while retaining valid latest GPU scalars.
- Wait for initial listener registration before fetching history, as on reconnect.
- Cache unavailable thermal results for a bounded interval after WMI is available, without delaying the first WMI-backed query.
- Remove disconnected network interfaces during refresh so their last byte deltas are not replayed.
- Preserve upload-series extrema during chart downsampling, clear explicitly unavailable temperatures, and use monotonic device-pruning bookkeeping.
- Add focused regressions and validate the production and simulation paths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `metrics-history-streaming`: preserve gaps at their original indices through PDH failure and recovery.
- `collector-time-fidelity`: bound unsuccessful thermal polling and exclude disconnected interface deltas.
- `frontend-data-load-resilience`: close the initial history read/subscription gap.

## Impact

Collector state, commits, snapshot projection and IPC mirrors; metrics hook and mock schema; regression tests and architecture documentation. No new dependencies or presentation changes.
