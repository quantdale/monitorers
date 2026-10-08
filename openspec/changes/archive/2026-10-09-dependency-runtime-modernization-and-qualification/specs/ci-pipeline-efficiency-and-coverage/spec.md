# ci-pipeline-efficiency-and-coverage Delta

## ADDED Requirements

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
