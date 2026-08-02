import { defineConfig, devices } from '@playwright/test';

// The Playwright browser cannot attach to the app's WebView2 window, so these
// tests drive the frontend the only way it can be driven: against the Vite dev
// server, where isTauri() is false and useMetrics serves mock data. Anything
// that requires the real Rust backend (IPC, settings.json persistence, real
// sensors) is intentionally out of scope for this harness and covered by
// unit tests (useSettings.persistence.test.ts, useMetrics.*.test.ts) or the
// opt-in real-hardware cadence probe (src-tauri/tests/cadence_hardware.rs).
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Vite only — the mock-data path (isTauri() === false). Starting the full
    // Tauri app here adds nothing: the webview can't be driven by Playwright.
    command: 'npm run dev',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
