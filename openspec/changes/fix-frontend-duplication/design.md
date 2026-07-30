## Context

Five independent duplication/fragility findings in the frontend (`src/`), all confirmed still open against current source. None require a schema change or new capability; all are extract-and-reuse refactors that must preserve exact current behavior. The main design question per finding is *where* to put the extracted shared code, since this codebase has specific conventions (named exports only except `App.tsx`, inline styles only, no new abstraction layers beyond what's needed).

## Goals / Non-Goals

**Goals:**
- Eliminate each of the five duplication/fragility points with the smallest reasonable extraction, preserving current behavior exactly.
- Keep new shared helpers colocated with their existing callers' conventions (named exports, same file or an adjacent small utils file — not a new architectural layer).

**Non-Goals:**
- Not attempting a cross-language shared-constant mechanism for CQ-008 (`MAX_HISTORY`/`HISTORY_LEN` = 3600) — Rust and TypeScript compile independently in this project with no shared-codegen step, so the TS-side `3600` must remain a manually-kept-in-sync literal; this change only reduces the Rust-side duplication (two files) to one shared constant and adds cross-referencing comments so the manual sync point is discoverable.
- Not changing any card-rendering behavior, label text, or history-append timing — CQ-010 and CQ-011 must be behavior-preserving refactors, verified by the existing test suite continuing to pass unchanged.
- Not adopting a new dependency or build step for CQ-013 — just switching which existing dnd-kit export is used.

## Decisions

- **CQ-008**: Unify `MAX_HISTORY` (`collector/mod.rs:20`) and `HISTORY_LEN` (`state.rs:118`) into one `pub(crate) const HISTORY_CAPACITY: usize = 3600` (or similar) in one location (e.g. `state.rs`, since it already owns `HistoryStore`), re-exported/imported by `collector/mod.rs`. For the TypeScript side, add a one-line comment at `useMetrics.ts:6`'s `MAX_HISTORY` declaration referencing the Rust constant's location (and vice versa in Rust), since no build-time cross-language sharing exists in this project — alternative considered: generate the TS constant from Rust via a codegen step, rejected as disproportionate for a single shared integer literal in a project with no existing codegen infrastructure.

- **CQ-009**: Add `isTauri()` to whatever shared frontend utils module already exists (check `src/utils.ts` first — if a general-purpose utils file exists, add it there rather than creating a new file; only create a new file if `utils.ts` is itself feature-specific and unsuitable). Use named export per project convention.

- **CQ-010**: Extract `getCardLabel`'s duplicated fallback formatter (currently copy-pasted verbatim at two call sites within the same function, `App.tsx:150-153` and `163-166`) into a small local helper function within `App.tsx` (not necessarily exported — internal to the file unless another file needs it, which isn't currently the case). `renderCard()`'s 172-line/5-branch structure is not being restructured by this change — the audit's citation of both together is about the label-fallback duplication specifically, not a request to break up the dispatcher itself, which would be a larger, riskier refactor out of scope here.

- **CQ-011**: Extract the ~35-40 line shared state-application block (`setMemGb`/`setNvidiaStats`/`setGpuMeta`/`setLatestCpu`/`setLatestGpu`/`shouldCommitHistory`+`setHistory`) from both the real `metrics-update` listener and the mock `setInterval` path into one function, e.g. `applySnapshot(snap: MetricsSnapshot, setters...)`, called identically from both sites with the same `MetricsSnapshot`-shaped payload (the mock path already constructs a `MetricsSnapshot`-shaped object with its own `on_tick` counter per the prior `fix-history-emission-rate` change, so both call sites already share the same payload shape — this extraction is purely mechanical, not requiring new plumbing).

- **CQ-013**: Import `SyntheticListenerMap` from dnd-kit's public entry point if one exists; if dnd-kit genuinely does not publicly export this type, define an equivalent local type alias (structurally matching what's actually used) in `MetricCard.tsx` or a shared types file, so no import reaches into `dist/`.

## Risks / Trade-offs

- [Risk: CQ-011's extraction subtly changes when/how a setter fires if the real listener and mock path aren't actually identical today] → Mitigation: read both blocks in full and diff them before extracting; if any genuine difference exists (e.g. the mock path's synthetic `on_tick` counter), keep that as a parameter rather than silently unifying it away, matching CQ-012's approach in the sibling `fix-collector-code-hygiene` change.
- [Risk: CQ-013's public dnd-kit export doesn't exist, forcing a local type re-definition that drifts from the real type over a future dnd-kit upgrade] → Mitigation: prefer the public export if `@dnd-kit/core`'s package exports include it; only fall back to a local type alias as a last resort, and note the drift risk in a code comment if that path is taken.
- [Risk: CQ-008's Rust constant unification touches two files (`collector/mod.rs`, `state.rs`) that are also touched by other in-flight batches] → Mitigation: none of this session's other proposed batches edit `MAX_HISTORY`/`HISTORY_LEN`'s declaration lines specifically (confirmed against the fix-collector-code-hygiene, fix-multi-gpu-telemetry-identity, and fix-sensor-registry-scope proposals) — low collision risk, but land in whatever order convenient rather than assuming full independence if those other changes are in flight simultaneously.

## Migration Plan

Not applicable — no data migration, no schema change, no user-facing rollout. Standard PR: implement, run the full local gate (`npx tsc --noEmit`, `npm test -- --run`, plus `cargo test`/`cargo fmt`/`cargo clippy` for CQ-008's Rust half), commit.

## Open Questions

- Does `src/utils.ts` (or equivalent) already exist as a general-purpose shared module, or would CQ-009's `isTauri()` need a new file? Resolve during implementation by reading current `src/` structure — not a blocking design decision either way.
