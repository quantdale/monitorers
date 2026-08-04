/**
 * Playwright config for the simulation lanes (npm run sim / npm run sim:real).
 *
 * The spec (run.spec.ts) drives the engine; each journey launches its own
 * browser via the driver (MockHarnessDriver or RealAppDriver). The mock lane
 * needs the Vite dev server on 5180 (started here and reused); the real lane
 * needs the built app exe (SIM_APP_EXE or the default release/debug path).
 * The mock lane is the CI default; the real lane is opt-in (SIM_LANE=real).
 */
import { defineConfig } from '@playwright/test';

const LANE = process.env.SIM_LANE ?? 'mock';

export default defineConfig({
  testDir: './',
  testMatch: /run\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',
  timeout: Number(process.env.SIM_TIMEOUT ?? 600_000),
  use: {
    trace: 'off',
  },
  ...(LANE === 'mock'
    ? {
        webServer: {
          command: 'npm run dev',
          url: 'http://127.0.0.1:5180',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
});