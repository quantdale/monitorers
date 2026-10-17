## 1. Worker bound

- [x] 1.1 In `sys-monitor-tauri/vite.config.ts`'s `test` block, add `maxWorkers: 4` with a comment recording the failure mode it prevents (fork-storm `Failed to start forks worker … Timeout waiting for worker to respond` aborts on loaded/high-core hosts — 19 observed while three foreign Playwright/vite pipelines saturated the host) and why the bound is 4. Do not change `pool`, `isolate`, `environment`, or the build config.
- [x] 1.2 In `scripts/verify.mjs`, make the unit-test step retry the run once when — and only when — the failure output contains the worker-startup infra signatures (`Failed to start forks worker` or `Timeout waiting for worker to respond`): vitest 4.1.11 hardcodes its worker handshake timeout (`START_TIMEOUT = 6e4`) and a starved host can kill the run before any test executes (observed 4/22 files even with the bound). The retry must print a loud banner with both outcomes; a real test failure never matches the condition and stays red on first failure.
- [x] 1.3 Record the suite's wall-clock duration with the bound and compare against the unbounded runs recorded earlier (47.5s / 16.8s / 96.7s on varying host load) to show the bound is not a material slowdown.

## 2. Validate

- [x] 2.1 Run `npm test -- --run` at least three times — all green (296 tests, 22 files).
- [x] 2.2 Run `npx tsc --noEmit` and `npm run build` — clean (config is type-checked by the build's `tsc` pass).
- [x] 2.3 Prove the retry's selectivity: (a) with a forced worker-startup failure the step retries and recovers, (b) with a forced failing test the step is red on the FIRST run and does not retry (unit-test the seam or demonstrate both paths manually; record which).
- [x] 2.4 Run `npm run verify:fast` end-to-end — exit 0 (shared with the cadence-test and sensor-gate changes' validation; one green run serves all three).
- [x] 2.5 Run `openspec validate 2026-10-17-bound-unit-gate-worker-parallelism --type change --strict --no-interactive`.
- [x] 2.6 Write `evidence.md` with the observed failure output, the host-load analysis (foreign pipelines, not repo orphans), the retry selectivity proof, the before/after durations, and the gates run. Do not claim a packaged-lane run.
