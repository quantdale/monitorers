## Why

The `metrics-update` Tauri event fires unconditionally every 250ms, and the frontend (`useMetrics.ts`) appends every single event into its charting history arrays with no gating. The Rust-side `HistoryStore` itself already commits at the correct 1Hz rate (via `commit_cpu`/`commit_gpu`/`commit_disk_network`, gated to every 4th tick), but that correctness never reaches the UI: the frontend rebuilds its own, ungated history from the raw event stream. Net effect — confirmed by reading current source in a prior `/opsx:explore` session — every history channel (CPU, mem, disk, net, GPU) grows 4x faster than real time, so a user's "1 hour" window selection is actually showing ~15 minutes of real elapsed time. This is the audit's headline correctness finding (COR-001), a repeat of the same bug class already fixed once on the Rust side (`1c30a6c`) but never closed off on the IPC/frontend side.

Bundled with this fix, because both touch the same commit functions and the same tick-loop control flow:
- **ARC-007**: `cpu_latest`/`gpu_latest` in `HistoryStore` go stale on full ticks — `commit_cpu`/`commit_gpu` push fresh values into history but never update `cpu_latest`/`gpu_latest`, and the sensor registry (which normally refreshes those scalars) is skipped entirely on full ticks. `build_snapshot` then serves a stale scalar even though history was just updated in the same tick.
- **TEST-001**: the tick-cadence gate (`tick.is_multiple_of(4)` in `main.rs`'s tick loop) has no regression test. Given this is the second time this exact bug class has recurred, it needs to be extracted into a testable unit and covered, so it can't silently regress a third time.

## What Changes

- Add a boolean field to `MetricsSnapshot` (Rust) / the corresponding TS type — `on_tick: bool` — set to whatever the tick loop already computes as `raw.is_some()` (i.e., "was this a full-poll, history-committing tick"). No new emission path; this rides the existing `metrics-update` event.
- **BREAKING** (internal IPC only, not user-facing): bump `SCHEMA_VERSION` from `2` to `3` on both `main.rs` and `useMetrics.ts`, since `MetricsSnapshot`'s shape changes.
- Frontend (`useMetrics.ts`): add "latest value" state for CPU and GPU (mirroring the `memGb`/`nvidiaStats` latest-vs-history split that already exists for those channels), updated on every event regardless of `on_tick`. History arrays (`cpu`, `mem`, `disks[].values`, `net_recv`, `net_sent`, `gpus[].values`) only append when `on_tick` is true.
- Frontend (`App.tsx`): cards switch their current-value reads from `history.cpu.at(-1)` / `gpu.values.at(-1)` (etc.) to the new latest-value state, preserving the existing 250ms visual refresh rate for those readouts.
- Rust (`collector/mod.rs`): fix ARC-007 by having `commit_cpu`/`commit_gpu` also update `cpu_latest`/`gpu_latest` (or equivalent), so `build_snapshot` never serves a stale scalar on a full tick.
- Rust (`main.rs`): extract the tick-cadence decision (`tick.is_multiple_of(4)`) into a small, independently testable function, and add unit tests for it.
- Frontend tests: cover the new gating condition (history only appends on `on_tick`) and the new latest-value derivation.

## Capabilities

### New Capabilities
- `metrics-history-streaming`: formalizes the previously-undocumented contract between the collector's tick cadence, `HistoryStore` commits, and the `metrics-update` IPC event — specifically the 1Hz history-commit rate, the "latest value never stale relative to history" invariant, and the tick-cadence gate's correctness. No such capability currently exists in `openspec/specs/`; this is the first time it's captured as a formal requirement rather than left as prose in CLAUDE.md and code comments.

### Modified Capabilities
(none — no existing `openspec/specs/` capability currently covers this contract)

## Impact

- **Code**: `sys-monitor-tauri/src-tauri/src/main.rs` (schema version, `MetricsSnapshot`, `build_snapshot`, tick loop extraction), `sys-monitor-tauri/src-tauri/src/collector/mod.rs` (`commit_cpu`, `commit_gpu`), `sys-monitor-tauri/src/hooks/useMetrics.ts` (schema version, gating, latest-value state), `sys-monitor-tauri/src/types/metrics.ts` (mirror the new `on_tick` field), `sys-monitor-tauri/src/App.tsx` (card value reads).
- **IPC schema**: `MetricsSnapshot` gains `on_tick: bool`; `SCHEMA_VERSION`/`EXPECTED_SCHEMA_VERSION` bump 2 → 3 on both sides together.
- **Tests**: Rust baseline 70 tests expected to grow (new tick-cadence-gate tests, updated ARC-007 coverage). Frontend baseline 41 tests expected to grow (gating + latest-value tests).
- **Out of scope** (separate audit findings, not touched here): COR-002/ARC-001 (multi-GPU telemetry keying), ERR-002/ARC-002 (collector crash logging/restart), PERF-001/PERF-002 (re-measure after this lands), any UX/DOC/CQ findings other than what's listed above.
