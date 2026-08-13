## Purpose

Defines the accessibility contract for status/loading messages and dismissable popover controls in the dashboard: WCAG AA contrast for status text, Escape dismissal plus ARIA state exposure for dropdowns, and an empty-state that reflects the actually-visible card list rather than the raw persisted order.
## Requirements
### Requirement: Status and loading messages meet WCAG AA contrast
Text used for status/loading messages (e.g. "Collecting metrics…", "Detecting hardware…") SHALL have a contrast ratio of at least 4.5:1 against its actual rendered background.

#### Scenario: Main dashboard loading message
- **WHEN** the "Collecting metrics…" message is rendered against the main dashboard's background
- **THEN** its text color achieves at least 4.5:1 contrast against that background

#### Scenario: Hardware sidebar loading message
- **WHEN** the "Detecting hardware…" message is rendered against the hardware sidebar's background
- **THEN** its text color achieves at least 4.5:1 contrast against that background

### Requirement: Dismissable dropdowns support Escape and expose state to assistive technology
Any dropdown/popover control in the app that can be dismissed by clicking outside it SHALL also be dismissable via the Escape key, and its trigger SHALL expose its open/closed state via `aria-expanded` and its popup relationship via `aria-haspopup`.

#### Scenario: Escape closes the card selector dropdown
- **WHEN** the card selector dropdown is open and the user presses Escape
- **THEN** the dropdown closes

#### Scenario: Trigger button exposes ARIA state
- **WHEN** the card selector dropdown is open or closed
- **THEN** its trigger button's `aria-expanded` attribute reflects that state, and the trigger carries `aria-haspopup`

### Requirement: Empty-state messaging reflects visible cards, not the full persisted order
The application SHALL show its empty-state message whenever no cards are actually visible, determined by the same filtered list used to render cards — not by the raw persisted card-order list, which may be non-empty even when every card it references is hidden or absent.

#### Scenario: All cards hidden via the card selector
- **WHEN** a user hides every card via the card selector, leaving the persisted card-order list non-empty but every entry hidden
- **THEN** the empty-state message is shown, not a blank canvas

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
