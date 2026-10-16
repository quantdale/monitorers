# Evidence — stabilize the five-minute axis-label boundary

Date: 2026-10-17. Machine: Windows (dev host). All commands from
`sys-monitor-tauri/` unless noted.

## Pre-change failure reproduction (the race, on the tree at `e16f0ff`)

The seeded-span case was run in isolation three times before any change:

| run | result |
|---|---|
| 1 | FAILED — `seeded-span label "06:01" keeps seconds` (label dropped seconds) |
| 2 | FAILED — same assertion |
| 3 | passed |

The full `npm run e2e` on the same tree failed the same case (32 passed,
1 failed). Root cause: the mock ring's timestamps are grid-aligned to 1 s, so
once a single live full-tick is committed after the 300-point seed, the
300-second window's visible span is exactly 300 000 ms — and the old rule
(`spanMs >= 300_000` drops seconds) flipped the whole axis to `HH:MM`, while
the case asserts `HH:MM:SS` and its own span self-check admits exactly
300 000 ms. The freeze-vs-first-commit race decided the format.

## Post-change verification

- `src/cards/chartLabels.test.ts`: 8 tests pass, including the boundary
  regression pin — `formatAxisTick(t, 300_000)` returns `HH:MM:SS`,
  `300_001` and `3_600_000` return `HH:MM`.
- The seeded-span E2E case run alone **8 consecutive times: 8 passed**
  (5 + 3 runs, all `1 passed`, exit 0) — both reachable mock spans (seed-only
  299 000 ms and full-window exactly 300 000 ms) now render `HH:MM:SS`, so the
  widest-label containment proof at 400×300 is deterministic either way the
  freeze lands.
- Full `npm run e2e`: **33 passed** (was 32 passed / 1 failed before).

## Gates run

- `npx tsc --noEmit` — clean
- `npm run typecheck:test` — clean
- `npm test -- --run` — 296 passed (22 files)
- `npm run build` — success
- `npm run e2e` — 33 passed
- `openspec validate 2026-10-17-stabilize-five-minute-axis-label-boundary --type change --strict` — valid
- `npm run sim` (mock simulation lane) — see the companion change's evidence;
  run once over the combined final tree.

Not run, not claimed: the packaged/real lane (formatter-boundary change, mock
lane is the stated verification scope in the proposal).
