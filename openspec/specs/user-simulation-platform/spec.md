# user-simulation-platform Specification

## Purpose
TBD - created by archiving change add-user-simulation-platform. Update Purpose after archive.
## Requirements
### Requirement: Reusable declarative user personas
The platform SHALL provide personas as declarative data (not code) that parameterize a simulated user: session-length distribution, think-time and dwell-time ranges, action preferences over the app's interaction surface, mistake probability, and fault-reaction behavior. Personas SHALL be composable with any journey and any supported driver without modification, and adding a new persona SHALL NOT require changes to the engine or driver code.

#### Scenario: A new persona is added without engine changes
- **WHEN** a developer adds a new persona data file defining timing ranges and action preferences, and runs an existing journey with it
- **THEN** the journey executes with that persona's timing and decisions, with no edits to engine, driver, or journey code

#### Scenario: Persona behavior differs measurably across personas
- **WHEN** the same journey runs once with a short-session persona and once with a long-watch persona under fixed seeds
- **THEN** the two runs differ in session duration and action mix in accordance with each persona's declared distributions

### Requirement: Composable journey definitions over the full interaction surface
The platform SHALL provide a typed step library covering every user-reachable interaction — sidebar toggle, time-window selection, metric hide/show via the dropdown (including Escape and click-outside close), view-mode switching, pointer and keyboard drag-reorder on dashboard and sidebar, ErrorBoundary retry, and app restart — plus state checkpoints for every application state (settings-error, loading, collecting, history-error inline/fatal, all-hidden, live, collector-error banner). Journeys SHALL be code modules composing these steps with assertions, and SHALL declare which drivers support them.

#### Scenario: A journey exercises multiple interaction kinds in one session
- **WHEN** a customization journey reorders a card via keyboard drag, hides a card via the dropdown, changes the time window, and switches view mode in a single run
- **THEN** each step's effect is asserted at the rendered layer before the next step begins, and the run fails at the first unmet checkpoint

#### Scenario: Every interactive control is reachable by at least one step
- **WHEN** the step library is audited against the interaction inventory (toolbar, dashboard drag, sidebar drag, ErrorBoundary retry)
- **THEN** every control has a corresponding step, or the gap is recorded in the exploratory register with a reason

### Requirement: Deterministic, reproducible execution
All simulated decisions and timings SHALL be drawn from a seeded pseudo-random generator. Every run SHALL log its seed, persona, journey, and driver as the run header, and re-running with the same seed and environment SHALL reproduce the same action sequence and timings (within driver scheduling jitter), so a CI failure is reproducible locally from the logged header alone.

#### Scenario: Same seed reproduces the same session
- **WHEN** a journey runs twice with the same logged seed on the mock-harness driver
- **THEN** the two action logs contain the same ordered sequence of actions and drawn timings

#### Scenario: Failure reproduction from a CI artifact
- **WHEN** a simulation run fails in CI and uploads its run header
- **THEN** a developer can reproduce the identical session locally by passing the logged seed, persona, and journey to the runner

### Requirement: Realistic user-behavior simulation
The engine SHALL model human-plausible behavior rather than fixed scripts: randomized think time between actions and dwell time on views within persona ranges, probabilistic decision points (e.g. whether to reorder this session), and modeled mistakes (mis-drag that cancels, Escape closing the dropdown mid-flow) at persona-configured rates. A zero-variance persona SHALL remain available for smoke runs that need fixed sequences.

#### Scenario: Timings vary within persona bounds across seeds
- **WHEN** the same journey runs under two different seeds with a non-zero-variance persona
- **THEN** inter-action delays differ between runs while every delay falls within the persona's declared ranges

#### Scenario: Modeled mistakes are exercised and recovered
- **WHEN** a persona with non-zero mistake probability runs a dropdown interaction
- **THEN** mistaken actions (e.g. Escape-close before selection) occur at the configured rate over many seeds, and the journey's recovery path completes the intended action

### Requirement: Scriptable mock backend with fault injection
The platform SHALL replace the hardcoded mock in `useMetrics.ts` with a scriptable mock backend, active only when `isTauri()` is false, that lets a journey script metric timelines and inject faults: collector-error emission, GPU/disk value freeze and ghosting, disk/GPU appear and disappear, slow or failing history load, schema-version mismatch, and corrupt settings payloads. The bridge SHALL NOT alter any production Tauri IPC code path.

#### Scenario: A journey injects a collector error and observes the banner
- **WHEN** a journey running on the mock-harness driver injects the collector-error fault
- **THEN** the app displays the collector-error banner, keeps it for the remainder of the session, and freezes the last-known card values — matching the pinned production contract

#### Scenario: A journey scripts a disk hotplug cycle
- **WHEN** the bridge script removes disk `D:` for several ticks and then restores it under the same key
- **THEN** the `D:` card disappears via presence filtering while its id is retained in settings, and reappears at its original position — matching the ghost-entry contract

#### Scenario: Production code paths are untouched by the bridge
- **WHEN** the app runs in a real Tauri context (`isTauri()` true)
- **THEN** no bridge code executes and metrics arrive only via real IPC

### Requirement: Default mock behavior parity
The bridge's default script SHALL reproduce the pre-existing mock behavior (sine-wave metrics, 250 ms ticks, 4:1 history cadence, two disks, two GPUs, schema version 3) such that the existing E2E suite passes unmodified against the bridge.

#### Scenario: Existing E2E specs pass against the bridge with no edits
- **WHEN** the simulation bridge replaces the inline mock and the five existing Playwright specs run unchanged
- **THEN** all five pass without modification

### Requirement: Real packaged app is drivable via CDP attach
The platform SHALL provide a real-app driver that launches the built Tauri app with WebView2 remote debugging enabled (loopback-only port, set via environment at launch, never via shipped configuration) and attaches Playwright over CDP, enabling journeys to drive the real backend: real Tauri IPC, real `settings.json` persistence, and real sensor data. If CDP attach cannot be made reliable, this driver SHALL be descoped to the exploratory register with a recorded reason rather than shipped flaky.

#### Scenario: A journey drives the packaged app end to end
- **WHEN** the packaged app is launched through the real-app driver and a customization journey runs
- **THEN** the driver performs rendered-layer interactions against the real WebView2 window and asserts real backend responses

#### Scenario: Remote debugging is never enabled in shipped configuration
- **WHEN** the shipped `tauri.conf.json` and build scripts are inspected
- **THEN** no remote-debugging flag is present; the flag exists only in the dev launch wrapper behind an environment variable

### Requirement: App restart is a first-class simulation step
Both drivers SHALL provide a restart primitive that simulates a full app relaunch: process restart on the real-app driver, page reload with persisted bridge state on the mock-harness driver. Journeys SHALL use it to validate the persistence boundary — layout preferences survive restart, telemetry history does not — against the real `settings.json` store when running on the real-app driver.

#### Scenario: Customization survives a real-app restart
- **WHEN** a journey customizes card order, hidden cards, window, and view mode on the real-app driver, restarts the app, and reads the resulting layout
- **THEN** the restored layout exactly matches the customized state, verified against the temp-isolated `settings.json`

#### Scenario: History does not survive restart
- **WHEN** a journey accumulates history, restarts the app, and inspects the initial `get_history` payload
- **THEN** history buffers are empty after relaunch regardless of pre-restart accumulation

### Requirement: Multi-layer validation
Journeys SHALL be able to assert at three layers: the rendered DOM (what a user sees), the persistence layer (store contents after actions and restarts), and the emission layer (cadence invariants cross-checked against `cadence_probe` JSONL where applicable). A journey SHALL NOT re-assert contracts already owned by other specs (cadence, card identity, settings concurrency); it references them as checkpoints.

#### Scenario: A cadence-related journey defers to probe ground truth
- **WHEN** a long-watch journey needs real-time cadence validation
- **THEN** it consumes cadence-probe invariants rather than re-deriving timing truth from wall-clock sleeps

#### Scenario: A persistence assertion reads the real store
- **WHEN** a real-app journey asserts persisted state
- **THEN** it validates against the per-run isolated `settings.json` contents, not only the rendered DOM

### Requirement: Run artifacts and failure triage
Every run SHALL produce: a JSONL action/event log (run header with seed, ordered actions with drawn timings, assertion results), Playwright trace and video, screenshots on failure, browser console and page-error capture, and (real-app driver) the app process stderr. On failure the runner SHALL emit a triage bundle and classify the failure as app defect, harness defect, or undrivable, and SHALL publish machine-readable (JUnit) and human-readable (HTML) journey reports.

#### Scenario: A failed journey yields a complete triage bundle
- **WHEN** any journey assertion fails
- **THEN** the run directory contains the action log with seed, the failing screenshot, the trace/video, console output, and a failure classification

#### Scenario: CI consumes the machine-readable report
- **WHEN** the simulation CI job completes with a failure
- **THEN** the JUnit report identifies the failing journey, step, and seed without opening the HTML report

### Requirement: Execution across local, CI, and packaged environments
The platform SHALL run in three lanes: local mock-harness runs (fast, time-compressed), CI mock-harness runs on windows-latest alongside the existing E2E job (initially non-blocking), and packaged-app runs locally and on manual workflow dispatch. Long-window and fault journeys SHALL support time compression via the bridge clock; real-time cadence spot checks SHALL remain in the packaged/on-demand lane.

#### Scenario: A developer runs the full mock suite locally with one command
- **WHEN** a developer runs the mock-lane simulation command
- **THEN** all mock-supported journeys execute against the Vite server and produce reports, without a Rust build

#### Scenario: Packaged-app journeys run on demand in CI
- **WHEN** the simulation workflow is manually dispatched for the packaged lane
- **THEN** the app is built, launched under the real-app driver, and real-driver journeys execute with artifacts uploaded

### Requirement: Test activity is isolated from real user state
Every real-app run SHALL execute with its persisted state redirected to a per-run temporary directory, so simulation never reads or writes a developer's real `settings.json`, runs are hermetic and parallel-safe, and no residual state leaks between runs. The mock bridge's persisted state SHALL likewise be namespaced per run.

#### Scenario: Developer settings are untouched by a simulation run
- **WHEN** a real-app simulation run completes while a developer's own `settings.json` exists
- **THEN** the developer's store file is byte-identical before and after the run, and all simulation writes occurred under the per-run temp directory

#### Scenario: Parallel runs do not share state
- **WHEN** two real-app runs execute concurrently
- **THEN** each uses a distinct temp app-data directory and debugging port, and neither observes the other's settings

### Requirement: Undrivable scenarios follow the register discipline
Any journey step that cannot be software-driven (physical hardware change, OS power events, multi-process interaction) SHALL be recorded in the exploratory register with a one-line reason and SHALL NOT be implemented as a faked or flaky automation. Register entries SHALL be revisited when a new driver capability makes them drivable.

#### Scenario: A physically undrivable step is registered, not faked
- **WHEN** a proposed journey requires a real drive unplug
- **THEN** the step is added to the exploratory register with its reason, and the journey covers the software-reachable portion via bridge-scripted hotplug instead

### Requirement: Simulation failures are governed against flakiness
The platform SHALL define a flake budget: a journey that fails under a fixed seed is a defect to fix; a journey that fails only under varying seeds is quarantined after a defined number of distinct-seed failures, removed from the blocking set, and tracked until fixed. The CI simulation job SHALL be non-blocking at introduction, with promotion to blocking treated as a separate change.

#### Scenario: Seed-stable failure blocks as a defect
- **WHEN** a journey fails and re-running the logged seed locally reproduces the same failure
- **THEN** the failure is treated as an app or harness defect, not quarantined as flake

#### Scenario: Seed-varying failure is quarantined with tracking
- **WHEN** a journey fails intermittently across distinct seeds beyond the budgeted count
- **THEN** it is moved to the quarantine list with a tracking entry, and the remaining suite continues to gate

