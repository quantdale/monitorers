## 1. Settings load error handling (ERR-001)

- [ ] 1.1 Wrap `useSettings.ts`'s load IIFE (`Store.load` + the five `s.get()` calls, `useSettings.ts:33-49`) in a `try`/`catch`.
- [ ] 1.2 Add an `error: string | null` (or equivalent) state to the hook, set on catch, returned alongside the existing `loaded` state.
- [ ] 1.3 Update `App.tsx`'s `if (!loaded) return null;` (`App.tsx:139`) to check the new error state first and render a visible message instead of `null` when settings failed to load.

## 2. Settings versioning and per-field validation (ARC-005)

- [ ] 2.1 Add a `settingsVersion` constant (current version) and persist it as one of the settings-store keys.
- [ ] 2.2 On load, treat a missing `settingsVersion` as the earliest known version (not an error) so existing installs' current settings aren't discarded on first run after this change.
- [ ] 2.3 Add a basic shape/type validation check for each persisted field (`cardOrder`, `hiddenCardIds`, `sidebarCardOrder`, `viewMode`, `windowSecs`); on a field failing validation, fall back to that field's compiled-in default and `console.warn` that the fallback was triggered (do not fail the whole settings load for one bad field).
- [ ] 2.4 Confirm the fallback logic does not reject valid-but-unfamiliar values overly aggressively (e.g. a `cardOrder` entry for a GPU/disk not currently present is a valid array of strings, not an invalid shape — leave existing "prune stale ids" behavior, or lack thereof, untouched; that's TEST-005's separate documented gap, not this change's concern).

## 3. History load error handling (ERR-006)

- [ ] 3.1 Add a `historyLoadError: string | null` (or equivalent) field to `useMetrics.ts`'s returned state.
- [ ] 3.2 Update the `get_history()` `.catch()` handler (`useMetrics.ts:239`) to set this field in addition to (or instead of) the existing `console.warn`.
- [ ] 3.3 Update `App.tsx`'s handling of a `null` `history` value to check the new error field and render a distinct message from the normal "Collecting metrics…" placeholder when set.

## 4. Tests

- [ ] 4.1 Add a test for `useSettings` asserting that a `Store.load` rejection sets the error state rather than leaving `loaded` false forever.
- [ ] 4.2 Add a test for the settings validation logic asserting a version mismatch or invalid field falls back to defaults per-field, and that a missing `settingsVersion` is treated as valid (not rejected).
- [ ] 4.3 Add a test for `useMetrics` asserting a `get_history` rejection sets `historyLoadError` rather than only warning to console.

## 5. Verify

- [ ] 5.1 Run `npx tsc --noEmit` from `sys-monitor-tauri/` — confirm clean.
- [ ] 5.2 Run `npm test -- --run` from `sys-monitor-tauri/` — confirm the current baseline of 46 tests still pass, plus the new tests from section 4.
- [ ] 5.3 Manually verify (e.g. via `npm run dev`) that the app still renders normally end-to-end when settings and history load successfully — the new error paths must not change the happy-path experience.
