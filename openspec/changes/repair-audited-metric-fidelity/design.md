## Context

See proposal.md for verified audit findings. Scalar histories currently use `VecDeque<f64>` and assume shorter device rings represent only pre-discovery time. That assumption fails for holes in the middle. The frontend already supports nullable chart points, but snapshot utilization is typed as always available. The tick loop must remain the only history growth gate and OS I/O must remain outside history locks.

## Goals / Non-Goals

**Goals:** make dynamic history index alignment truthful under failure and hotplug, close bootstrap data loss, and bound unnecessary polling.

**Non-Goals:** changing chart design, cadence, recovery policy, device identity, or dependencies.

## Decisions

- Store dynamic-device history as `VecDeque<Option<f64>>`. Append `None` for every retained device on an unavailable full tick; new device rings remain tail-aligned until first discovery. This models holes explicitly instead of overloading NaN or inserting stale values.
- Make snapshot disk `active` and GPU `util` nullable. Full ticks project the committed slot; registry ticks can project the last valid GPU scalar. The frontend skips null GPU scalar updates but appends null chart values. Bump all three metrics-schema constants to 7 and document the synchronized contract.
- Keep the current grace-based pruning policy and last-good scalars independent of nullable history. No synthetic samples are added for recovery downtime because no full ticks occur then.
- Use a time-injected thermal cache seam storing both successful and unsuccessful results. Do not cache calls without a WMI connection; five-second negative caching bounds repeated expensive queries while permitting automatic recovery.
- Use sysinfo's remove-not-listed interface refresh mode. Its Windows implementation initializes new interfaces' old and current counters together, so reconnection begins with a truthful zero delta.
- Initialize the history registration revision as unmatched so initial mount follows the already-existing reconnect fence.
- The audit's second pass extends the same fidelity work: retain extrema from both network series within the fixed point budget, honor explicit null thermal values, and use `performance.now()` for frontend-only pruning grace so wall-clock adjustments cannot retain ghosts indefinitely. Correct tail slicing when a supplied channel is longer than its timestamp ring and align the headless probe's CPU identity/provider registration with production.

## Risks / Trade-offs

- Nullable snapshot fields change IPC compatibility → synchronized schema bump and production/mock typechecks, unit regressions, E2E, simulation and packaged verification.
- Missing full-tick GPU values must not erase the latest valid live scalar → explicit null-filter regression.
- Last-good GPU fallback must not scan 3600 samples on each tick → retain `gpu_latest` for live scalar lookup.
- Five-second negative caching delays recovery from an unavailable thermal class by at most that interval → same freshness bound as successful readings and deterministic boundary tests.

## Migration Plan

Ship backend and frontend together through the normal Tauri build. Settings are unchanged. An old frontend/backend pair fails the existing schema check. Rollback requires reverting the matching contract and code together.
