## ADDED Requirements

### Requirement: Local and hosted verification use canonical gates
The repository SHALL define canonical fast/full verification scripts and CI SHALL invoke those same commands or their documented platform-specific equivalent. Hooks SHALL identify the layer they run honestly; required checks SHALL not be made non-blocking.

#### Scenario: Full gate includes security and user-facing checks
- **WHEN** the full gate runs
- **THEN** it includes frontend typecheck/tests/build/audit, Rust fmt/test/clippy/audit, E2E, simulation typecheck/matrix, and the supported Windows Tauri release no-bundle build

### Requirement: Production Tauri integration is built automatically
At least one Windows PR/push job SHALL build the shipped-feature Tauri release executable. Installer bundle generation SHALL run automatically on a documented release/scheduled policy, with artifacts/logs available for failures. CI SHALL pin/document its Rust toolchain, minimize permissions, cancel superseded work safely, and use maintained action/runtime versions.

#### Scenario: Tauri integration regression is caught before merge
- **WHEN** a PR changes Rust, Tauri config, capabilities, or frontend integration
- **THEN** the Windows production no-bundle build runs and fails the required check on integration errors

#### Scenario: Superseded pushes are cancelled
- **WHEN** a newer commit arrives for the same PR/ref
- **THEN** obsolete workflow work is cancelled where safe and cannot report a misleading final green result
