# Evidence — Remediate the source-map-js advisory in the application lockfile

All commands below were run on Windows in `D:\Documents\tryPython\monitorers`
from the clean checkout of `main@b4517f44` (the only pre-existing modification was
none — `git status --porcelain` was empty before this change started).

## Baseline — the failing scope (recorded before any change)

```
> cd sys-monitor-tauri && npm audit --audit-level=high
# npm audit report
source-map-js  1.0.0 - 1.2.1
Severity: high
source-map-js allows event-loop denial of service through indexed
source-map section offsets — https://github.com/advisories/GHSA-68fv-2mgg-jv7q
fix available via `npm audit fix`
1 high severity vulnerability
[exit code 1]
```

Repository-root scope (a separate workspace that holds only `husky`, so it can
never observe the application's transitive tree):

```
> npm audit --audit-level=high          # from the repository root
found 0 vulnerabilities
[exit code 0]
```

`npm run verify:fast` on that baseline failed inside its embedded `frontend()` lane:

```
=== application npm audit (sys-monitor-tauri) ===
... 1 high severity vulnerability ...
Error: application npm audit (sys-monitor-tauri) failed with exit code 1
    at run (file:///D:/Documents/tryPython/monitorers/sys-monitor-tauri/scripts/verify.mjs:16:34)
    at runNpm (.../scripts/verify.mjs:25:5)
    at frontend (.../scripts/verify.mjs:52:3)
```

Both scopes are named separately here on purpose; neither figure is an aggregate.

## Dependency chains and the in-range patched release

```
> npm ls source-map-js
sys-monitor-tauri@0.1.4
+-- jsdom@30.0.1
| `-- css-tree@3.2.1
|   `-- source-map-js@1.2.1
`-- vite@8.2.2
  `-- postcss@8.5.26
    `-- source-map-js@1.2.1 deduped
```

| Parent | Declared range for `source-map-js` | Accepts 1.2.2 |
|---|---|---|
| `postcss@8.5.26` (via `vite@8.2.2`) | `^1.2.1` | yes |
| `css-tree@3.2.1` (via `jsdom@30.0.1`) | `^1.2.1` | yes |

```
> npm view source-map-js time --json        (tail)
"1.2.1": "2024-09-08T16:22:55.645Z",
"1.2.2": "2026-09-30T14:08:09.382Z"
```

`1.2.2` was published **2026-09-30**, i.e. after the lockfile was resolved, so the
advisory became applicable to an *unchanged* lockfile. No dependency was upgraded
and Dependabot (monthly cadence) produced no PR. That is the recurring failure
family this change records.

```
> npm audit fix --dry-run
change source-map-js 1.2.1 => 1.2.2
changed 1 package, and audited 207 packages in 2s
```

## Remediation

Applied `npm audit fix` in `sys-monitor-tauri/`. The complete committed diff
(`git diff sys-monitor-tauri/package-lock.json`):

```diff
     "node_modules/source-map-js": {
-      "version": "1.2.1",
-      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
-      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
+      "version": "1.2.2",
+      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz",
+      "integrity": "sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==",
       "dev": true,
       "license": "BSD-3-Clause",
       "engines": { "node": ">=0.10.0" }
     }
```

`git diff --stat` for the whole change contains no `package.json` hunk — no range
edit, no `overrides`/`resolutions` block, no new direct dependency
(`design.md` D1; the archived `restore-green-frontend-gate` task 1.3 policy).

## Post-change verification (exact commands and outcomes)

| Command | Scope | Result |
|---|---|---|
| `npm audit --audit-level=high` | application (`sys-monitor-tauri/`) | exit **0** — `found 0 vulnerabilities` |
| `npm audit --audit-level=high` | repository root | exit **0** — `found 0 vulnerabilities` |
| `npm run verify:frontend` | frontend lane | exit **0** — 79s: version+doc consistency, dead-code check (387 symbols, 0 unreferenced), both audits green, `tsc --noEmit`, `tsc -p tsconfig.test.json`, `npm test -- --run` **270 passed (270)**, `vite build` ✓ 5.95s / 2405 modules |
| `npm run verify:fast` | frontend + full Rust gate | exit **0** — 314s end-to-end (same frontend stages above plus `cargo fmt --check`, the 5-matrix `cargo test` runs, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo audit`) |
| `npx openspec validate 2026-10-08-remediate-source-map-js-advisory --strict --no-interactive` | this change | `Change '2026-10-08-remediate-source-map-js-advisory' is valid` |
| `git diff --check` | whitespace | 0 errors |
| `python -c "yaml.safe_load(...)"` on `.github/workflows/dependency-audit-watch.yml` | workflow syntax | `yaml ok` |

Baseline note for the unit suite: 270 tests in 20 files pass both before and after
the lockfile change (the count drifted up from the 248 recorded by the previous
campaign because later changes added tests; no count is hard-coded in tracked docs).

## Advisory-watch lane

`.github/workflows/dependency-audit-watch.yml` (new) runs the *same two* audit
commands `scripts/verify.mjs`'s `frontend()` runs, in the same order with the same
labels, so there is no second definition of "the audit":

```yaml
npm audit --audit-level=high                     # repository-root scope
npm --prefix sys-monitor-tauri audit --audit-level=high   # application scope
```

Constraints verified while writing it:

- `permissions: contents: read`; the only write is `gh issue create` /
  `gh issue comment` through the default `GITHUB_TOKEN`. No push, no lockfile edit,
  no branch install.
- Actions are pinned by immutable SHA with the version in a comment, reusing SHAs
  already committed in this repository
  (`actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`,
  `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`). No third-party
  action was added — `gh` is preinstalled on GitHub-hosted runners — so no new pin
  had to be invented.
- The `dependencies` label the issue step uses already exists in this repository
  (`gh label list` → `dependencies  Pull requests that update a dependency file`).
- Issue handling is idempotent: one stable title searched with `in:title`, updated
  by comment when it already exists, created when it does not.

## Upstream reference

- GHSA-68fv-2mgg-jv7q — *source-map-js allows event-loop denial of service through
  indexed source-map section offsets* (CWE-1284, CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`,
  score 7.5), affected range `>=1.0.0 <1.2.2`, fixed in `1.2.2`.
- `source-map-js@1.2.2` publish time `2026-09-30T14:08:09.382Z` (`npm view source-map-js time`).

## Limitations

- The scheduled workflow itself cannot be *executed* from this environment
  (GitHub Actions dispatch is not available here); it is verified by syntax parse
  and by running the exact commands its body contains, both of which are recorded
  above. Its first real run is external evidence.
- No production/runtime dependency moved: `source-map-js` is a `dev: true`
  transitive of `vite`/`jsdom`, so the shipped frontend bundle is unaffected
  (the post-change build output above is identical in chunk structure).
