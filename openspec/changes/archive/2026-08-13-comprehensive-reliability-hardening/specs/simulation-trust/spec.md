## ADDED Requirements

### Requirement: Simulation configuration is validated and non-empty
The simulation entrypoint SHALL validate lane, finite positive speed, seed, journey selectors, persona selectors, and supported-lane availability before starting. Explicitly unknown selectors and a matrix with zero runnable non-quarantined journeys SHALL fail with actionable diagnostics. `speed=N` SHALL mean N simulated seconds per wall-clock second, applied exactly once.

#### Scenario: Invalid speed fails
- **WHEN** `SIM_SPEED` is NaN, infinite, zero, negative, or outside the supported range
- **THEN** configuration fails before a browser or settings store is opened

#### Scenario: Unknown selector fails
- **WHEN** a user explicitly selects a nonexistent journey or persona
- **THEN** the command exits nonzero and lists valid IDs

#### Scenario: Zero-result matrix fails
- **WHEN** every selected journey is quarantined or no journey supports the selected lane
- **THEN** the result is a harness/configuration failure unless an explicit supported-lane explanation is reported; it is never a silent green pass

### Requirement: Simulation state and settings are isolated
Scenario hardware arrays SHALL be cloned into each backend instance, explicit empty arrays SHALL remain empty, and an isolated packaged run SHALL fail closed if its override path cannot be resolved, created, or written. Production with no simulation override SHALL continue to use normal settings behavior.

#### Scenario: Empty hardware is honored
- **WHEN** a scenario specifies `gpus: []` or `disks: []`
- **THEN** the mock exposes no devices in that category and the UI renders the corresponding empty state

#### Scenario: Backend instances do not share arrays
- **WHEN** instance A hotplugs or mutates its hardware
- **THEN** instance B and module defaults remain structurally unchanged

#### Scenario: Override failure cannot fall back
- **WHEN** a packaged simulation expects an override but the command fails or the path is invalid/unwritable
- **THEN** the run aborts before any settings write to the real user store

### Requirement: A journey passes only with meaningful, clean evidence
Every runnable journey SHALL make at least one meaningful assertion. Unexpected page errors and console errors SHALL fail by default; allowlists SHALL be narrow, journey-scoped, and documented. Assertion failures SHALL capture a best-effort screenshot, cleanup SHALL always attempt every resource, and cleanup/isolation failures SHALL remain diagnostics without masking an earlier application failure.

#### Scenario: Zero assertions fail
- **WHEN** a registered journey executes no meaningful assertion
- **THEN** the runner classifies it as a harness defect and fails

#### Scenario: Browser error fails an otherwise passing journey
- **WHEN** a pageerror or unexpected console error occurs during a journey whose assertions pass
- **THEN** the journey fails and includes the browser error in triage

#### Scenario: Assertion failure has a screenshot
- **WHEN** a final result fails only because an assertion failed
- **THEN** the runner attempts a screenshot before closing the driver and records any capture failure separately

### Requirement: Run artifacts and driver lifecycle preserve diagnostics
Real-app launch SHALL race CDP readiness against spawn errors and early process exit, fallback navigation SHALL validate the Tauri bridge/root before succeeding, and each run SHALL use a fresh owned directory. Triage bundles SHALL copy canonical artifacts, not rename them. HTML/JUnit output SHALL remain well-formed for arbitrary messages.

#### Scenario: Early process exit is a harness failure
- **WHEN** the packaged process exits before CDP is ready
- **THEN** launch rejects with exit code/signal/stderr diagnostics and cleanup still runs

#### Scenario: Triage preserves originals
- **WHEN** a triage bundle is written
- **THEN** both canonical artifact paths and triage copies exist and remain readable

#### Scenario: Arbitrary failure text is serialized safely
- **WHEN** a failure contains `<`, `&`, quotes, Unicode, or `]]>`
- **THEN** HTML/JUnit output remains parseable and retains the message semantically
