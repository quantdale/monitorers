# Design — Remediate the source-map-js advisory in the application lockfile

## D1. Why an in-range update, not an override

The archived `restore-green-frontend-gate` change recorded the policy for exactly
this situation (task 1.3): *"Prefer an in-range update so `package.json` semver
ranges are unchanged; if a patched version is only available outside the current
range, make the minimal explicit range edit and record why. Do NOT add an
`overrides`/`resolutions` block."*

Both parents accept the patched release in-range, so the update is a pure
lockfile re-resolution:

| Parent | Declared range | Accepts 1.2.2 |
|---|---|---|
| `postcss@8.5.26` (via `vite@8.2.2`) | `source-map-js@^1.2.1` | yes |
| `css-tree@3.2.1` (via `jsdom@30.0.1`) | `source-map-js@^1.2.1` | yes |

`npm audit fix` therefore reports `change source-map-js 1.2.1 => 1.2.2` and touches
only the `version`/`resolved`/`integrity` fields of the single
`node_modules/source-map-js` entry. `package.json` and every other lockfile entry
stay byte-identical, which keeps the change reviewable to three lines and keeps a
future `npm ci` (what the CI `frontend` job runs) on the patched version.

Rejected alternatives:

- **`overrides: { "source-map-js": "^1.2.2" }`** — forbidden by the recorded policy;
  it also permanently pins a transitive the project does not own and would mask a
  future out-of-range advisory.
- **`npm audit fix --force`** — could downgrade/unify unrelated packages; the dry
  run showed the non-force fix is sufficient.
- **Dropping `jsdom`/`vite`** — out of scope and not a real remediation.

## D2. Why a scheduled advisory watch

Detection already works (`verify:frontend` fails loudly, as this campaign found).
What does not exist is a signal *between* pushes. Dependabot is monthly
(`.github/dependabot.yml`), and an advisory published against an unchanged
lockfile — exactly what happened here — produces no Dependabot PR at all. The
practical consequence measured in this repository: the gate was red on `main`
while `progress.md` said both scopes were green.

The watch lane is deliberately narrow:

- runs **weekly** (`cron`) and is also `workflow_dispatch`-able so it can be
  exercised on demand;
- checks out the repository read-only and runs **both** audit scopes with the
  exact commands `scripts/verify.mjs` uses, so there is no second definition of
  "the audit";
- opens **one** issue with a stable title (`Dependency advisory watch: application audit red`)
  or updates the existing one, so a persistent advisory does not spam;
- **fails the workflow run** when a scope is red, so the signal is also visible in
  the Actions tab like every other lane;
- never pushes, never edits a lockfile, never installs into a branch, and needs no
  new third-party action (the GitHub CLI is preinstalled on GitHub-hosted runners),
  so the immutable-SHA pin policy of `.github/workflows/*` is preserved without
  introducing an unpinned action.

## D3. Verification surface

The decisive local evidence for the remediation is cheap and deterministic:

1. `cd sys-monitor-tauri && npm audit --audit-level=high` → exit 0, both scopes named.
2. `npm run verify:frontend` → exit 0 (version check, dead-code check, both audits,
   both typechecks, `npm test -- --run`, `npm run build`).
3. `npm run verify:fast` → exit 0 (adds the whole Rust gate, which is what
   `.husky/pre-push` executes).
4. `openspec validate --strict` for this change, and `git diff --check`.

The workflow file itself is verified by YAML parse plus a dry-run of the audit
commands it contains (the same two commands, run locally), and by confirming that
no workflow in the repository authorizes a write beyond issue creation.
