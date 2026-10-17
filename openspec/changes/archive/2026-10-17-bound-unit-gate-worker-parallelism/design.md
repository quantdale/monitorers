# Design — bound the unit-gate worker fan-out

## Context

Vitest's `forks` pool (the default, kept here) runs each test file in its own
child process with its own jsdom environment. `maxWorkers` defaults to CPU
count − 1. On a many-core host that means ~20 simultaneous process starts and
jsdom boots; the pool's worker handshake has a fixed response timeout. Under
host saturation the handshakes miss the timeout and the run aborts with
`Failed to start forks worker` before any test executes — observed today with
19 such errors while three unrelated Playwright/vite pipelines saturated the
machine.

## Options considered

### A. `maxWorkers: 4` (chosen)

Bounds simultaneous forks and jsdom boots. 22 files / 4 workers ≈ six waves;
environment setup dominates per-file cost anyway, so the wall-clock penalty
is small (measured: within noise of the unbounded run on this host), while
the startup storm that trips the pool timeout becomes impossible.

### B. `fileParallelism: false`

Maximally safe (one file at a time) but forces `maxWorkers: 1` and visibly
slows the normal case. More than the failure mode needs.

### C. Pool tuning / startup-timeout knob

The `Timeout waiting for worker to respond` handshake timeout is hardcoded
(`START_TIMEOUT = 6e4` — 60 s — in vitest 4.1.11's pool runner;
`WORKER_START_TIMEOUT = 9e4` beside it) with no configuration surface. Under
severe starvation a jsdom boot can exceed 60 s (measured 30–40 s per file
while three foreign pipelines saturated the host), so even a bounded pool
occasionally loses a worker — observed 4/22 files after the bound was added.
Changing the pool to `threads` trades away the `forks` pool's process-API
compatibility for speed — not a trade this suite needs.

### D. Bounded retry for the infra failure class (chosen alongside A)

`scripts/verify.mjs`'s unit-test step retries the run once, and ONLY when the
failure output contains the worker-startup signatures (`Failed to start
forks worker` / `Timeout waiting for worker to respond`). Those errors mean
the run died before any test executed — there is no verdict to mask. A real
test failure never matches and stays red on first failure, so flaky TESTS
cannot be retried away (this session fixed three of those; the gate must
keep surfacing that class). The retry is loud: its own banner and both
outcomes logged.

## Decision

**Options A + D**, with the config comment and the retry's banner recording
the incident so neither is "cleaned up" as unexplained magic. `pool` stays
`forks`; `isolate` stays on.

## Consequences

- The gate's resource profile is predictable on high-core dev boxes and
  shared CI runners: at most 4 test processes.
- Under extreme external load the suite slows down; if a worker still misses
  the hardcoded 60 s handshake, the step is retried once and the run
  recovers instead of aborting before any test executes.
- A flaky TEST remains a first-failure red — the retry condition matches
  only worker-startup infrastructure errors.
- If the suite grows past ~40 files, revisit the bound upward — never
  unbounded again.
