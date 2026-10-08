# Remediate the source-map-js advisory in the application lockfile

## Why

The repository's required frontend gate is **red on a clean checkout of `main`**
(`b4517f44`). `sys-monitor-tauri/scripts/verify.mjs`'s `frontend()` lane runs
`npm audit --audit-level=high` inside `sys-monitor-tauri/`, and that command
exits **1**:

```
source-map-js  1.0.0 - 1.2.1
Severity: high
source-map-js allows event-loop denial of service through indexed
source-map section offsets — GHSA-68fv-2mgg-jv7q
1 high severity vulnerability
```

Because `verify:frontend` is what the `frontend` job of `.github/workflows/rust.yml`
executes and `verify:fast` is what `.husky/pre-push` executes, **no commit can be
pushed and no PR can be green** until this is resolved.

This is the *third* recurrence of the same failure family:

1. `restore-green-frontend-gate` (2026-09-30) fixed `undici` (high, via `jsdom`)
   and `vitest` (moderate) — and recorded its root cause as "the recorded status
   was scoped wrong".
2. `progress.md` then recorded "0 high vulnerabilities" for the application
   scope on 2026-09-30 — truthfully, as of that date.
3. `source-map-js@1.2.2` (the patched release) was published **2026-09-30**, one
   day before that status was written, so the already-locked `1.2.1` in
   `sys-monitor-tauri/package-lock.json` became an in-range-but-vulnerable pin.
   The gate went red without any dependency being upgraded.

Root cause of the recurrence: detection is real (the gate fails loudly), but
nothing in the repository tells an agent or maintainer that an advisory can
appear *against an unchanged lockfile*. The remediation path is also undocumented,
so the natural first guesses (`npm update`, `overrides`, `npm audit fix --force`)
are unreviewed guesses.

Two re-resolutions are enough for the fix itself; the durable work is (a) recording
the exact, minimal remediation and (b) making the advisory surface visible before
it blocks a push.

## What Changes

- **Re-resolve `sys-monitor-tauri/package-lock.json`** so `source-map-js` moves
  `1.2.1 → 1.2.2`. Both dependents accept it in-range
  (`vite@8.2.2 → postcss@8.5.26 → source-map-js@^1.2.1` and
  `jsdom@30.0.1 → css-tree@3.2.1 → source-map-js@^1.2.1`), so **no
  `package.json` edit and no `overrides`/`resolutions` block are needed** —
  the archived `restore-green-frontend-gate` task 1.3 explicitly forbids an
  override for this class of fix.
- **Add a scheduled advisory-watch workflow** (`.github/workflows/dependency-audit-watch.yml`)
  that runs *both* audit scopes weekly against the committed lockfiles and opens
  or updates a labelled issue when either scope is red, so an advisory published
  between Dependabot's monthly runs surfaces as an issue instead of a blocked push.
  The workflow only reads the repository and writes an issue; it never pushes,
  installs anything into a branch, or changes a lockfile.
- **Record the remediation evidence** (before/after lockfile diff, both scoped
  audit commands with exit statuses) in this change's `evidence.md` and fix the
  audit line in `progress.md` so it states both scopes again.

This is not a product change: no `src/**`, no `src-tauri/**`, no IPC contract,
no user-visible behaviour.

## Capabilities

### Modified Capabilities
- `dependency-vulnerability-audit`: adds the recurring-transgression guard — an
  advisory published against an already-locked in-range transitive SHALL be
  remediated by re-resolving the lockfile (preferred) and SHALL surface through
  an advisory-watch signal rather than being discovered at push time; an
  `overrides` block remains forbidden as the routine remediation.

## Impact

- **Dependencies**: `sys-monitor-tauri/package-lock.json` (one transitive dev
  entry: `node_modules/source-map-js` 1.2.1 → 1.2.2). No production dependency
  moves; the shipped bundle is byte-identical in content terms.
- **Tooling**: `.github/workflows/dependency-audit-watch.yml` (new, scheduled,
  immutable-SHA-pinned where actions are used).
- **Documentation**: `progress.md`, this change's `evidence.md`.
- **Not affected**: `src/**`, `src-tauri/**`, `Cargo.lock`, the E2E/simulation
  lanes, `tauri.conf.json`, IPC schema versions.
- Evidence collected during the change (all reproducible from a clean checkout):
  - `cd sys-monitor-tauri && npm audit --audit-level=high` → exit **1**,
    `1 high severity vulnerability` (`source-map-js`).
  - `npm audit --audit-level=high` at the repository root → exit 0,
    `found 0 vulnerabilities` (that workspace holds only `husky`).
  - `npm ls source-map-js` → `jsdom@30.0.1 → css-tree@3.2.1 → source-map-js@1.2.1`
    and `vite@8.2.2 → postcss@8.5.26 → source-map-js@1.2.1 deduped`.
  - `npm view source-map-js time` → `1.2.2` published `2026-09-30T14:08:09.382Z`.
