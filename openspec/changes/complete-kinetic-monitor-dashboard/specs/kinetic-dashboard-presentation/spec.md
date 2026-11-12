## Purpose

Defines a cohesive, tactile system-monitor presentation that remains immediately operable and truthful while live resource readings update.

## ADDED Requirements

### Requirement: Consistent instrument-panel hierarchy across all surfaces
The dashboard SHALL use a shared dark surface, text, action, status, typography and spacing system across Default, Tile and List views, hardware rail/drawer, visibility controls, and loading/error/empty states. Metric series colors SHALL remain distinguishable from the primary action accent.

#### Scenario: Switching layouts preserves capabilities
- **WHEN** the user switches among Default, Tile and List
- **THEN** current values, history ranges, metadata, visibility choices, and stable-key reorder remain available without changing their meaning or persistence

#### Scenario: Narrow and wide windows
- **WHEN** the viewport changes between the 400x300 minimum and desktop sizes
- **THEN** card content remains contained, controls are reachable, Tile tracks remain equal or collapse, and the hardware rail becomes an overlay where required

### Requirement: Decorative motion cannot compromise immediate interaction
Presentation motion SHALL preserve keyboard reorder, focus, and viewport placement from the first interactive frame, including during live value updates. Charts SHALL NOT animate incoming samples. Nonessential animation SHALL stop or be suppressed under reduced-motion preference.

#### Scenario: Immediate keyboard reorder during changing readings
- **WHEN** the user starts a card drag, moves to an adjacent sibling and drops while metrics update
- **THEN** the intended stable-key order changes once and remains correct, with no stale-measurement cancellation or unrelated state change

#### Scenario: Visibility panel from an animated toolbar
- **WHEN** the metric visibility panel opens under transformed or glass toolbar ancestors at 400x300
- **THEN** its painted bounds remain within the viewport, Tab and reverse Tab stay inside, all items can be reached by scrolling, and Escape returns focus to the trigger

#### Scenario: Reduced-motion preference
- **WHEN** the operating system requests reduced motion
- **THEN** decorative translations, scaling, stagger, looping pulses, and ambient animations are disabled without suppressing status announcements or functional interactions

### Requirement: Monitoring truth and recovery behavior are preserved
The redesign SHALL preserve collection schemas, history timestamps/gaps/cadence, hardware identity, stored customizations, missing-value semantics, managed lifecycle recovery, and retry behavior.

#### Scenario: Collector interruption during use
- **WHEN** collection recovers or reaches failed state
- **THEN** existing charts remain present, the appropriate live-region feedback appears, and retry remains operable without changing the underlying collection contract
