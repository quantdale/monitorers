## Context

Four independent prose corrections across three files, none touching code. The one recurring theme worth designing around (not just fixing) is DOC-003: this is the *second* time root `CLAUDE.md`'s test-count claim has gone stale (once at audit time, corrected, then stale again after two more merges) — worth a design decision about how to phrase the fix so it doesn't imply false precision that immediately decays again.

## Goals / Non-Goals

**Goals:**
- All four stale/incorrect doc claims are corrected to match current, re-verified reality at time of writing this change.
- The `project-documentation-accuracy` capability's scenarios describe *what must stay true*, not just today's specific numbers, so it remains meaningful after the numbers next change (which they will).

**Non-Goals:**
- Not building any automated doc-linting/CI-check that enforces this going forward (e.g. a script that greps for test counts and fails if they don't match `cargo test`'s actual output) — that would be a reasonable follow-up but is a code/CI change, not a docs sweep; out of scope here.
- Not touching `.cursor/commands/check.md` — established out of scope by the `fix-dependency-audit` precedent (gitignored, non-durable).

## Decisions

- **DOC-003 phrasing**: state the counts as of this change's merge, but phrase surrounding text to acknowledge they're a snapshot (e.g. "as of the latest merged change" or similar), consistent with how `CLAUDE.md`'s CI section already frames things as current invariants rather than one-time facts. This doesn't prevent future drift, but avoids overstating the durability of a number that history shows changes every time a Rust or frontend test is added.
- **DOC-004 rewrite scope**: replace `.cursorrules`' entire "CI" section body with the three-job description, mirroring root `CLAUDE.md`'s own "CI readiness gate" section's content (already correct, per the `fix-dependency-audit` change's own verification) rather than writing new prose from scratch — keeps the two files' CI descriptions consistent with each other going forward.
- **DOC-005 Node version**: state the CI-verified requirement (Node 20, per `.github/workflows/rust.yml`) rather than guessing a broader compatible range — the audit's own recommendation was to state what the toolchain *actually requires*, and the only ground truth available is what CI uses, since no `engines` field exists in `package.json` to check against.

## Risks / Trade-offs

- [Risk: this change's own stated test counts (77/46) drift stale again before or shortly after merge, if another change lands concurrently] → Mitigation: task list requires re-running `cargo test --verbose`/`npm test -- --run` immediately before finalizing this change's doc edits, not relying on the number already established in this proposal — treat the number in this document as provisional until reconfirmed at implementation time.

## Migration Plan

Not applicable — pure documentation edit, no code, no schema, no rollout.

## Open Questions

None.
