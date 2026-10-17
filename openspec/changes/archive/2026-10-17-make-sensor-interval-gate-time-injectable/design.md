# Design — inject the time sample into the sensor interval gate

## Context

`SensorRegistry::poll_all` computes `due = last_polled.is_none_or(|last|
now.duration_since(last) >= interval)` with `now = Instant::now()` sampled
internally once per call. The arithmetic is trivial and pure; the only thing
making it untestable is the embedded clock. The current test compensates with
four real `sleep(250ms)` calls and asserts the exact due-pattern
`[true, false, false, false, true]` — which encodes an unstated assumption
that four sleeps land in `[1000, 1250)` ms total. `sleep` overshoot under
load broke it (observed: total ≥1000 ms by call 4, the gate correctly firing
early — the test failing against correct behavior).

## Options considered

### A. Pass `now: Instant` into `poll_all` (chosen)

Same shape as the repo's existing pure-function extraction for tick cadence.
One parameter, two call sites (`run_collector_loop` passes `Instant::now()`
at the identical sampling point; the test passes synthetic instants). The
gate's arithmetic becomes deterministically testable at any load, and the
five-element pin survives intact.

### B. Load-tolerant assertions over real time

Weaken the test to only assert first-poll-immediate and due-after-interval
(possibly skipping assertions when measured elapsed falls in a gray zone).
Sound but weaker: the exact "ticks 0 and 4" mapping — the property the test
exists for — stops being pinned.

### C. Wall-clock sleeps with wider margins

`sleep(1200)` etc. reduces flake frequency but keeps the same unstated
timing assumptions; this session has already shown such thresholds fail on
loaded hosts.

## Decision

**Option A.** The parameter is a plain `Instant`, not a clock trait: exactly
one call site needs a real clock, and a trait would be machinery for one
caller. The doc comment on `poll_all` records that the caller owns the time
sample (so the tick loop and the gate share one sample per tick — consistent
with this repo's single-clock discipline elsewhere).

## Consequences

- `test_interval_gated_provider_polls_on_time_not_every_call` becomes pure
  arithmetic over synthetic times: zero sleeps, zero load sensitivity.
- The tick loop's behavior is unchanged (it passes `Instant::now()` where
  the gate previously sampled it).
- Future providers' cadence rules can be unit-tested the same way.
