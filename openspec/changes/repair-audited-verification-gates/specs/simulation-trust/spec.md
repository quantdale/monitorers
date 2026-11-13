## ADDED Requirements

### Requirement: Card readiness includes required core metrics
A simulation readiness assertion SHALL require both its minimum card count and its expected card set, defaulting to CPU, memory and network. Customization journeys SHALL supply the saved visible set after hiding cards. Reaching the count without the expected set SHALL fail after the readiness deadline.

#### Scenario: Dynamic cards conceal missing core cards
- **WHEN** enough disk/GPU cards render but a required core card is absent through the deadline
- **THEN** the readiness assertion fails

#### Scenario: A core card was deliberately hidden
- **WHEN** a customization journey restarts with a core card hidden in its saved visible set
- **THEN** readiness requires the entire saved visible set and does not require the hidden card

### Requirement: Screenshot capture releases its timeout handle
Failure-screenshot finalization SHALL cancel its timeout when capture settles and remain bounded when capture hangs.

#### Scenario: Screenshot completes promptly
- **WHEN** a failure screenshot is captured before its deadline
- **THEN** the timer is released immediately rather than keeping the worker alive
