## ADDED Requirements

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
`useMetrics.ts`'s initial `get_history()` call SHALL, on rejection, set an explicit error state distinguishable from the normal "still collecting metrics" loading state, rather than only logging to the console while leaving `history` as `null` indefinitely.

#### Scenario: get_history rejects
- **WHEN** the `get_history` IPC command rejects
- **THEN** the hook sets a distinct error field and the consuming component can render a message different from the perpetual loading placeholder
