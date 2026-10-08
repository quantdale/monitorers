# collector-time-fidelity Specification

## Purpose
Defines the wall-clock scheduling, cadence-verification, timestamp-window, and elapsed-rate contracts for the Windows collector.

## Requirements

### Requirement: Collector scheduling is monotonic and non-catching-up
The collector SHALL schedule ticks from a monotonic clock at the configured 250 ms period. Work time SHALL NOT be added to the period, and a slow tick SHALL rebase or skip missed deadlines rather than executing a busy catch-up burst. Overruns and poll duration SHALL be observable in diagnostic/probe records.

#### Scenario: Work duration does not extend every period
- **WHEN** a tick body takes 80 ms and the target period is 250 ms
- **THEN** the next scheduled tick is due at the next 250 ms deadline from the monotonic schedule, not 330 ms after the prior start

#### Scenario: Long work does not cause a catch-up burst
- **WHEN** a tick body takes longer than one target period
- **THEN** the scheduler records an overrun and schedules one future tick without immediately replaying every missed deadline

#### Scenario: Stop remains responsive during scheduling
- **WHEN** the stop flag is set while the collector is waiting for its next deadline
- **THEN** the loop exits without waiting for an entire accumulated backlog of deadlines

### Requirement: Cadence verification proves wall-clock timing and ratio independently
The cadence probe SHALL define its observation epoch as the first emitted snapshot after startup bootstrap. `--secs N` SHALL stop after N monotonic wall-clock seconds and SHALL require at least 60 seconds for a real-duration check; `--ticks N` SHALL remain a separate explicit diagnostic mode. The checker SHALL validate event interval distribution, full-history interval distribution, full-tick ratio, CPU/timestamp/history growth, elapsed-time coverage, no off-tick growth, and no catch-up burst.

#### Scenario: Slow perfect-ratio fixture fails
- **WHEN** a fixture emits events every 750 ms with a perfect 4:1 full-tick ratio
- **THEN** the checker fails the wall-clock liveness SLO rather than passing on ratio alone

#### Scenario: Too-short fixture fails
- **WHEN** a real-duration fixture contains less than 60 seconds from its first emitted event
- **THEN** the checker reports an insufficient observation duration and exits nonzero

#### Scenario: Jitter and timestamp defects fail
- **WHEN** event intervals burst, full-history intervals exceed the SLO, or timestamps/history lengths diverge
- **THEN** the checker reports the offending distribution/coverage invariant and fails

### Requirement: Time windows and rates use elapsed timestamps
History window selection SHALL use recorded monotonic-derived timestamps and apply one aligned index range to every channel. The history ring SHALL have exactly one timestamp source: the timestamps the backend commits SHALL be the same values the frontend stores when it appends a live full-tick snapshot, so that no point in the ring is stamped by a second, independent clock. Where a live snapshot is reconciled against a history response, the "already covered" comparison SHALL be made between timestamps from that single source. Network throughput SHALL divide byte deltas by the elapsed monotonic refresh interval and SHALL handle first samples, counter resets, interface changes, near-zero intervals, and long pauses without inventing rates.

#### Scenario: Irregular history selects real duration
- **WHEN** timestamps are irregular and a 60-second window is requested
- **THEN** the selected suffix spans the newest timestamp back to approximately 60 seconds, regardless of how many samples that contains

#### Scenario: Equivalent byte ratios agree
- **WHEN** 250 ms, 1 s, and 2 s refreshes each observe byte deltas proportional to the same bytes-per-second rate
- **THEN** the normalized KB/s values agree within floating-point tolerance

#### Scenario: Counter reset is safe
- **WHEN** a network counter decreases or an elapsed interval is non-positive
- **THEN** the rate helper returns an explicit unavailable/zero-safe result and does not report a negative or fabricated spike

#### Scenario: Live commits reuse the backend's timestamp
- **WHEN** the frontend appends a history-committing live snapshot to the ring
- **THEN** it stores the timestamp carried by that snapshot, and does not mint an independent timestamp from a different clock

#### Scenario: Ring has a single timestamp source
- **WHEN** a history ring is inspected after both an initial history response and a sequence of live full-tick commits
- **THEN** every entry's timestamp originates from the same producer, so consecutive values are comparable and a window selection over the ring is well defined

#### Scenario: Reconciliation compares like with like
- **WHEN** a live event is reconciled against an in-flight history response
- **THEN** the already-covered decision compares timestamps produced by the same source, so a genuinely new sample is never discarded and an already-included sample is never duplicated

#### Scenario: Missing timestamp on the wire is handled explicitly
- **WHEN** a live snapshot arrives without a usable timestamp
- **THEN** the frontend applies the documented fallback rule, records that the fallback was used, and does not silently interleave a second clock's values into the ring without marking them

### Requirement: Collector dependency migrations SHALL preserve timing semantics
An upgrade of sysinfo, WMI, windows-rs, Tauri runtime dependencies, compiler toolchain, or any other library on the collector path SHALL preserve the existing monotonic 250 ms scheduling contract, non-catching-up behavior, 4:1 live/full-poll split, approximately 1 Hz history commits, elapsed-time rate normalization, and first-sample/recovery baseline behavior unless an explicit prior spec migration changes the contract.

#### Scenario: Native collector dependencies are upgraded
- **WHEN** the collector is rebuilt against a newer sysinfo, WMI, windows-rs, NVML, Tauri, or Rust toolchain
- **THEN** the canonical cadence checker and focused collector tests still pass without relaxed thresholds, skipped assertions, or extra history commits

#### Scenario: Upstream refresh API changes
- **WHEN** a sysinfo or Windows API migration changes how CPU/network/disk state is refreshed
- **THEN** startup/recovery baselines remain truthful and downtime or initialization delay is not collapsed into a fabricated rate spike or zero sample

### Requirement: Optional WMI enrichment SHALL remain outside the core-liveness critical path
A WMI library/API migration SHALL preserve collector-session thread ownership and SHALL NOT make the first core PDH/sysinfo snapshot wait for successful WMI connection or enrichment. WMI initialization/retry failure SHALL remain bounded, diagnosed and degradable.

#### Scenario: WMI constructor behavior changes upstream
- **WHEN** the selected WMI crate moves COM initialization into `WMIConnection` or otherwise changes the connection API
- **THEN** the app adapts the constructor while keeping the connection session-local, non-blocking core startup, bounded retry/backoff and degraded core metrics behavior

#### Scenario: WMI stays unavailable after migration
- **WHEN** every bounded WMI initialization attempt fails
- **THEN** core metrics continue at the required cadence and the profile remains useful with explicit unknown/best-effort enrichment rather than stopping collection
