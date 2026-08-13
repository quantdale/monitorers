## ADDED Requirements

### Requirement: Incompatible IPC payloads are rejected before mutation
History and live snapshot schema mismatches SHALL fail closed: no incompatible payload may update history/latest state, and the UI SHALL show a distinct actionable frontend/backend version-mismatch error. Listeners MAY remain attached for recovery but SHALL not consume incompatible values.

#### Scenario: Mismatched history is rejected
- **WHEN** `get_history` resolves with a schema version different from the expected contract
- **THEN** history remains unchanged and a rebuild/version error is rendered

#### Scenario: Mismatched live snapshot is rejected
- **WHEN** a `metrics-update` payload has an incompatible schema version
- **THEN** the snapshot is not appended or applied to latest values

### Requirement: History requests and live events are generation-safe
An asynchronous history load SHALL carry a generation/request identity and reconcile with live events received after that request began. A stale response SHALL not overwrite a newer window selection or roll state backward.

#### Scenario: Older request cannot win
- **WHEN** request A starts, request B starts and resolves, and A resolves afterward
- **THEN** the state remains the result for B/current generation

#### Scenario: Live event is not lost to a refetch
- **WHEN** a live snapshot arrives while a history request is pending
- **THEN** resolving the request preserves the newer live point and never rolls history backward

### Requirement: Finite-safe statistics and formatting are shared
History statistics and metric formatters SHALL ignore non-finite/missing values, return explicit empty fallbacks, and apply documented per-metric clamping/sign policies. The UI SHALL never display `NaN`, `Infinity`, or unsupported sensor-shaped placeholders as valid readings.

#### Scenario: All-gap statistics are safe
- **WHEN** a history channel contains only gaps or non-finite values
- **THEN** list view renders the defined empty fallback rather than `NaN`/`Infinity`
