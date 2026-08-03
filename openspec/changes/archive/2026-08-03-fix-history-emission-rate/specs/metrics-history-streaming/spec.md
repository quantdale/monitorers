## ADDED Requirements

### Requirement: History arrays advance at exactly 1Hz end-to-end
Both the Rust `HistoryStore` and the frontend's mirrored history state SHALL append at most one new point per history channel (CPU, mem, disk, net, GPU) per real-world second, regardless of how frequently `metrics-update` events are emitted.

#### Scenario: One hour window reflects one real hour
- **WHEN** the app has been running continuously for 3600 seconds
- **THEN** a "1 hour" time window selection displays exactly 3600 real seconds of history for every channel (CPU, mem, disk, net, GPU) — not ~900 seconds

#### Scenario: Off-tick events do not grow history
- **WHEN** a `metrics-update` event is emitted on a non-full tick (`on_tick: false`)
- **THEN** the frontend does not append to any of `history.cpu`, `history.mem`, `history.disks[].values`, `history.net_recv`, `history.net_sent`, or `history.gpus[].values`

### Requirement: Live scalar readouts refresh independently of history commits
CPU and GPU current-value display (the numeric readout shown on their cards) SHALL update on every `metrics-update` event (~250ms cadence), independent of whether that event is a history-committing tick.

#### Scenario: CPU card updates every 250ms
- **WHEN** a `metrics-update` event arrives, whether or not `on_tick` is true
- **THEN** the CPU card's displayed percentage reflects that event's `cpu` value immediately, without waiting for the next history-committing tick

#### Scenario: GPU card updates every 250ms
- **WHEN** a `metrics-update` event arrives for a GPU present in `snap.gpus`
- **THEN** that GPU's card displays the event's `util` value immediately, independent of `on_tick`

### Requirement: Latest scalar values are never stale relative to history
`HistoryStore.cpu_latest` and `HistoryStore.gpu_latest` SHALL reflect values at least as recent as the newest entry in `cpu_history`/the corresponding `gpu_entries` history at all times, including immediately after a full (history-committing) tick.

#### Scenario: Full tick keeps latest in sync with history
- **WHEN** a full poll tick runs `commit_cpu`/`commit_gpu`, pushing a new value into `cpu_history`/`gpu_entries`
- **THEN** `cpu_latest`/`gpu_latest` are updated to that same value in the same commit, so `build_snapshot` never serves an older scalar than what was just committed to history

### Requirement: The tick-cadence gate is independently testable and regression-covered
The decision of whether a given tick is a full (history-committing) poll or a registry-only (scalar-refresh) poll SHALL be implemented as a pure, unit-testable function, separate from the I/O and commit logic it gates.

#### Scenario: Cadence gate has direct unit tests
- **WHEN** the tick-cadence function is called with tick values `0, 1, 2, 3, 4, 5, ...`
- **THEN** it returns true exactly for multiples of 4 (`0, 4, 8, ...`) and false otherwise, verified by a unit test with no I/O or Tauri/collector dependencies

#### Scenario: Regression protection
- **WHEN** a future change modifies the tick loop's full/registry branching
- **THEN** the existing cadence-gate unit tests fail if the 1-full-poll-per-4-ticks (1Hz history commit) invariant is broken, before the change can be merged
