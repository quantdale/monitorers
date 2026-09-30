## Context

This repository is operated by agents, and the tracked instruction files are the agents' primary input. `AGENTS.md` and `CLAUDE.md` both declare that `.cursorrules` is "the detailed architectural source of truth" and that "if they ever appear to disagree again, trust the source and fix the docs". That makes drift in `.cursorrules` a correctness problem, not cosmetics.

Three concrete drifts exist today, all verified by reading the committed files:

| Claim | Location | Reality |
|---|---|---|
| `sysinfo 0.33`, `windows 0.61`, `wmi 0.13`, `nvml-wrapper 0.10` | `.cursorrules` §1 Backend row | `Cargo.toml`: `sysinfo = "0.39"`, `windows = { version = "0.62" }`, `wmi = "0.18"`, `nvml-wrapper = "0.12"` |
| `React 18` / `"react": "^18.2.0"`, `TypeScript 5`, `Vite 6` / `"vite": "^6.4.3"`, `"recharts": "^3.8.0"`, `"lucide-react": "^0.460.0"` | `.cursorrules` §1 Frontend/Charts/Icons rows | `package.json`: `react ^19.2.8`, `typescript ^7.0.2`, `vite ^8.2.2`, `recharts ^3.10.1`, `lucide-react ^1.34.0` |
| "Schema version is **4**" | `AGENTS.md` corrected-claims list | `SCHEMA_VERSION: u32 = 5` (`collector/snapshot.rs`), `EXPECTED_SCHEMA_VERSION = 5` (`useMetrics.ts`); `AGENTS.md`'s own IPC section says 5 |
| `registry.commit_all` is "gated inside `if let Some(ref r) = raw`" | `.cursorrules` §2 invariant list | `collector/run_loop.rs`: the call is a sibling of the `if let Some(ref r) = raw` block, not nested in it |
| "E2E … 12 tests expected" | `.cursorrules` §CI + `CLAUDE.md` commands | 14 `test()` blocks across `e2e/tests/*.spec.ts` |

The drift has a root cause worth naming: a *documentation* obligation with no *enforcement* mechanism. Every other project rule in this repo has one — `cargo fmt --check` for formatting, `clippy -D warnings` for lints, `check-version.mjs` for the three release versions, the `project-documentation-accuracy` spec for test counts. Version claims in prose have no gate at all, so they are correct only by luck of timing.

## Goals / Non-Goals

**Goals:**

- Bring the three drifted claims in line with source, and remove the self-contradiction in `AGENTS.md`.
- Replace the hardcoded E2E count with the command that produces it, consistent with the repo's existing "counts are intentionally not duplicated" policy for Rust/frontend unit tests.
- Add a cheap, deterministic check that fails when a documented dependency version disagrees with the committed manifest, wired into a lane CI already runs.

**Non-Goals:**

- Rewriting or restructuring the instruction documents. These are surgical corrections to specific claims; the existing structure, tone, and the "trust the source" policy stay as they are.
- Automatically verifying the free-prose invariant descriptions. The *check* covers the mechanically-verifiable surface (declared versions vs documented versions). The `registry.commit_all` correction is a one-time human fix; general prose verification is not automatable and is out of scope.
- Changing any product source, schema constant, or IPC behaviour.

## Decisions

### D1 — Verify declared-vs-documented versions with a purpose-built script

`scripts/check-version.mjs` already establishes the repo's pattern for "read a manifest, compare a small set of fields, fail loudly": it reads `package.json`, `Cargo.toml`, and `tauri.conf.json` and throws when the three release versions diverge. The version-table check follows that pattern exactly — read the manifests, extract the documented versions from the `.cursorrules` table, compare, throw with a message naming document/field/declared/documented.

- **Alternative considered — generate the table from the manifests at build time.** Rejected: the table must live in a human-edited prose document (agents read it), and code generation into markdown adds a build step and a second source of truth for the same facts.
- **Alternative considered — rely on review discipline only.** Rejected: this exact drift already survived a full, heavily-evidenced campaign (`dependency-runtime-modernization-and-qualification`) that touched every one of these packages. Review discipline is demonstrably insufficient here.
- **Alternative considered — lint all prose claims.** Rejected: unverifiable and unbounded in scope. The script covers the surface where "documented X" has a machine-readable "actual X".

The check should reuse the existing `check-version.mjs` file rather than adding a fourth script: it is the same problem class (documented fact vs committed manifest), and keeping one script keeps the verification entry points learnable. The audit/docs portion should run first in the `frontend()` lane (cheapest, fails fastest) or as its own `verify:docs` step invoked from the same place.

### D2 — Machine-check only the manifest-derived surface; hand-fix the mechanism claims

The version table has a deterministic mapping (documented string ↔ manifest value). The `registry.commit_all` invariant sentence does not: verifying it would require parsing English prose against an AST. So:

- the version table is checked automatically;
- the invariant sentence is corrected by hand, once, and the correction is recorded in this change's evidence.

This split is deliberate: automating only what is honestly automatable keeps the gate trustworthy. A gate that occasionally fails on a prose nuance gets ignored, which is worse than a smaller gate that never does.

### D3 — Remove the hardcoded E2E count rather than updating it to 14

The repo already decided, for Rust and frontend unit-test counts, that "counts are intentionally not duplicated here; use the command results as evidence" (`AGENTS.md`, `.cursorrules` §6, `CLAUDE.md`). The E2E count is the one place that policy was not followed. Bringing it into line is both accurate and self-maintaining.

### D4 — Do not touch `AGENTS.md`'s surrounding structure

`AGENTS.md`'s "Previously-stale claims, now corrected in all three files" list is a useful mechanism — it names claims that were reconciled. The fix is to replace the wrong value (4) with the right one (5) and reword it so the list does not restate a version the IPC section also states. The list keeps its purpose.

## Risks / Trade-offs

- **[The new check is too strict and blocks legitimate work]** → Scope it to exactly the fields the `.cursorrules` table names, keep declared ranges compared by their leading major.minor (so `^19.2.8` and "React 19" agree), and make the failure message state precisely what to update. Accept a false positive found during implementation in preference to silent drift.
- **[`.cursorrules` prose is rewritten and loses information]** → Only the drifted sentences change. The change's evidence records the before/after text for each edited claim so a reviewer can diff intent, not just wording.
- **[A contributor updates the doc but not the manifest (or vice versa) and the check fires spuriously]** → That is the check working. The message names both values.
- **[The check is Windows/POSIX-agnostic and CI-safe]** → It must be plain Node with no new dependency, mirroring `check-version.mjs`, so it runs identically on the `ubuntu-latest` frontend job and the `windows-latest` Rust job.

## Migration Plan

1. Correct the drifted claims in `.cursorrules` and `AGENTS.md` (documentation-only, no behaviour change).
2. Add the documentation-fidelity check alongside `check-version.mjs` and invoke it from the verification lane that CI already runs on every PR.
3. Run the full `verify:frontend` lane; confirm the new check passes against the corrected docs.
4. Deliberately break the check once (edit a documented version in a scratch state) to confirm it fails with a useful message, then restore.
5. Rollback = revert the doc edits and the check wiring; no code, schema, or data impact.

## Open Questions

None. The set of documented versions to check is fixed by what `.cursorrules` §1 currently enumerates, and the check's strictness is a design-level choice already made in D1.
