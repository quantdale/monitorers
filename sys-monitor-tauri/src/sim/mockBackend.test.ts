import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockBackend,
  defaultScenario,
  LocalStorageSettingsBackend,
  isSimRunActive,
  detectSimRunId,
  simSessionKey,
  simSettingsKey,
  type SimScenario,
} from './mockBackend';

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

  it('emits 4:1 on_tick ratio snapshots with schema_version 3', () => {
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
    expect([...new Set(versions)]).toEqual([3]);
  });

  it('default scenario carries the pre-bridge disk/GPU set', () => {
    const scenario = defaultScenario();
    expect(scenario.schema_version).toBe(3);
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
    expect(payload.schema_version).toBe(3);
    expect(payload.timestamps).toHaveLength(300);
    expect(payload.cpu).toHaveLength(300);
    expect(payload.disks.map((d) => d.key)).toEqual(['C:', 'D:']);
    expect(payload.gpus.map((g) => g.name)).toEqual(['UHD Graphics', 'RTX 4050']);
  });
});

describe('MockBackend fault injection', () => {
  it('collector-error halts emission and notifies', () => {
    const backend = makeBackend();
    const errorMessages: string[] = [];
    backend.onCollectorError((m) => errorMessages.push(m));
    backend.start();
    backend.injectFault({ kind: 'collector-error', message: 'boom' });
    expect(errorMessages).toEqual(['boom']);
    expect(backend.isHalted).toBe(true);
    // Halting stops the timer; starting again is a no-op.
    backend.start();
    expect(backend.isHalted).toBe(true);
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