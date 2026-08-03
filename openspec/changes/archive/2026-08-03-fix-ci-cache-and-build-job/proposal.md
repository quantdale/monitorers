## Why

Two CI-pipeline findings (DOC-006, DOC-007) from the 2026-07-25 audit remain open, re-confirmed against current source: `rust-test` and `rust-lint` cache identical paths under disjoint keys with no shared restore-key fallback (wasting Windows-runner minutes on every cache miss), and no CI job ever runs the actual production build (`npm run build` / `tauri build`), so a regression only visible in a real production bundle can merge to `main` undetected. Both are real `.github/workflows/rust.yml` changes (as opposed to prose documentation), so they're proposed as their own change rather than folded into the docs-only sweep — CI workflow edits carry different review weight and risk than pure prose corrections.

## What Changes

- **DOC-006**: `rust-test` (cache key prefix `cargo-test-`, `rust.yml:41,43`) and `rust-lint` (cache key prefix `cargo-lint-`, `rust.yml:70,72`) cache the identical paths (`~/.cargo/registry`, `~/.cargo/git`, `target`) under disjoint key prefixes with no shared `restore-keys` fallback between them. Add a shared restore-key prefix (or a common base key both jobs' `restore-keys` fall back to) so a cache miss on one job's exact key can still restore from the other job's most recent cache, instead of both independently recompiling the full dependency tree from scratch.
- **DOC-007**: Add a CI step/job that runs the actual frontend production build (`npm run build`) as a minimum production-build verification — catching build-time regressions (e.g. a `tsc`-clean but `vite build`-broken change, or an asset/import issue that only surfaces in the production bundle) that the existing `tsc --noEmit` + vitest checks don't exercise. (See design.md for the trade-off between this lighter check and a full `tauri build` native-bundle job.)

## Capabilities

### New Capabilities
- `ci-pipeline-efficiency-and-coverage`: formalizes, as a durable requirement, that CI jobs sharing identical cached dependency paths use a common cache-key strategy to avoid redundant recompilation, and that CI verifies the actual production build artifact rather than only type-checking and unit-testing source. No such capability currently exists in `openspec/specs/`.

### Modified Capabilities
(none)

## Impact

- **Code**: `.github/workflows/rust.yml` only.
- **APIs/schema**: none.
- **Dependencies**: none added or removed.
- **Tests**: no change to `cargo test`/`npm test` counts — this change only affects the CI workflow definition, not source under test. The new production-build step is itself the "test" being added (a real `npm run build` run, not a new unit test).
- **CI runtime impact**: DOC-006's fix should reduce average CI wall-clock time on cache misses (shared restore-key fallback avoids two independent from-scratch dependency compiles). DOC-007's fix adds CI time (one additional build step) — a deliberate, bounded trade-off for catching a class of regression currently invisible to CI.
- **Out of scope**: `.cursorrules`/`README.md`/`CLAUDE.md` prose fixes (proposed separately as `fix-docs-sweep`); everything else in the wider audit backlog.
