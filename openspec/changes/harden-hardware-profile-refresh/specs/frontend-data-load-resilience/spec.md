## ADDED Requirements

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
