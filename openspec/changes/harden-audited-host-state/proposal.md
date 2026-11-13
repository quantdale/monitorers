## Why

The audit found that registry query failures are interpreted as confirmed absence, and the packaged driver overwrites and later deletes a pre-existing machine-wide WebView2 policy. The Rust lockfile also retains a Tokio release with an available advisory fix.

## What Changes

- Share a fail-closed registry read between the driver and post-run policy assertion, with tests for operational errors.
- Refuse to overwrite an existing wildcard policy that this driver does not own; preserve ownership when a subsequent write fails.
- Update Tokio to the in-range patched release and document the remaining target-specific warnings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-lane-host-cleanup`: require definite absence and preserve pre-existing host values.

## Impact

Packaged verification driver, registry assertion script, regression tests, and Cargo.lock. No application features, registry mutations outside the existing verification channel, or new dependencies.
