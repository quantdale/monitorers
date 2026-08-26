/**
 * Scriptable mock backend for browser (non-Tauri) mode.
 *
 * Replaces the hardcoded sine mock that used to live in `useMetrics.ts` with
 * a scenario-driven backend: identical default behavior (sine metrics, 250 ms
 * ticks, 4:1 history cadence, two disks, two GPUs, schema version 4) plus a
 * timeline/fault-injection surface for simulation journeys (`window.__SIM__`).
 *
 * Active only when `isTauri()` is false. In a real Tauri context no module in
 * `src/sim/` executes — the production IPC paths in `useMetrics.ts` /
 * `useSettings.ts` are untouched (they branch on `isTauri()` before any sim
 * call). This module MUST NOT import from `useMetrics.ts` (would create an
 * import cycle at bundle-evaluation time).
 *
 * Run handoff protocol (used by e2e/sim journeys, implemented here so the
 * page side is the single source of truth):
 *   1. The journey assigns a run id and writes the scenario JSON to
 *      localStorage under `sysmon_sim_session_<runId>` (see
 *      `simSessionKey()`), then navigates to `/?__sim_run=<runId>`.
 *   2. On load, `getSimBackend()` reads the scenario and installs
 *      `window.__SIM__` (runId, scenario, backend controls, settings shim).
 *   3. Live faults are injected via `window.__SIM__.backend.injectFault()`.
 *   4. Mock-mode persistence lives in the per-run localStorage namespace
 *      `sysmon_sim_settings_<runId>` (see `simSettingsKey()`), so settings
 *      survive page reloads within a run and parallel runs never share state.
 *
 * Determinism: all waveforms are tick-based (tick 0 = simulation second 0,
 * each tick advances the simulated clock by 250 ms). Speed changes wall-clock
 * timer frequency only, so speed=N means N simulated seconds per wall second.
 * A scenario
 * produces the same snapshot sequence regardless of wall clock.
 */

import type {
  CollectorLifecycleState,
  CollectorStatus,
  HistoryPayload,
  MetricsSnapshot,
  NvidiaTelemetry,
} from '../types/metrics';

export type GpuVendor = 'nvidia' | 'intel' | 'amd' | 'unknown';

export interface SimDiskSpec {
  key: string;
  read_mb_s?: number;
  write_mb_s?: number;
  avg_response_ms?: number;
}

export interface SimGpuSpec {
  /** Stable fixture identity; required for duplicate display-name scenarios. */
  key?: string;
  name: string;
  vendor?: GpuVendor;
  nvidia?: NvidiaTelemetry;
}

export type SimFault =
  | { kind: 'collector-error'; message: string }
  /** Session-panic simulation with bounded automatic recovery. */
  | { kind: 'collector-crash'; reason?: string; recoverAfterMs?: number }
  /** Repeated failures exhaust the budget; stays failed until retryCollection(). */
  | { kind: 'collector-crash-permanent'; reason?: string; attempts?: number; stageMs?: number }
  | { kind: 'disk-remove'; key: string }
  | { kind: 'disk-add'; key: string }
  | { kind: 'gpu-remove'; name?: string; key?: string }
  | { kind: 'gpu-add'; name: string; vendor?: GpuVendor; key?: string; nvidia?: NvidiaTelemetry }
  | { kind: 'schema-version'; version: number }
  /** Hold all live values for `ticks` further emissions (a PDH freeze). */
  | { kind: 'freeze'; ticks: number };

export type SimTimelineEvent = SimFault & { at: number };

export type HistoryLoadFault = { mode: 'fail' } | { mode: 'slow'; delayMs: number };

/** Declarative scenario for a mock-mode simulation run. */
export interface SimScenario {
  /** Scenario shape version (bump on incompatible changes). */
  version: 1;
  /** Emitted `schema_version` in snapshots/history. Default 5 (production). */
  schema_version?: number;
  /** Mock clock speed factor (1 = real-time 250 ms ticks). */
  speed?: number;
  /** Active disks. Default two: C: and D:. */
  disks?: SimDiskSpec[];
  /** Active GPUs. Default two: UHD Graphics (intel), RTX 4050 (nvidia). */
  gpus?: SimGpuSpec[];
  /** Failing/slow initial `get_history`, applied on load. */
  history_fault?: HistoryLoadFault;
  /** When true the settings shim returns garbage for every field. */
  corrupt_settings?: boolean;
  /** Ordered timeline of faults, keyed by tick number (0-based). */
  timeline?: SimTimelineEvent[];
}

/**
 * Supported mock-clock range. At the upper bound the timer's 10 ms safety
 * floor is not reached, so the meaning of speed remains stable: N simulated
 * seconds per wall-clock second.
 */
export const MIN_SIM_SPEED = 0.25;
export const MAX_SIM_SPEED = 16;
export const MIN_TIMER_PERIOD_MS = 10;

export function validateSimSpeed(value: number): number {
  if (!Number.isFinite(value) || value < MIN_SIM_SPEED || value > MAX_SIM_SPEED) {
    throw new Error(
      `simulation speed must be finite and between ${MIN_SIM_SPEED} and ${MAX_SIM_SPEED} (got ${String(value)})`
    );
  }
  return value;
}

export function timerPeriodMs(speed: number): number {
  return Math.max(MIN_TIMER_PERIOD_MS, 250 / validateSimSpeed(speed));
}

/** A sin-basis waveform generator for one metric. */
interface Wave {
  base: number;
  amp: number;
  periodFactor: number;
  phase: number;
}

function sinAt(wave: Wave, t: number): number {
  return wave.base + wave.amp * Math.sin(t * wave.periodFactor + wave.phase);
}

/** Small deterministic string hash — gives hotplug-added hardware stable identities. */
function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Per-key disk waveform so disks added mid-session get plausibly distinct motion. */
function diskWave(key: string): Wave {
  const h = hashKey(key);
  return {
    base: 8 + (h % 40),
    amp: 20 + (h % 15),
    periodFactor: 0.15 + (h % 10) / 100,
    phase: (h % 8) / 2,
  };
}

function gpuWave(name: string): Wave {
  const h = hashKey(name);
  return {
    base: 10 + (h % 50),
    amp: 25 + (h % 20),
    periodFactor: 0.25 + (h % 10) / 100,
    phase: (h % 6) / 2,
  };
}

/** Default disk specs — byte-for-byte the values of the pre-bridge mock. */
const DEFAULT_DISKS: SimDiskSpec[] = [
  { key: 'C:', read_mb_s: 12.5, write_mb_s: 8.2, avg_response_ms: 3.2 },
  { key: 'D:', read_mb_s: 3.1, write_mb_s: 1.8, avg_response_ms: 1.7 },
];

const DEFAULT_GPUS: SimGpuSpec[] = [
  { name: 'UHD Graphics', vendor: 'intel' },
  { name: 'RTX 4050', vendor: 'nvidia' },
];

export function defaultScenario(): SimScenario {
  return {
    version: 1,
    schema_version: 5,
    speed: 1,
    disks: DEFAULT_DISKS.map((disk) => ({ ...disk })),
    gpus: DEFAULT_GPUS.map((gpu) => ({ ...gpu })),
  };
}

function cloneScenario(scenario: SimScenario): SimScenario {
  const speed = scenario.speed === undefined ? 1 : validateSimSpeed(scenario.speed);
  return {
    ...scenario,
    speed,
    disks: scenario.disks?.map((disk) => ({ ...disk })),
    gpus: scenario.gpus?.map((gpu) => ({ ...gpu })),
    timeline: scenario.timeline?.map((event) => ({ ...event })),
  };
}

function gpuKey(gpu: SimGpuSpec, index: number): string {
  return gpu.key ?? `sim_gpu_${hashKey(`${gpu.name}:${index}`).toString(16)}`;
}

/** 300-point seed kept identical to the pre-bridge mock (chart cap parity). */
const MOCK_SEED_POINTS = 300;

export function simSessionKey(runId: string): string {
  return `sysmon_sim_session_${runId}`;
}

export function simSettingsKey(runId: string): string {
  return `sysmon_sim_settings_${runId}`;
}

export function detectSimRunId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('__sim_run');
  } catch {
    return null;
  }
}

/**
 * Reads the handoff scenario for `runId` from localStorage. The entry is kept
 * (not removed) so an app-restart step that reloads the page resumes the same
 * run with the same scripted state; journeys clear it via `clearSimScenario()`
 * when they finish.
 */
export function readSimScenario(runId: string): SimScenario | null {
  try {
    const raw = localStorage.getItem(simSessionKey(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimScenario;
    if (parsed && typeof parsed === 'object' && parsed.version === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Removes a run's handoff scenario (run cleanup). */
export function clearSimScenario(runId: string): void {
  try {
    localStorage.removeItem(simSessionKey(runId));
  } catch {
    // best-effort cleanup
  }
}

const HISTORICAL_DENSITY = 1000; // ms per history point in mock seeds

export const LIFECYCLE_SCHEMA_VERSION = 1;

/** Default wall-clock stage duration for synthesized recovery sequences. */
const RECOVERY_STAGE_MS = 500;

/**
 * Mirrors the production supervisor's lifecycle constants for journey realism:
 * three automatic attempts per streak (matching RecoveryPolicy::production).
 */
const SIM_MAX_ATTEMPTS = 3;

export class MockBackend {
  readonly runId: string;
  readonly scenario: SimScenario;

  /** Display title of the scenario this backend runs (for logs/reports). */
  readonly title: string;

  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapListeners = new Set<(snap: MetricsSnapshot) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private statusListeners = new Set<(status: CollectorStatus) => void>();
  /** Supervised-lifecycle mirror for journey realism (browser mode only). */
  private lifecycle: CollectorStatus = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    state: 'starting',
    generation: 0,
    attempt: 0,
    max_attempts: SIM_MAX_ATTEMPTS,
    reason: null,
    timestamp_ms: Date.now(),
  };
  private generation = 0;
  private crashTimeouts: ReturnType<typeof setTimeout>[] = [];
  /**
   * Bumped by `stop()` and by every (re)start so scheduled crash/recovery
   * callbacks can detect they belong to a superseded run. A stale callback
   * must never mutate or resurrect the singleton — the module-level backend
   * outlives individual mounts, so an uncancelled timeout could otherwise
   * restart emission after unmount and contaminate the next run.
   */
  private runToken = 0;
  /** True from a replacement generation's start until its FIRST snapshot emission. */
  private awaitingFirstEmit = false;

  private disks: SimDiskSpec[];
  private gpus: SimGpuSpec[];
  private schemaVersion: number;
  private speed: number;
  private historyFault: HistoryLoadFault | null;
  private corruptSettings: boolean;
  private freezeRemaining = 0;
  private halted = false;
  private lastSnapshot: MetricsSnapshot | null = null;
  private pendingTimeline: SimTimelineEvent[];
  private firedTimeline = 0;

  constructor(title: string, scenario: SimScenario, runId: string) {
    this.title = title;
    this.scenario = cloneScenario(scenario);
    this.runId = runId;
    this.disks = this.scenario.disks === undefined
      ? DEFAULT_DISKS.map((disk) => ({ ...disk }))
      : this.scenario.disks.map((disk) => ({ ...disk }));
    this.gpus = this.scenario.gpus === undefined
      ? DEFAULT_GPUS.map((gpu) => ({ ...gpu }))
      : this.scenario.gpus.map((gpu) => ({ ...gpu }));
    this.schemaVersion = this.scenario.schema_version ?? 5;
    this.speed = this.scenario.speed ?? 1;
    this.historyFault = this.scenario.history_fault ?? null;
    this.corruptSettings = this.scenario.corrupt_settings ?? false;
    this.pendingTimeline = [...(this.scenario.timeline ?? [])].sort((a, b) => a.at - b.at);
  }

  get speedFactor(): number {
    return this.speed;
  }

  get isHalted(): boolean {
    return this.halted;
  }

  get isFrozen(): boolean {
    return this.freezeRemaining > 0;
  }

  /** Starts the emission loop as a NEW generation. Idempotent; halted backends stay halted. */
  start(): void {
    if (this.halted || this.timer !== null) return;
    this.runToken += 1;
    this.generation += 1;
    this.awaitingFirstEmit = true;
    this.emitStatus({
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      state: 'starting',
      generation: this.generation,
      attempt: 0,
      max_attempts: SIM_MAX_ATTEMPTS,
      reason: null,
      timestamp_ms: Date.now(),
    });
    this.armTimer();
  }

  /** (Re)arms the interval clock only — no lifecycle transitions. */
  private armTimer(): void {
    if (this.timer !== null) return;
    const period = timerPeriodMs(this.speed);
    this.timer = setInterval(() => this.advance(), period);
  }

  stop(): void {
    // Invalidate every pending crash/recovery callback BEFORE clearing them,
    // then clear both the active interval and all staged timers: teardown must
    // cancel anything capable of restarting the backend.
    this.runToken += 1;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearCrashTimeouts();
    this.awaitingFirstEmit = false;
  }

  onSnapshot(listener: (snap: MetricsSnapshot) => void): void {
    this.snapListeners.add(listener);
  }

  offSnapshot(listener: (snap: MetricsSnapshot) => void): void {
    this.snapListeners.delete(listener);
  }

  onCollectorError(listener: (message: string) => void): void {
    this.errorListeners.add(listener);
  }

  offCollectorError(listener: (message: string) => void): void {
    this.errorListeners.delete(listener);
  }

  onCollectorStatus(listener: (status: CollectorStatus) => void): void {
    this.statusListeners.add(listener);
  }

  offCollectorStatus(listener: (status: CollectorStatus) => void): void {
    this.statusListeners.delete(listener);
  }

  /** Latest synthesized lifecycle status (`get_collector_status` analog). */
  getStatus(): CollectorStatus {
    return { ...this.lifecycle };
  }

  /**
   * Manual-retry analog of the `retry_collection` command. Honored only while
   * the synthesized supervisor is `failed`; otherwise a coalesced no-op.
   * Returns the lifecycle state observed at call time, mirroring the backend
   * command contract.
   */
  retryCollection(): CollectorLifecycleState {
    const observed = this.lifecycle.state;
    if (observed !== 'failed') return observed;
    this.clearCrashTimeouts();
    this.halted = false;
    this.start();
    return observed;
  }

  private emitStatus(status: CollectorStatus): void {
    this.lifecycle = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private clearCrashTimeouts(): void {
    for (const timeout of this.crashTimeouts.splice(0)) clearTimeout(timeout);
  }

  /**
   * Schedules a crash/recovery callback bound to the current run token. If
   * `stop()`/`start()` supersedes the run before the delay elapses, the
   * callback is a verified no-op even if it somehow still fires.
   */
  private scheduleCrashCallback(callback: () => void, delayMs: number): void {
    const token = this.runToken;
    this.crashTimeouts.push(
      setTimeout(() => {
        if (token !== this.runToken) return; // stale callback from a dead run
        callback();
      }, delayMs)
    );
  }

  /**
   * Synthesizes a session panic with bounded automatic recovery: emissions
   * stop, status walks recovering → healthy, then ticks resume truthfully
   * (the gap between remains a real gap — no fabricated samples).
   */
  private simulateCrashRecovery(reason: string, recoverAfterMs: number): void {
    if (this.lifecycle.state === 'recovering' || this.lifecycle.state === 'failed') return;
    this.stop();
    this.generation += 1;
    this.emitStatus({
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      state: 'recovering',
      generation: this.generation,
      attempt: 1,
      max_attempts: SIM_MAX_ATTEMPTS,
      reason,
      timestamp_ms: Date.now(),
    });
    this.scheduleCrashCallback(
      () => {
        this.halted = false;
        // The replacement generation reports healthy only after its first
        // successful snapshot (start() arms awaitingFirstEmit), exactly like
        // the production supervisor's first-emit transition.
        this.start();
      },
      recoverAfterMs
    );
  }

  /**
   * Synthesizes repeated failures exhausting the recovery budget: staged
   * recovering statuses then a persistent failed state. Only retryCollection()
   * (or a new run) restores emission afterwards.
   */
  private simulateCrashExhaustion(reason: string, attempts: number, stageMs: number): void {
    if (this.lifecycle.state === 'recovering' || this.lifecycle.state === 'failed') return;
    this.stop();
    this.generation += 1;
    this.emitStatus({
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      state: 'recovering',
      generation: this.generation,
      attempt: 1,
      max_attempts: SIM_MAX_ATTEMPTS,
      reason,
      timestamp_ms: Date.now(),
    });
    for (let i = 2; i <= attempts; i += 1) {
      this.scheduleCrashCallback(
        () => {
          this.generation += 1;
          this.emitStatus({
            schema_version: LIFECYCLE_SCHEMA_VERSION,
            state: 'recovering',
            generation: this.generation,
            attempt: i,
            max_attempts: SIM_MAX_ATTEMPTS,
            reason,
            timestamp_ms: Date.now(),
          });
        },
        stageMs * (i - 1)
      );
    }
    this.scheduleCrashCallback(
      () => {
        this.halted = true;
        this.generation += 1;
          this.emitStatus({
            schema_version: LIFECYCLE_SCHEMA_VERSION,
            state: 'failed',
            generation: this.generation,
            attempt: attempts + 1,
            max_attempts: SIM_MAX_ATTEMPTS,
            reason,
            timestamp_ms: Date.now(),
          });
          for (const listener of [...this.errorListeners]) {
            listener(`metrics collection failed after ${attempts} recovery attempts — ${reason}`);
          }
      },
      stageMs * attempts
    );
  }

  /**
   * `get_history` analog. Honors the configured history fault (fail/slow);
   * the default resolves with a fresh 300-point sine seed, matching the
   * pre-bridge mock exactly.
   */
  getHistory(): Promise<HistoryPayload> {
    const payload = this.generateHistory();
    const fault = this.historyFault;
    if (!fault) return Promise.resolve(payload);
    if (fault.mode === 'fail') {
      return Promise.reject(new Error('simulated history load failure'));
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(payload), fault.delayMs);
    });
  }

  /** Injects a fault immediately (runtime handle / timeline both reach here). */
  injectFault(fault: SimFault): void {
    switch (fault.kind) {
      case 'collector-error':
        this.haltWithError(fault.message);
        break;
      case 'collector-crash':
        this.simulateCrashRecovery(
          fault.reason ?? 'synthetic session panic',
          fault.recoverAfterMs ?? RECOVERY_STAGE_MS * 2
        );
        break;
      case 'collector-crash-permanent':
        this.simulateCrashExhaustion(
          fault.reason ?? 'synthetic repeated session panics',
          fault.attempts ?? SIM_MAX_ATTEMPTS,
          fault.stageMs ?? RECOVERY_STAGE_MS
        );
        break;
      case 'disk-remove':
        this.disks = this.disks.filter((d) => d.key !== fault.key);
        break;
      case 'disk-add':
        if (!this.disks.some((d) => d.key === fault.key)) {
          this.disks.push({ key: fault.key });
        }
        break;
      case 'gpu-remove':
        this.gpus = this.gpus.filter((g, index) => {
          const key = fault.key;
          return key !== undefined ? gpuKey(g, index) !== key : g.name !== fault.name;
        });
        break;
      case 'gpu-add':
        if (!this.gpus.some((g) => g.name === fault.name)) {
          this.gpus.push({
            key: fault.key ?? `sim_gpu_${hashKey(`${fault.name}:${this.gpus.length}`).toString(16)}`,
            name: fault.name,
            vendor: fault.vendor ?? 'unknown',
            nvidia: fault.nvidia,
          });
        }
        break;
      case 'schema-version':
        this.schemaVersion = fault.version;
        break;
      case 'freeze':
        this.freezeRemaining = Math.max(this.freezeRemaining, fault.ticks);
        break;
    }
  }

  /** Sets the clock speed factor without churning lifecycle state. */
  setSpeed(factor: number): void {
    this.speed = validateSimSpeed(factor);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.armTimer();
    }
  }

  /** Switches the history-load fault for the current run (runtime control). */
  setHistoryFault(fault: HistoryLoadFault | null): void {
    this.historyFault = fault;
  }

  get corruptSettingsEnabled(): boolean {
    return this.corruptSettings;
  }

  /** Simulated clock seconds elapsed (tick × 0.25). Timer frequency carries speed. */
  get simSeconds(): number {
    return this.tick * 0.25;
  }

  private advance(): void {
    if (this.halted) {
      this.stop();
      return;
    }
    this.tick += 1;
    this.applyTimeline(this.tick);
    // A timeline fault may have stopped/halted the loop mid-tick; emitting a
    // frame afterwards would fake data flowing through a dead session.
    if (this.halted || this.timer === null) return;
    this.emitSnapshot();
    if (this.awaitingFirstEmit) {
      // First successful snapshot of this generation → Healthy. A replacement
      // that never emits never becomes healthy (timer-scheduled != Healthy).
      this.awaitingFirstEmit = false;
      this.emitStatus({
        schema_version: LIFECYCLE_SCHEMA_VERSION,
        state: 'healthy',
        generation: this.generation,
        attempt: 0,
        max_attempts: SIM_MAX_ATTEMPTS,
        reason: null,
        timestamp_ms: Date.now(),
      });
    }
  }

  private applyTimeline(tick: number): void {
    while (this.firedTimeline < this.pendingTimeline.length) {
      const event = this.pendingTimeline[this.firedTimeline];
      if (event.at > tick) break;
      this.firedTimeline += 1;
      this.injectFault(event);
    }
  }

  private emitSnapshot(): void {
    const snap = this.composeSnapshot();
    this.lastSnapshot = snap;
    for (const listener of this.snapListeners) {
      listener(snap);
    }
  }

  /**
   * Computes the snapshot for the current tick. While a freeze is active the
   * previous snapshot's values are re-emitted verbatim (PDH freeze hold); the
   * freeze counter decrements each emission.
   */
  private composeSnapshot(): MetricsSnapshot {
    const onTick = this.tick % 4 === 0;
    if (this.freezeRemaining > 0 && this.lastSnapshot) {
      this.freezeRemaining -= 1;
      return {
        ...this.lastSnapshot,
        schema_version: this.schemaVersion,
        on_tick: onTick,
      };
    }
    this.freezeRemaining = 0;
    const t = this.simSeconds;

    const cpu = sinAt({ base: 30, amp: 40, periodFactor: 0.3, phase: 0 }, t);
    const mem = sinAt({ base: 50, amp: 35, periodFactor: 0.3, phase: 0.5 }, t);

    const disks = this.disks.map((d) => {
      const wave = diskWave(d.key);
      return {
        key: d.key,
        active: Math.max(0, sinAt(wave, t)),
        read_mb_s: d.read_mb_s ?? wave.base + 4,
        write_mb_s: d.write_mb_s ?? (wave.base + 4) / 2,
        avg_response_ms: d.avg_response_ms ?? (wave.base % 40) / 10 + 0.5,
      };
    });

    const gpus = this.gpus.map((g, index) => {
      const wave = gpuWave(g.name);
      return {
        key: gpuKey(g, index),
        name: g.name,
        vendor: g.vendor ?? ('unknown' as GpuVendor),
        util: Math.max(0, sinAt(wave, t)),
        temp_c: (hashKey(g.name) % 25) + 40,
        nvidia: g.vendor === 'nvidia'
          ? {
              temp_c: g.nvidia?.temp_c ?? (hashKey(gpuKey(g, index)) % 20) + 50,
              power_w: g.nvidia?.power_w ?? (hashKey(gpuKey(g, index)) % 80) + 40,
              mem_used_mb: g.nvidia?.mem_used_mb ?? 2048,
              mem_total_mb: g.nvidia?.mem_total_mb ?? 6144,
              fan_speed_pct: g.nvidia?.fan_speed_pct ?? 35,
              clock_mhz: g.nvidia?.clock_mhz ?? 2100,
            }
          : null,
      };
    });

    return {
      schema_version: this.schemaVersion,
      on_tick: onTick,
      cpu,
      cpu_name: 'CPU',
      cpu_temp_c: 52,
      mem,
      mem_used_gb: 6 + 2 * Math.sin(t * 0.1),
      mem_total_gb: 16,
      disks,
      net_recv_kib_s: Math.max(0, sinAt({ base: 100, amp: 200, periodFactor: 0.4, phase: 2.5 }, t)),
      net_sent_kib_s: Math.max(0, sinAt({ base: 50, amp: 150, periodFactor: 0.4, phase: 3 }, t)),
      gpus,
    };
  }

  /** 300-point history seed mirroring the pre-bridge mock payload. */
  private generateHistory(): HistoryPayload {
    const n = MOCK_SEED_POINTS;
    const now = Date.now();
    const cpu: number[] = [];
    const mem: number[] = [];
    const netRecv: number[] = [];
    const netSent: number[] = [];
    const timestamps: number[] = [];

    // Deterministic base phase so the seed's shape doesn't depend on the
    // current wall-clock second (unlike the pre-bridge mock); amplitude,
    // period and phase per metric are preserved.
    const t0 = 0;
    const dt = HISTORICAL_DENSITY / 1000 / n * 4; // one wave across ~300s in sim-time

    for (let i = 0; i < n; i += 1) {
      const t = t0 + i * dt;
      timestamps.push(now - (n - 1 - i) * HISTORICAL_DENSITY);
      cpu.push(30 + 40 * Math.sin(t * 4));
      mem.push(50 + 35 * Math.sin(t * 4 + 0.5));
      netRecv.push(Math.max(0, 100 + 200 * Math.sin(t * 4 + 2.5)));
      netSent.push(Math.max(0, 50 + 150 * Math.sin(t * 4 + 3)));
    }

    return {
      schema_version: this.schemaVersion,
      timestamps,
      cpu,
      cpu_name: 'CPU',
      cpu_temp_c: 52,
      mem,
      disks: this.disks.map((d) => {
        const wave = diskWave(d.key);
        return {
          key: d.key,
          values: Array.from({ length: n }, (_, i) => Math.max(0, sinAt(wave, i * dt))),
          read_mb_s: d.read_mb_s ?? wave.base + 4,
          write_mb_s: d.write_mb_s ?? (wave.base + 4) / 2,
          avg_response_ms: d.avg_response_ms ?? (wave.base % 40) / 10 + 0.5,
          last_seen_ts: now,
        };
      }),
      net_recv: netRecv,
      net_sent: netSent,
      gpus: this.gpus.map((g, index) => {
        const wave = gpuWave(g.name);
        return {
          key: gpuKey(g, index),
          name: g.name,
          vendor: g.vendor ?? 'unknown',
          values: Array.from({ length: n }, (_, i) => Math.max(0, sinAt(wave, i * dt))),
          temp_c: (hashKey(g.name) % 25) + 40,
          nvidia: g.vendor === 'nvidia'
            ? {
                temp_c: g.nvidia?.temp_c ?? (hashKey(gpuKey(g, index)) % 20) + 50,
                power_w: g.nvidia?.power_w ?? (hashKey(gpuKey(g, index)) % 80) + 40,
                mem_used_mb: g.nvidia?.mem_used_mb ?? 2048,
                mem_total_mb: g.nvidia?.mem_total_mb ?? 6144,
                fan_speed_pct: g.nvidia?.fan_speed_pct ?? 35,
                clock_mhz: g.nvidia?.clock_mhz ?? 2100,
              }
            : null,
          last_seen_ts: now,
        };
      }),
    };
  }

  private haltWithError(message: string): void {
    // Legacy permanent-halt path: mirror the supervised contract by reporting
    // a terminal failed status (retryable via retryCollection) alongside the
    // historical collector-error listener notification.
    this.stop();
    this.generation += 1;
    this.emitStatus({
      schema_version: LIFECYCLE_SCHEMA_VERSION,
      state: 'failed',
      generation: this.generation,
      attempt: SIM_MAX_ATTEMPTS + 1,
      max_attempts: SIM_MAX_ATTEMPTS,
      reason: message,
      timestamp_ms: Date.now(),
    });
    this.halted = true;
    for (const listener of this.errorListeners) {
      listener(message);
    }
  }
}

/** Handles run isolation and persistence for mock-mode settings. */
export interface SimSettingsBackend {
  /** Loads the run's persisted settings (or garbage when corrupt settings are enabled). */
  load(): Promise<Record<string, unknown>>;
  /** Writes a partial settings patch into the run's namespace. */
  save(patch: Record<string, unknown>): Promise<void>;
}

const CORRUPT_PAYLOAD: Record<string, unknown> = {
  cardOrder: 'definitely-not-an-array',
  hiddenCardIds: 'oops',
  sidebarCardOrder: 42,
  viewMode: 'banana',
  windowSecs: 0, // not a legal WINDOW_SECS_OPTIONS value
};

export class LocalStorageSettingsBackend implements SimSettingsBackend {
  constructor(private readonly runId: string, private readonly corrupt: boolean) {}

  private key(): string {
    return simSettingsKey(this.runId);
  }

  private read(): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(this.key());
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async load(): Promise<Record<string, unknown>> {
    if (this.corrupt) return { ...CORRUPT_PAYLOAD };
    return this.read();
  }

  async save(patch: Record<string, unknown>): Promise<void> {
    try {
      const next = { ...this.read(), ...patch, settingsVersion: 2 };
      localStorage.setItem(this.key(), JSON.stringify(next));
    } catch {
      // localStorage can hit quota/serialization errors in odd embedders;
      // persistence is best-effort in mock mode — keep the session alive.
      console.warn('[sim] failed to persist mock settings:', patch);
    }
  }
}

export interface SimHandle {
  runId: string;
  scenario: SimScenario;
  backend: MockBackend;
  settings: SimSettingsBackend;
  /** Mock clock speed factor (same as `backend.speedFactor`). */
  speed: number;
}

declare global {
  interface Window {
    /** Installed in browser mode only (never when `isTauri()` is true). */
    __SIM__?: SimHandle;
    /**
     * Journeys call this to preload a scenario under localStorage BEFORE the
     * page boots (see module docs for the handoff protocol). Provided on the
     * window for parity with __SIM__; implementation lives in this module.
     */
    __SIM_PREP__?: (runId: string, scenario: SimScenario) => void;
  }
}

let singleton: MockBackend | null = null;

/**
 * Returns (creating on first call) the mock backend for the current page.
 * A backend exists in every browser-mode page: default scenario + a generic
 * run id when no `__sim_run` session is active, or the handed-off run's
 * scenario otherwise. In a Tauri context callers must branch on `isTauri()`
 * first — this module never runs production paths.
 */
export function getSimBackend(): MockBackend {
  if (singleton) return singleton;
  const runId = detectSimRunId();
  const scenario = runId ? (readSimScenario(runId) ?? defaultScenario()) : defaultScenario();
  const title = runId ? `scenario:${runId}` : 'default-mock';
  const backend = new MockBackend(title, scenario, runId ?? 'dev');
  singleton = backend;
  window.__SIM__ = {
    runId: backend.runId,
    scenario,
    backend,
    settings: new LocalStorageSettingsBackend(backend.runId, backend.corruptSettingsEnabled),
    speed: backend.speedFactor,
  };
  window.__SIM_PREP__ = (id, scn) => {
    try {
      localStorage.setItem(simSessionKey(id), JSON.stringify(scn));
    } catch {
      // best-effort handoff; the journey will surface a harness error instead
    }
  };
  return backend;
}

export function getSimHandle(): SimHandle | null {
  return typeof window !== 'undefined' && window.__SIM__ ? window.__SIM__ : null;
}

/** True when the current page participates in a sim run (`?__sim_run=`). */
export function isSimRunActive(): boolean {
  return detectSimRunId() !== null;
}
