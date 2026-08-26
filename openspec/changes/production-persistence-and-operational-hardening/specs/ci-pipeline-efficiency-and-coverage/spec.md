# ci-pipeline-efficiency-and-coverage Delta

## ADDED Requirements

### Requirement: Mandatory audit tooling is installed without avoidable compilation
The Rust CI job's `cargo audit` gate SHALL remain mandatory at its pinned version, but the installation mechanism SHALL NOT recompile the tool's dependency tree from source when an official prebuilt release of that exact version exists. Any installation action SHALL be pinned immutably (full commit SHA, never a mutable tag), install the exact pinned tool version, fail the job visibly when installation fails, and introduce no unsigned-binary acceptance without integrity verification. The chosen mechanism, version integrity reasoning, and observed or estimated time impact SHALL be recorded as evidence.

#### Scenario: Audit gate survives an installation-path outage
- **WHEN** the prebuilt-install action fails or the requested version is unavailable
- **THEN** the job fails visibly with the installation error; the audit step can never be silently skipped

#### Scenario: Audit semantics are unchanged by the installation path
- **WHEN** the workflow installs cargo-audit via the prebuilt action instead of `cargo install --locked`
- **THEN** `cargo audit` runs the same pinned version with the same advisory database behavior, and the job's pass/fail meaning is identical

### Requirement: Playwright browser downloads are cached against the lockfile
Workflows that install Playwright browsers SHALL cache the browser directory keyed on the package-lock hash, retaining the explicit install step as the cold-miss fallback so a cache hit avoids the download without ever shipping a version-mismatched browser.

#### Scenario: Cache hit skips the browser download
- **WHEN** the lockfile has not changed since a previous successful run
- **THEN** the cached browser directory is restored and the suite runs against the same pinned browser build

#### Scenario: Lockfile change invalidates the browser cache
- **WHEN** the pinned Playwright version changes in the lockfile
- **THEN** the cache key misses and the install step repopulates the correct browser build
