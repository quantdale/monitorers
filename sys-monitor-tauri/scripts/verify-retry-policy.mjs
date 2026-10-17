/**
 * Retry policy for the frontend unit-test step in scripts/verify.mjs.
 *
 * Extracted as a pure function so the gate's one retry is provably narrow:
 * it may fire ONLY for vitest worker-startup infrastructure failures — the
 * ones where the run dies in the pool's worker handshake (vitest 4.1.11
 * hardcodes `START_TIMEOUT = 6e4`, so a heavily starved host can kill a run
 * before its test files ever execute). A counted test failure must NEVER be
 * retried away; this session fixed three flaky tests and the gate has to keep
 * surfacing that class on first failure.
 */

/**
 * True only when `output` shows the worker-startup infra failure class AND
 * no counted test/file failure. Vitest reports test verdicts as lowercase
 * counts ("1 failed | 295 passed"); the startup signature itself is
 * "Failed to start forks worker" (capital F), which does not match.
 */
export function unitRetryWarrantsRetry(output) {
  const hasStartupSignature =
    output.includes('Failed to start forks worker') ||
    output.includes('Timeout waiting for worker to respond');
  if (!hasStartupSignature) return false;
  return !/\d+ failed/.test(output);
}
