## Purpose

Defines how the frontend surfaces data-load failures: settings and history load rejections produce distinct, visible error states instead of a silent perpetual loading placeholder; persisted settings are versioned and validated on read with per-field fallback to defaults.
## Requirements
### Requirement: Settings load failures surface a distinct, visible error state
`useSettings.ts`'s initial load SHALL catch any rejection from `Store.load` or the subsequent settings-key reads, and SHALL set an explicit error state distinguishable from both the "still loading" and "loaded successfully" states. The application SHALL NOT render a permanently blank screen when settings fail to load.

#### Scenario: Store.load rejects
- **WHEN** `Store.load` rejects during the settings hook's initial load
- **THEN** the hook sets an error state (not `loaded: true` with silent defaults, and not an unhandled rejection) and the consuming component renders a visible message instead of `null`

#### Scenario: A settings key read rejects after Store.load succeeds
- **WHEN** `Store.load` succeeds but a subsequent `s.get()` call rejects
- **THEN** the hook still sets the error state rather than leaving `loaded` permanently `false` with no error signal

### Requirement: Persisted settings are versioned and validated on read
Settings persisted via the store plugin SHALL include a `settingsVersion` field. On read, each stored value SHALL be validated for basic shape/type correctness before use; a value that fails validation, or a version mismatch, SHALL cause that field to fall back to its compiled-in default rather than propagating an invalid value into application state or silently doing nothing.

#### Scenario: Valid, current-version settings load normally
- **WHEN** `settings.json` contains a `settingsVersion` matching the current expected version and all fields pass validation
- **THEN** all persisted values are used as-is

#### Scenario: Missing settingsVersion is treated as pre-existing, not an error
- **WHEN** `settings.json` has no `settingsVersion` field (an install predating this requirement)
- **THEN** the settings load proceeds normally (treated as the earliest known version) rather than being rejected outright, and existing valid values are preserved

#### Scenario: An individual field fails validation
- **WHEN** a specific persisted field (e.g. `cardOrder`) is not the expected type/shape
- **THEN** only that field falls back to its compiled-in default; other valid fields are unaffected

### Requirement: History load failures surface a distinct error state
`useMetrics.ts`'s initial `get_history()` call SHALL, on rejection, set an explicit error state distinguishable from the normal "still collecting metrics" loading state, rather than only logging to the console while leaving `history` as `null` indefinitely. The error state SHALL be cleared when a compatible history response succeeds; if the initial history is unavailable, the first compatible `on_tick` snapshot may seed the charts and clear the transient error. Off-tick events alone SHALL NOT hide a still-unresolved history-load failure.

#### Scenario: get_history rejects
- **WHEN** the `get_history` IPC command rejects
- **THEN** the hook sets a distinct error field and the consuming component can render a message different from the perpetual loading placeholder

#### Scenario: A full live tick recovers from a failed initial load
- **WHEN** `get_history` has rejected and a compatible `on_tick: true` `metrics-update` event subsequently arrives
- **THEN** the error field clears, the snapshot seeds a one-point history, and charts render and continue appending normally

### Requirement: Ghost disk/GPU cards are pruned from frontend history after sustained absence
When a disk or GPU is absent from the live `metrics-update` snapshot for a sustained period (matching the backend's `PRUNE_MISS_THRESHOLD`), the frontend SHALL remove that card's history from its accumulated state so that `isCardPresent` correctly reports `false` and the ghost card disappears from the dashboard.

#### Scenario: Disk card disappears after backend prunes it
- **WHEN** a disk present in initial `get_history` stops appearing in live `metrics-update` snapshots for longer than the prune threshold
- **THEN** `mergeDiskHistory` removes that disk's entry from frontend history and `isCardPresent` returns `false` for that disk ID

#### Scenario: GPU card disappears after backend prunes it
- **WHEN** a GPU present in initial `get_history` stops appearing in live `metrics-update` snapshots for longer than the prune threshold
- **THEN** `mergeGpuHistory` removes that GPU's entry from frontend history and `isCardPresent` returns `false` for that GPU ID

#### Scenario: Re-appearing card re-seeds history at re-appearance timestamp
- **WHEN** a previously-pruned disk/GPU reappears in `metrics-update`
- **THEN** its history contains null gaps before the re-appearance timestamp and its first numeric point is at re-appearance, not at the original first-seen timestamp

### Requirement: Newly-appearing cards anchor their first history point to their true appearance timestamp
When a disk or GPU first appears in `metrics-update` after the session has started (not present in initial `get_history`), the frontend SHALL seed that card's history with a single point at the arrival timestamp, not at the oldest global timestamp, so the card's plot starts where it actually appeared.

#### Scenario: Mid-session disk appears at correct x-position
- **WHEN** a disk first appears in `metrics-update` at wall-clock time T (not in initial `get_history`)
- **THEN** its timestamp-aligned values contain null gaps before T and a numeric point at T; `computeChartPoints` plots that point at x-position corresponding to T, not at the left edge of the window

#### Scenario: Mid-session GPU appears at correct x-position
- **WHEN** a GPU first appears in `metrics-update` at wall-clock time T (not in initial `get_history`)
- **THEN** its timestamp-aligned values contain null gaps before T and a numeric point at T; `computeChartPoints` plots that point at x-position corresponding to T, not at the left edge of the window

### Requirement: Incompatible IPC payloads are rejected before mutation
History and live snapshot schema mismatches SHALL fail closed: no incompatible payload may update history/latest state, and the UI SHALL show a distinct actionable frontend/backend version-mismatch error. Listeners MAY remain attached for recovery but SHALL not consume incompatible values.

#### Scenario: Mismatched history is rejected
- **WHEN** `get_history` resolves with a schema version different from the expected contract
- **THEN** history remains unchanged and a rebuild/version error is rendered

#### Scenario: Mismatched live snapshot is rejected
- **WHEN** a `metrics-update` payload has an incompatible schema version
- **THEN** the snapshot is not appended or applied to latest values

### Requirement: History requests and live events are generation-safe
An asynchronous history load SHALL carry a generation/request identity and reconcile with live events received after that request began. A stale response SHALL not overwrite a newer window selection or roll state backward.

#### Scenario: Older request cannot win
- **WHEN** request A starts, request B starts and resolves, and A resolves afterward
- **THEN** the state remains the result for B/current generation

#### Scenario: Live event is not lost to a refetch
- **WHEN** a live snapshot arrives while a history request is pending
- **THEN** resolving the request preserves the newer live point and never rolls history backward

### Requirement: Finite-safe statistics and formatting are shared
History statistics and metric formatters SHALL ignore non-finite/missing values, return explicit empty fallbacks, and apply documented per-metric clamping/sign policies. The UI SHALL never display `NaN`, `Infinity`, or unsupported sensor-shaped placeholders as valid readings.

#### Scenario: All-gap statistics are safe
- **WHEN** a history channel contains only gaps or non-finite values
- **THEN** list view renders the defined empty fallback rather than `NaN`/`Infinity`
