## Context

The hook owns independent history and live effects, a retained history ref, request generations and disposed-listener fences. Error composition already distinguishes four sources, but there is no way to reattach failed subscriptions. A successful history response also incorrectly clears an unrelated live-schema error. See proposal.md for the user-facing problem.

## Goals / Non-Goals

Goals: recover in place, retain user state, give truthful pending/error feedback, and preserve clock/history/lifecycle contracts. Non-goals: restarting a healthy collector, bypassing incompatible payloads, changing persisted data or restyling the dashboard.

## Decisions

1. A hook-owned connection revision replaces the subscription effect on explicit retry. Its settlement releases the history request for that revision. This closes the reconnect gap by reading the ring after listener registration attempts, while preserving the initial-load behavior and existing live-event reconciliation. A full page reload was rejected because it discards in-memory settings and chart state.
2. Separate history/subscription pending flags disable duplicate retries; a synchronous ref fences repeated activations before React renders. Old effect callbacks and old history requests remain fenced. Valid history clears only history errors; valid live/status payloads clear their respective schema errors; successful listener attachment clears only subscription errors.
3. One error presentation covers both empty and retained-data states. It uses the existing danger tint/text/border, shared Button, 36px control target, wrapping content and plain Retry connection copy. No extra caption is needed. On success, keyboard focus returns to the history-range control only if the user has not moved elsewhere.
4. History and subscription attempts have ten-second deadlines. A deadline settles the attempt as failed without abandoning raw listener ownership, and disposal clears owned timers. Successful registrations after a timed-out group do not silently clear its failure; explicit retry establishes a fully checked connection. Ten seconds is comfortably above normal local IPC latency while bounding an otherwise permanent pending state.
5. Bootstrap scalars distinguish unknown from a real zero. CPU falls back to the newest historical sample until a live snapshot exists; memory sizes use the existing finite-safe unavailable formatter until observed. Remove browser-history fixture writes that overwrite the most recent live memory sizes during refetch.

### Reference lock and decision ledger

Designing connection recovery for Windows desktop users monitoring live hardware. Primary task: recover useful metrics without disrupting the dashboard. Direct build against the existing product design system.

| Decision | Source | Role and adaptation |
| --- | --- | --- |
| Preserve dark canvas, Segoe/Cascadia type, lime interaction accent and danger feedback tokens | Current product and Linear style `3affd07f-e21e-46a4-8aee-26accba689a6` | Existing product is the primary lock; borrow compact controls and restrained surfaces only. Linear's acid proof color remains a proof-card role and is not imported. |
| One explicit retry beside the failure | Wynde screen `6f4d3d78-c20c-49d8-bd44-c1bf775d5c8a` and Shuttle screen `63e5401b-24c1-4d56-b253-f0c6905af5af` | Both show a clear error plus Try again. Adapt this recovery affordance, retaining this product's page and last-good data. Captures do not prove pending/focus behavior; those are engineering acceptance criteria. |
| Keep lime sparse and functional | Existing product; ClickHouse style `e53b1f69-b012-487e-b7d4-56427b19f2f4` | Borrow deliberate action emphasis only; reject marketing scale, highlighter decoration, new fonts, media and exact source colors. |

## Risks / Trade-offs

- Reconnection can overlap late listener removal → dispose before replacement; guard callbacks and remove late registrations.
- History can race live events → reuse sequence replay and request generation fences.
- A history success can hide ongoing stream incompatibility → clear only the proven channel; add cross-channel regression tests.
- Retrying during backend failure does not repair the collector → keep the separate existing Retry metrics action and supervised lifecycle behavior.
- Real hardware faults cannot be injected through shipped config → cover failures with IPC mocks/browser bridge and qualify successful native reconnect via CDP without production fault endpoints.
