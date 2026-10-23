## ADDED Requirements

### Requirement: The all-hidden state offers a way back to the selector
When every metric card is hidden, the empty state SHALL name that condition and SHALL provide a control that opens the existing metric-card selector. The open selector SHALL keep Tab inside its panel.

#### Scenario: Choose metrics opens the selector
- **WHEN** every card is hidden and the user activates the empty-state action
- **THEN** the metric-card visibility dialog opens

#### Scenario: Tab stays in the open selector
- **WHEN** the metric-card visibility dialog is open and focus is on its last checkbox
- **THEN** Tab moves focus to the first checkbox in the dialog instead of leaving the panel
