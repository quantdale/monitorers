## ADDED Requirements

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
