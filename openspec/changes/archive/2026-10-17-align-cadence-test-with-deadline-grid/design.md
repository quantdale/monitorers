# Design — align the cadence regression guard with the deadline grid

## Context

`run_collector_loop` schedules ticks on a monotonic deadline grid:
`next_deadline = epoch + rebase_deadline(previous, elapsed, 250 ms)`, where
`rebase_deadline` returns `previous + period` unless that is already past, in
which case `now + period`. Consequences:

- `deadline_k ≥ epoch + k·250 ms` for every k (rebase only moves right).
- An emit happens at or after its deadline (the wait is at the TOP of the
  iteration).
- The gap between two consecutive ACTUAL emits is **not** bounded below: if
  tick 0 is delayed by load to 499 ms but deadline_1's successor (500 ms) has
  not moved, tick 1 emits ~immediately after.

`collector-time-fidelity` pins exactly this ("Work time SHALL NOT be added to
the period… the next scheduled tick is due at the next 250 ms deadline from
the monotonic schedule, not 330 ms after the prior start").

## Options considered

### A. Gap-based bound with a bigger tolerance

`second >= first + something-smaller` still double-counts the first tick's
lateness; there is no positive `something` that is sound (the squeeze can
approach zero).

### B. Grid bound: `second >= 2 × TICK_INTERVAL` measured from priming

Sound at any load (`deadline_2 ≥ epoch + 500 ms ≥ started + 500 ms`, since
`started` precedes the loop epoch). Still fails the pre-fix loop (both polls
inside one period) and a first-to-second collapse whenever the first tick is
not itself catastrophically late. Symmetric with the existing first-poll
floor in style and intent.

### C. Rewrite the test around emit-vs-deadline instrumentation

Precise but requires exposing scheduling internals for one regression guard;
the observable emit timeline already carries the invariant.

## Decision

**Option B**, plus a comment that records why the previous gap-based form was
unsound. The first assertion (`first >= floor`) is kept unchanged as the
decisive original-regression guard.

## Consequences

- The guard becomes load-stable: its threshold is a property of the schedule,
  not of when the machine happened to run tick 0's body.
- A future "stops waiting between ticks" regression is still caught (a
  collapsed second tick lands well before 500 ms unless the first tick was
  itself past the 500 ms grid point, in which case rebase guarantees
  `second ≥ first + 250 ms` and the first assertion is already past its
  floor — the pre-fix signature is caught decisively by assertion 1).
