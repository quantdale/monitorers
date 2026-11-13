## Context

The hook fetches the current backend profile when an invalidation event arrives. Backend events carry no profile payload. Requests are asynchronous; only this hook owns sidebar profile state. See proposal.md for the observed gaps.

## Goals / Non-Goals

Goals: eventual convergence after every notification, bounded concurrent work, retained good data, safe effect disposal and retry.

Non-goals: polling, IPC changes, collector changes, or a new shared async abstraction.

## Decisions

- Subscribe before the bootstrap fetch so changes in the subscription gap are included by bootstrap.
- Keep one request active and one dirty bit. Notifications during the active request set the bit; settlement starts one trailing request. Dropping notifications causes stale state; overlapping fetches require ordering fences and unbounded request work.
- Guard callbacks and settlement by effect-local cancellation. Dispose delayed registrations once resolved. StrictMode and explicit retry must not revive old work.
- Keep the existing profile on all failures. A subscription error is visible and retryable; still attempt one bootstrap read so useful hardware details are available despite a broken subscription.

## Risks / Trade-offs

Continuous invalidations can require successive fetches, but concurrency stays at one per active effect. Backend errors do not automatically retry without a fresh notification or user retry, avoiding a retry storm. Tests defer registration and request settlement instead of depending on timing sleeps.
