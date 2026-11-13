## Why

The audit found verification paths that can report incomplete core UI readiness as success, and an advisory-watch job whose read-only token cannot create its required issue. Failure screenshots also leave their timeout alive after capture completes.

## What Changes

- Require the simulation's expected card set as well as its minimum card count, defaulting to CPU/memory/network and explicitly honoring saved visibility during customization.
- Grant only the advisory-watch job the issue-write permission its existing reporting behavior requires.
- Release failure-screenshot timeout handles when capture finishes.
- Add regressions and validate the workflow configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `simulation-trust`: readiness success requires all declared core UI conditions.
- `dependency-vulnerability-audit`: advisory reporting has the required scoped permission.

## Impact

Simulation step/runner helpers, unit seams and advisory-watch workflow. No application UI or metrics behavior changes.
