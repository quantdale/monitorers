## Why

A 2026-07-25 engineering audit of `sys-monitor-tauri` flagged five frontend code-quality findings (CQ-008, CQ-009, CQ-010, CQ-011, CQ-013), all re-verified as still open against current source in a follow-up `/opsx:explore` session. Each is a small, self-contained duplication or fragility issue in `src/` with no behavior change intended — bundling them avoids five near-trivial PRs while keeping the diff easy to review as one pass over the frontend's known duplication clusters.

## What Changes

- **CQ-008**: `MAX_HISTORY`/`HISTORY_LEN` = 3600 is currently hardcoded independently in three places across two languages: `src-tauri/src/collector/mod.rs:20`, `src-tauri/src/state.rs:118`, and `src/hooks/useMetrics.ts:6`. The two Rust constants can be unified into one shared `const` referenced from both files. The TypeScript constant cannot share a literal value across the IPC boundary — document the cross-language invariant with a comment at both definition sites (Rust and TS) pointing at each other, so a future change to one prompts a check of the other, rather than attempting a build-time shared-constant mechanism this project doesn't otherwise have.
- **CQ-009**: `window.__TAURI_INTERNALS__` detection is duplicated inline in both `useMetrics.ts` and `useSettings.ts`. Extract one shared `isTauri()` helper (e.g. in a small shared utils module) and use it in both.
- **CQ-010**: `App.tsx`'s `renderCard()` (a 172-line, 5-branch dispatcher, `App.tsx:198-369`) and `getCardLabel()` (`App.tsx:148-167`) both contain the same label-fallback formatter duplicated verbatim within `getCardLabel`. Extract the shared fallback-formatting logic into one function.
- **CQ-011**: `useMetrics.ts`'s real `metrics-update` listener (`useMetrics.ts:249-289`) and the browser-mock `setInterval` path (`useMetrics.ts:302-339`) duplicate ~35-40 lines of identical state-application logic (`setMemGb`/`setNvidiaStats`/`setGpuMeta`/`setLatestCpu`/`setLatestGpu`/`shouldCommitHistory`+`setHistory`). Extract the shared per-snapshot state-application logic into one function called from both the real listener and the mock interval.
- **CQ-013**: `MetricCard.tsx:1` imports `SyntheticListenerMap` from dnd-kit's internal `@dnd-kit/core/dist/hooks/utilities` path instead of its public export. Switch to the public export path (or, if dnd-kit does not publicly export this type, an equivalent locally-defined type alias) so a minor/patch dnd-kit release can't silently break the build by relocating an internal path.

No IPC schema changes. No behavior changes are intended anywhere in this batch — all five are refactors/extractions that must produce byte-identical runtime behavior (same rendered labels, same history-append timing, same mock-vs-real data flow, same TypeScript compiled output shape).

## Capabilities

### New Capabilities
- `frontend-code-deduplication`: formalizes, as a durable requirement, that cross-cutting frontend logic (history-buffer capacity, Tauri-runtime detection, card-label fallback formatting, and per-snapshot state application) has exactly one implementation each — not independently reimplemented in multiple call sites that must be kept in sync by hand. No such capability currently exists in `openspec/specs/`; this change both fixes the four confirmed duplication sites and records the rule so future duplication of the same kind is a spec violation, not just a style nit.

### Modified Capabilities
(none — no existing spec in `openspec/specs/` currently covers frontend code-organization/duplication)

## Impact

- **Code**: `sys-monitor-tauri/src-tauri/src/collector/mod.rs`, `src-tauri/src/state.rs` (CQ-008's Rust-side constant unification), `sys-monitor-tauri/src/hooks/useMetrics.ts`, `src/hooks/useSettings.ts` (CQ-009), `src/App.tsx` (CQ-010), `src/components/MetricCard.tsx` (CQ-013). Possibly one new small shared-utils file (e.g. `src/utils/tauri.ts` or similar) for CQ-009's `isTauri()` helper, depending on what already exists in `src/utils.ts`.
- **APIs/schema**: none.
- **Dependencies**: none added or removed; CQ-013 only changes which existing dnd-kit export is imported.
- **Tests**: Rust baseline currently 77 tests (unaffected by CQ-008's Rust-side change, which is a pure constant reference, not new logic). Frontend baseline currently 46 tests — expect no drop; existing tests for `appendToHistory`, `shouldCommitHistory`, `mergeLatestGpu`, label formatting, etc. must continue passing unchanged since their behavior doesn't change, only where the code lives. `npx tsc --noEmit` must stay clean throughout (particularly relevant for CQ-013's type-import change).
- **Out of scope**: everything else in the wider audit backlog. This is one of several independent batches from the same explore session; `fix-collector-code-hygiene` (Rust-only) and the others share no files with this one.
