# simulation-trust Delta

## ADDED Requirements

### Requirement: Runtime/framework dependency migrations SHALL be proven on the packaged real-app lane
A migration that changes Tauri, plugin-store, React, the collector's Windows-facing dependencies, or another runtime component on the real IPC/persistence path SHALL NOT be considered qualified solely from the Vite mock harness or unit tests. Final qualification SHALL include the built executable driven through the packaged CDP lane with real Tauri IPC, isolated real settings persistence, real collector data and true process relaunch.

#### Scenario: Tauri/store dependencies are upgraded
- **WHEN** the cross-language Tauri/store stack changes
- **THEN** packaged qualification proves command/event IPC, isolated `settings.json` writes, clean shutdown/relaunch, restored customization and developer-store non-interference

#### Scenario: React or event APIs are upgraded
- **WHEN** React/React DOM or Tauri event packages change
- **THEN** the packaged lane observes advancing metrics and lifecycle state without duplicate subscriptions, stale bootstrap rollback, uncaught page errors or orphaned app processes

### Requirement: Dependency qualification SHALL not weaken simulation evidence
A dependency migration SHALL NOT remove journeys, lower meaningful-assertion requirements, add broad console/page-error allowlists, disable isolation checks, or convert a real-lane assertion to mock-only merely to obtain a green result.

#### Scenario: Major migration causes an existing real journey to fail
- **WHEN** a previously certified packaged journey fails after a dependency update
- **THEN** the migration is fixed, reverted, or explicitly deferred; the journey is not skipped/quarantined unless a separate evidence-backed harness defect proves the test itself invalid

### Requirement: Final dependency qualification SHALL include repeated restart durability
Because dependency changes can affect store flushing, process lifecycle and event registration, the final runtime stack SHALL pass the existing bounded restart durability journey in addition to one-shot persistence checks.

#### Scenario: final candidate survives repeated relaunch
- **WHEN** the final candidate executes the bounded restart soak
- **THEN** each cycle persists valid settings, starts a distinct new process, re-bootstrap lifecycle state coherently, advances metrics, and leaves no owned orphan or developer-store mutation
