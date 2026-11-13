# verification-lane-host-cleanup Specification

## Purpose
Guarantees that any verification lane which mutates machine-wide host state — currently the HKLM WebView2 remote-debugging policy used by the packaged-app driver — removes that state on every termination path (normal exit, thrown error, and OS signal) and verifies the removal instead of assuming it, so an interrupted run cannot silently leave the host with every WebView2 application remotely debuggable.

## Requirements

### Requirement: Machine-wide host state is removed on every termination path
A verification lane that writes a machine-wide host policy SHALL ensure the value is removed when the process exits normally, when the process terminates by an uncaught exception, and when the process receives an interrupt or termination signal. Removal SHALL be idempotent and SHALL NOT be skipped because an earlier, unrelated teardown step already failed.

#### Scenario: Interrupted run still removes the policy
- **WHEN** the packaged-app lane is interrupted by an interrupt or termination signal while the machine-wide policy value is present
- **THEN** the value is removed as part of handling that signal, before the process exits

#### Scenario: Crash path still removes the policy
- **WHEN** the lane terminates because of an uncaught exception while the policy value is present
- **THEN** the value is removed as part of handling the crash

#### Scenario: Idempotent with the normal teardown path
- **WHEN** both the normal teardown and the termination handler attempt removal
- **THEN** the removal is performed at most once per written value, and neither path reports a spurious failure because the other already removed it

### Requirement: Removal is verified, not assumed
After attempting removal of a machine-wide host policy value, the lane SHALL read the value back and SHALL treat a still-present value as a failure or as an explicitly reported, unmissable diagnostic. A run SHALL NOT be reported as clean while the value it wrote is still present.

#### Scenario: Silent no-op is detected
- **WHEN** the removal call completes without throwing but the value is still readable afterwards
- **THEN** the run is failed (or the condition is surfaced as a hard, explicitly reported diagnostic), and the value's path and name are named

#### Scenario: Successful removal is confirmed
- **WHEN** the removal call completes and the value is no longer readable
- **THEN** the teardown reports success for that value

### Requirement: Host-state scope and recovery are documented
A lane that writes a machine-wide host policy SHALL document the scope of the value it writes (which applications it affects), and SHALL document the exact command a user can run to verify and remove the value if a run was interrupted before cleanup could complete.

#### Scenario: Scope is stated where the value is written
- **WHEN** a reader inspects the code that writes the machine-wide policy
- **THEN** the comment states which applications the written value affects and for how long it is intended to exist

#### Scenario: Manual recovery is documented
- **WHEN** a user finds that an interrupted run left host state behind
- **THEN** the repository documentation provides the exact command to inspect the value and the exact command to remove it

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
