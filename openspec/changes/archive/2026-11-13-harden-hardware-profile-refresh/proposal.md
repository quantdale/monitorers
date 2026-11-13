## Why

Hardware-profile notifications currently disappear when a profile request is in flight, and the bootstrap fetch starts before the notification listener attaches. A single enrichment or device-set change can therefore leave the hardware sidebar stale indefinitely.

## What Changes

- Attach the profile listener before bootstrap and serialize refreshes with one coalesced trailing fetch.
- Ignore notifications/responses belonging to a disposed effect, including delayed listener registration.
- Surface subscription failures through the existing retryable profile error state while retaining the last good profile.
- Add deterministic race and cleanup regressions.
- Fence equivalent disposed metrics/status/error callbacks and remove remaining wall-clock history fallbacks, exposed by the sibling-path review.
- Cancel obsolete settings bootstrap work so StrictMode replay cannot overwrite subsequent user edits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `frontend-data-load-resilience`: require lossless, lifecycle-safe hardware-profile refreshes.

## Impact

Hardware-profile, metrics and settings hooks and their tests. No IPC/schema, collector, dependency, persisted settings shape, or visual design changes.
