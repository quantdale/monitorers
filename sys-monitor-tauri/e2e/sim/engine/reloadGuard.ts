/**
 * Unexpected-reload (HMR) guard for long-lived mock-lane pages.
 *
 * A Vite HMR full reload (or any stray redirect) replaces the document
 * mid-journey: bridge state resets, and the runner previously saw the fallout
 * as foreign console errors attributed to the app. The guard watches
 * main-frame `framenavigated` events and fails fast with a harness-defect
 * error naming the cause. The driver's own `restartApp()` reload suspends the
 * guard for the duration of that reload.
 *
 * Typed structurally over the small Page surface it needs, so the trust test
 * in run.spec.ts can drive it without a browser.
 */
import { ClassifiedSimulationError } from '../errors';

interface FrameLike {
  url(): string;
}

export interface ReloadWatchTarget {
  mainFrame(): FrameLike;
  on(event: 'framenavigated', listener: (frame: FrameLike) => void): unknown;
  off(event: 'framenavigated', listener: (frame: FrameLike) => void): unknown;
}

export interface ReloadGuard {
  /** Rejects when an unexpected main-frame navigation/reload is detected.
   *  Never resolves; see the no-op catch inside createReloadGuard. */
  failure: Promise<never>;
  /** While suspended (driver-initiated restartApp), navigations are ignored. */
  suspend(): void;
  resume(): void;
  /** Detaches the listener; later navigations are neither fatalized nor recorded. */
  dispose(): void;
  /** Returns and clears violations recorded so far (post-journey diagnostics). */
  drainViolations(): string[];
}

export function createReloadGuard(page: ReloadWatchTarget): ReloadGuard {
  const violations: string[] = [];
  let suspended = false;
  let disposed = false;
  let rejectFailure: ((error: ClassifiedSimulationError) => void) | null = null;
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  // The runner races `failure` against the journey. Once that race has settled
  // (journey finished first), a late violation must not surface as an
  // unhandled rejection and kill the Playwright worker — the race consumer
  // already got its outcome, and drainViolations() still reports the record.
  failure.catch(() => {});

  const onNavigated = (frame: FrameLike): void => {
    if (disposed || suspended) return;
    if (frame !== page.mainFrame()) return; // child frames are app-internal
    const detail =
      'unexpected page navigation/reload during an active journey — ' +
      `likely a Vite HMR full reload or stray redirect; url=${frame.url()}`;
    violations.push(detail);
    rejectFailure?.(new ClassifiedSimulationError(detail, 'harness-defect', 'config'));
  };

  page.on('framenavigated', onNavigated);

  return {
    failure,
    suspend: () => {
      suspended = true;
    },
    resume: () => {
      suspended = false;
    },
    dispose: () => {
      disposed = true;
      try {
        page.off('framenavigated', onNavigated);
      } catch {
        // The page may already be closing during teardown; disposal is
        // best-effort — the listener dies with the page either way.
      }
    },
    drainViolations: () => violations.splice(0),
  };
}
