## ADDED Requirements

### Requirement: An open hardware sidebar does not crush the dashboard at the minimum window
At the application's minimum window size (400×300) and any viewport narrower than 640px, opening the hardware sidebar SHALL present it as an overlay that does not reduce the dashboard column width. Cards SHALL remain inside their boxes (no card's scroll width exceeds its client width). At 640px and wider, the sidebar SHALL remain an in-flow rail that reduces the dashboard column by the rail width. The collapsed sidebar SHALL stay hidden from assistive technology and the tab order.

#### Scenario: Minimum window overlays the rail
- **WHEN** the hardware sidebar is opened at a 400px-wide window
- **THEN** the dashboard card list keeps the width it had while the sidebar was closed, no metric card overflows its own box, and the sidebar is a fixed overlay rather than an in-flow column

#### Scenario: Wide window still pushes
- **WHEN** the hardware sidebar is opened at a 900px-wide window
- **THEN** the dashboard card list becomes narrower by the rail width and no metric card overflows its own box

#### Scenario: Overlay dismisses without leaving focus behind
- **WHEN** the overlay sidebar is open and the user activates its close control, its scrim, or Escape (and Escape was not already consumed by an in-progress keyboard drag)
- **THEN** the sidebar collapses out of the accessibility tree and focus returns to the sidebar toggle
