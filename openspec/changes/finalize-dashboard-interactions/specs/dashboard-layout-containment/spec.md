## ADDED Requirements

### Requirement: Hardware labels and large live values remain readable
At the minimum window and above, all view modes SHALL keep long CPU/GPU/model names and large network rate values inside their allocated panels. Primary live values SHALL remain visible and SHALL NOT be squeezed behind non-shrinking hardware names or clipped by a neighboring chart. Disk model display SHALL NOT replace stable-key identity.

#### Scenario: Long hardware label in list view
- **WHEN** List view renders a long CPU or GPU model name at 400px width
- **THEN** the name wraps inside its panel, the live value is visible, and neither overlaps the chart

#### Scenario: Large network rate in tile view
- **WHEN** a 300px-wide tile renders a large finite network rate
- **THEN** its direction label and live value reflow within the card instead of painting past its edge
