## ADDED Requirements

### Requirement: Policy absence requires a successful registry observation
The verification driver and standalone cleanup assertion SHALL distinguish a missing key/value from an operational query failure. Access denial, failed process startup, invalid query output, and other observation failures SHALL fail the verification instead of being reported as absence.

#### Scenario: Registry read is denied
- **WHEN** the host refuses access to the policy query
- **THEN** verification reports an observation error and does not claim cleanup succeeded

#### Scenario: Value is missing
- **WHEN** a successful query confirms the key or value does not exist
- **THEN** verification reports absence

### Requirement: Verification preserves pre-existing host policy
A driver SHALL NOT replace or delete a pre-existing machine-wide wildcard policy that it does not own. If a later write to an owned policy fails, the driver SHALL retain cleanup ownership until absence is verified.

#### Scenario: Policy already belongs to the host
- **WHEN** a new verification run observes an existing wildcard value
- **THEN** launch fails with a diagnostic before writing and teardown preserves that value

#### Scenario: Owned policy cannot be rewritten
- **WHEN** a driver successfully writes its policy and a subsequent port-change write fails
- **THEN** the failure is surfaced and teardown still attempts to remove the previously written value

### Requirement: Launch observation releases losing polling work
A packaged-app launch SHALL bound CDP readiness observation, including hung HTTP responses. Process failure or completion of the launch observation SHALL cancel outstanding CDP polling and detach process listeners.

#### Scenario: Process exits while readiness HTTP request is pending
- **WHEN** the launched process exits before CDP is ready
- **THEN** the launch rejects and aborts its pending HTTP request without further polling

#### Scenario: CDP endpoint accepts but does not answer
- **WHEN** a readiness response remains pending through the configured deadline
- **THEN** the launch rejects within the bounded observation instead of waiting indefinitely
