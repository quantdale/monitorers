## Context

`.github/workflows/rust.yml` runs three jobs: `rust-test` and `rust-lint` (both `windows-latest`, both caching `~/.cargo/registry`, `~/.cargo/git`, `target`), and `frontend` (`ubuntu-latest`, `npm audit` + `tsc --noEmit` + vitest). Neither Rust job's cache key references the other's, so GitHub Actions treats them as entirely independent caches even though they build the identical dependency tree. Separately, no job anywhere builds the real shippable artifact — `npm run build`/`tauri build` are both local-only, never exercised by CI.

## Goals / Non-Goals

**Goals:**
- Reduce redundant full-dependency-tree recompilation between `rust-test` and `rust-lint` on a cache miss, via a shared cache-key strategy.
- Add CI coverage for the actual production build, catching a class of regression (build-time-only breakage) invisible to the current `tsc --noEmit`/vitest/`cargo test` checks.

**Non-Goals:**
- Not merging `rust-test` and `rust-lint` into one job — they serve different purposes (test execution vs. lint/format/audit) and the audit didn't recommend consolidating them, only sharing their cache.
- Not necessarily adding a full native `tauri build` (produces a real `.msi`/`.exe`, requires the Rust toolchain plus bundler tooling, meaningfully slower) as the first step here — see the Decisions section for the chosen scope.

## Decisions

- **DOC-006's cache-sharing mechanism**: use `actions/cache`'s standard `restore-keys` fallback pattern — give both jobs' cache steps a shared base prefix (e.g. `cargo-${{ runner.os }}-` or similar) as a `restore-keys` entry, while keeping each job's own more-specific exact key (e.g. `cargo-test-${{ hashFiles('**/Cargo.lock') }}` / `cargo-lint-${{ hashFiles('**/Cargo.lock') }}`) as the primary key for exact-match hits. This way: an exact match still hits precisely (no behavior change on the common case), but a miss on one job can still restore *most* of the dependency tree from whichever job ran more recently, rather than starting from nothing. Alternative considered: use one single identical cache key for both jobs — rejected, since `actions/cache` write-once-per-key semantics mean whichever job finishes first "wins" the cache write and the other job's cache save silently no-ops; keeping distinct primary keys with a shared restore-key fallback preserves both jobs' ability to update their own cache while still benefiting from cross-job restores on a miss.

- **DOC-007's build scope**: add `npm run build` (frontend production build via `tsc && vite build`) as a new step, most naturally added to the existing `frontend` job (already on the right runner, already has `npm ci` set up) rather than a new job — minimal CI-time addition, and this alone already catches the most common class of "works in dev, breaks in prod build" regression (tree-shaking/minification issues, production-only import resolution, environment-variable handling differences). Alternative considered: add a full `cargo tauri build` producing the real Windows installer — rejected *for this change* as disproportionate: it requires `windows-latest`, the full Rust toolchain, and native bundler tooling, adding significant CI minutes for a check whose primary value (catching frontend-build-only regressions) is already delivered by the lighter `npm run build` step. A full native-bundle CI job is a reasonable *future* enhancement but is a distinct, larger scope decision the audit itself didn't mandate as the only acceptable fix — flagged as an open question below rather than silently scoped out.

## Risks / Trade-offs

- [Risk: shared restore-key prefix causes a job to restore a cache from the "wrong" job (e.g. rust-lint restoring rust-test's cache) that's subtly incompatible, e.g. built with different feature flags] → Mitigation: both jobs build the same `Cargo.lock`-pinned dependency tree with the same default features (`nvapi` + `nvml`) — there's no compile-flag divergence between `rust-test` and `rust-lint` today that would make a cross-restored cache invalid; `cargo`'s own incremental-compile fingerprinting will simply recompile whatever doesn't match after a restore, it won't produce incorrect binaries.
- [Risk: adding `npm run build` to the `frontend` job increases that job's CI time, slowing down every PR] → Mitigation: `npm run build` for a project this size (~3,500 lines) is expected to be fast (well under a minute typically for a Vite frontend project of this scale) — a reasonable, bounded cost for the regression class it catches. If it turns out to meaningfully slow CI, that's a signal to revisit, not a reason to skip the check now.

## Migration Plan

Not applicable — CI workflow-only change, no code/schema/data migration. Standard PR: implement, verify by triggering the workflow (or reviewing a run once merged) to confirm both the cache-sharing behavior and the new build step actually execute as intended.

## Open Questions

- Should a full `cargo tauri build` (real installer bundle) job be added later as a separate, heavier CI job, given it would catch native-bundling regressions this change's lighter `npm run build` step cannot? Flagged for the maintainer to decide as a follow-up, not blocking this change.
