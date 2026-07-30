## 1. Unify history capacity constant (CQ-008)

- [ ] 1.1 Introduce one shared Rust `const` (e.g. `HISTORY_CAPACITY: usize = 3600`) referenced by both `collector/mod.rs`'s `MAX_HISTORY` and `state.rs`'s `HISTORY_LEN` use sites, removing the duplicate literal.
- [ ] 1.2 Add a comment at the Rust constant's definition cross-referencing `useMetrics.ts`'s `MAX_HISTORY`, and a comment at `useMetrics.ts:6`'s `MAX_HISTORY` cross-referencing the Rust constant's location.

## 2. Shared isTauri() helper (CQ-009)

- [ ] 2.1 Check whether `src/utils.ts` (or an equivalent existing shared module) is a suitable home for a general-purpose helper; if so add `isTauri()` there, otherwise create a small new shared module.
- [ ] 2.2 Replace the inline `window.__TAURI_INTERNALS__` check in `useMetrics.ts` with a call to the shared `isTauri()`.
- [ ] 2.3 Replace the inline `window.__TAURI_INTERNALS__` check in `useSettings.ts` with a call to the same shared `isTauri()`.

## 3. Deduplicate card label fallback formatting (CQ-010)

- [ ] 3.1 Read `getCardLabel` (`App.tsx:148-167`) in full; extract the verbatim-duplicated fallback formatter into one internal helper function.
- [ ] 3.2 Update both call sites within `getCardLabel` to use the extracted helper; confirm `renderCard()` (`App.tsx:198-369`) is otherwise unchanged.

## 4. Deduplicate snapshot state-application logic (CQ-011)

- [ ] 4.1 Read the real `metrics-update` listener block (`useMetrics.ts:249-289`) and the mock `setInterval` block (`useMetrics.ts:302-339`) in full; diff them to confirm they are (or should be) identical aside from the data source.
- [ ] 4.2 Extract the shared state-application logic (`setMemGb`/`setNvidiaStats`/`setGpuMeta`/`setLatestCpu`/`setLatestGpu`/`shouldCommitHistory`+`setHistory`) into one function taking a `MetricsSnapshot`-shaped payload and the relevant setters.
- [ ] 4.3 Update both the real listener and the mock interval to call the extracted function.

## 5. Fix dnd-kit internal import (CQ-013)

- [ ] 5.1 Check whether `@dnd-kit/core`'s public exports include `SyntheticListenerMap` (or an equivalent public type); if so, update `MetricCard.tsx:1`'s import to use it.
- [ ] 5.2 If no public export exists, define a local structurally-equivalent type alias in `MetricCard.tsx` (or a shared types file) instead of importing from `@dnd-kit/core/dist/hooks/utilities`.

## 6. Verify

- [ ] 6.1 Run `npx tsc --noEmit` from `sys-monitor-tauri/` — confirm clean, particularly after CQ-013's type-import change.
- [ ] 6.2 Run `npm test -- --run` from `sys-monitor-tauri/` — confirm the current baseline of 46 tests still pass unchanged.
- [ ] 6.3 Run `cargo test --verbose` and `cargo fmt -- --check` from `src-tauri/` — confirm the current baseline of 77 tests still pass and formatting stays clean after CQ-008's Rust-side constant unification.
- [ ] 6.4 Manually sanity-check (via `npm run dev` or `npm run tauri dev`) that card labels, mock data, and real data still render identically to before this change.
