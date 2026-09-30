## MODIFIED Requirements

### Requirement: Test activity is isolated from real user state
Every real-app run SHALL execute with its persisted state redirected to a per-run temporary directory, so simulation never reads or writes a developer's real `settings.json`, runs are hermetic and parallel-safe, and no residual state leaks between runs. The mock bridge's persisted state SHALL likewise be namespaced per run. Where the driver must also mutate machine-wide host state to make the packaged app drivable (an HKLM WebView2 remote-debugging policy), that state SHALL be removed on every termination path — normal teardown, uncaught exception, and interrupt/termination signal — and the lane SHALL verify the value is gone before reporting a clean teardown, so an interrupted run cannot silently leave every WebView2 application on the host remotely debuggable. The scope of such a machine-wide value and the commands to verify and remove it manually SHALL be documented.

#### Scenario: Developer settings are untouched by a simulation run
- **WHEN** a real-app simulation run completes while a developer's own `settings.json` exists
- **THEN** the developer's store file is byte-identical before and after the run, and all simulation writes occurred under the per-run temp directory

#### Scenario: Parallel runs do not share state
- **WHEN** two real-app runs execute concurrently
- **THEN** each uses a distinct temp app-data directory and debugging port, and neither observes the other's settings

#### Scenario: Interrupt during a run does not leave host state behind
- **WHEN** a real-app run is interrupted or terminated by signal while a machine-wide host policy value is present
- **THEN** the policy value is removed before the process exits

#### Scenario: Teardown does not report success while the value survives
- **WHEN** teardown completes but the machine-wide policy value is still readable
- **THEN** the run is not reported as clean, and the condition is surfaced naming the value's key and name

#### Scenario: Host-state scope and manual recovery are documented
- **WHEN** a reader inspects the code that writes a machine-wide host policy, or looks for recovery instructions after an interrupted run
- **THEN** the written value's scope (which applications it affects) and the exact commands to inspect and remove it are documented
