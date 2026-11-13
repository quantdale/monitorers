## ADDED Requirements

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
