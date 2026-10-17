## Why

The canonical frontend gate died once today with 19 unhandled

```
[vitest-pool]: Failed to start forks worker for test files …
Caused by: [vitest-pool-runner]: Timeout waiting for worker to respond
```

errors — 3 of 22 test files ran, the lane went red. Root cause analysis:
the vitest fork pool spawns one child process per test file up to
`maxWorkers` (default: CPU count − 1) and every file boots its own jsdom
environment; the host at that moment was saturated by three unrelated
Playwright/vite pipelines from other projects (25 node processes observed),
so worker startup exceeded the pool's response timeout and the run died
before any test executed.

The load was external, but the exposure is the repository's: on a high-core
machine the default fan-out asks for up to 21 simultaneous jsdom boots (the
suite's environment setup already measures tens of seconds per file on a
loaded host), and there is no bound protecting the gate from a fork storm.
Vitest's own guidance for high-CPU machines is to bound workers. A
verification gate should degrade in speed, never in verdict.

## What Changes

- `sys-monitor-tauri/vite.config.ts`'s `test` block gains an explicit
  `maxWorkers: 4` bound with a comment recording the failure mode it
  prevents (fork-storm worker-startup timeouts on loaded/high-core hosts)
  and why 4 (enough parallelism for 22 jsdom files to stay fast, small
  enough that worker startup stays inside the pool timeout under load).
- `scripts/verify.mjs`'s unit-test step retries the run ONCE, and only when
  the failure output contains the worker-startup infra signatures
  (`Failed to start forks worker` / `Timeout waiting for worker to respond`) —
  the vitest 4 pool's 60 s worker handshake timeout is hardcoded and cannot
  be raised, so a heavily starved host can kill the run before any test
  executes. The retry is loud (its own banner, both outcomes logged); a real
  test failure never matches the retry condition and stays red on first
  failure. Observed exposure: 19/22 then 4/22 files failed to start under
  three concurrent foreign Playwright/vite pipelines.
- No test semantics change, no pool change (stays `forks`), no isolation
  change. If a future suite outgrows the bound, adjust the number — do not
  remove the bound.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- None. This is verification tooling configuration; no capability
  requirement changes.

## Impact

- `sys-monitor-tauri/vite.config.ts` (test config only; the Vite build
  config is untouched) and `sys-monitor-tauri/scripts/verify.mjs` (the
  unit-test step's retry-on-infra-failure).
- Verification: `npm test -- --run` green (repeatedly, including on a host
  loaded by concurrent foreign pipelines — the exact conditions that killed
  the unbounded run), plus `npm run verify:fast` green end-to-end. Suite
  duration recorded before/after to show the bound is not a material
  slowdown. Not run, not claimed: the packaged lane (test-tooling config
  only).
