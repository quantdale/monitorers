import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockBackend,
  defaultScenario,
  LocalStorageSettingsBackend,
  isSimRunActive,
  detectSimRunId,
  simSessionKey,
  simSettingsKey,
  validateSimSpeed,
  MAX_SIM_SPEED,
  type SimScenario,
} from './mockBackend';
import type { MetricsSnapshot } from '../types/metrics';

// jsdom provides window/localStorage; ensure a clean slate per test.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { ...window.location, search: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function makeBackend(scenario?: SimScenario): MockBackend {
  return new MockBackend('test', scenario ?? defaultScenario(), 'run-test');
}

describe('MockBackend default parity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits 4:1 on_tick ratio snapshots with schema_version 5', () => {
    vi.useFakeTimers();
    const backend = makeBackend();
    const onTicks: boolean[] = [];
    const versions: number[] = [];
    backend.onSnapshot((s) => {
      onTicks.push(s.on_tick);
      versions.push(s.schema_version);
    });
    backend.start();
    vi.advanceTimersByTime(4 * 250); // 4 simulation seconds
    expect(onTicks).toHaveLength(4);
    expect(onTicks).toEqual([false, false, false, true]);
    expect([...new Set(versions)]).toEqual([5]);
  });

  it('default scenario carries the pre-bridge disk/GPU set', () => {
    const scenario = defaultScenario();
    expect(scenario.schema_version).toBe(5);
    expect(scenario.speed).toBe(1);
    expect(scenario.disks?.map((d) => d.key)).toEqual(['C:', 'D:']);
    expect(scenario.gpus?.map((g) => [g.name, g.vendor])).toEqual([
      ['UHD Graphics', 'intel'],
      ['RTX 4050', 'nvidia'],
    ]);
  });

  it('getHistory returns a 300-point seed matching the pre-bridge shape', async () => {
    const backend = makeBackend();
    const payload = await backend.getHistory();
    expect(payload.schema_version).toBe(5);
    expect(payload.timestamps).toHaveLength(300);
    expect(payload.cpu).toHaveLength(300);
    expect(payload.disks.map((d) => d.key)).toEqual(['C:', 'D:']);
    expect(payload.gpus.map((g) => g.name)).toEqual(['UHD Graphics', 'RTX 4050']);
  });

  it('keeps distinct telemetry on two same-name Nvidia fixture devices', () => {
    vi.useFakeTimers();
    const backend = makeBackend({
      version: 1,
      speed: 1,
      disks: [],
      gpus: [
        { key: 'GPU-uuid-a', name: 'GeForce RTX 3060', vendor: 'nvidia', nvidia: { temp_c: 51, power_w: 100 } },
        { key: 'GPU-uuid-b', name: 'GeForce RTX 3060', vendor: 'nvidia', nvidia: { temp_c: 72, power_w: 180 } },
      ],
    });
    const snapshots: MetricsSnapshot[] = [];
    backend.onSnapshot((snapshot) => snapshots.push(snapshot));
    backend.start();
    vi.advanceTimersByTime(250);
    const gpus = snapshots.at(-1)?.gpus ?? [];
    expect(gpus.map((gpu) => gpu.key)).toEqual(['GPU-uuid-a', 'GPU-uuid-b']);
    expect(gpus.map((gpu) => gpu.nvidia?.temp_c)).toEqual([51, 72]);
    expect(gpus.map((gpu) => gpu.nvidia?.power_w)).toEqual([100, 180]);
    backend.stop();
  });

  it.each([0.5, 1, 2, 8, MAX_SIM_SPEED])(
    'speed %s represents simulated seconds per wall-clock second',
    (speed) => {
      vi.useFakeTimers();
      const backend = makeBackend({ ...defaultScenario(), speed });
      backend.start();
      vi.advanceTimersByTime(1000);
      expect(Math.abs(backend.simSeconds - speed)).toBeLessThanOrEqual(0.5);
      backend.stop();
    }
  );

  it('keeps explicit empty hardware empty', async () => {
    vi.useFakeTimers();
    const backend = makeBackend({ version: 1, disks: [], gpus: [], speed: 1 });
    const history = await backend.getHistory();
    expect(history.disks).toEqual([]);
    expect(history.gpus).toEqual([]);
    const snapshots: MetricsSnapshot[] = [];
    backend.onSnapshot((snapshot) => snapshots.push(snapshot));
    backend.start();
    vi.advanceTimersByTime(250);
    expect(snapshots[0]?.disks).toEqual([]);
    expect(snapshots[0]?.gpus).toEqual([]);
    backend.stop();
  });

  it('clones defaults and caller hardware per backend instance', async () => {
    const scenario = defaultScenario();
    const first = makeBackend(scenario);
    const second = makeBackend(scenario);
    first.injectFault({ kind: 'disk-add', key: 'E:' });
    first.injectFault({ kind: 'gpu-add', name: 'Arc', vendor: 'intel' });
    expect((await second.getHistory()).disks.map((disk) => disk.key)).toEqual(['C:', 'D:']);
    expect((await second.getHistory()).gpus.map((gpu) => gpu.name)).toEqual(['UHD Graphics', 'RTX 4050']);
    expect(scenario.disks?.map((disk) => disk.key)).toEqual(['C:', 'D:']);
    expect(defaultScenario().disks?.map((disk) => disk.key)).toEqual(['C:', 'D:']);
    expect(defaultScenario().gpus?.map((gpu) => gpu.name)).toEqual(['UHD Graphics', 'RTX 4050']);
  });

  it('can remove and re-add a GPU by its stable fixture key', async () => {
    const backend = makeBackend({
      version: 1,
      disks: [],
      gpus: [{ key: 'GPU-stable', name: 'Fixture GPU', vendor: 'nvidia' }],
    });
    backend.injectFault({ kind: 'gpu-remove', key: 'GPU-stable' });
    expect((await backend.getHistory()).gpus).toEqual([]);
    backend.injectFault({ kind: 'gpu-add', key: 'GPU-stable', name: 'Fixture GPU', vendor: 'nvidia' });
    expect((await backend.getHistory()).gpus.map((gpu) => gpu.key)).toEqual(['GPU-stable']);
  });
});

describe('simulation speed validation', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, MAX_SIM_SPEED + 1])(
    'rejects invalid speed %s',
    (speed) => {
      expect(() => validateSimSpeed(speed)).toThrow(/speed must be finite/);
    }
  );
});

describe('MockBackend fault injection', () => {
  it('collector-error halts emission, notifies, and reports terminal failed status', () => {
    const backend = makeBackend();
    const errorMessages: string[] = [];
    const statuses: string[] = [];
    backend.onCollectorError((m) => errorMessages.push(m));
    backend.onCollectorStatus((s) => statuses.push(s.state));
    backend.start();
    backend.injectFault({ kind: 'collector-error', message: 'boom' });
    expect(errorMessages).toEqual(['boom']);
    expect(backend.isHalted).toBe(true);
    expect(statuses.at(-1)).toBe('failed');
    expect(backend.getStatus().reason).toBe('boom');
    // Halting stops the timer; starting again is a no-op.
    backend.start();
    expect(backend.isHalted).toBe(true);
  });

  it('collector-crash walks recovering → starting → (first emit) → healthy', () => {
    vi.useFakeTimers();
    const backend = makeBackend();
    const statuses: string[] = [];
    const attempts: number[] = [];
    let emissionsAfterRecovery = 0;
    backend.onCollectorStatus((s) => {
      statuses.push(s.state);
      attempts.push(s.attempt);
    });
    backend.start();
    vi.advanceTimersByTime(250);
    // Initial mount: healthy only after the first real emission.
    expect(statuses).toEqual(['starting', 'healthy']);

    backend.injectFault({ kind: 'collector-crash', reason: 'synthetic panic', recoverAfterMs: 1_000 });
    expect(statuses.at(-1)).toBe('recovering');
    expect(attempts.at(-1)).toBe(1);

    vi.advanceTimersByTime(1_000);
    // Replacement generation started, but NOT healthy yet — no data emitted.
    expect(statuses.at(-1)).toBe('starting');
    backend.onSnapshot(() => {
      emissionsAfterRecovery += 1;
    });
    vi.advanceTimersByTime(250); // first replacement tick emits
    expect(emissionsAfterRecovery).toBeGreaterThan(0);
    expect(statuses.at(-1)).toBe('healthy'); // healthy only AFTER that data
    expect(attempts.at(-1)).toBe(0);
    vi.useRealTimers();
  });

  it('collector-crash-permanent exhausts the budget into a persistent failed state until retryCollection', () => {
    vi.useFakeTimers();
    const backend = makeBackend();
    const statuses: string[] = [];
    backend.onCollectorStatus((s) => statuses.push(s.state));
    backend.start();

    backend.injectFault({ kind: 'collector-crash-permanent', reason: 'repeat', attempts: 3, stageMs: 500 });
    vi.advanceTimersByTime(3 * 500 + 500);
    expect(statuses.filter((s) => s === 'recovering')).toHaveLength(3);
    expect(statuses.at(-1)).toBe('failed');
    expect(backend.getStatus().attempt).toBe(4); // max_attempts + 1
    expect(backend.isHalted).toBe(true);

    // retryCollection outside failed would be a no-op; from failed it restores.
    vi.advanceTimersByTime(2_000);
    expect(statuses.at(-1)).toBe('failed'); // no automatic restart while failed

    expect(backend.retryCollection()).toBe('failed'); // mirrors the command contract
    expect(statuses.at(-1)).toBe('starting'); // replacement generation started…
    vi.advanceTimersByTime(250); // …and its first tick emits → healthy
    expect(statuses.at(-1)).toBe('healthy');
    expect(backend.isHalted).toBe(false);
    vi.useRealTimers();
  });

  it('schema-version fault changes the schema_version of emitted snapshots', () => {
    vi.useFakeTimers();
    const backend = makeBackend();
    const versions: number[] = [];
    backend.onSnapshot((s) => versions.push(s.schema_version));
    backend.start();
    backend.injectFault({ kind: 'schema-version', version: 7 });
    vi.advanceTimersByTime(250);
    expect(versions[versions.length - 1]).toBe(7);
    vi.useRealTimers();
  });

  it('disk-remove / disk-add mutate the active disk set for history seeds', async () => {
    const backend = makeBackend();
    backend.injectFault({ kind: 'disk-remove', key: 'D:' });
    let payload = await backend.getHistory();
    expect(payload.disks.map((d) => d.key)).toEqual(['C:']);
    backend.injectFault({ kind: 'disk-add', key: 'E:' });
    payload = await backend.getHistory();
    expect(payload.disks.map((d) => d.key)).toEqual(['C:', 'E:']);
  });

  it('history-load-fail rejects getHistory', async () => {
    const backend = makeBackend();
    backend.setHistoryFault({ mode: 'fail' });
    await expect(backend.getHistory()).rejects.toThrow(/simulated history load failure/);
  });

  it('history-load-slow resolves after the delay', async () => {
    const backend = makeBackend();
    backend.setHistoryFault({ mode: 'slow', delayMs: 30 });
    const began = Date.now();
    await backend.getHistory();
    expect(Date.now() - began).toBeGreaterThanOrEqual(25);
  });
});

describe('LocalStorageSettingsBackend', () => {
  it('round-trips a run-namespaced settings patch', async () => {
    const shim = new LocalStorageSettingsBackend('run-1', false);
    await shim.save({ cardOrder: ['cpu', 'memory'], windowSecs: 600 });
    const loaded = await shim.load();
    expect(loaded.cardOrder).toEqual(['cpu', 'memory']);
    expect(loaded.windowSecs).toBe(600);
    // Namespaced: another run does not see it.
    const other = new LocalStorageSettingsBackend('run-2', false);
    expect(await other.load()).toEqual({});
  });

  it('returns corrupt payload when corrupt is enabled', async () => {
    const shim = new LocalStorageSettingsBackend('run-1', true);
    const loaded = await shim.load();
    expect(loaded.viewMode).toBe('banana');
    expect(loaded.cardOrder).toBe('definitely-not-an-array');
  });
});

describe('run detection and keys', () => {
  it('detects an active run from the URL query param', () => {
    vi.stubGlobal(
      'location',
      { ...window.location, search: '?__sim_run=abc123' }
    );
    expect(detectSimRunId()).toBe('abc123');
    expect(isSimRunActive()).toBe(true);
  });

  it('is not active when no run param is present', () => {
    expect(detectSimRunId()).toBeNull();
    expect(isSimRunActive()).toBe(false);
  });

  it('builds per-run storage keys', () => {
    expect(simSessionKey('r')).toBe('sysmon_sim_session_r');
    expect(simSettingsKey('r')).toBe('sysmon_sim_settings_r');
  });
});

// --- Lifecycle parity + singleton teardown (production-contract regressions) ---

describe('MockBackend recovery lifecycle parity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBackend2(): InstanceType<typeof MockBackend> {
    return new MockBackend('test', defaultScenario(), 'run-lifecycle');
  }

  it('timer scheduled != healthy: a replacement that never emits stays unhealthy', () => {
    vi.useFakeTimers();
    const backend = makeBackend2();
    const statuses: string[] = [];
    const events: string[] = [];
    backend.onCollectorStatus((s) => {
      statuses.push(s.state);
      events.push(`status:${s.state}`);
    });
    backend.onSnapshot(() => events.push('snapshot'));
    backend.start();
    vi.advanceTimersByTime(250);

    backend.injectFault({ kind: 'collector-crash', reason: 'panic', recoverAfterMs: 1_000 });
    // Kill the backend BEFORE the replacement's first emission window.
    vi.advanceTimersByTime(500); // t=750: still recovering, timer stopped
    expect(statuses.at(-1)).toBe('recovering');
    backend.stop();

    const snapshotCount = events.filter((e) => e === 'snapshot').length;
    vi.advanceTimersByTime(60_000); // far past every deadline
    // No resurrection, no fabricated healthy transition — the ONLY healthy
    // ever reported is the pre-fault generation's.
    expect(events.filter((e) => e === 'snapshot')).toHaveLength(snapshotCount);
    expect(statuses.filter((s) => s === 'healthy')).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe('recovering');
  });

  it('stop() during automatic recovery cancels the pending restart', () => {
    vi.useFakeTimers();
    const backend = makeBackend2();
    const statuses: string[] = [];
    backend.onCollectorStatus((s) => statuses.push(s.state));
    backend.start();
    vi.advanceTimersByTime(250);
    const generationBefore = backend.getStatus().generation;

    backend.injectFault({ kind: 'collector-crash', recoverAfterMs: 800 });
    vi.advanceTimersByTime(300); // mid-backoff
    backend.stop(); // unmount during recovery
    vi.advanceTimersByTime(30_000);

    expect(statuses.filter((s) => s === 'starting')).toHaveLength(1); // only the original
    expect(backend.getStatus().generation).toBe(generationBefore + 1); // crash bumped once, restart never ran
  });

  it('stop() during retry-exhaustion staging freezes progression and never reaches failed', () => {
    vi.useFakeTimers();
    const backend = makeBackend2();
    const statuses: string[] = [];
    let errors = 0;
    backend.onCollectorStatus((s) => statuses.push(s.state));
    backend.onCollectorError(() => (errors += 1));
    backend.start();

    backend.injectFault({ kind: 'collector-crash-permanent', attempts: 3, stageMs: 500 });
    vi.advanceTimersByTime(600); // first staged attempt fired
    expect(statuses.at(-1)).toBe('recovering');
    backend.stop(); // teardown mid-staging

    const frozenGeneration = backend.getStatus().generation;
    vi.advanceTimersByTime(120_000);
    expect(errors).toBe(0);
    expect(backend.isHalted).toBe(false);
    expect(backend.getStatus().state).toBe('recovering');
    expect(backend.getStatus().generation).toBe(frozenGeneration);
  });

  it('remount after plain stop resumes with a fresh generation and full lifecycle', () => {
    vi.useFakeTimers();
    const backend = makeBackend2();
    const statuses: string[] = [];
    backend.onCollectorStatus((s) => statuses.push(s.state));
    backend.start();
    vi.advanceTimersByTime(250);
    expect(statuses).toEqual(['starting', 'healthy']);
    backend.stop();

    statuses.length = 0;
    backend.start(); // remount: fresh generation, same starting→(emit)→healthy contract
    expect(statuses).toEqual(['starting']);
    expect(backend.getStatus().generation).toBe(2);
    vi.advanceTimersByTime(250);
    expect(statuses.at(-1)).toBe('healthy');
  });

  it('stale recovery timeout after remount cannot resurrect or double-bump the generation', () => {
    vi.useFakeTimers();
    const backend = makeBackend2();
    const statuses: string[] = [];
    const generationsAtHealthy: number[] = [];
    backend.onCollectorStatus((s) => {
      statuses.push(s.state);
      if (s.state === 'healthy') generationsAtHealthy.push(s.generation);
    });
    backend.start();
    vi.advanceTimersByTime(250); // gen1 healthy

    backend.injectFault({ kind: 'collector-crash', recoverAfterMs: 1_000 }); // recovering gen2
    vi.advanceTimersByTime(400);
    backend.stop(); // cancels the pending restart (token bump + clearTimeout)
    backend.start(); // "remount" — gen3
    vi.advanceTimersByTime(250); // gen3 first emit → healthy gen3
    expect(backend.getStatus().generation).toBe(3);

    // The ORIGINAL recovery timeout would now be long past — it must never fire.
    vi.advanceTimersByTime(60_000);
    expect(backend.getStatus().generation).toBe(3);
    expect(generationsAtHealthy).toEqual([1, 3]);
    expect(statuses.filter((s) => s === 'starting')).toHaveLength(2);
  });
});
