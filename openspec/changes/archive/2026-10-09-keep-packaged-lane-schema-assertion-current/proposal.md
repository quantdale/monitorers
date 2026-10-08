# Keep the packaged lane's schema assertion in lockstep

## Why

Running `npm run verify:packaged` against the current build **failed**:

```
Error: real IPC history schema version
Expected: 5
Received: 6
    at e2e/sim/qualify.spec.ts:130
```

The packaged lane hardcoded the metrics schema version. When the previous
campaign bumped the pair 5 → 6 (`MetricsSnapshot` gained `timestamp_ms`), it
updated the Rust constant, the TypeScript expectation in `useMetrics.ts`, and
the mock pin — but not this lane, which is dispatch/tag only and therefore never
runs on a pull request. The result is a lane that reports a *failure* for a
correct application: the worst kind of red, because the natural reaction is to
distrust the app rather than the assertion.

This is the same class of drift the documentation-fidelity gate was introduced
for (`scripts/check-version.mjs` exists because a documentation obligation with
no enforcement mechanism is correct only by luck of timing): a copy of a shared
contract that nothing keeps in step.

## What Changes

- The packaged lane asserts against the **shared** expectation
  (`EXPECTED_SCHEMA_VERSION` from `src/hooks/useMetrics`) instead of a literal
  `5`, so a future schema bump moves the lane with the app.
- The lane is re-run to prove it passes against the real application over real
  IPC, and the WebView2 policy assertion is re-run after it, per the repository's
  post-real-lane procedure.

## Impact

- `e2e/sim/qualify.spec.ts` only. No product code, no IPC contract change.
- The lifecycle schema assertion (unchanged at 1) was checked at the same time;
  this change does not touch it.
