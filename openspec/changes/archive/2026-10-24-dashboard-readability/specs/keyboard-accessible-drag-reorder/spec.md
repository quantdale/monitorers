## ADDED Requirements

### Requirement: Dashboard reorder handles are visible at rest
Dashboard card reorder handles SHALL be visible without requiring hover or keyboard focus, so a pointer user can discover reorder. Keyboard focus SHALL still show a visible focus indicator.

#### Scenario: Handle is visible before interaction
- **WHEN** a dashboard card is rendered and the pointer is not over it
- **THEN** its reorder handle is visible (not `opacity: 0`)
