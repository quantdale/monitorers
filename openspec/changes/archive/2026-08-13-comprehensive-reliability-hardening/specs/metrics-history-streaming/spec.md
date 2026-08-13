## ADDED Requirements

### Requirement: History commit density is tied to elapsed time
The history contract SHALL retain the one-logical-commit cadence while defining windows from timestamps, not assuming one sample equals one second. Full-poll ratio correctness and wall-clock duration correctness SHALL be independently observable.

#### Scenario: Slow collector cannot claim one-hour fidelity
- **WHEN** full ticks occur at a ratio of one in four but wall-clock intervals are slower than the configured SLO
- **THEN** the cadence evidence fails and a window does not claim more elapsed coverage than its timestamps provide

### Requirement: Missing dynamic-device samples are gaps
The frontend SHALL preserve missing/NaN dynamic-device values as null gaps through merge, chart-point conversion, secondary-series handling, and Recharts rendering. Legitimate numeric zero SHALL remain zero and gaps SHALL not be connected into a fabricated pre-discovery line.

#### Scenario: Pre-discovery history is not zero
- **WHEN** a disk or GPU appears after the global timestamp history begins
- **THEN** samples before its appearance render as gaps, while its first real sample is anchored at its appearance timestamp

#### Scenario: Zero remains visible
- **WHEN** a legitimate device utilization sample is exactly `0`
- **THEN** the chart and statistics treat it as numeric zero, not missing data
