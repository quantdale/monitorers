## ADDED Requirements

### Requirement: Drag handles are visible when keyboard-focused
Every drag handle in the application (main dashboard cards and hardware sidebar cards) SHALL be visually revealed when it receives keyboard focus, not only on mouse hover.

#### Scenario: Tabbing to a card's drag handle
- **WHEN** a keyboard user tabs focus onto a card's drag handle
- **THEN** the handle becomes visible (not `opacity: 0`), independent of mouse hover state

#### Scenario: Focus ring is not globally suppressed
- **WHEN** a keyboard user tabs to any focusable button in the app
- **THEN** a visible focus indicator is shown, even though the app suppresses the default mouse-click focus ring

### Requirement: Card reordering is operable via keyboard with predictable movement
Both `DndContext`s in the application (main dashboard, hardware sidebar) SHALL configure a keyboard sensor with sibling-aware coordinate movement, so that keyboard-driven reordering moves a card to the next/previous position rather than an arbitrary pixel offset.

#### Scenario: Keyboard-driven reorder in the main dashboard
- **WHEN** a keyboard user activates a focused drag handle in the main dashboard and presses an arrow key
- **THEN** the card moves to the adjacent sibling position in the grid, not a fixed pixel distance

#### Scenario: Keyboard-driven reorder in the hardware sidebar
- **WHEN** a keyboard user activates a focused drag handle in the hardware sidebar and presses an arrow key
- **THEN** the card moves to the adjacent sibling position in the sidebar list, not a fixed pixel distance

### Requirement: Drag handles have a correct accessible name
Every drag handle SHALL expose "Drag to reorder" (or equivalent) as its accessible name to assistive technology, regardless of what visual glyph or icon it renders.

#### Scenario: Main dashboard card's handle accessible name
- **WHEN** a screen reader encounters the main dashboard's card drag handle
- **THEN** it announces "Drag to reorder" (or equivalent), not the literal glyph rendered as its visual content

#### Scenario: Hardware sidebar card's handle accessible name (regression guard)
- **WHEN** a screen reader encounters the hardware sidebar's card drag handle
- **THEN** it continues to announce "Drag to reorder" (or equivalent), preserving its current correct behavior
