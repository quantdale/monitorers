## ADDED Requirements

### Requirement: Initial history reads follow listener registration
The first history read SHALL wait for live subscription registration attempts to settle or time out, using the same ordering as explicit reconnection. Events emitted before listener attachment SHALL be recovered by the subsequent history read; events during that read SHALL be reconciled without duplication.

#### Scenario: Initial subscription is delayed
- **WHEN** history is immediately available but listener registration is pending
- **THEN** the app waits to request history until registration settles and retains a full tick emitted before the read

#### Scenario: Initial subscription fails
- **WHEN** a registration rejects or times out
- **THEN** a history read still runs and the subscription failure remains visible
