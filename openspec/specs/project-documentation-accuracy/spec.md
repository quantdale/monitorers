## Purpose

Defines the documentation-accuracy contract: developer-facing test-count claims in tracked docs match actual passing counts, `.cursorrules`' CI section matches the real workflow, README onboarding facts match actual configuration, and tracked docs reference no deleted files.
## Requirements
### Requirement: Developer-facing test-count claims match actual passing test counts
Tracked, non-gitignored documentation (`.cursorrules`, root `CLAUDE.md`) that states expected Rust or frontend test counts SHALL match the actual count of passing tests as of the most recent merged change.

#### Scenario: Test counts stated in .cursorrules
- **WHEN** `.cursorrules` states an expected Rust or frontend test count
- **THEN** that count matches the actual output of `cargo test --verbose` / `npm test -- --run` as of the latest merge

#### Scenario: Test counts stated in root CLAUDE.md
- **WHEN** root `CLAUDE.md` states an expected Rust or frontend test count
- **THEN** that count matches the actual output of `cargo test --verbose` / `npm test -- --run` as of the latest merge

### Requirement: .cursorrules accurately describes the real CI pipeline
`.cursorrules`' CI section SHALL describe the checks that actually run in `.github/workflows/rust.yml`: the `rust` job (fmt, feature-matrix tests, clippy, audit via the canonical `verify:rust` lane), the `frontend` job (audit, typecheck, tests, build via `verify:frontend`), plus the Windows production-executable and tag/manual-dispatch installer jobs.

#### Scenario: CI section lists the real gates
- **WHEN** `.cursorrules`' CI section is read
- **THEN** it describes the canonical verify lanes covering Rust fmt/test/clippy/audit and frontend audit/tsc/tests/build, matching the real workflow file

### Requirement: README onboarding facts match actual project configuration
`sys-monitor-tauri/README.md` SHALL state the actual dev server port, actual `src-tauri/src/` file layout, and actual minimum Node.js version required by the toolchain.

#### Scenario: Dev port matches Vite config
- **WHEN** README.md states the dev server URL/port
- **THEN** it matches `vite.config.ts`'s configured port

#### Scenario: File layout table matches actual directory structure
- **WHEN** README.md describes `src-tauri/src/`'s file layout
- **THEN** it reflects the actual current files and subdirectories

#### Scenario: Node version matches CI's actual requirement
- **WHEN** README.md states a minimum Node.js version
- **THEN** it matches the version actually used by CI (`.github/workflows/rust.yml`)

### Requirement: Documentation does not reference deleted files
Tracked documentation SHALL NOT reference source files that no longer exist in the repository.

#### Scenario: No remaining App.css references
- **WHEN** `.cursorrules` is read
- **THEN** it contains no reference to `App.css`, since that file has been deleted from the repository

### Requirement: Reliability documentation matches source and evidence
Tracked documentation SHALL describe monotonic cadence/overrun behavior, timestamp-based windows, missing-data gaps, stable identity/Nvidia mapping, schema/settings migrations, simulation speed/isolation/pass criteria, CI/release gates, and any physical validation limitations without claiming tests or hardware evidence that did not run.

#### Scenario: Cadence docs match checker
- **WHEN** a contributor reads the cadence probe/checker documentation
- **THEN** it states the minimum wall-clock duration, timing distributions, ratio checks, and `--secs` versus `--ticks` semantics implemented in source

#### Scenario: Build docs distinguish build from launch
- **WHEN** README documents `tauri build`
- **THEN** it says the command builds/bundles and does not claim that it launches the compiled app

### Requirement: Release versions have one validated procedure
The app package version, Tauri configuration version, and any required release metadata SHALL be validated for agreement by a lightweight script/test, with a documented intentional update procedure.

#### Scenario: Version drift fails
- **WHEN** a required version field differs from the canonical app version
- **THEN** the validation command fails before release artifacts are produced

### Requirement: Documentation matches the supervised runtime and qualification reality
Instruction and documentation files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `CONTEXT.md` glossary, `sys-monitor-tauri/README.md`, workflow comments, `progress.md`) SHALL accurately describe: the supervisor lifecycle and its states; the recovery policy (budget, backoff, healthy-reset); manual retry behavior; history semantics across collector restarts including gap truthfulness and rate-counter re-baselining; the typed status IPC contract and its schema version; the packaged-app qualification command and its CI policy; installer qualification commands/workflow; release artifact/manifest locations; signing status; and known external validation limitations. No instruction file SHALL contradict another or the source on these topics.

#### Scenario: Fail-stop claim is gone
- **WHEN** a reader consults any instruction file about collector panic behavior
- **THEN** it describes supervised bounded recovery with manual retry, not permanent thread death requiring an app restart

#### Scenario: progress.md is truthful for this campaign
- **WHEN** the campaign completes
- **THEN** `progress.md` records the actual delivered state, remaining limitations, and no stale placeholder content

