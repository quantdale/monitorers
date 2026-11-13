## ADDED Requirements

### Requirement: Metrics connection retry exposes progress and usable focus
Connection error feedback SHALL include a keyboard-operable Retry connection control with a visible focus indicator. Pending work SHALL expose busy feedback and prevent duplicate activation while retaining error details. Error content and controls SHALL fit the 400x300 minimum window, including long unbroken diagnostics. Successful user-triggered recovery SHALL place focus on an available metrics control if the retry control disappears and the user has not moved focus elsewhere. Reduced motion SHALL preserve the same feedback without decorative animation.

#### Scenario: Keyboard recovery completes
- **WHEN** the user activates Retry connection by keyboard and the connection recovers
- **THEN** pending feedback is announced and focus returns to the history-range control without changing its selected value

#### Scenario: User moves away during retry
- **WHEN** focus moves to another dashboard control during the attempt
- **THEN** successful recovery does not steal that focus

#### Scenario: Narrow error layout
- **WHEN** a long diagnostic is displayed at 400x300
- **THEN** the message wraps, the retry action remains reachable and the dashboard does not grow sideways

### Requirement: Connection bootstrap and refetch retain truthful scalar values
Before the first live snapshot, CPU SHALL use its newest available historical sample or the unavailable marker when none exists. Memory capacity/usage sizes SHALL remain unavailable until supplied by a live snapshot. A history refresh SHALL NOT replace known live sizes with defaults or fixture values. Genuine zero readings SHALL remain valid.

#### Scenario: History arrives before the live connection
- **WHEN** history contains a CPU sample but no live snapshot has arrived
- **THEN** the CPU numeral uses that sample and unknown memory sizes show unavailable markers

#### Scenario: History is refreshed after live sizes arrived
- **WHEN** the selected history window changes or the connection is retried
- **THEN** known memory sizes remain unchanged until a newer live snapshot updates them
