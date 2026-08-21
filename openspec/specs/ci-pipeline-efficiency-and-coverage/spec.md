## Purpose

Defines CI requirements beyond the plain test gate: jobs that share cached dependency paths fall back to a common cache-key prefix, and the real production frontend build (`npm run build`) runs on every PR.
## Requirements
### Requirement: CI jobs sharing cached dependency paths use a common cache-key fallback
Any two CI jobs that cache identical dependency paths from the same lockfile SHALL share a common `restore-keys` fallback prefix, so a cache miss on one job's exact key can still restore from another job's most recent cache rather than recompiling the full dependency tree from scratch.

#### Scenario: tauri-build restores from the shared cargo cache on a miss
- **WHEN** a Windows job that caches the Cargo registry/target paths (e.g. `tauri-build`) runs and its own exact cache key has not been written yet (e.g. first run after a `Cargo.lock` change)
- **THEN** it falls back to restoring from another such job's most recent cache via the shared `${{ runner.os }}-cargo-` `restore-keys` prefix, rather than starting with no cache at all

### Requirement: CI verifies the actual production build
CI SHALL include a job or step that runs the real production frontend build (`npm run build`), so a regression only visible in the built/bundled output (not caught by `tsc --noEmit` or unit tests alone) is caught before merge.

#### Scenario: Production build step runs on every PR
- **WHEN** a pull request is opened or updated against `main`
- **THEN** CI runs `npm run build` and the PR's checks fail if that build fails

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
