## ADDED Requirements

### Requirement: Recovery and failure states meet the accessibility contract
Collector recovery and failure surfaces SHALL satisfy the established accessibility rules: recovering announcements use polite live-region semantics, exhausted-failure alerts use assertive semantics, the retry control has an accessible name and remains keyboard operable, focus behavior follows the existing banner conventions, and no new motion is introduced (reduced-motion compatibility is inherent).

#### Scenario: Recovering message does not interrupt
- **WHEN** the recovery banner appears while the user is reading metrics
- **THEN** it is announced politely (`role="status"`) without stealing focus or replacing card content

#### Scenario: Failed alert is announced and actionable
- **WHEN** supervision escalates to `failed`
- **THEN** the alert is announced assertively, its Retry control is reachable by keyboard with a programmatic label matching its visible text
