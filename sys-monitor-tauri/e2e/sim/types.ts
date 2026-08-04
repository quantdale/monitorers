/**
 * Shared types for the user-simulation platform (e2e/sim).
 *
 * Lives outside src/ (and out of the frontend's include set) because the sim
 * engine, personas, journeys and drivers are test-side only. The page-side
 * bridge contract (SimScenario, SimFault, ...) is imported from
 * `src/sim/mockBackend` (type-only) so the two sides can never drift.
 */

import type { SimFault, SimScenario } from '../../src/sim/mockBackend';

// ── Run / lane ────────────────────────────────────────────────────────────────

export type DriverKind = 'mock' | 'real';

export type Lane = 'mock' | 'real';

export interface RunOptions {
  /** Deterministic seed for this run (logged in the run header). */
  seed: number;
  /** Per-run identifier; also namespaces mock bridge state and temp app dirs. */
  runId: string;
  lane: Lane;
  /** Mock clock speed factor (1 = real time). Ignored on the real driver. */
  speed: number;
  /** Absolute dir for all artifacts of this run. */
  outDir: string;
  /** Duration cap for the whole run (ms), to bound CI wall-clock time. */
  deadlineMs: number;
}

// ── Persona (declarative data — see personas/*.persona.ts) ────────────────────

/** Distribution represented as an inclusive [min, max] range (ms or s). */
export type Range = [number, number];

export type ActionKind =
  | 'toggleSidebar'
  | 'setWindow'
  | 'toggleMetric'
  | 'setViewMode'
  | 'reorderDashboard'
  | 'reorderSidebar'
  | 'retryCard'
  | 'inspectSettings';

export interface MistakeProfile {
  /** Escape out of the Metrics dropdown before selecting (per dropdown open). */
  escapeDropdown: number;
  /** Start a drag then cancel it (Escape mid-drag), per drag attempt. */
  misdrag: number;
  /** Click on the wrong control before the intended one (per step). */
  wrongClick: number;
}

export interface Persona {
  id: string;
  /** Human-readable description (goes into reports). */
  description: string;
  /** Session length range (simulated seconds). */
  sessionLengthSecs: Range;
  /** Delay between actions (ms). */
  thinkTimeMs: Range;
  /** Time spent watching before acting (ms). */
  dwellTimeMs: Range;
  /** Probability per action-kind of performing it when available. */
  actionPreference: Partial<Record<ActionKind, number>>;
  /** Watch behavior — how long a thrown-away perturbation is tolerated. */
  mistakes: MistakeProfile;
  /** Reaction to a collector-error banner. */
  faultReaction: 'ignore' | 'retry' | 'restart';
  /** 0 = zero-variance (fixed sequences for smoke); >0 scales draw spread. */
  variance: number;
}

// ── Journey (code — see journeys/*.journey.ts) ────────────────────────────────

export type JourneyState =
  | 'settings-error'
  | 'loading'
  | 'collecting'
  | 'history-error-inline'
  | 'history-error-fatal'
  | 'all-hidden'
  | 'live'
  | 'collector-error-banner';

export interface Journey {
  id: string;
  title: string;
  supportedDrivers: DriverKind[];
  /** Empty array = runs with every persona. */
  personaIds: string[];
  run: (ctx: SimContext) => Promise<void>;
}

// ── Engine context / logging ──────────────────────────────────────────────────

export interface JsonLog {
  timestampMs: number;
  tick: string;
  payload: unknown;
}

export type AssertionResult = 'pass' | 'fail';

export interface AssertionRecord {
  stepIndex: number;
  label: string;
  result: AssertionResult;
  detail?: string;
}

export interface SimContext {
  driver: SimDriver;
  persona: Persona;
  journey: Journey;
  rng: Rng;
  opts: RunOptions;
  /** Records an action/event entry for the JSONL run log. */
  log: (kind: string, payload?: Record<string, unknown>) => void;
  /** Records an assertion result. */
  assert: (label: string, ok: boolean, detail?: string) => void;
  /** Waits a human-plausible think-time delay (wall time, speed-adjusted). */
  think: () => Promise<void>;
  /** Waits a dwell-time delay (wall time, speed-adjusted). */
  dwell: () => Promise<void>;
  /** Clock elapsed for the run (ms). */
  elapsedMs: () => number;
  /** Coerce to a valid 1..sessionLength duration. */
  deadline: (ms: number) => boolean;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next: () => number;
  /** Integer in [min, max] inclusive. */
  int: (min: number, max: number) => number;
  /** Float in [min, max). */
  range: (min: number, max: number) => number;
  /** Draws a boolean with the given probability (0..1). */
  chance: (probability: number) => boolean;
}

// ── Drivers ───────────────────────────────────────────────────────────────────

export interface DriverLaunchResult {
  /** The drivable page. */
  page: import('@playwright/test').Page;
  /** App process stderr (real driver) or null. */
  appStderrPath: string | null;
}

export interface SimDriver {
  readonly kind: DriverKind;
  readonly page: import('@playwright/test').Page | null;

  /** Starts the app/server and opens the run page (`/?__sim_run=<id>`). */
  launch(runId: string, scenario: SimScenario, outDir?: string): Promise<DriverLaunchResult>;
  /** Injects a fault. No-op on the real driver (returns false when unsupported). */
  injectFault(fault: SimFault): Promise<boolean>;
  /** Sets the mock bridge clock speed. No-op on the real driver. */
  setSpeed(factor: number): Promise<void>;
  /** Stops per-run tracing into the given path (mock driver; no-op elsewhere). */
  stopTrace?(tracePath: string): Promise<void>;
  /** Full app relaunch / page reload with persisted bridge state. */
  restartApp(): Promise<void>;
  /** Tears everything down (app process, browser); flushes videos. */
  close(): Promise<void>;
  /** Driver-specific self-test (e.g. real driver isolation guarantee). */
  selfTest?(): Promise<void>;
}

// ── Results / reporting ───────────────────────────────────────────────────────

export type FailureClass = 'app-defect' | 'harness-defect' | 'undrivable' | 'none';

export interface RunResult {
  opts: RunOptions;
  personaId: string;
  journeyId: string;
  driverKind: DriverKind;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  passed: boolean;
  failureClass: FailureClass;
  failureMessage: string | null;
  failingStep: string | null;
  assertCount: number;
  assertPassed: number;
  seed: number;
  artifacts: {
    outDir: string;
    jsonl: string;
    junit: string;
    html: string;
    trace: string | null;
    video: string | null;
    screenshot: string | null;
    appStderr: string | null;
  };
}

// Re-exported for convenience so journeys and drivers import from one module.
export type { SimFault, SimScenario };
