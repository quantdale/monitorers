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
History window selection SHALL use recorded monotonic-derived timestamps and apply one aligned index range to every channel. Network throughput SHALL divide byte deltas by the elapsed monotonic refresh interval and SHALL handle first samples, counter resets, interface changes, near-zero intervals, and long pauses without inventing rates.

#### Scenario: Irregular history selects real duration
- **WHEN** timestamps are irregular and a 60-second window is requested
- **THEN** the selected suffix spans the newest timestamp back to approximately 60 seconds, regardless of how many samples that contains

#### Scenario: Equivalent byte ratios agree
- **WHEN** 250 ms, 1 s, and 2 s refreshes each observe byte deltas proportional to the same bytes-per-second rate
- **THEN** the normalized KB/s values agree within floating-point tolerance

#### Scenario: Counter reset is safe
- **WHEN** a network counter decreases or an elapsed interval is non-positive
- **THEN** the rate helper returns an explicit unavailable/zero-safe result and does not report a negative or fabricated spike
