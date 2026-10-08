# Progress

## Current Goal

Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TypeScript frontend) in `sys-monitor-tauri/`, maintained through the spec-driven `openspec/` flow.

**Current phase: `2026-10-08` follow-up campaigns completed on `main` (branch `main`; local commits, not yet pushed). Three OpenSpec changes archived; no active change remains.**

Campaigns completed on 2026-10-08, in order:

1. **`2026-10-08-remediate-source-map-js-advisory`** (archived). P0: the
   application-scoped npm audit that gates CI's `frontend` job and
   `.husky/pre-push` was **red on a clean `main`** (`source-map-js@1.2.1`,
   GHSA-68fv-2mgg-jv7q, high; fix 1.2.2 published 2026-09-30, i.e. after the
   lockfile was written, so the advisory appeared with no dependency upgrade).
   Fixed by re-resolving `sys-monitor-tauri/package-lock.json` to 1.2.2 — no
   `package.json` edit, no `overrides` block. A weekly
   `.github/workflows/dependency-audit-watch.yml` now runs the same two scoped
   audit commands `scripts/verify.mjs` runs and files one issue per failing
   scope, so an advisory published between Dependabot's monthly runs surfaces as
   an issue instead of a blocked push. Both scopes green afterwards
   (root exit 0, app exit 0).
2. **`2026-10-08-harden-dashboard-layout-and-semantics`** (archived). UI/UX-first
   campaign: eight user-visible defects fixed from rendered evidence — a negative
   CPU percentage (`Min: -9.9%`) from unclamped mock utilizations and an unclamped
   min/max formatter; the Tile grid resolving to `406.234px/180.703px` inside a
   358 px container at the product's own 400×300 minimum window; List rows
   clipping the Network card's range behind a fixed 50 px height; zero landmarks
   and zero headings; seven focusable `role="application"` charts with empty
   `<title>`; a collapsed sidebar still in the tab order; seven drag handles
   sharing one accessible name; a 2.90:1 drag-handle glyph.
3. **Archive reconciliation** of `dependency-runtime-modernization-and-qualification`
   (archived as `2026-10-09-dependency-runtime-modernization-and-qualification`):
   its 172 task checkboxes were reconciled against evidence, hosted runs were
   re-queried through the GitHub API (all four `completed`/`success` at
   `2e56ffc17ff2d97203e74b29009e30c9a47eab20`), and task 15's adversarial review
   was executed fresh over `git diff 46ee499 2e56ffc` (0 added unsafe blocks,
   0 `#[allow]`, 0 `as any`/`@ts-ignore`, 0 skipped tests, all 29 action pins
   full SHAs). Findings in that change's `evidence.md` §J.

Validation after these campaigns: `verify:frontend` and `verify:fast` exit 0,
`npm test -- --run` **281 passed (281)** in 21 files, `npm run e2e` **22 passed**,
mock simulation lane **4 passed**, `openspec validate --all --strict` **22 passed,
0 failed**.

## Agent Rules

- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on active OpenSpec tasks in dependency order.
- Mark tasks complete only with evidence.
- Add newly discovered defects/follow-up work to the active change or final backlog.
- Run the relevant test/lint/build gate after every coherent migration stage.
- Do not run destructive commands, force pushes, production deploys, secret mutation or database resets.
- Never weaken tests/security/identity/cadence contracts merely to accept a dependency update.

## Status snapshot (2026-10-08)

- **Audit health, stated per scope (never as an aggregate):**
  - repository-root scope (`npm audit --audit-level=high` at the repo root) → exit 0, `found 0 vulnerabilities` (that workspace holds only `husky`);
  - application scope (`cd sys-monitor-tauri && npm audit --audit-level=high`) → exit 0, `found 0 vulnerabilities` after `source-map-js` 1.2.1 → 1.2.2; **before** that change the same command exited 1 with `1 high severity vulnerability` (`source-map-js` via `vite → postcss` and `jsdom → css-tree`).
- **A new advisory can appear against an unchanged lockfile.** `source-map-js@1.2.2` was published 2026-09-30; the lockfile nobody touched then resolved an affected range. The weekly `dependency-audit-watch` workflow is the signal for that class; nothing else in the repository detects it earlier than a push.
- **Dashboard invariants now under test:** tile tracks stay equal and collapse to one column at ≤400 px; list rows never clip metadata; the page exposes one `h1`, a `banner` and a `main`; every chart is a named `role="img"` with `tabindex="-1"`; no rendered percentage is negative; the chart's accessible name is invariant to live scalar ticks (guards the Recharts render fan-out).
- **Frontend test count** is whatever the runner reports — currently 281 tests in 21 files. Do not hard-code it in docs.
- **Visual evidence** for the dashboard campaign lives under `sys-monitor-tauri/e2e-results/qa/` (gitignored): before/after screenshots at 390×844, 400×300, 900×1100 in Default, Tile and List modes.

## Active TODO

- [x] Remediate the application-scope `source-map-js` advisory and add the advisory-watch lane (`2026-10-08-remediate-source-map-js-advisory`).
- [x] Harden dashboard layout containment and semantic accessibility (`2026-10-08-harden-dashboard-layout-and-semantics`).
- [x] Reconcile, re-verify and archive `dependency-runtime-modernization-and-qualification`.
- [x] **Disposition the open dependency queue** (`2026-10-09-disposition-open-dependency-queue`, branch `agent/monitorers-dependency-queue-2026-10-09`, local): React 19.3.0 + types, Vite 8.3.1 + plugin-react 6.1.1, jsdom 30.1.1, vitest 4.1.11, Playwright 1.63.0, lucide-react 1.48.0, Rust+JS Tauri 2.12.0 as one stage, actions/download-artifact v8.0.1, taiki-e/install-action 2.87.21, nvml-wrapper 0.13.0. Eight PRs closed with a disposition comment; `@types/node` 26 (PR #44) stays open and deferred until the Node runtime moves to 26.
- [ ] **Push and host-qualify.** The four local campaign commits (`96aefb6`, `38b82b0`, `b2ef5d7` on `main`, and the three on the dependency-queue branch) have never been pushed, so no hosted run covers them — including the first `dependency-audit-watch` schedule.

## Recently completed

- [x] 2026-10-08 `2026-10-08-harden-dashboard-layout-and-semantics`: negative-percentage correctness (mock fidelity + shared clamped range formatter), tile-grid containment at the 400×300 minimum, list-row containment, `header`/`main`/`h1`, charts as named non-focusable images, per-card drag-handle names, collapsed sidebar out of the a11y tree, selector focus management, drag-handle contrast 2.90:1 → 3.88:1. 281 unit tests, 22 E2E, sim 4/4, verify:frontend/fast green.
- [x] 2026-10-08 `2026-10-08-remediate-source-map-js-advisory`: app npm audit 1 high → 0, plus a weekly advisory-watch workflow filing one issue per failing scope.
- [x] 2026-10-09 `2026-10-09-disposition-open-dependency-queue`: nine Dependabot PRs dispositioned (8 adopted, 1 deferred), including the Tauri Rust+JS halves adopted as one stage after PR #43 proved that a JS-only bump fails the production-executable build, and `@tauri-apps/plugin-store` held at 2.4.4 because the Rust crate has no stable line above it. `verify:fast`, 281 unit tests, 22 E2E, sim 4/4, openspec 23/23.
- [x] 2026-10-08 Archive reconciliation for `dependency-runtime-modernization-and-qualification`: tasks reconciled from evidence, four hosted runs re-verified at `2e56ffc`, §15 adversarial review executed fresh (0 added unsafe blocks / 0 `#[allow]` / 0 `as any` / 0 skipped tests / 29 full-SHA action pins).
- [x] 2026-08-27 `dependency-runtime-modernization-and-qualification`: Rust 1.95.0, sysinfo 0.39.6, wmi 0.18.4, windows 0.62.2, nvml 0.12.1, Tauri 2.11.5/2.4.4, React 19.2.8, Vite 8.2.2, TS 7.0.2, jsdom 30.0.1, Recharts 3.10.1, Lucide 1.34.0 – all staged and qualified (verify:full, verify:packaged, mock sim, cadence, startup, audits, openspec 17/17 at the time).


## Backlog / deliberately deferred

- [ ] **Dual identical-GPU runtime mapping — physical proof.** Deterministic fixtures cover identity logic, but a qualifying machine with two identical physical GPUs is still required before claiming physical runtime qualification. A single iGPU exposing multiple PDH LUID nodes does not qualify.
- [ ] **Free-roam real-lane pointer-drag reorder.** Keyboard drag is the certified deterministic interaction used by persistence journeys. Pointer drag remains registered exploratory behavior and is not a blocker for the active dependency campaign.
- [ ] **Code signing.** MSI/NSIS installers remain unsigned because no signing certificate/secret is configured. Do not invent credentials inside the dependency campaign.
- [ ] **Node 24.3.0 → 24.15+ patch for jsdom 30 engine satisfaction.** jsdom 30.0.1 wants Node ^24.15.0, current 24.3.0 triggers EBADENGINE warning but vitest still passes; CI Node 24 (latest) satisfies without warning. Patch update is low-risk follow-up, not a blocker for the modernized stack.
- [ ] **@types/node 26.x.** Deferred because Node runtime stays 24.3.0; 24.13.3 is latest 24 patch. Adopt 26 only when Node runtime moves to 26.

## Blocked

- **None that stops local work.** The only genuinely external items are physical
  (dual identical-GPU proof, physical hotplug/lid/power) and provisioning
  (code-signing certificate); all are backlog items above, not blockers.
- Hosted qualification for the dependency campaign is **already recorded**
  (`evidence.md` §F/J: four runs, `completed`/`success` at
  `2e56ffc17ff2d97203e74b29009e30c9a47eab20`).
- The 2026-10-08 follow-up campaigns are **local commits only** — they are not
  pushed, so their GitHub Actions qualification (including the new advisory-watch
  workflow's first scheduled run) is pending a push, not blocked.
