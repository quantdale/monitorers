## ADDED Requirements

### Requirement: Monitoring controls expose complete accessible state
Time-range selection SHALL have an accessible name; sidebar toggles SHALL expose `aria-label`, `aria-expanded`, and `aria-controls`; metric selectors SHALL expose popup relationship and return focus on Escape; errors/statuses SHALL use appropriate non-repetitive live-region semantics; view-mode buttons SHALL have a labeled group.

#### Scenario: Time range is discoverable
- **WHEN** assistive technology queries the time-range select
- **THEN** it finds it by the accessible name “History time range” or an equivalent label

#### Scenario: Sidebar state is exposed
- **WHEN** the sidebar is open or closed
- **THEN** the toggle's expanded state and controlled sidebar ID match the rendered state

### Requirement: Loading and failures are visible and motion-aware
Settings loading SHALL render a minimal accessible status rather than a blank root; settings, history, and hardware-profile failures SHALL render recoverable messages/retry state. Nonessential transitions SHALL honor `prefers-reduced-motion`.

#### Scenario: Settings load is pending
- **WHEN** settings have not loaded
- **THEN** the root contains an accessible loading/status message

#### Scenario: Hardware profile refetch fails then recovers
- **WHEN** a profile fetch fails and a later retry succeeds
- **THEN** the sidebar shows a recoverable error during failure and the profile after recovery without a repeated error loop
