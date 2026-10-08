## Tasks — Remediate the source-map-js advisory in the application lockfile

> Executor rule: record the pre-change state before touching the lockfile, and never
> mark a step complete without the command output that proves it.

## 1. Record the failing baseline

- [x] 1.1 Run `cd sys-monitor-tauri && npm audit --audit-level=high` on the current `main` and save the full output (expect exit 1, `source-map-js 1.0.0 - 1.2.1`, `1 high severity vulnerability`).
- [x] 1.2 Run `npm audit --audit-level=high` at the repository root and record that it exits 0 (root workspace holds only `husky`), so the two scopes cannot be conflated.
- [x] 1.3 Identify the exact dependency chains with `npm ls source-map-js` and record both (`vite → postcss`, `jsdom → css-tree`) plus the ranges each dependent declares.
- [x] 1.4 Confirm the patched release and its publish date with `npm view source-map-js versions --json` and `npm view source-map-js time --json` (1.2.2, published 2026-09-30), which establishes that the advisory appeared without any dependency change.
- [x] 1.5 Run `npm audit fix --dry-run` and record the single planned change before applying anything (`change source-map-js 1.2.1 => 1.2.2`).

## 2. Remediate

- [x] 2.1 Apply `npm audit fix` in `sys-monitor-tauri/` and confirm `git diff` shows only the `version` / `resolved` / `integrity` fields of the `node_modules/source-map-js` lockfile entry.
- [x] 2.2 Confirm `git diff --stat` reports no `package.json` hunk (no range edit, no `overrides`, no new direct dependency).
- [x] 2.3 Run `cd sys-monitor-tauri && npm audit --audit-level=high` again and confirm exit 0 with `found 0 vulnerabilities`.

## 3. Make the advisory surface visible between pushes

- [x] 3.1 Add `.github/workflows/dependency-audit-watch.yml`: weekly schedule plus `workflow_dispatch`, `permissions: contents: read`, immutable-SHA pins for any action used, and a single create-or-update issue step gated on failure.
- [x] 3.2 Confirm the workflow runs the same two audit commands, in the same order, with the same labels as `scripts/verify.mjs`'s `frontend()` — no second definition of the audit.
- [x] 3.3 Confirm the workflow cannot write anything but an issue: no push, no lockfile edit, no branch install; the only write action is `gh issue create` / `gh issue comment` with the default `GITHUB_TOKEN`.
- [x] 3.4 Exercise the audit commands the workflow runs (both scopes, locally) and record exit statuses, so the workflow body is verified against a real run of the identical commands.

## 4. Re-qualify the gates this campaign unblocks

- [x] 4.1 Run `npm run verify:frontend` end-to-end and confirm exit 0 (version + doc consistency, dead-code check, both audits, both typechecks, unit tests, production build).
- [x] 4.2 Run `npm run verify:fast` end-to-end and confirm exit 0 (adds the full Rust gate: fmt, the feature-matrix test runs, clippy `-D warnings`, `cargo audit`).
- [x] 4.3 Run `gix diff --check` / `git diff --check` and record whitespace status.
- [x] 4.4 Run `npx openspec validate 2026-10-08-remediate-source-map-js-advisory --strict` and confirm it passes.

## 5. Record truth

- [x] 5.1 Fill this change's `evidence.md` with the before/after lockfile diff, both scoped audit commands and exit statuses, the two dependency chains, and the upstream advisory reference.
- [x] 5.2 Correct the audit line in `progress.md` so it states both scopes with their commands and exit statuses (never an unqualified aggregate), and records that an advisory can appear against an unchanged lockfile.
- [x] 5.3 Confirm no product source file (`src/**`, `src-tauri/**`) was modified: `git status --porcelain` should show only the lockfile, the new workflow, this change directory and `progress.md`.
