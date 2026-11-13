## ADDED Requirements

### Requirement: Formatted-counter availability survives collection success
A successful counter collection SHALL NOT imply that every formatted counter or instance is available. Failed disk/GPU formatting SHALL record missing utilization samples, preserve the last valid live GPU scalar, and suspend disappearance pruning for the failed domain. An individual invalid instance SHALL remain present with unavailable values. Other available domains SHALL continue updating. Missing disk throughput or response readings SHALL be null on the wire and displayed unavailable.

#### Scenario: GPU formatting fails while disk formatting succeeds
- **WHEN** collection succeeds but formatting the GPU counter fails
- **THEN** GPU history receives gaps while valid disk metrics continue updating

#### Scenario: Disk formatting fails repeatedly
- **WHEN** collection succeeds but the disk inventory counter cannot be formatted for more than the pruning threshold
- **THEN** known disks remain present with missing utilization samples instead of being removed

#### Scenario: One formatted instance has invalid data
- **WHEN** one returned device counter carries an invalid status or nonfinite value
- **THEN** its utilization is unavailable while other valid instances retain their readings

#### Scenario: Optional throughput counter is unavailable
- **WHEN** a disk activity sample is valid but a throughput or response counter is unavailable
- **THEN** the missing readout is displayed unavailable instead of numeric zero
