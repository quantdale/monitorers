## ADDED Requirements

### Requirement: Failed device reads retain timestamp-aligned gaps
Every known disk and GPU SHALL receive one nullable history slot per full tick while retained. A failed read or device absence SHALL append null at that tick, preserve all earlier sample timestamps, and keep pruning separate from history alignment. The live full-tick snapshot SHALL carry the same nullable utilization as the committed slot. Valid latest GPU scalars SHALL survive a missing utilization sample.

#### Scenario: PDH fails and resumes
- **WHEN** a valid sample is followed by failed full ticks and then another valid sample
- **THEN** history reads and live reconstruction both contain the earlier value, null gaps, and the resumed value at their original timestamps

#### Scenario: Device returns during pruning grace
- **WHEN** one device disappears briefly while another remains available
- **THEN** the retained device records null for each absent full tick and resumes without shifting its earlier values

#### Scenario: Capacity rollover includes missing slots
- **WHEN** a full history ring receives failed and successful device samples
- **THEN** each device history rolls over with the timestamp ring and remains bounded

### Requirement: Metric projection preserves unavailable readings and both plotted series
An explicit null temperature SHALL replace the previous reading. Dynamic-device pruning grace SHALL use monotonic elapsed time. Downsampling a dual-series chart SHALL consider extrema in both series while retaining endpoints, common source indices, missing-data gaps and the configured point budget.

#### Scenario: Temperature becomes unavailable
- **WHEN** a previously available CPU or GPU temperature is explicitly null in a later full-tick snapshot
- **THEN** the displayed temperature becomes unavailable instead of retaining stale telemetry

#### Scenario: Wall time changes during device absence
- **WHEN** system wall time moves backward or forward during a device's pruning grace
- **THEN** the grace still expires after its configured monotonic duration

#### Scenario: Upload spikes between download extrema
- **WHEN** a network upload spike occurs at an interior sample while download remains flat
- **THEN** downsampling retains the spike with its matching download value and timestamp when the point budget permits

## MODIFIED Requirements

### Requirement: History arrays advance at exactly 1Hz end-to-end
Both the Rust `HistoryStore` and the frontend's mirrored history state SHALL append at most one new point per history channel (CPU, mem, disk, net, GPU) per real-world second, regardless of how frequently `metrics-update` events are emitted. A history-committing live snapshot SHALL be appended with the timestamp carried by that snapshot, so the frontend does not stamp a second, independent clock into the same ring as the backend's history. Changing the selected history window SHALL re-slice the session's accumulated history — a wider window reveals earlier recorded samples that were already committed, a narrower window shows a strictly smaller elapsed span — and SHALL NOT replace the accumulated history with unrelated data. This window-slicing behaviour SHALL hold identically in the real backend and in the scriptable browser mock backend used by the simulation lanes.

#### Scenario: One hour window reflects one real hour
- **WHEN** the app has been running continuously for 3600 seconds
- **THEN** a "1 hour" time window selects the recorded samples in that elapsed window for every channel (CPU, mem, disk, net, GPU), bounded by the 3600-point ring rather than treating 3600 ticks as 3600 seconds

#### Scenario: Off-tick events do not grow history
- **WHEN** a `metrics-update` event is emitted on a non-full tick (`on_tick: false`)
- **THEN** the frontend does not append to any of `history.cpu`, `history.mem`, `history.disks[].values`, `history.net_recv`, `history.net_sent`, or `history.gpus[].values`

#### Scenario: GPU history preserves gaps on PDH failure
- **WHEN** a full poll tick runs but `PdhCollectQueryData` fails for the GPU PDH query
- **THEN** `commit_gpu` appends a null slot to every retained GPU history, preserving earlier sample timestamps, while `gpu_latest` retains the last valid reading

#### Scenario: Disk history and readouts preserve unavailability on PDH failure
- **WHEN** a full poll tick runs but `PdhCollectQueryData` fails for disk PDH queries
- **THEN** `commit_disk_network` appends a null activity slot for each retained disk, preserves its earlier sample timestamps, suspends disappearance pruning, and marks current throughput/response unavailable

#### Scenario: Newly-appearing cards anchor their first history point to their true appearance timestamp
- **WHEN** a disk or GPU first appears in `metrics-update` after the session has started (not present in initial `get_history`)
- **THEN** the frontend seeds that card's history with a single point at the arrival timestamp, not at the oldest global timestamp; subsequent points append normally so the card's plot starts where it actually appeared

#### Scenario: Widening the window reveals already-committed history
- **WHEN** the selected time window is widened after the session has accumulated recorded samples
- **THEN** the chart for each channel extends back over the additional elapsed time using samples that were already committed, rather than showing an unrelated replacement series

#### Scenario: Narrowing the window shortens the span
- **WHEN** the selected time window is narrowed
- **THEN** the visible elapsed span for each channel shrinks to the requested window and the newest sample is retained

#### Scenario: Window behaviour is identical in the mock lane
- **WHEN** the same window change is performed in the browser mock harness used by the simulation platform
- **THEN** the resulting timestamps and channel slices are produced by the same windowing semantics as the real backend, so a journey or E2E spec exercising the mock lane is genuinely testing window behaviour

#### Scenario: Live commits do not introduce a second clock
- **WHEN** the frontend appends history from a history-committing live event
- **THEN** the appended entry's timestamp is the one carried by that event, and the resulting history ring does not contain values produced by two different clocks

### Requirement: Live scalar readouts refresh independently of history commits
CPU and GPU current-value display (the numeric readout shown on their cards) SHALL update from every valid `metrics-update` reading (~250ms cadence), independent of whether that event is a history-committing tick. Missing GPU utilization SHALL preserve its last valid scalar, or remain unavailable before the first valid reading.

#### Scenario: CPU card updates every 250ms
- **WHEN** a `metrics-update` event arrives, whether or not `on_tick` is true
- **THEN** the CPU card's displayed percentage reflects that event's `cpu` value immediately, without waiting for the next history-committing tick

#### Scenario: GPU card updates every 250ms
- **WHEN** a `metrics-update` event carries valid utilization for a GPU present in `snap.gpus`
- **THEN** that GPU's card displays the event's `util` value immediately, independent of `on_tick`

#### Scenario: GPU live readout freezes on PDH failure (does not show 0%)
- **WHEN** a full poll tick's PDH query for the GPU fails and the backend commits a missing utilization slot while retaining its last valid scalar
- **THEN** the full-tick event carries null utilization for history reconstruction, and the GPU card retains its last valid readout instead of showing 0.0%; registry-only events may carry the retained scalar

### Requirement: Latest scalar values are never stale relative to history
`HistoryStore.cpu_latest` and `HistoryStore.gpu_latest` SHALL reflect valid readings at least as recent as the newest valid entry in `cpu_history`/the corresponding `gpu_entries` history at all times, including immediately after a full (history-committing) tick. Missing history slots SHALL NOT overwrite a valid latest scalar.

#### Scenario: Full tick keeps latest in sync with history
- **WHEN** a full poll tick runs `commit_cpu`/`commit_gpu`, pushing a valid new value into `cpu_history`/`gpu_entries`
- **THEN** `cpu_latest`/`gpu_latest` are updated to that same valid value in the same commit

#### Scenario: On PDH failure, latest retains last-successful value
- **WHEN** a full poll tick fails PDH for a GPU
- **THEN** `gpu_latest` retains its last valid value while the history receives a null slot

### Requirement: Emission cadence is autonomously verifiable against real hardware
The 1 Hz history-commit / 4 Hz liveness cadence SHALL be verifiable by an automated probe-and-checker against real hardware, without human observation of the GUI. A headless probe SHALL run the real collector loop for a bounded duration and emit, per snapshot, a machine-readable record carrying at least the elapsed time, the `on_tick` flag, and the current history length of at least the CPU channel. A checker SHALL consume those records and assert the cadence invariants, producing a PASS/FAIL result and a nonzero exit on failure. Because the cadence is a fixed ratio, a bounded run (on the order of 60–120 seconds) is sufficient to establish the invariants for any longer window; the checker SHALL NOT require a full-hour run.

#### Scenario: Liveness — events arrive at the full tick rate
- **WHEN** the checker processes a probe run of at least 60 seconds
- **THEN** it confirms the mean interval between emitted snapshots is ~250 ms (within tolerance), establishing that live readouts refresh multiple times per second

#### Scenario: Fidelity — history advances at exactly 1 Hz with no drift
- **WHEN** the checker processes the same probe run
- **THEN** it confirms history length increases by exactly one per `on_tick:true` record until capacity and by zero per `on_tick:false` record, that the bounded final length tracks elapsed whole seconds within tolerance, and that committed timestamps continue advancing at capacity

#### Scenario: Checker fails loudly on a cadence regression
- **WHEN** a future change breaks the 1-full-poll-per-4-ticks gate or re-introduces ungated history growth, and the probe is re-run
- **THEN** the checker reports FAIL with the offending measured cadence and exits nonzero, so the regression is caught before merge on a sensor-equipped runner

#### Scenario: GPU/disk PDH failure does not corrupt cadence checker history counts
- **WHEN** the checker processes a probe run where PDH fails intermittently for GPU/disk
- **THEN** every retained channel receives one slot per `on_tick:true` record regardless of PDH success/failure, bounded by capacity, with null slots for failed device readings
