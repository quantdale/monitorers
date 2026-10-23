# Progress

## Current Goal

Windows-only real-time system monitor (Rust/Tauri v2 backend, React/TypeScript frontend) in `sys-monitor-tauri/`, maintained through the spec-driven `openspec/` flow.

**Current phase: `2026-10-24-overlay-narrow-hardware-sidebar` is archived. No active OpenSpec change remains.**

**`2026-10-24-overlay-narrow-hardware-sidebar`** (archived). Opening the hardware sidebar at the 400×300 minimum window used to shrink the dashboard to a 140px column and clip disk/GPU badges (measured scrollWidth 230 inside a 138px card). Below 640px the rail is now a fixed overlay drawer (scrim, Close, Escape, focus returned to the toggle); at 640px and above it still pushes. Long sidebar model names wrap inside the 220px rail. Same tree: the Network card shows a Down glance numeral instead of an empty value, and the all-hidden / collecting messages are polite live regions. Gates: sidebar-overlay E2E 3/3, accessibility E2E including the empty-state case, `tsc --noEmit`, oxlint on the touched sources, sidebar unit tests, `openspec validate --all --strict` 26 passed. Packaged/real lane not run, not claimed.

The 2026-10-17 campaign — the five gate/audit changes plus the visual-design overhaul (`modernize-dashboard-visual-design`) — remains archived on `main`.

Campaigns in this phase (2026-10-17, in order):

1. **`2026-10-17-stabilize-five-minute-axis-label-boundary`** (archived). The
   E2E gate was **red on a clean `main`**: the chart-axis campaign's
   seeded-span case failed 2 of 3 local runs (`seeded-span label "06:01"
   keeps seconds`). Root cause was both a test race AND a product boundary
   wart: the 300-second window's visible span can reach exactly 300 000 ms
   when its oldest sample lands on the window cutoff (deterministic on the
   mock's 1 s grid), and `formatAxisTick` dropped seconds at `>= 300_000`, so
   the whole axis flipped `HH:MM:SS` ↔ `HH:MM` on sampling phase alone. The
   boundary is now inclusive on the seconds side (seconds kept up to and
   including exactly five minutes, dropped strictly beyond — the 300 s
   window's format is constant over its whole life), the
   `chart-axis-readability` spec carries the amended requirement plus a
   boundary scenario, and the seeded-span case passed 8/8 isolated re-runs
   (both reachable mock spans keep seconds) and the full suite 33/33.
2. **`2026-10-17-enforce-react-hooks-linting`** (archived). The long-recorded
   "React-hooks rules are a known gap" is **closed**: oxlint 1.88.0 (exact
   pin, native TS parsing — `typescript-eslint` stays peer-blocked on TS 7)
   with a committed `.oxlintrc.json` enabling exactly `react/rules-of-hooks`
   + `react/exhaustive-deps` as errors over `src/` + `e2e/`, run as
   `npm run lint` inside `scripts/verify.mjs`'s frontend lane (CI frontend
   job + pre-push, no workflow edits). The gate's first run found four real
   findings — including an actual `rules-of-hooks` violation (the
   provider-less fallback in `useSettings()` called a hook after an early
   return) and a render-churn bug (`settings.cardOrder ?? []` allocated per
   render, defeating the Recharts fan-out memos) — all fixed structurally,
   zero suppressions, plus a mutation check proving the gate fires. New spec:
   `react-hooks-lint-gate`. Docs (AGENTS/CLAUDE/.cursorrules) now describe
   the gate instead of the gap.
3. **`2026-10-17-align-cadence-test-with-deadline-grid`** (archived). The
   five-matrix `verify:fast` gate went red again:
   `test_first_poll_waits_for_initial_deadline_after_rate_priming` failed
   with "second poll fired 614.7809ms after priming — cadence collapsed" —
   the cadence was HEALTHY; the assertion `second >= first + floor` measured
   spacing from the actual (load-delayed) first emit and double-counted its
   lateness, encoding period-after-prior-start semantics that
   `collector-time-fidelity` explicitly disclaims. Fixed to the sound grid
   bound `second >= 2×TICK_INTERVAL` (`deadline_k ≥ epoch + k·250 ms` under
   every rebase path). Repetition evidence: 20/20 + 20/20 (the second batch
   immediately after the full five-matrix run — the load class that exposed
   the flake).
4. **`2026-10-17-make-sensor-interval-gate-time-injectable`** (archived).
   Third flaky gate defect, same class:
   `test_interval_gated_provider_polls_on_time_not_every_call` failed with
   `[true, false, false, true, false]` — again against CORRECT behavior
   (`sleep(250)` overshoot under load had genuinely elapsed 1000 ms by
   call 4). `SensorRegistry::poll_all` now takes a caller-supplied
   `now: Instant` (one sample per pass; the tick loop passes it at the same
   sampling point) so the interval arithmetic is testable with synthetic
   instants; the test keeps its exact five-element pin with zero sleeps.
   20/20 determinism batch.
5. **`2026-10-17-bound-unit-gate-worker-parallelism`** (archived). The
   vitest lane died twice in worker startup ("Failed to start forks worker …
   Timeout waiting for worker to respond" — 19 then 4 files) while three
   FOREIGN pipelines (`tryMC_v3`, `browser-blackhole`,
   `superhabits-overnight`) saturated the host (25 node processes, no repo
   orphans); vitest 4.1.11 hardcodes a 60 s worker handshake timeout.
   `maxWorkers: 4` bounds the fork storm (19→4 residual), and the unit-test
   step in `verify.mjs` retries ONCE only for the worker-startup infra class
   behind the unit-tested `scripts/verify-retry-policy.mjs` seam — a counted
   test failure is never retried (flaky tests must surface; this session
   fixed three). Policy tests 4/4 with fixtures from the real captured
   output.
6. **`2026-10-17-modernize-dashboard-visual-design`** (archived). Major
   frontend overhaul grounded in Refero research (Polar's dark-minimal admin
   language as primary; steel.dev's label-over-value metric rows and
   chargetrip's per-card accent series borrowed; light themes and external
   fonts rejected). A single token module (`src/design/tokens.ts`) now owns
   palette/typography/radii/elevation; the flat `#1e1e1e`-box UI became a
   deep-charcoal canvas with hairline elevated cards, 30px tight metric
   numerals over 12px muted labels (label-over-value `valueLabel` split so
   composite values fit the narrowest tile track), gradient-filled charts on
   faint dotted gridlines, a segmented view control, pill controls, a
   collector status pill, and token-chrome banners/sidebar. All behavioral
   contracts preserved: E2E 33/33 with only literal rgb pins re-bound to the
   tokens, contrast floors re-proven from the token values (7.06:1 tick text,
   3.70:1 axis stroke, AA text tiers and banner tints), 302 unit tests,
   mock sim lane 4/4, six rendered screenshots at 400×300/900×1100 recorded
   under `e2e-results/qa/visual-overhaul/`.

Verified on the combined final tree (2026-10-17): both `tsc` projects,
`npm run lint` clean, 302 unit tests (23 files), production build, 33 E2E,
mock simulation lane 4 passed, `npm run verify:frontend` green end-to-end
(including the lint step), **`npm run verify:fast` exit 0 end-to-end** — the
shared green run for the three gate-hardening changes (frontend lane +
five-matrix Rust lane + clippy `-D warnings` + `cargo audit`) — and strict
OpenSpec validation. **The packaged/real lane was not run and is not claimed
for these changes.**

Latest campaign before this phase — **`2026-10-09-harden-chart-axis-readability`** (archived):
Default/Tile time axes are now a readable scale — tick text `#888` (4.703:1) and
axis stroke `#7a7a7a` (3.884:1) on the `#1e1e1e` card surface instead of
recharts' `#666` default (2.903:1), a new pure `formatAxisTick(ms, spanMs)`
helper that keeps `HH:MM:SS` under a five-minute span and drops seconds above
it, `minTickGap` 80 and a 16px bottom margin. Verified locally: both `tsc`
projects, 295 unit tests, production build, 33 E2E tests (11 new, including the
300s seeded-span case), strict OpenSpec validation. **The packaged/real lane was
not run and is not claimed for this change.** (The 2026-10-17 boundary change
above supersedes the "under/above" wording of the formatter rule.)

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
- **Frontend test count** is whatever the runner reports. Do not hard-code a standing count. The 2026-10-09 `verify:full` snapshot below recorded 281 tests in 21 files; the later chart-axis campaign recorded 295 tests in 22 files.
- **Visual evidence** for the dashboard campaign lives under `sys-monitor-tauri/e2e-results/qa/` (gitignored): before/after screenshots at 390×844, 400×300, 900×1100 in Default, Tile and List modes.

**Final validation of this state (2026-10-09):** `npm run verify:full` exits **0** — frontend lane (version + 11/11 documentation fidelity, dead-code check, both npm audit scopes 0 vulnerabilities, two typechecks, 281 unit tests, production build) + Rust lane (fmt, five-matrix `cargo test`, clippy `-D warnings`, `cargo audit`) + E2E (22 passed) + mock simulation lane (4 passed) + Tauri release executable (Finished in 4m09s). `npm run verify:packaged` 1 passed locally; `assert:webview2-policy-absent` exit 0. `openspec validate --all --strict` 23 passed. Hosted: PR #45 all required checks success at `e94d266`.

## Active TODO

- [x] Remediate the application-scope `source-map-js` advisory and add the advisory-watch lane (`2026-10-08-remediate-source-map-js-advisory`).
- [x] Harden dashboard layout containment and semantic accessibility (`2026-10-08-harden-dashboard-layout-and-semantics`).
- [x] Reconcile, re-verify and archive `dependency-runtime-modernization-and-qualification`.
- [x] **Disposition the open dependency queue** (`2026-10-09-disposition-open-dependency-queue`, branch `agent/monitorers-dependency-queue-2026-10-09`, local): React 19.3.0 + types, Vite 8.3.1 + plugin-react 6.1.1, jsdom 30.1.1, vitest 4.1.11, Playwright 1.63.0, lucide-react 1.48.0, Rust+JS Tauri 2.12.0 as one stage, actions/download-artifact v8.0.1, taiki-e/install-action 2.87.21, nvml-wrapper 0.13.0. Eight PRs closed with a disposition comment; `@types/node` 26 (PR #44) stays open and deferred until the Node runtime moves to 26.
- [x] **Push and host-qualify.** Branch `agent/monitorers-dependency-queue-2026-10-09` pushed; PR #45 open against `main` with every required workflow **success** at `e94d266` (Rust — verify, Frontend — verify, Windows — production executable, E2E harness, Simulation mock lane, Simulation config lint — run IDs 37834212019 / 37834211907 / 37834211917). The two dispatch-only lanes (`Simulation — packaged lane`, `Windows — MSI and NSIS bundle`) are skipped by policy and remain unclaimed.
- [x] **Land on `main`.** `origin/main` fast-forwarded `b4517f4..ef8737d`, which includes the former local-only `main` commits and the chart-axis commits. PR #45's earlier hosted checks remain the evidence for `e94d266`; they were not re-run for `ef8737d`. The pre-push `verify:fast` hook passed on this push.
- [x] **Push `main`.** The old "four `main` commits" bookkeeping item is included in `b4517f4..ef8737d`. Not a force-push.
- [ ] **Packaged real-app lane for the updated stack** — run locally it passes (see the schema-assertion change), but the *dispatch-only* hosted packaged lane has not run at this stack.
- [x] **Harden chart axis readability** (`2026-10-09-harden-chart-axis-readability`, now on `main` at `ef8737d`): explicit `#888`/`#7a7a7a` axis colors on the `#1e1e1e` card surface, span-keyed `formatAxisTick` helper, `minTickGap` 80 + 16px bottom margin. A post-apply review's five corrections are closed (spec amended for a 1px sub-pixel inside-box tolerance; stroke + card background asserted on rendered pixels; unit gap test renamed as a floor guard; unit React roots unmounted; 300s seeded-span browser case added). Gates: both typechecks, 295 unit tests, build, 33 E2E, strict OpenSpec validation. Packaged lane not run, not claimed.
- [x] **Repository-wide audit: find and fix everything wrong** (2026-10-17). Full gate sweep plus fresh review found **five real defects** (two on the code, three in the verification gates themselves) across five OpenSpec changes: (1) the E2E gate was red/flaky (seeded-span axis case, 2/3 failures — root-caused to the phase-dependent five-minute label boundary, fixed product-side with the spec amended); (2) the recorded React-hooks lint gap had materialized into four findings including a true `rules-of-hooks` violation (fixed structurally; oxlint gate added and wired into `verify:frontend`); (3) the run_loop cadence test asserted a gap bound that double-counted load lateness and contradicted `collector-time-fidelity` (fixed to the grid bound); (4) the sensor interval test drove real sleeps and failed against CORRECT gating (fixed by injecting the gate's time sample); (5) the vitest lane's unbounded fork storm died in worker startup under host saturation (bounded to `maxWorkers: 4` + one infra-class-only retry behind a unit-tested policy seam). Docs reconciled (AGENTS/CLAUDE/.cursorrules). All five changes archived with evidence.
- [x] **Close the React-hooks lint gap** (`2026-10-17-enforce-react-hooks-linting`): `npm run lint` (oxlint 1.88.0 exact pin, two rules in scope) enforced through the canonical frontend lane; 0 findings, mutation-checked.
- [x] **Make the Rust gate timing tests sound** (`2026-10-17-align-cadence-test-with-deadline-grid` + `2026-10-17-make-sensor-interval-gate-time-injectable`): both flaky tests asserted wall-clock patterns `sleep`/scheduling never promised and both failed against correct behavior under load; now grid-bound and synthetic-clock respectively (20/20 × 3 repetition batches).
- [x] **Harden the unit gate against host saturation** (`2026-10-17-bound-unit-gate-worker-parallelism`): `maxWorkers: 4` bounds the fork storm; the unit-test step retries once only for worker-startup infrastructure failures (`scripts/verify-retry-policy.mjs`, 4/4 policy pins) — counted test failures are never retried.
