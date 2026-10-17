import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Split the heavy vendor libraries into their own chunks: app-only edits
  // then invalidate a small chunk instead of the whole ~545 kB bundle, and
  // the browser caches/parallelizes the stable vendor code across releases.
  // Function form pins each package by path so no chunk comes out empty.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (
            /[\\/]node_modules[\\/](recharts|react-smooth|react-transition-group|react-is|victory-vendor|d3-[^\\/]+|internmap|decimal.js-light|eventemitter3|fast-equals)[\\/]/.test(id)
          ) {
            return 'vendor-charts';
          }
          if (/[\\/]node_modules[\\/]@dnd-kit[\\/]/.test(id)) return 'vendor-dnd';
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5180,
    host: "127.0.0.1",
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Bound the fork pool. Each test file boots its own jsdom environment in
    // its own child process; the default maxWorkers (CPU count − 1) can ask a
    // high-core host for ~20 simultaneous boots, and under load the pool's
    // worker handshake misses its response timeout and the whole run aborts
    // with "Failed to start forks worker … Timeout waiting for worker to
    // respond" BEFORE any test executes (observed: 19 such errors while
    // three unrelated Playwright/vite pipelines saturated the host). Four
    // workers keep 22 jsdom files fast (setup dominates per-file cost) while
    // making the startup storm impossible — the gate degrades in speed under
    // load, never in verdict. Raise the number if the suite grows; do not
    // remove the bound.
    maxWorkers: 4,
    setupFiles: ['src/test/setup.ts'],
    // Playwright SPECS under e2e/ are run by `npm run e2e`, not by vitest.
    // Plain *.test.ts files under e2e/ (driver unit seams, no browser/hive)
    // stay part of the vitest lane right next to the code they cover.
    exclude: [...configDefaults.exclude, 'e2e/**/*.spec.ts'],
  },
}));
