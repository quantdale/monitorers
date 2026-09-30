## MODIFIED Requirements

### Requirement: History arrays advance at exactly 1Hz end-to-end
Both the Rust `HistoryStore` and the frontend's mirrored history state SHALL append at most one new point per history channel (CPU, mem, disk, net, GPU) per real-world second, regardless of how frequently `metrics-update` events are emitted. A history-committing live snapshot SHALL be appended with the timestamp carried by that snapshot, so the frontend does not stamp a second, independent clock into the same ring as the backend's history. Changing the selected history window SHALL re-slice the session's accumulated history — a wider window reveals earlier recorded samples that were already committed, a narrower window shows a strictly smaller elapsed span — and SHALL NOT replace the accumulated history with unrelated data. This window-slicing behaviour SHALL hold identically in the real backend and in the scriptable browser mock backend used by the simulation lanes.

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
