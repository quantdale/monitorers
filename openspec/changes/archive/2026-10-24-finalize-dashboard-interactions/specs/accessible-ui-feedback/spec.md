## ADDED Requirements

### Requirement: Dialog focus is contained from entry through dismissal
Open hardware modal drawers and metric-visibility panels SHALL keep keyboard focus inside their controls on forward and reverse Tab, including initial focus and changing content. The hardware modal's backdrop SHALL NOT be an external keyboard stop. Closing SHALL restore focus to an available trigger; a keyboard drag's Escape SHALL cancel the drag without also dismissing the drawer.

#### Scenario: Reverse Tab immediately after opening
- **WHEN** the metrics panel opens and the user presses Shift+Tab
- **THEN** focus stays inside the panel rather than moving to the trigger behind it

#### Scenario: Hardware modal tab cycle
- **WHEN** the hardware drawer opens and the user repeatedly presses Tab or Shift+Tab
- **THEN** focus stays inside the drawer, never on the backdrop or browser chrome

#### Scenario: Drag cancellation is not dismissal
- **WHEN** a keyboard sidebar drag is active and Escape is pressed
- **THEN** the drag cancels and the drawer remains open; a subsequent Escape dismisses it and returns focus

### Requirement: Metric visibility controls fit the viewport
The metric selector SHALL keep its popup within the current viewport at the product's 400x300 minimum and above. Long hardware labels SHALL wrap, and content beyond the available height SHALL be reachable by scrolling without growing the page sideways.

#### Scenario: Short window with many cards
- **WHEN** the metrics panel opens at 400x300 with more items than fit vertically
- **THEN** the popup stays within the viewport and every item is keyboard reachable inside its scroll area

### Requirement: Missing samples are not reported as zero
Window summaries and network rates SHALL show unavailable readings when no finite sample exists, rather than inventing zero throughput or a zero utilization range.

#### Scenario: Null-only history window
- **WHEN** a card's entire visible series is null or empty
- **THEN** its rate and range summary show unavailable markers rather than 0 or 0.0%
