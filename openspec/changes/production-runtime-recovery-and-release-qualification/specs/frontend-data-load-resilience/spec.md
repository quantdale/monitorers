## ADDED Requirements

### Requirement: Collector failure is recoverable UX, not a dead end
The frontend SHALL represent collector lifecycle states explicitly: during automatic recovery it SHALL keep last-known metrics and charts visible with an accessible transient "recovering" announcement; after budget exhaustion it SHALL show a persistent accessible failure state with a working Retry metrics action; on successful recovery or retry it SHALL clear both automatically. The dashboard SHALL NOT blank, SHALL NOT replace retained values with zeros, and SHALL remain otherwise interactive.

#### Scenario: Recovering keeps the dashboard alive
- **WHEN** supervision reports `recovering`
- **THEN** last-known metrics stay rendered unchanged (no zero substitution), a `role="status"` recovery message is announced politely, and no restart of the page or app is required

#### Scenario: Transient failure clears itself
- **WHEN** supervision returns to `healthy` after automatic recovery
- **THEN** the recovery/failure UI disappears without user action and live values resume from real events

#### Scenario: Exhausted budget offers retry
- **WHEN** supervision reports `failed`
- **THEN** an assertive alert names the failure, presents an accessible Retry metrics control that invokes the backend retry path exactly once per activation, and the rest of the app remains usable

#### Scenario: Retry success restores normal operation
- **WHEN** a manual retry leads to a healthy session
- **THEN** the failure banner and retry control disappear automatically and charts continue appending truthful new samples

### Requirement: Frontend lifecycle handling is unit-covered
Hook/component tests SHALL cover healthy→recovering→healthy, healthy→recovering→failed, failed→manual retry, transient clearing, retention of last-known metrics during recovery, absence of fabricated zeros, absence of duplicate history appends across collector generation changes, schema-mismatch behavior for the lifecycle payload, and retry-button behavior.

#### Scenario: Generation change does not duplicate history
- **WHEN** a replacement collector session begins emitting into preserved frontend history
- **THEN** history arrays continue appending without duplicating pre-recovery points or rewinding timestamps
