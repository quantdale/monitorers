## ADDED Requirements

### Requirement: Percentage-range formatting has a single implementation
The formatting of a percentage range (the `Min: … Max: …` text and the network card's download/upload ranges) SHALL be implemented once in the shared card formatter module and SHALL clamp its bounds, so the same rule applies to every card and cannot drift per call site.

#### Scenario: Network ranges use the shared formatter
- **WHEN** the network card renders its download and upload ranges in List view
- **THEN** those ranges are produced by the same shared percentage/throughput-range formatter used by every other card, with no card-local `Math.max(0, …)` duplication

### Requirement: Mock telemetry is range-faithful to the production payload
The mock backend SHALL emit metric values inside the ranges the production collector can report for the same field, so a defect observable in the mock lane is a real defect rather than a mock artifact, and so mock-lane assertions cannot pass because of a divergence.

#### Scenario: Mock utilization matches production bounds
- **WHEN** a consumer reads any utilization series from the mock backend (live samples or history ring)
- **THEN** every value is within 0–100 percent, the same bound the production collector respects for percentage counters
