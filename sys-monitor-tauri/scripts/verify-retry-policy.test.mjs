import { describe, expect, it } from 'vitest';
import { unitRetryWarrantsRetry } from './verify-retry-policy.mjs';

// Fixtures below are shape-identical to output captured from this repo's real
// failing gate runs on 2026-10-17 (19- and 4-worker-startup-error runs under
// three concurrent foreign Playwright/vite pipelines).

const INFRA_FAILURE = `
Unhandled Errors
⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯
Error: [vitest-pool]: Failed to start forks worker for test files D:/x/src/a.test.ts.
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond

 Test Files  18 passed (18)
      Tests  252 passed (252)
     Errors  4 errors
`;

const REAL_TEST_FAILURE = `
 ❯ src/cards/formatters.test.ts (4 | 1) 3ms
   × formatPercent clamps

 Test Files  1 failed | 21 passed (22)
      Tests  1 failed | 295 passed (296)
`;

const MIXED = `
Error: [vitest-pool]: Failed to start forks worker for test files D:/x/src/a.test.ts.

 Test Files  1 failed | 17 passed (18)
      Tests  1 failed | 251 passed (252)
     Errors  4 errors
`;

const CLEAN = `
 Test Files  22 passed (22)
      Tests  296 passed (296)
`;

describe('unitRetryWarrantsRetry (the gate’s one retry)', () => {
  it('retries a pure worker-startup infrastructure failure (no test verdicts to mask)', () => {
    expect(unitRetryWarrantsRetry(INFRA_FAILURE)).toBe(true);
  });

  it('never retries a counted test failure', () => {
    expect(unitRetryWarrantsRetry(REAL_TEST_FAILURE)).toBe(false);
  });

  it('never retries when a real failure accompanies the startup signature', () => {
    expect(unitRetryWarrantsRetry(MIXED)).toBe(false);
  });

  it('never retries a clean run', () => {
    expect(unitRetryWarrantsRetry(CLEAN)).toBe(false);
    expect(unitRetryWarrantsRetry('')).toBe(false);
  });
});
