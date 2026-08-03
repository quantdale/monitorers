## MODIFIED Requirements

### Requirement: History arrays advance at exactly 1Hz end-to-end
Both the Rust `HistoryStore` and the frontend's mirrored history state SHALL append at most one new point per history channel (CPU, mem, disk, net, GPU) per real-world second, regardless of how frequently `metrics-update` events are emitted.

#### Scenario: One hour window reflects one real hour
- **WHEN** the app has been running continuously for 3600 seconds
- **THEN** a "1 hour" time window selection displays exactly 3600 real seconds of history for every channel (CPU, mem, disk, net, GPU) — not ~900 seconds

#### Scenario: Off-tick events do not grow history
- **WHEN** a `metrics-update` event is emitted on a non-full tick (`on_tick: false`)
- **THEN** the frontend does not append to any of `history.cpu`, `history.mem`, `history.disks[].values`, `history.net_recv`, `history.net_sent`, or `history.gpus[].values`

#### Scenario: GPU history freezes on PDH failure instead of committing 0%
- **WHEN** a full poll tick runs but `PdhCollectQueryData` fails for the GPU PDH query
- **THEN** `commit_gpu` does not push 0.0 into `gpu_entries`; instead the GPU history arrays retain their last-known values and `gpu_latest` is frozen at the last successful reading

#### Scenario: Disk throughput history freezes on PDH failure instead of zeroing
- **WHEN** a full poll tick runs but `PdhCollectQueryData` fails for disk PDH queries
- **THEN** `commit_disk_network` does not overwrite `disk_read_mb_s`, `disk_write_mb_s`, and `disk_avg_response_ms` with empty maps; instead disk history arrays retain their last-known values and `disk_latest` is frozen at the last successful reading

#### Scenario: Newly-appearing cards anchor their first history point to their true appearance timestamp
- **WHEN** a disk or GPU first appears in `metrics-update` after the session has started (not present in initial `get_history`)
- **THEN** the frontend seeds that card's history with a single point at the arrival timestamp, not at the oldest global timestamp; subsequent points append normally so the card's plot starts where it actually appeared

### Requirement: Live scalar readouts refresh independently of history commits
CPU and GPU current-value display (the numeric readout shown on their cards) SHALL update on every `metrics-update` event (~250ms cadence), independent of whether that event is a history-committing tick.

#### Scenario: CPU card updates every 250ms
- **WHEN** a `metrics-update` event arrives, whether or not `on_tick` is true
- **THEN** the CPU card's displayed percentage reflects that event's `cpu` value immediately, without waiting for the next history-committing tick

#### Scenario: GPU card updates every 250ms
- **WHEN** a `metrics-update` event arrives for a GPU present in `snap.gpus`
- **THEN** that GPU's card displays the event's `util` value immediately, independent of `on_tick`

#### Scenario: GPU live readout freezes on PDH failure (does not show 0%)
- **WHEN** a `metrics-update` event arrives with `snap.gpus[i].pdh_ok == false`
- **THEN** the GPU card's displayed `util` retains its last successful value instead of showing 0.0%

### Requirement: Latest scalar values are never stale relative to history
`HistoryStore.cpu_latest` and `HistoryStore.gpu_latest` SHALL reflect values at least as recent as the newest entry in `cpu_history`/the corresponding `gpu_entries` history at all times, including immediately after a full (history-committing) tick.

#### Scenario: Full tick keeps latest in sync with history
- **WHEN** a full poll tick runs `commit_cpu`/`commit_gpu`, pushing a new value into `cpu_history`/`gpu_entries`
- **THEN** `cpu_latest`/`gpu_latest` are updated to that same value in the same commit, so `build_snapshot` never serves an older scalar than what was just committed to history

#### Scenario: On PDH failure, latest retains last-successful value
- **WHEN** a full poll tick fails PDH for GPU or disk
- **THEN** `gpu_latest`/`disk_latest` are NOT updated (remain at last successful values) so the invariant "latest is at least as recent as history" holds trivially

### Requirement: The tick-cadence gate is independently testable and regression-covered
The decision of whether a given tick is a full (history-committing) poll or a registry-only (scalar-refresh) poll SHALL be implemented as a pure, unit-testable function, separate from the I/O and commit logic it gates.

#### Scenario: Cadence gate has direct unit tests
- **WHEN** the tick-cadence function is called with tick values `0, 1, 2, 3, 4, 5, ...`
- **THEN** it returns true exactly for multiples of 4 (`0, 4, 8, ...`) and false otherwise, verified by a unit test with no I/O or Tauri/collector dependencies

#### Scenario: Regression protection
- **WHEN** a future change modifies the tick loop's full/registry branching
- **THEN** the existing cadence-gate unit tests fail if the 1-full-poll-per-4-ticks (1Hz history commit) invariant is broken, before the change can be merged

### Requirement: The collector tick loop is sink-agnostic and runnable without an AppHandle
The collector's per-tick body (poll/commit/build-snapshot/emit, including its `catch_unwind` panic handling) SHALL be implemented as a reusable function parameterized by an emit sink and an error sink, and SHALL take its `HistoryStore` as a passed-in handle rather than resolving it from a Tauri `AppHandle`. Production wires the emit sink to `app_handle.emit("metrics-update", …)` and the error sink to `app_handle.emit("collector-error", …)`; a headless caller may wire them to any other destination. The extraction SHALL be behavior-preserving: identical 250 ms cadence, identical 4-tick full-poll ratio, identical one-`PdhCollectQueryData`-per-full-tick invariant, and identical panic-break semantics (on a caught panic, emit one error and stop).

#### Scenario: Production behavior is unchanged after extraction
- **WHEN** the app runs normally after the tick loop is extracted behind sinks
- **THEN** it emits `metrics-update` every ~250 ms and `collector-error` exactly once on a caught panic, with no observable difference from the pre-extraction inline loop

#### Scenario: Loop runs headless with a recording sink
- **WHEN** the extracted loop is invoked with a real `CollectorState`, a passed-in `HistoryStore`, a bounded tick count, and a recording emit sink instead of a Tauri `AppHandle`
- **THEN** it drives real hardware polling for the given number of ticks and delivers each `MetricsSnapshot` to the sink, requiring no Tauri window or event loop

### Requirement: Emission cadence is autonomously verifiable against real hardware
The 1 Hz history-commit / 4 Hz liveness cadence SHALL be verifiable by an automated probe-and-checker against real hardware, without human observation of the GUI. A headless probe SHALL run the real collector loop for a bounded duration and emit, per snapshot, a machine-readable record carrying at least the elapsed time, the `on_tick` flag, and the current history length of at least the CPU channel. A checker SHALL consume those records and assert the cadence invariants, producing a PASS/FAIL result and a nonzero exit on failure. Because the cadence is a fixed ratio, a bounded run (on the order of 60–120 seconds) is sufficient to establish the invariants for any longer window; the checker SHALL NOT require a full-hour run.

#### Scenario: Liveness — events arrive at the full tick rate
- **WHEN** the checker processes a probe run of at least 60 seconds
- **THEN** it confirms the mean interval between emitted snapshots is ~250 ms (within tolerance), establishing that live readouts refresh multiple times per second

#### Scenario: Fidelity — history advances at exactly 1 Hz with no drift
- **WHEN** the checker processes the same probe run
- **THEN** it confirms history length increases by exactly one per `on_tick:true` record and by zero per `on_tick:false` record, and that the final history length equals the elapsed whole-seconds count within tolerance — establishing that a "1 hour" window would represent 3600 real seconds, not ~900

#### Scenario: Checker fails loudly on a cadence regression
- **WHEN** a future change breaks the 1-full-poll-per-4-ticks gate or re-introduces ungated history growth, and the probe is re-run
- **THEN** the checker reports FAIL with the offending measured cadence and exits nonzero, so the regression is caught before merge on a sensor-equipped runner

#### Scenario: GPU/disk PDH failure does not corrupt cadence checker history counts
- **WHEN** the checker processes a probe run where PDH fails intermittently for GPU/disk
- **THEN** history length increases by exactly one per `on_tick:true` record regardless of PDH success/failure (because commits are gated on `on_tick`, not on PDH success)

### Requirement: The manual runtime verification has an automated fulfilling procedure
The previously manual end-to-end verification (`fix-history-emission-rate` task 8.7, absorbed as `add-realistic-usage-test-suite` task 5.5) SHALL have a documented automated procedure — run the probe, run the checker, interpret PASS/FAIL — that an AI agent or a self-hosted Windows CI runner can execute unattended to satisfy the check. The manual stopwatch observation becomes optional corroboration, not the sole means of verification.

#### Scenario: Agent closes the manual task from a passing checker run
- **WHEN** an agent runs the documented procedure on a real Windows machine and the checker reports PASS
- **THEN** the captured checker report is sufficient evidence to consider the absorbed manual verification satisfied, without a human watching the GUI