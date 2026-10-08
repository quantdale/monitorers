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

### Requirement: Production Tauri integration is built automatically
At least one Windows PR/push job SHALL build the shipped-feature Tauri release executable. Installer bundle generation SHALL run automatically on a documented release/scheduled policy, with artifacts/logs available for failures. CI SHALL pin/document its Rust toolchain, minimize permissions, cancel superseded work safely, and use maintained action/runtime versions.

#### Scenario: Tauri integration regression is caught before merge
- **WHEN** a PR changes Rust, Tauri config, capabilities, or frontend integration
- **THEN** the Windows production no-bundle build runs and fails the required check on integration errors

#### Scenario: Superseded pushes are cancelled
- **WHEN** a newer commit arrives for the same PR/ref
- **THEN** obsolete workflow work is cancelled where safe and cannot report a misleading final green result

### Requirement: Packaged-app qualification is a canonical evidence-producing lane
A canonical command SHALL build the production executable, launch the real built exe through the existing WebView2/CDP driver with per-run isolation, and assert: real Tauri IPC responds (history command), real collector data arrives and advances, the real settings store writes only inside the run-isolated directory, a representative UI interaction succeeds, teardown is clean, and no orphaned application or WebView processes remain. The lane SHALL reuse the existing simulation driver rather than introducing a second automation framework.

#### Scenario: Packaged lane proves the real binary end-to-end
- **WHEN** the packaged qualification command runs on a Windows machine with a fresh build
- **THEN** it exits nonzero on any failed assertion, zero when all pass, and records its result for CI evidence

#### Scenario: Shipped configuration gains no debugging surface
- **WHEN** the packaged lane runs
- **THEN** remote-debugging arguments are supplied per-process through environment variables owned by the verification process, and shipped Tauri configuration still contains no remote-debugging flag

### Requirement: Installer qualification executes the real install lifecycle
For each supported installer format (MSI, NSIS), CI SHALL run independent clean Windows jobs that: build the production installer; assert the artifact exists and is non-empty; install silently using the format's supported mechanism; locate the installed executable via system registration (no developer-path hardcoding); verify installed product/version identity against the release version; launch the installed executable under test isolation; confirm it survives startup and exercise a representative smoke flow where automation permits; uninstall silently; and assert removal of the installed executable/registration with no orphan processes. The two formats SHALL NOT share machine state.

#### Scenario: MSI qualifies end-to-end
- **WHEN** the MSI qualification job runs
- **THEN** silent install, version check, installed-exe smoke run, silent uninstall, and clean-removal assertions all pass or the job fails

#### Scenario: NSIS qualifies end-to-end
- **WHEN** the NSIS qualification job runs
- **THEN** the same lifecycle holds for the NSIS build, including user-data retention being asserted as documented product behavior rather than failure

#### Scenario: Qualification cost policy is explicit
- **WHEN** pull requests or ordinary pushes run
- **THEN** expensive packaged/installer qualification does not run as a required gate; it runs on manual dispatch and tag events by documented policy

### Requirement: Release artifacts carry integrity evidence
Successful installer builds SHALL produce an uploaded artifact manifest recording at minimum: application version, commit SHA, build timestamp, artifact filenames, sizes, SHA-256 hashes, installer type, signing status, and qualification result. Installers remain unsigned while no certificate exists, stated truthfully in workflow and docs, without weakening security gates.

#### Scenario: Manifest reflects reality
- **WHEN** the release-qualification workflow completes
- **THEN** the manifest lists every produced installer with correct size/hash/version and the recorded qualification outcome, and is uploaded alongside the installers

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

### Requirement: Dependency migration CI SHALL exercise the declared toolchain/runtime truth
When a dependency migration changes the Rust compiler floor, Node engine requirement, Tauri build stack, or frontend build stack, every canonical CI job SHALL use a supported declared version and its caches SHALL invalidate on the relevant toolchain/lockfile inputs.

#### Scenario: Rust toolchain changes
- **WHEN** `rust-toolchain.toml` changes to satisfy a selected dependency MSRV
- **THEN** Rust/build jobs compile with that committed toolchain and Cargo caches keyed by the toolchain/lockfile cannot silently reuse an incompatible target state as authoritative evidence

#### Scenario: Node runtime remains compatible
- **WHEN** Vite/TypeScript/Tauri tooling is upgraded but Node 24 remains inside every selected package's supported range
- **THEN** CI keeps one coherent Node 24 baseline instead of changing Node major without a compatibility reason

### Requirement: Hosted qualification evidence SHALL correspond to the final candidate SHA
Dependency modernization SHALL not cite a green workflow from an earlier migration stage as final evidence. Required Rust/frontend/E2E/simulation/packaged/release runs SHALL correspond to the final candidate commit or to an explicitly demonstrated byte-equivalent build input.

#### Scenario: a final fix lands after hosted qualification
- **WHEN** source, dependency lockfiles, toolchain, build config or test behavior changes after a hosted run
- **THEN** every materially affected required workflow is rerun before the campaign is marked complete

### Requirement: CI maintenance discovered during migration SHALL preserve supply-chain controls
CI maintenance discovered during migration SHALL preserve supply-chain controls. If dependency migration exposes unsupported Node action runtimes, deprecated GitHub Actions, or cache incompatibilities, supported replacements MAY be adopted as part of the campaign only when action references remain pinned to full immutable commit SHAs and existing audit/security semantics remain mandatory.

#### Scenario: artifact action emits an unsupported-runtime warning
- **WHEN** a hosted workflow reports that a pinned artifact action uses a deprecated Node runtime and a compatible maintained release exists
- **THEN** the action may be upgraded to a full-SHA-pinned maintained version and the artifact path/content behavior is re-qualified rather than ignoring the warning indefinitely

#### Scenario: security tool installation fails
- **WHEN** the pinned cargo-audit installation or advisory fetch fails during the migration
- **THEN** the job fails visibly; dependency modernization never turns an audit outage into a green skip
