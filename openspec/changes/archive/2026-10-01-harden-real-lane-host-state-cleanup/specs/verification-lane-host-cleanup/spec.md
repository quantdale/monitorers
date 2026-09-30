## Purpose

Guarantees that any verification lane which mutates machine-wide host state — currently the HKLM WebView2 remote-debugging policy used by the packaged-app driver — removes that state on every termination path (normal exit, thrown error, and OS signal) and verifies the removal instead of assuming it, so an interrupted run cannot silently leave the host with every WebView2 application remotely debuggable.
## ADDED Requirements

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
