## Purpose

Defines CI requirements beyond the plain test gate: jobs that share cached dependency paths fall back to a common cache-key prefix, and the real production frontend build (`npm run build`) runs on every PR.

## Requirements

### Requirement: CI jobs sharing cached dependency paths use a common cache-key fallback
Any two CI jobs that cache identical dependency paths from the same lockfile SHALL share a common `restore-keys` fallback prefix, so a cache miss on one job's exact key can still restore from another job's most recent cache rather than recompiling the full dependency tree from scratch.

#### Scenario: rust-lint restores from rust-test's cache on a miss
- **WHEN** `rust-lint` runs and its own exact cache key has not been written yet (e.g. first run after a `Cargo.lock` change)
- **THEN** it falls back to restoring from `rust-test`'s most recent cache via a shared `restore-keys` prefix, rather than starting with no cache at all

### Requirement: CI verifies the actual production build
CI SHALL include a job or step that runs the real production frontend build (`npm run build`), so a regression only visible in the built/bundled output (not caught by `tsc --noEmit` or unit tests alone) is caught before merge.

#### Scenario: Production build step runs on every PR
- **WHEN** a pull request is opened or updated against `main`
- **THEN** CI runs `npm run build` and the PR's checks fail if that build fails
