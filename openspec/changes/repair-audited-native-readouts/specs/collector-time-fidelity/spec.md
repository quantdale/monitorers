## ADDED Requirements

### Requirement: Cadence verification respects ring capacity and requires timestamp evidence
The cadence checker SHALL account for bounded history capacity during long observations, require elapsed timestamp coverage, and use newest committed timestamps and per-device history lengths from current probe records to verify continued full-tick advancement after saturation. Missing timestamp coverage SHALL fail instead of bypassing the check.

#### Scenario: Observation exceeds history capacity
- **WHEN** a correct observation lasts longer than the ring capacity
- **THEN** saturation is accepted while per-device lengths and newest committed timestamps still prove full-tick advancement

#### Scenario: Timestamp coverage is absent
- **WHEN** an otherwise plausible long-enough observation reports zero timestamp span
- **THEN** the checker fails the missing coverage evidence

#### Scenario: Saturated ring stops advancing
- **WHEN** lengths remain at capacity but committed timestamps stop advancing on full ticks
- **THEN** the checker fails instead of treating unchanged lengths as proof of correct rollover
