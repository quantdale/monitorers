# project-documentation-accuracy Delta

## ADDED Requirements

### Requirement: Automation-capability claims match the shipped lanes
Instruction files (AGENTS.md, CLAUDE.md, .cursorrules) and status files (progress.md) SHALL describe the repository's three verification lanes accurately: plain Playwright E2E drives the Vite mock-data harness; the mock simulation lane scripts faults through the bridge; the packaged lane drives the built Windows executable over CDP with real IPC, real sensors, the real settings store, and true process relaunch. No instruction file SHALL claim the production application cannot be automated while the repository ships that automation, and genuinely hardware-only scenarios SHALL be attributed to physical-hardware boundaries rather than automation blindness.

#### Scenario: A reader reconciling AGENTS.md finds no contradiction
- **WHEN** AGENTS.md describes E2E coverage and later documents the packaged CDP simulation lane
- **THEN** both statements agree on what WebView2 automation can and cannot do, differing only by lane

#### Scenario: Status files reflect completed campaigns
- **WHEN** progress.md names the current phase after a campaign is merged and archived
- **THEN** it does not simultaneously describe that campaign as in progress

### Requirement: Documented schema versions match executable constants
Every documented "current" schema or contract version (snapshot schema, lifecycle schema) SHALL equal the corresponding executable constant pair (Rust producer ↔ TS expected). A repository file SHALL NOT advertise two different current values for the same contract.

#### Scenario: Instruction files agree with source constants
- **WHEN** SCHEMA_VERSION and EXPECTED_SCHEMA_VERSION are read from source alongside every documentation mention of the snapshot schema version
- **THEN** all mentions equal the same single value (likewise for the lifecycle version pair)
