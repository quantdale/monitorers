## ADDED Requirements

### Requirement: Simulation failures are fail-closed and classified
The simulation platform SHALL fail for zero meaningful assertions, unexpected page/console errors, invalid selectors/configuration, isolation violations, driver lifecycle errors, and cleanup errors after a passing journey. Failure records SHALL distinguish app assertion defects from driver/CDP/spawn/isolation defects and explicitly registered undrivable scenarios.

#### Scenario: Unknown journey is not an empty pass
- **WHEN** `SIM_JOURNEYS` contains an unknown ID
- **THEN** the run exits nonzero and reports valid IDs

#### Scenario: Cleanup does not mask assertion failure
- **WHEN** an assertion fails and `driver.close()` also throws
- **THEN** the assertion remains the primary failure and cleanup error is appended as diagnostics

### Requirement: Mock and real runs verify handoff and artifact ownership
The mock driver SHALL verify the injected `window.__SIM__` run/scenario handoff after load. Real runs SHALL use fresh harness-owned directories per run, compare the full `{exists, bytes}` production-settings state before/after, and preserve canonical artifacts when making triage copies.

#### Scenario: Mock handoff mismatch fails
- **WHEN** the page loads without the requested simulation run ID or scenario version
- **THEN** the driver fails as a harness defect instead of running the default scenario

#### Scenario: Settings creation is detected
- **WHEN** production settings are absent before a real simulation and present afterward
- **THEN** isolation self-test fails
