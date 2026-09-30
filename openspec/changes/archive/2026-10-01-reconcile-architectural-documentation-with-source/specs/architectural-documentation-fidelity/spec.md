## Purpose

Guarantees that the tracked architecture and instruction documents (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) publish the dependency versions, module layout, and enforcement mechanisms that actually exist in the committed source — and that the claim is machine-verified rather than maintained by hand, so a dependency-modernization campaign cannot leave the source of truth describing a stack that was already replaced.
## ADDED Requirements

### Requirement: Documented dependency versions match the committed manifests
Any tracked instruction or architecture document that states a dependency version SHALL state the version actually declared in the committed manifest (`sys-monitor-tauri/package.json`, `sys-monitor-tauri/src-tauri/Cargo.toml`) or resolved lockfile. A document SHALL NOT advertise a superseded major or minor version of a runtime or test dependency.

#### Scenario: Frontend stack table is current
- **WHEN** a reader compares the frontend dependency versions stated in `.cursorrules` against `sys-monitor-tauri/package.json`
- **THEN** every stated version (React, TypeScript, Vite, Recharts, lucide-react, and the Tauri JS packages) equals the declared range in `package.json`

#### Scenario: Backend stack table is current
- **WHEN** a reader compares the backend dependency versions stated in `.cursorrules` against `sys-monitor-tauri/src-tauri/Cargo.toml`
- **THEN** every stated version (sysinfo, windows, wmi, nvml-wrapper, nvapi-sys) equals the declared requirement in `Cargo.toml`

#### Scenario: Drift is detected automatically
- **WHEN** a dependency is upgraded in a manifest and a documented version table is not updated in the same change
- **THEN** the repository's documentation-fidelity check fails and names the document, the field, and the declared-versus-documented versions

### Requirement: Documented mechanisms describe the mechanism that is implemented
Where an instruction document names a specific code construct, function, block, or guard as the *implementation* of a documented behavior, the described construct SHALL be the one that actually enforces that behavior. A document SHALL NOT attribute an invariant to a code location that does not implement it.

#### Scenario: Registry commit gate is described accurately
- **WHEN** `.cursorrules` documents how history commits are restricted to full (1 Hz) ticks
- **THEN** it describes the gate that actually exists in the collector loop (registry-only ticks contribute no commit values, and the history commits live inside the full-poll branch), and does not claim the registry commit call is nested inside the full-poll branch if it is not

#### Scenario: A reader can locate the enforcing code
- **WHEN** a reader follows a documented invariant's stated implementation location to the source
- **THEN** the code at that location is what enforces the invariant

### Requirement: Documented source layout lists the modules that exist
The module/file listing in a tracked architecture document SHALL include every current first-party source module of the described subsystems and SHALL NOT list modules that no longer exist.

#### Scenario: Backend module listing is complete
- **WHEN** the `.cursorrules` source listing is read
- **THEN** it names the current backend modules including the collector supervisor and the persistent error log, and the probe/test entry points under `src-tauri/`

#### Scenario: Frontend module listing is complete
- **WHEN** the `.cursorrules` source listing is read
- **THEN** it names the current frontend modules including the simulation bridge and the simulation platform under `e2e/sim/`

### Requirement: Hardcoded suite counts are replaced by reproducible commands
A tracked instruction document SHALL NOT state a hardcoded count for a test suite that changes independently of the document. Where a suite size is operationally useful, the document SHALL instead state the command that produces the count.

#### Scenario: E2E count is not hardcoded
- **WHEN** a reader looks for the size of the Playwright E2E suite in `.cursorrules` or `CLAUDE.md`
- **THEN** they find the command that runs the suite (and its count), not a fixed number that can silently become wrong
