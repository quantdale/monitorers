## ADDED Requirements

### Requirement: Retained history keeps one timestamp clock across collector replacement
The collector SHALL retain one fixed wall origin and monotonic epoch for the lifetime of a history store, including automatic recovery and manual retry. Replacement sessions SHALL use this retained timestamp projection for both live snapshots and full-tick history commits, even when current wall time differs. Poll scheduling and rate priming SHALL still use fresh per-session state. Recovery downtime SHALL remain elapsed time without fabricated samples. A fresh process with empty history SHALL establish a new origin.

#### Scenario: Clock adjustment precedes collector recovery
- **WHEN** system wall time changes backward or forward and a replacement session appends into existing history
- **THEN** new timestamps continue the existing monotonic projection without rewind or a wall-clock jump

#### Scenario: Recovery has downtime
- **WHEN** a replacement session starts after a monotonic recovery interval
- **THEN** the next sample includes that elapsed interval and no synthetic downtime samples are inserted

#### Scenario: Ring and snapshot remain identical
- **WHEN** the replacement session commits its first full tick
- **THEN** the snapshot timestamp equals the newest committed history timestamp from the retained clock
