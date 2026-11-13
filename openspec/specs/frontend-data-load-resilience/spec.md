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

### Requirement: Collector failure is recoverable UX, not a dead end
The frontend SHALL represent collector lifecycle states explicitly: during automatic recovery it SHALL keep last-known metrics and charts visible with an accessible transient "recovering" announcement; after budget exhaustion it SHALL show a persistent accessible failure state with a working Retry metrics action; on successful recovery or retry it SHALL clear both automatically. The dashboard SHALL NOT blank, SHALL NOT replace retained values with zeros, and SHALL remain otherwise interactive.

#### Scenario: Recovering keeps the dashboard alive
- **WHEN** supervision reports `recovering`
- **THEN** last-known metrics stay rendered unchanged (no zero substitution), a `role="status"` recovery message is announced politely, and no restart of the page or app is required

#### Scenario: Transient failure clears itself
- **WHEN** supervision returns to `healthy` after automatic recovery
- **THEN** the recovery/failure UI disappears without user action and live values resume from real events

#### Scenario: Exhausted budget offers retry
- **WHEN** supervision reports `failed`
- **THEN** an assertive alert names the failure, presents an accessible Retry metrics control that invokes the backend retry path exactly once per activation, and the rest of the app remains usable

#### Scenario: Retry success restores normal operation
- **WHEN** a manual retry leads to a healthy session
- **THEN** the failure banner and retry control disappear automatically and charts continue appending truthful new samples

### Requirement: Frontend lifecycle handling is unit-covered
Hook/component tests SHALL cover healthy→recovering→healthy, healthy→recovering→failed, failed→manual retry, transient clearing, retention of last-known metrics during recovery, absence of fabricated zeros, absence of duplicate history appends across collector generation changes, schema-mismatch behavior for the lifecycle payload, and retry-button behavior.

#### Scenario: Generation change does not duplicate history
- **WHEN** a replacement collector session begins emitting into preserved frontend history
- **THEN** history arrays continue appending without duplicating pre-recovery points or rewinding timestamps

### Requirement: Mount and reload bootstrap the current collector status race-safely
On mount/reload in Tauri mode the hook SHALL fetch the supervisor's current managed status (`get_collector_status`) IN ADDITION to subscribing to `collector-status` events, dispatching the fetch only after the listener is attached. A fetched response that is older than an already-observed event SHALL be discarded rather than applied. A malformed or stale lifecycle contract received through either channel SHALL fail visibly without mutating lifecycle state. Pending bootstrap work SHALL NOT touch state after unmount, and a remount SHALL re-bootstrap.

#### Scenario: Failed before mount surfaces Retry immediately
- **WHEN** the webview mounts or reloads while supervision is already persistent `failed`
- **THEN** the failed UX and working Retry control appear from the bootstrapped status alone — no new transition event and no process restart required

#### Scenario: Event observed during bootstrap outranks the fetched snapshot
- **WHEN** a valid `collector-status` event is applied while the bootstrap fetch is still in flight
- **THEN** the slower fetched response is discarded and the newer observed state remains rendered

### Requirement: Hardware-profile refreshes converge without losing notifications
The frontend SHALL subscribe to hardware-profile notifications before fetching the initial profile. Notifications received during a fetch SHALL cause a subsequent refresh, coalescing repeated notifications while keeping at most one request active per subscription. Fetch or subscription failures SHALL expose a retryable error while retaining the last good profile. Disposed subscriptions SHALL NOT change profile state or start additional requests, even when registration or a request settles late.

#### Scenario: Notification arrives during a fetch
- **WHEN** the backend profile changes while an older profile request is pending and emits one or more notifications
- **THEN** the frontend fetches again after the active request settles and displays the current profile without requiring another event

#### Scenario: Listener registration is delayed
- **WHEN** the profile changes before asynchronous listener registration completes
- **THEN** the initial fetch is dispatched after registration and reads the current profile

#### Scenario: Subscription cannot attach
- **WHEN** listener registration fails
- **THEN** a retryable error is shown and an initial profile read still provides useful hardware details when possible

#### Scenario: Effect is disposed with work pending
- **WHEN** registration or a profile request settles after unmount or explicit retry disposed its effect
- **THEN** late callbacks cannot replace the active profile or start a trailing request and any late listener is removed

### Requirement: Disposed metrics subscriptions cannot mutate an active mount
Disposed metrics, collector-status and collector-error subscriptions SHALL ignore callbacks during asynchronous listener removal. A bootstrap awaiting listener registration SHALL NOT dispatch a request after disposal. This SHALL hold during effect replay as well as unmount. Active full-tick callbacks SHALL append exactly once even when the UI framework replays state updaters. Subscription failures SHALL surface a visible error that unrelated successful history/status responses cannot clear.

#### Scenario: Disposed effect delivers events during replay
- **WHEN** an old metrics effect delivers a snapshot, status or error after a replacement effect has become active
- **THEN** the current metrics and lifecycle remain unchanged

#### Scenario: Framework replays state updater functions
- **WHEN** one active full-tick event is delivered under StrictMode
- **THEN** every history channel and its timestamp advance exactly once

#### Scenario: Live subscription fails but bootstrap succeeds
- **WHEN** a live listener cannot attach while history and lifecycle bootstrap succeed
- **THEN** the UI reports the subscription failure while preserving available data

### Requirement: Missing live timestamps never introduce the local clock
The frontend SHALL preserve samples with unusable payload timestamps using the latest known history or backend timestamp, or zero when neither exists. Default history-helper calls SHALL use the same backend timestamp rule. The frontend SHALL NOT invent wall-clock sample times.

#### Scenario: Timestamp is absent before history loads
- **WHEN** a full-tick live sample has no usable timestamp and no history or backend time is known
- **THEN** the sample is preserved at zero and a missing-timestamp diagnostic is emitted

### Requirement: Disposed settings loads cannot replace active user edits
Settings loads belonging to disposed effects SHALL NOT update settings, store ownership or error state. This SHALL hold for the native store and simulation shim, including StrictMode effect replay.

#### Scenario: Older bootstrap completes after the active settings were edited
- **WHEN** a replacement settings effect has loaded and the user changes the history window before an older effect resolves
- **THEN** the chosen window and active store remain unchanged by that obsolete load

### Requirement: Metrics connection errors can be retried in place
The frontend SHALL offer an explicit retry for history or live-connection failures, whether metrics are absent or last-known data remains. Retry SHALL reattempt live subscriptions and read history for the selected window without restarting a healthy collector, resetting user settings or blanking retained metrics. Concurrent activations SHALL coalesce. Disposed work SHALL NOT change the active connection. A reconnect history read SHALL start after its subscription registration attempts settle and SHALL reconcile intervening live events.

History reads and subscription registration attempts SHALL terminate as failed after ten seconds without an answer, so pending work cannot permanently disable retry. A timed-out request's eventual result SHALL NOT overwrite the active request. Listener ownership SHALL remain intact so late registrations are still removed on disposal.

#### Scenario: History retry succeeds
- **WHEN** history loading failed and the user retries after the request becomes available
- **THEN** history for the current window loads, the history error clears, and view/visibility/order settings remain unchanged

#### Scenario: Failed listener can reconnect
- **WHEN** live subscription registration failed and a later retry attaches successfully
- **THEN** live events resume, the subscription error clears and each full tick appends once

#### Scenario: Retry fails repeatedly
- **WHEN** another connection attempt fails
- **THEN** the error stays actionable and retained data remains visible without fabricated zero values

#### Scenario: Old work settles during reconnect
- **WHEN** a disposed listener callback or old history response arrives after retry
- **THEN** it cannot alter active metrics, errors, pending state or lifecycle

#### Scenario: IPC never answers
- **WHEN** a history request or subscription registration does not settle within ten seconds
- **THEN** a visible timeout permits retry and the current data remains available; disposal cancels owned deadline timers

### Requirement: Metrics error channels recover independently
History, live-schema, lifecycle-schema and subscription errors SHALL clear only when their own channel proves recovery. Successful history alone SHALL NOT clear a live-schema fault. Successful status or history SHALL NOT clear a failed subscription. A retry activation alone SHALL NOT hide existing errors.

#### Scenario: Compatible history follows incompatible live data
- **WHEN** a live-schema error is active and a compatible history request succeeds
- **THEN** the live-schema error stays visible until a compatible live snapshot arrives

#### Scenario: Connection repair preserves other faults
- **WHEN** listeners attach successfully while a history or lifecycle-schema failure is still unresolved
- **THEN** only the subscription error clears

### Requirement: Initial history reads follow listener registration
The first history read SHALL wait for live subscription registration attempts to settle or time out, using the same ordering as explicit reconnection. Events emitted before listener attachment SHALL be recovered by the subsequent history read; events during that read SHALL be reconciled without duplication.

#### Scenario: Initial subscription is delayed
- **WHEN** history is immediately available but listener registration is pending
- **THEN** the app waits to request history until registration settles and retains a full tick emitted before the read

#### Scenario: Initial subscription fails
- **WHEN** a registration rejects or times out
- **THEN** a history read still runs and the subscription failure remains visible
