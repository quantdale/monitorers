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
`useMetrics.ts`'s initial `get_history()` call SHALL, on rejection, set an explicit error state distinguishable from the normal "still collecting metrics" loading state, rather than only logging to the console while leaving `history` as `null` indefinitely. The error state SHALL be cleared once live `metrics-update` events prove the collector pipeline is running, and the charts SHALL then seed from the first on_tick snapshot so the app does not stay stuck on the loading placeholder.

#### Scenario: get_history rejects
- **WHEN** the `get_history` IPC command rejects
- **THEN** the hook sets a distinct error field and the consuming component can render a message different from the perpetual loading placeholder

#### Scenario: Live events recover from a failed initial load
- **WHEN** `get_history` has rejected but a live `metrics-update` event subsequently arrives
- **THEN** the error field clears, and the first `on_tick: true` snapshot seeds a one-point history so charts render and continue appending normally

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
- **THEN** its history is re-seeded with a single point at the re-appearance timestamp (not the original first-seen timestamp), matching the mid-session card anchoring behavior

### Requirement: Newly-appearing cards anchor their first history point to their true appearance timestamp
When a disk or GPU first appears in `metrics-update` after the session has started (not present in initial `get_history`), the frontend SHALL seed that card's history with a single point at the arrival timestamp, not at the oldest global timestamp, so the card's plot starts where it actually appeared.

#### Scenario: Mid-session disk appears at correct x-position
- **WHEN** a disk first appears in `metrics-update` at wall-clock time T (not in initial `get_history`)
- **THEN** its history values array receives one point at timestamp T; `computeChartPoints` plots that point at x-position corresponding to T, not at the left edge of the window

#### Scenario: Mid-session GPU appears at correct x-position
- **WHEN** a GPU first appears in `metrics-update` at wall-clock time T (not in initial `get_history`)
- **THEN** its history values array receives one point at timestamp T; `computeChartPoints` plots that point at x-position corresponding to T, not at the left edge of the window

