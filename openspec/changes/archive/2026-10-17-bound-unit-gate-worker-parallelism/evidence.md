# Evidence — bound the unit-gate worker fan-out

Date: 2026-10-17. Machine: Windows (dev host). Commands from
`sys-monitor-tauri/` unless noted.

## The failure (two red `verify:fast` runs)

```
Unhandled Error
Error: [vitest-pool]: Failed to start forks worker for test files …
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
… (×19) …
 Test Files  3 passed (3)
      Tests  27 passed (27)
     Errors  19 errors
```

and later (with `maxWorkers: 4` already in place):

```
 Test Files  18 passed (18)
      Tests  252 passed (252)
     Errors  4 errors        (4 × Failed to start forks worker)
```

## Host-load analysis (external cause, real exposure)

Process inspection at the time showed 25 `node.exe` processes: this repo had
NONE orphaned (no vitest/playwright/vite leftovers from earlier runs), but
three unrelated projects were running full pipelines concurrently —
`tryMC_v3` (Playwright tests + `vite preview`), `browser-blackhole`
(Playwright tests + `vite preview` + workers), `superhabits-overnight`
(`tsc --noEmit`) — plus pi tooling. Under that saturation each jsdom fork
boot measured 30–40 s and some exceeded vitest's worker handshake timeout.

vitest 4.1.11 hardcodes that timeout (`START_TIMEOUT = 6e4` and
`WORKER_START_TIMEOUT = 9e4` in `node_modules/vitest/dist/chunks/cli-api.*.js`
— grep-verified), so it cannot be raised from config. The exposure is still
the repository's: the default `maxWorkers` (CPU count − 1) fans out ~20
simultaneous process/jsdom boots on a high-core host, maximizing both the
storm and the probability of losing workers.

## Fixes

1. `vite.config.ts` test block: `maxWorkers: 4` with the incident recorded in
   the comment. Observed effect: worst-case dropped from 19 to 4 lost
   workers.
2. `scripts/verify.mjs` unit-test step: one retry, and ONLY when the failure
   output carries the worker-startup infra signatures AND no counted test
   failure (`scripts/verify-retry-policy.mjs`, the seam).

## Selectivity proof (task 2.3 — seam unit-tested)

`scripts/verify-retry-policy.test.mjs` pins four cases with fixtures
shape-identical to today's captured output:

- pure worker-startup infra failure (18 files/252 tests + 4 errors) → retry;
- counted test failure (`1 failed | 295 passed`) → NO retry;
- mixed (startup signature + counted failure) → NO retry (a flaky test can
  never be retried away — this session fixed three and the gate must keep
  surfacing that class on first failure);
- clean run → NO retry.

All four pass. The retry mechanics themselves (re-run once, throw if still
failing, loud banner naming the class) are exercised by any future infra
failure; both observed failure runs predate the retry, so no organic recovery
is claimed.

## Durations (varying host load — not a benchmark)

- unbounded: 47.5 s / 16.8 s / 96.7 s / 93.5 s (failed run)
- bounded (`maxWorkers: 4`): 105.8 s / 85.2 s / 76.0 s / 29.8 s

Within the noise of this host's load swings; the bound is not a material
slowdown on a healthy machine (22 jsdom files, environment setup dominates).

## Validation

- `scripts/verify-retry-policy.test.mjs`: 4 passed (in-suite: 23 files,
  300 tests).
- `npm test -- --run`: 23 files / 300 tests green (twice).
- `npx tsc --noEmit` clean; `npm run build` success.
- Shared `npm run verify:fast` end-to-end: **exit 0** — the same run is the
  green evidence for the cadence-guard and sensor-gate changes.

Not run, not claimed: the packaged lane (test tooling configuration).
