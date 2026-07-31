## ADDED Requirements

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

### Requirement: The manual runtime verification has an automated fulfilling procedure
The previously manual end-to-end verification (`fix-history-emission-rate` task 8.7, absorbed as `add-realistic-usage-test-suite` task 5.5) SHALL have a documented automated procedure — run the probe, run the checker, interpret PASS/FAIL — that an AI agent or a self-hosted Windows CI runner can execute unattended to satisfy the check. The manual stopwatch observation becomes optional corroboration, not the sole means of verification.

#### Scenario: Agent closes the manual task from a passing checker run
- **WHEN** an agent runs the documented procedure on a real Windows machine and the checker reports PASS
- **THEN** the captured checker report is sufficient evidence to consider the absorbed manual verification satisfied, without a human watching the GUI
