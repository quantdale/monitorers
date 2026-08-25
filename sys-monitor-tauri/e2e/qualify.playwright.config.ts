/**
 * Playwright config for the canonical packaged-app qualification lane
 * (`npm run verify:packaged`).
 *
 * Unlike the simulation lanes this is NOT a journey/persona matrix: it is a
 * single evidence-producing qualification run against the real built Tauri
 * executable (see e2e/sim/qualify.spec.ts). No Vite webServer is started —
 * the packaged app serves its own frontend. CI policy: dispatch/tag only
 * (release-qualification workflow), never a required PR gate.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './sim',
  testMatch: /qualify\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Build + launch + CDP attach + interaction + teardown on a cold runner.
  timeout: Number(process.env.QUALIFY_TIMEOUT ?? 600_000),
  use: {
    trace: 'off',
  },
});
