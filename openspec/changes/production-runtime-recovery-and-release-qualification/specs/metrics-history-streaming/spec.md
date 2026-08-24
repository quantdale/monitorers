## ADDED Requirements

### Requirement: Collector lifecycle status is a typed, versioned IPC contract
The backend SHALL expose collector lifecycle state through a `collector-status` event and a `get_collector_status` command returning a typed payload containing at least: its own schema version, lifecycle state (`starting|healthy|recovering|failed|stopping`), session generation, current attempt within the recovery budget, maximum attempts, an optional human-readable reason, and a timestamp. The payload SHALL derive `Serialize` only, and its schema version SHALL be validated fail-closed by the frontend independently of the metrics snapshot version.

#### Scenario: Status payloads serialize with stable field names
- **WHEN** any lifecycle transition is serialized to JSON
- **THEN** fields use snake_case names matching the TypeScript mirror exactly, and the embedded schema version identifies the contract revision

#### Scenario: Incompatible status payload cannot corrupt UI state
- **WHEN** the frontend receives a `collector-status` payload whose schema version it does not recognize
- **THEN** it rejects the payload without mutating lifecycle state, keeps the listener attached for a compatible rebuild, and surfaces the existing actionable mismatch guidance

#### Scenario: Status emission failure never kills supervision
- **WHEN** delivering a status event fails (for example during teardown)
- **THEN** the failure is logged once and supervision continues; status delivery errors do not terminate sessions or escalate recovery

### Requirement: Terminal failure keeps the legacy error message channel
The existing `collector-error` string event SHALL continue to be emitted when collection stops, so existing diagnostics keep working; the typed status contract is the authoritative machine-readable source of lifecycle truth.

#### Scenario: Panic still produces a diagnostic message
- **WHEN** a collector session ends due to panic
- **THEN** the legacy string event fires as before while the typed status reports the recovering/failed transition
