## ADDED Requirements

### Requirement: The packaged real-app lane follows the schema pair instead of copying it
The packaged-app qualification lane SHALL assert the metrics schema version against the same expectation the frontend enforces, rather than a literal recorded in the lane, so a schema bump cannot leave the lane failing against a correct application.

#### Scenario: The lane runs against the current application
- **WHEN** `npm run verify:packaged` launches the built application and reads `get_history` over real Tauri IPC
- **THEN** the schema-version assertion compares the payload against the shared expectation and passes, without the lane holding its own copy of the version

#### Scenario: A future schema bump moves the pair
- **WHEN** the metrics schema version changes and both the Rust constant and the frontend expectation move together
- **THEN** the packaged lane's assertion moves with them and continues to pass without an edit to the lane
