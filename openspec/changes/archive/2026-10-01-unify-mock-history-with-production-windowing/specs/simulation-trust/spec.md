## MODIFIED Requirements

### Requirement: Simulation state and settings are isolated
Scenario hardware arrays SHALL be cloned into each backend instance, explicit empty arrays SHALL remain empty, and an isolated packaged run SHALL fail closed if its override path cannot be resolved, created, or written. Production with no simulation override SHALL continue to use normal settings behavior. The mock backend's history SHALL behave like the production backend's: an in-memory ring of committed samples advanced on history-committing (full-tick) emissions at the simulated 1 Hz cadence, sliced by elapsed time when a history window is requested. The mock SHALL NOT regenerate a fresh synthetic history on each `get_history` call; a seed may be written once into the buffer to make first paint deterministic, after which the buffer accumulates as the production ring does.

#### Scenario: Empty hardware is honored
- **WHEN** a scenario specifies `gpus: []` or `disks: []`
- **THEN** the mock exposes no devices in that category and the UI renders the corresponding empty state

#### Scenario: Backend instances do not share arrays
- **WHEN** instance A hotplugs or mutates its hardware
- **THEN** instance B and module defaults remain structurally unchanged

#### Scenario: Override failure cannot fall back
- **WHEN** a packaged simulation expects an override but the command fails or the path is invalid/unwritable
- **THEN** the run aborts before any settings write to the real user store

#### Scenario: Mock history accumulates rather than re-seeding
- **WHEN** the mock backend serves a history request after several full-tick emissions have occurred
- **THEN** the returned payload is a window slice of the samples committed so far (plus, on the very first request before any commit, the one-time seed), not a newly fabricated sine series unrelated to what was streaming

#### Scenario: Mock history window is honoured
- **WHEN** the mock backend is asked for a history window and the current buffer spans that window
- **THEN** the returned timestamps and per-channel values are sliced to the requested elapsed-time window exactly as the production backend slices its ring, so the same frontend windowing code path is exercised in both lanes
