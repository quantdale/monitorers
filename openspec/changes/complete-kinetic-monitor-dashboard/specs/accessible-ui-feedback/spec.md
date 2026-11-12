## MODIFIED Requirements

### Requirement: Recovery and failure states meet the accessibility contract
Collector recovery and failure surfaces SHALL satisfy the established accessibility rules: recovering announcements use polite live-region semantics, exhausted-failure alerts use assertive semantics, the retry control has an accessible name and remains keyboard operable, and focus behavior follows the existing banner conventions. Decorative feedback SHALL honor reduced-motion preferences, SHALL NOT delay announcements or input, and SHALL NOT animate live chart data.

#### Scenario: Recovering message does not interrupt
- **WHEN** the recovery banner appears while the user is reading metrics
- **THEN** it is announced politely (`role="status"`) without stealing focus or replacing card content

#### Scenario: Failed alert is announced and actionable
- **WHEN** supervision escalates to `failed`
- **THEN** the alert is announced assertively, its Retry control is reachable by keyboard with a programmatic label matching its visible text

#### Scenario: Reduced-motion recovery feedback
- **WHEN** the user requests reduced motion and collection is recovering or failed
- **THEN** feedback remains visible and announced without decorative movement or repeated animation
