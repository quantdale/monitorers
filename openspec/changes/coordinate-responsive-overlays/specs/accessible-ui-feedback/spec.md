## ADDED Requirements

### Requirement: The hardware modal has exclusive temporary focus ownership
When the hardware rail becomes a modal drawer, any open metric-visibility popup SHALL close and immediately leave the keyboard/accessibility interaction path. Only the hardware modal's focus boundary SHALL remain active. Closing the drawer or returning to desktop SHALL NOT resurrect the old popup; users SHALL be able to reopen it with their metric selections intact.

#### Scenario: Desktop overlays cross the narrow breakpoint
- **WHEN** the non-modal hardware rail and Metrics popup are both open and the window becomes narrow
- **THEN** the popup deactivates, focus moves to the hardware Close action, and forward/reverse Tab stay in the drawer

#### Scenario: Drawer closes and Metrics opens again
- **WHEN** the user dismisses the drawer and reopens Metrics
- **THEN** the popup opens normally with unchanged selections and Escape returns focus to its trigger

#### Scenario: Window widens again
- **WHEN** the modal presentation returns to the non-modal rail after suspending Metrics
- **THEN** Metrics stays closed until the user explicitly opens it
