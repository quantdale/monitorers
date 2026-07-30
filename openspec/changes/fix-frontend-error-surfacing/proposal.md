## Why

A 2026-07-25 engineering audit flagged three frontend findings (ERR-001, ARC-005, ERR-006), all re-confirmed still open against current source in a follow-up `/opsx:explore` session. All three share the same failure shape: a promise rejection or an invalid persisted value is silently swallowed or under-handled, leaving the UI stuck in a state indistinguishable from normal loading, with zero diagnostic signal to the user or a future debugger. ERR-001 is High severity because its failure mode is a permanently blank app (not even the "Collecting metrics…" fallback renders) triggered by a single `Store` failure that both `App.tsx` and `HardwareSidebar.tsx` can independently hit via their own `useSettings()` mounts.

## What Changes

- **ERR-001**: `src/hooks/useSettings.ts:33-49`'s settings-load IIFE (`Store.load` + five `s.get()` calls) has no `try`/`catch` and no `.catch()`. If any awaited call rejects, the rejection is unhandled, `setLoaded(true)` (line 48) is never reached, and `App.tsx:139`'s `if (!loaded) return null;` renders nothing, forever — `ErrorBoundary` can't help since it only catches synchronous render errors, not `useEffect` promise rejections. Wrap the load logic in `try`/`catch`; on failure, set an explicit error state (not just `loaded = true` with defaults, and not a silent fallback) so the caller can render a visible, actionable error rather than a blank screen forever.
- **ARC-005**: `settings.json` (persisted via `useSettings.ts:7-13,36-46`) has no schema-version field (unlike the IPC payloads, which carry `schema_version`) and no runtime validation on read — a stale or invalid stored value (e.g. from an older app version, or manual/corrupted edits to `settings.json`) degrades silently rather than resetting to defaults. Add a `settingsVersion` field to the persisted shape, and validate each read value's shape/type before use; on a version mismatch or invalid value, fall back to defaults for that field rather than propagating an invalid value into app state.
- **ERR-006**: `src/hooks/useMetrics.ts:207` (state) / `:239`'s `get_history()` `.catch((err) => console.warn(...))` leaves `history` as `null` forever on rejection — visually indistinguishable from the normal "still loading" state. Surface a distinct error state (e.g. a `historyLoadError` field) that the UI can render differently from "still collecting metrics."

These three are bundled because ERR-001 and ARC-005 touch the exact same function (`useSettings.ts`'s load IIFE) — implementing them separately would mean two passes over the same code. ERR-006 shares the identical failure shape (a data-load promise rejection silently leaves the UI in an ambiguous stuck state) in a sibling hook (`useMetrics.ts`), so the same "surface a distinct, visible error state instead of swallowing/misclassifying the rejection" fix pattern applies directly.

## Capabilities

### New Capabilities
- `frontend-data-load-resilience`: formalizes, as a durable requirement, that the frontend's two async data-load paths (settings via `useSettings.ts`, metrics history via `useMetrics.ts`) must surface load failures as a distinct, visible error state rather than leaving the UI silently stuck in a state indistinguishable from normal loading — and that persisted settings are versioned and validated on read rather than trusted as-is. No such capability currently exists in `openspec/specs/`.

### Modified Capabilities
(none)

## Impact

- **Code**: `sys-monitor-tauri/src/hooks/useSettings.ts`, `src/hooks/useMetrics.ts`, `src/App.tsx` (to render the new error states where `!loaded`/`!history` are currently checked).
- **APIs/schema**: no Rust/Tauri IPC schema changes. `settings.json`'s own (frontend-only, store-plugin-persisted) shape gains a `settingsVersion` field — this is not part of the Rust `MetricsSnapshot`/`HistoryPayload` IPC contract and does not touch `SCHEMA_VERSION`.
- **Dependencies**: none added or removed.
- **Tests**: Frontend baseline currently 46 tests. Expect this to grow — new tests should cover: `useSettings`'s load-failure path setting an error state instead of hanging; a version-mismatch/invalid-value case falling back to defaults per field; `useMetrics`'s `get_history` rejection setting a distinct error field. `npx tsc --noEmit` must stay clean throughout.
- **Out of scope**: everything else in the wider audit backlog. This is one of several independent batches from the same explore session and shares no files with the others except that `HardwareSidebar.tsx` (not directly edited here) also calls `useSettings()` and will benefit from ERR-001's fix automatically since the hook itself is what's being fixed.
