## REMOVED Requirements

### Requirement: Collector panic halts metrics permanently until relaunch
**Reason**: Superseded by supervised bounded recovery (`collector-supervision`): a panic ends one session, not collection. Fail-stop behavior no longer exists in production or documentation.

## ADDED Requirements

### Requirement: Collector panic triggers supervised recovery instead of permanent halt
When a collector session's tick body (or its bootstrap) panics, the application SHALL surface exactly one legacy `collector-error` event for diagnostics, end that session, and the supervisor SHALL replace it per the bounded recovery policy (`collector-supervision`). The frontend SHALL keep last-known card values visible during automatic recovery, SHALL show the transient recovering state, and SHALL clear failure UI only on actual recovery proof (a `healthy` status) or via the manual Retry metrics control after budget exhaustion.

#### Scenario: A caught panic emits exactly one error event and ends the session
- **WHEN** a tick body panics inside `catch_unwind`
- **THEN** exactly one `collector-error` payload is emitted for that session, no further `metrics-update` events are emitted on that session, and the supervisor reports the session outcome

#### Scenario: Recovery proof clears retained values' failure state
- **WHEN** a replacement session reports `healthy` after a panic
- **THEN** the frontend clears the failure/recovering UI automatically and live values resume appending truthful samples