## ADDED Requirements

### Requirement: Utilization values stay inside the valid percentage range on every path
Every utilization value the product displays SHALL be within 0–100 percent, whether it arrives from the production collector or from the mock backend, and every percentage range the UI renders SHALL be clamped by one shared formatter rather than by per-call-site arithmetic.

#### Scenario: Mock history never leaves the valid range
- **WHEN** the mock backend emits live samples or seeds its history ring across a full simulated window
- **THEN** every CPU, memory, disk active-time and GPU utilization it produces is a finite number in 0–100 inclusive, matching the range the production collector can report

#### Scenario: A rendered percentage range is never negative
- **WHEN** a card's List row renders its min/max range
- **THEN** the range is produced by the shared percentage-range formatter, which clamps both bounds to 0–100, so no rendered text can show a negative or above-100 percentage

### Requirement: Charts are named, non-focusable images
Each metric chart SHALL be exposed to assistive technology as a graphic with an accessible name that carries the card's current value and its visible min/max, and SHALL NOT be a keyboard focus stop, because the chart itself offers no interaction.

#### Scenario: Chart surface semantics
- **WHEN** the dashboard renders any metric card
- **THEN** the chart's root SVG exposes `role="img"` and a non-empty accessible name, and its `tabindex` is `-1` so tabbing reaches only actionable controls

#### Scenario: Chart name conveys the trend summary
- **WHEN** assistive technology queries a chart by its accessible name
- **THEN** the name states the metric's identity and its current value together with the visible minimum and maximum for the selected window

### Requirement: The collapsed hardware sidebar leaves the accessibility tree
The hardware sidebar SHALL be hidden from assistive technology and from the tab order while it is collapsed, not merely visually collapsed by width, so keyboard and screen-reader users cannot reach its controls or its status text while it is closed.

#### Scenario: Collapsed sidebar is not reachable
- **WHEN** the sidebar toggle is in its collapsed state
- **THEN** no element inside the sidebar is focusable and the sidebar's content is not exposed to assistive technology, while the existing width transition still animates the collapse

### Requirement: Reorder handles identify their card
Each card's reorder handle SHALL have an accessible name that identifies the card it belongs to, so a screen-reader user can tell which handle they are on.

#### Scenario: Handle name identifies the card
- **WHEN** the dashboard renders any reorderable card
- **THEN** its drag handle's accessible name names that card (for example `Reorder CPU card`) rather than a generic label shared by every card
