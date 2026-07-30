## Context

Both `useSettings.ts` and `useMetrics.ts` follow the same pattern: an async IIFE or invoke-chain runs once on mount, and a boolean/nullable flag (`loaded`, `history`) gates what `App.tsx` renders. Neither hook currently has a way to represent "the load failed" as distinct from "the load hasn't finished yet" — both look identical to the consuming component today. This change adds that missing third state to both hooks, plus versions/validates the settings payload specifically (ARC-005), since that's the one of the two persistence surfaces with no schema-version concept at all (unlike the IPC payloads, which already carry `schema_version`).

## Goals / Non-Goals

**Goals:**
- Every async data-load path the frontend depends on for initial render (settings, history) can represent and surface a distinct failure state.
- `App.tsx` renders something actionable (not a blank screen) when either load path fails.
- Persisted settings values are validated before use; invalid or version-mismatched values fall back to per-field defaults rather than propagating garbage into app state or silently doing nothing.

**Non-Goals:**
- Not adding retry/backoff logic for either load path — surfacing the failure clearly is the fix; automatic retry is a separate, larger concern (parallel to how ARC-002's restart-supervision is explicitly deferred elsewhere in this backlog).
- Not changing the Rust-side IPC `SCHEMA_VERSION`/`MetricsSnapshot` contract — `settingsVersion` is a frontend-only, `settings.json`-scoped concept, independent of the Tauri IPC schema.
- Not redesigning `useSettings`'s or `useMetrics`'s overall data flow beyond adding the error-state field and the validation step.

## Decisions

- **Error state shape**: for both hooks, add a nullable `error: string | null` (or a small discriminated-union state) alongside the existing `loaded`/`history` state, rather than overloading `loaded`/`history` themselves to also mean "failed." This keeps "loading," "loaded successfully," and "failed" as three distinct, independently checkable states in the returned hook value, so `App.tsx` can render three distinct UI states instead of inferring failure from an absence.

- **ERR-001's catch scope**: wrap the entire load IIFE body (both `Store.load` and all five `s.get()` calls) in one `try`/`catch`, not per-call error handling — a failure at any step means settings can't be trusted as loaded, and the existing code already treats the five `get()` calls as one atomic "load settings" unit (they all gate the same `setLoaded(true)`). Alternative considered: catch each `s.get()` independently and fall back to defaults per-field even on partial failure — rejected as overengineering for what the audit and current behavior treat as one atomic load operation; if `Store.load` itself fails, no field can be individually recovered anyway.

- **ARC-005's versioning approach**: add `settingsVersion: number` as one of the stored keys (alongside `cardOrder`, `hiddenCardIds`, etc.), read and checked first on load. On mismatch (or on any individual field failing a basic shape/type check — e.g. `cardOrder` not being a string array), fall back to that field's compiled-in default rather than treating the whole settings load as failed (distinct from ERR-001's failure mode, which is a *load* failure, not an *invalid-value* condition). This mirrors the granularity the audit's original wording implies ("stale/invalid stored value degrades... rather than resetting to defaults") — per-field graceful degradation, not an all-or-nothing reset.

- **ERR-006's error field**: add `historyLoadError: string | null` to `useMetrics`'s returned `SlicedHistory`-adjacent state (or `null` overall return value's sibling), set from the existing `get_history()` `.catch()` handler instead of only `console.warn`-ing. `App.tsx` can then render a distinct message (e.g. "Couldn't load metrics history — try restarting the app") instead of the perpetual "Collecting metrics…" placeholder.

## Risks / Trade-offs

- [Risk: ARC-005's per-field default-fallback silently discards a user's real customization if the validation logic has a bug and incorrectly rejects a valid value] → Mitigation: keep the validation checks minimal and permissive (type/shape only — e.g. "is this an array of strings," not deep semantic validation like "does this card id still exist," which is a separate, already-documented gap — TEST-005's "cardOrder never prunes stale ids" — not being fixed here). Log (console.warn, consistent with existing patterns) when a fallback is triggered so it's diagnosable if it fires unexpectedly.
- [Risk: adding a new error-rendering branch to `App.tsx` for two new states increases the component's already-large conditional surface] → Mitigation: keep each new branch minimal (a single message, not a full new UI section), consistent with the existing "Collecting metrics…" placeholder's simplicity.

## Migration Plan

`settingsVersion` is new — existing installs have no such field in their persisted `settings.json`. Treat its absence as version `0` (or equivalent "unversioned, needs one-time validation") rather than an error, so existing users' current settings load normally on first run after this change (validated once, not reset) rather than losing their saved card order/layout. No other migration concerns — no Rust/IPC change, no data migration beyond this one frontend-local, backward-compatible addition.

## Open Questions

None — the three findings have a clear, low-risk resolution path that doesn't require a maintainer decision beyond reviewing the diff and the exact wording of the new error-state UI messages.
