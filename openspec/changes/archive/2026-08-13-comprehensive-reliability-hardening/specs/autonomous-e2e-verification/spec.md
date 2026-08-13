## ADDED Requirements

### Requirement: E2E chart assertions use app-owned behavior signals
E2E tests SHALL assert user-observable time-span/window behavior through stable app-owned metadata or pure chart-pipeline tests, not Recharts internal SVG class names or path-command counts. At least one E2E SHALL prove a range change changes displayed time span and live history advances.

#### Scenario: Chart implementation can change without false failure
- **WHEN** Recharts changes its internal SVG path structure without changing the app's point/time metadata
- **THEN** the E2E remains valid

### Requirement: Pointer reorder has a deterministic semantic completion signal
The pointer drag journey SHALL retain a before/after card identity assertion and SHALL use a stable drag handle/target and observable reorder completion so hosted timing differences cannot turn a completed user action into a false timeout.

#### Scenario: Hosted pointer drag reorders
- **WHEN** the test drags a card using the user-facing pointer handle
- **THEN** the first card identity changes and the set of cards remains unchanged within the test's semantic wait
