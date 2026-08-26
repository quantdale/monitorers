# collector-supervision Specification

## Purpose
TBD - created by archiving change production-runtime-recovery-and-release-qualification. Update Purpose after archive.
## Requirements
### Requirement: The collector runs as a supervised session lifecycle
The backend SHALL run metric collection as supervised sessions owned by a single supervisor. Every session SHALL construct fresh OS-facing state (`CollectorState`, WMI bootstrap, sensor registry, NVML/NVAPI init) on its own thread and SHALL be the only emitter of `metrics-update` while alive. The supervisor SHALL model states `starting`, `healthy`, `recovering`, `failed`, and `stopping`, and SHALL report every transition through the typed status contract.

#### Scenario: Panic ends a session, not collection
- **WHEN** an unexpected panic escapes inside a collector session's tick body or bootstrap
- **THEN** the session terminates with a panicked outcome, the supervisor observes it, and supervision continues rather than ending metrics permanently

#### Scenario: Only one emitter exists at any time
- **WHEN** the supervisor starts a replacement session after a failure
- **THEN** the previous session thread has been joined before the replacement is spawned, so two concurrent emitters are impossible

#### Scenario: Shutdown wins from every state
- **WHEN** application shutdown is requested while a session is starting, healthy, recovering (including inside a backoff wait), or failed
- **THEN** no new session is started and the supervisor exits promptly without emitting further snapshots

### Requirement: Automatic recovery is bounded and staged
Automatic recovery SHALL retry a failed session up to a documented attempt budget using staged backoff between attempts, SHALL reset the failure streak only after a session remains healthy for a documented healthy period, and SHALL transition to `failed` when the budget is exhausted. Backoff waits SHALL respond to shutdown and manual-retry signals without waiting out the full interval.

#### Scenario: Recoverable panic recovers automatically
- **WHEN** a healthy session panics once and the next session starts successfully
- **THEN** the status sequence includes `recovering` followed by `healthy`, live metrics resume, and no user action was required

#### Scenario: Repeated failure escalates to failed
- **WHEN** consecutive sessions fail more times than the automatic budget allows without an intervening healthy period
- **THEN** the supervisor stops restarting automatically, reports state `failed` with the last failure reason, and waits for shutdown or a manual retry

#### Scenario: Healthy period resets the failure streak
- **WHEN** a session stays healthy longer than the healthy-reset period before failing
- **THEN** the subsequent recovery budget starts from a clean streak instead of accumulating across unrelated failures

### Requirement: Recovery reconstructs OS-facing state safely
A replacement session SHALL NOT reuse the failed session's `CollectorState`. PDH query/counters, sysinfo instances, sensor providers, NVML/NVAPI-related state, hardware discovery enrichment, and the MTA-bound WMI connection SHALL be reconstructed on the new session's thread, respecting existing COM/WMI thread-affinity rules.

#### Scenario: Rate counters do not fabricate post-recovery readings
- **WHEN** a replacement session begins collecting after downtime
- **THEN** rate-counter baselines are primed before the first committed tick, so the first committed values are genuine short-interval deltas — not fabricated 0% readings and not spikes aggregating the downtime

### Requirement: History survives sessions truthfully
The shared `HistoryStore` SHALL survive a session replacement, and no history sample SHALL be written while no session is running. A recovery gap SHALL remain visible as missing timestamps/gaps; neither the backend nor the frontend MAY fabricate continuous data across the gap.

#### Scenario: Downtime appears as a real gap
- **WHEN** a session fails, backoff elapses, and a replacement session commits its first full tick
- **THEN** the timestamp axis contains no synthetic samples for the downtime window and chart rendering shows gaps there

### Requirement: Manual retry restarts exactly one session
A manual retry control SHALL be available when supervision is in `failed`. A retry SHALL reset the failure streak, start exactly one new session, retain last-known UI/history state, be coalesced to a no-op when supervision is not `failed`, and remain safe during shutdown.

#### Scenario: Retry from failed returns to healthy
- **WHEN** the user activates Retry metrics during `failed` and the started session succeeds
- **THEN** exactly one new session emits, status transitions through `starting`/`healthy`, the failure UI clears automatically, and no application restart occurred

#### Scenario: Retry outside failed does nothing harmful
- **WHEN** a retry request arrives while a session is healthy or recovering
- **THEN** it is ignored without starting a second emitter or resetting healthy-state tracking

### Requirement: Retry and shutdown are distinct typed managed states
The Tauri managed-state layer SHALL expose the cooperative shutdown flag and the manual-retry request as two DISTINCT Rust types (e.g. `StopFlag` and `RetryRequest` newtypes), because Tauri resolves managed state by type and silently refuses duplicate-type registrations. The `retry_collection` command SHALL resolve only the retry type; the application-exit path SHALL resolve only the stop type; registration SHALL be asserted so a refused registration cannot vanish silently. Regression coverage SHALL exercise this real command/state seam (not a local reimplementation) including registration-order independence and the full failed→retry→one-replacement-generation→healthy path with the stop flag never set.

#### Scenario: Retry from failed never touches shutdown
- **WHEN** the user activates Retry metrics while supervision is `failed`, through the actual managed-state/command wiring
- **THEN** the supervisor's retry path consumes exactly one replacement generation that reaches healthy on its first emission, no `Stopping` transition occurs, and the stop flag remains unset

### Requirement: Deterministic fault injection exists only in test builds
Synthetic panic/retry-policy fault seams used to prove supervisor behavior SHALL exist exclusively in test compilation units (`#[cfg(test)]`) or browser-mode simulation code. Production and default release builds SHALL expose no environment variable, command, cargo feature, or other trigger capable of crashing or perturbing the collector.

#### Scenario: Shipped build has no fault surface
- **WHEN** the shipped-configuration lint runs against non-test Rust sources and Cargo manifest
- **THEN** no fault-injection feature flag or env-var trigger is present, and the lint passes

### Requirement: Supervisor behavior is deterministically unit-tested
Supervisor transitions SHALL be covered by focused Rust tests that inject policies/time instead of sleeping through real backoff intervals, covering at minimum: bounded-tick health, stop-without-recovery, panic surfacing, single replacement per panic, duplicate-emission impossibility, history boundary preservation, truthful timestamps, re-baselined counters, bounded backoff, escalation to `failed`, manual retry, retry coalescing, shutdown-during-recovery safety, healthy-streak reset, status payload serialization, and status-emission failures not crashing supervision.

#### Scenario: Tests never sleep through production backoff
- **WHEN** the supervisor test suite runs
- **THEN** every backoff path is exercised with injected sub-second policies and completes quickly, while production defaults remain documented constants

