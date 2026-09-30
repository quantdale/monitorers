## MODIFIED Requirements

### Requirement: Local and hosted verification use canonical gates
The repository SHALL define canonical fast/full verification scripts and CI SHALL invoke those same commands or their documented platform-specific equivalent. Hooks SHALL identify the layer they run honestly; required checks SHALL not be made non-blocking. The canonical frontend verification lane SHALL cover release-version and documentation consistency, the dead-code check, both npm audit scopes, the production TypeScript type check, the test-inclusive TypeScript type check, unit tests, the frontend production build, and any enforced frontend lint step. The test-inclusive type check SHALL type-check every first-party TypeScript test source the test runner executes, so a type error in a test file blocks the same gate as a type error in production source.

#### Scenario: Full gate includes security and user-facing checks
- **WHEN** the full gate runs
- **THEN** it includes frontend typecheck/tests/build/audit, Rust fmt/test/clippy/audit, E2E, simulation typecheck/matrix, and the supported Windows Tauri release no-bundle build

#### Scenario: Frontend job runs the canonical lane end-to-end
- **WHEN** a pull request is opened
- **THEN** the `frontend` job invokes the canonical frontend verification lane, which runs every step the lane defines, rather than a hand-picked subset

#### Scenario: A test-source type error blocks the job
- **WHEN** a pull request introduces a type error only in a test file
- **THEN** the `frontend` job fails

#### Scenario: Lane cost stays bounded
- **WHEN** the test-inclusive type check and any lint step are added to the frontend lane
- **THEN** the lane's added cost is reported and remains small relative to the unit-test and production-build steps already in that lane
