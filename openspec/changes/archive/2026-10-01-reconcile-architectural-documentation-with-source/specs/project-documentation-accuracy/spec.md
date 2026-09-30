## MODIFIED Requirements

### Requirement: Reliability documentation matches source and evidence
Tracked documentation SHALL describe monotonic cadence/overrun behavior, timestamp-based windows, missing-data gaps, stable identity/Nvidia mapping, schema/settings migrations, simulation speed/isolation/pass criteria, CI/release gates, and any physical validation limitations without claiming tests or hardware evidence that did not run. A document that attributes a documented behavior to a named code construct SHALL describe the construct that actually enforces it.

#### Scenario: Cadence docs match checker
- **WHEN** a contributor reads the cadence probe/checker documentation
- **THEN** it states the minimum wall-clock duration, timing distributions, ratio checks, and `--secs` versus `--ticks` semantics implemented in source

#### Scenario: Build docs distinguish build from launch
- **WHEN** README documents `tauri build`
- **THEN** it says the command builds/bundles and does not claim that it launches the compiled app

#### Scenario: Documented implementation mechanism exists and enforces the invariant
- **WHEN** an instruction document names a specific function, block, or guard as the implementation of a documented invariant
- **THEN** that construct is present in the source and is the one that enforces the invariant

### Requirement: Documented schema versions match executable constants
Every documented "current" schema or contract version (snapshot schema, lifecycle schema) SHALL equal the corresponding executable constant pair (Rust producer ↔ TS expected). A repository file SHALL NOT advertise two different current values for the same contract, including two different values **within the same file**.

#### Scenario: Instruction files agree with source constants
- **WHEN** SCHEMA_VERSION and EXPECTED_SCHEMA_VERSION are read from source alongside every documentation mention of the snapshot schema version
- **THEN** all mentions equal the same single value (likewise for the lifecycle version pair)

#### Scenario: No intra-file contradiction about a contract version
- **WHEN** a single instruction file is searched for every mention of the snapshot schema version
- **THEN** every mention in that file is the same value, so a summary list and a detailed section cannot disagree
