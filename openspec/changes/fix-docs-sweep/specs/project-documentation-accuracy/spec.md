## ADDED Requirements

### Requirement: Developer-facing test-count claims match actual passing test counts
Tracked, non-gitignored documentation (`.cursorrules`, root `CLAUDE.md`) that states expected Rust or frontend test counts SHALL match the actual count of passing tests as of the most recent merged change.

#### Scenario: Test counts stated in .cursorrules
- **WHEN** `.cursorrules` states an expected Rust or frontend test count
- **THEN** that count matches the actual output of `cargo test --verbose` / `npm test -- --run` as of the latest merge

#### Scenario: Test counts stated in root CLAUDE.md
- **WHEN** root `CLAUDE.md` states an expected Rust or frontend test count
- **THEN** that count matches the actual output of `cargo test --verbose` / `npm test -- --run` as of the latest merge

### Requirement: .cursorrules accurately describes the real CI pipeline
`.cursorrules`' CI section SHALL describe the CI jobs and checks that actually run in `.github/workflows/rust.yml`, including all three jobs (`rust-test`, `rust-lint`, `frontend`) and every check each job performs.

#### Scenario: CI section lists all three jobs
- **WHEN** `.cursorrules`' CI section is read
- **THEN** it describes `rust-test`, `rust-lint` (including `cargo audit`), and `frontend` (including `npm audit` and `tsc --noEmit`), matching the real workflow file

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
