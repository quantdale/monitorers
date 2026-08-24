## ADDED Requirements

### Requirement: Recovery journeys join the mock lane with full assertion strength
The simulation platform SHALL include at least two recovery journeys driven through the scriptable bridge: (1) normal monitoring → collector interruption → recovering UI → automatic restoration → subsequent settings/history interaction proving the app remains usable; and (2) retry exhaustion → persistent failure UI → manual retry success. Journeys SHALL produce meaningful assertions, preserve the existing zero-assertion/pageerror/console-error protections, and remain deterministic under the seeded engine.

#### Scenario: Interruption journey proves continued usability
- **WHEN** the recovery-interruption journey runs
- **THEN** it asserts the transient recovery state, automatic clearing after restoration, truthful retention of last-known values during the interruption window, and that a post-recovery settings/history interaction succeeds

#### Scenario: Exhaustion journey exercises manual retry
- **WHEN** the retry-exhaustion journey runs
- **THEN** it asserts the persistent failed state appears only after the budget is exhausted, that activating Retry metrics restores live collection, and that no unexpected browser errors occurred

### Requirement: Browser-mode bridge exposes lifecycle controls without production reach
The scriptable mock backend MAY synthesize lifecycle status sequences for journeys; this surface SHALL remain confined to browser (non-Tauri) mode exactly like existing faults, so packaged/production builds gain no fault trigger from it.

#### Scenario: Bridge lifecycle faults are browser-only
- **WHEN** the app runs in a real Tauri context
- **THEN** no module under the simulation bridge executes and no lifecycle fault injection exists in the shipped backend
