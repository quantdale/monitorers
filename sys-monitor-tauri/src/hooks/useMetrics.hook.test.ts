import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { HistoryPayload, MetricsSnapshot } from '../types/metrics';

// Fakes the Tauri event/invoke surface so the hook's real "metrics-update" /
// "collector-error" listener wiring can be exercised end-to-end, the same way
// it would run against a live backend — without a real Tauri runtime.
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let deferredHistory = false;
let retryInvocations = 0;
let retryResult: string | null = null;
// get_collector_status bootstrap controls (null = reject, 'defer' = park).
type StatusAnswer = { status: CollectorStatus } | { error: Error } | 'defer' | 'unset';
let collectorStatusAnswer: StatusAnswer = 'unset';
let collectorStatusRequests: Array<{ resolve: (s: CollectorStatus) => void; reject: (e: Error) => void }> = [];
let collectorStatusInvokeCount = 0;
const historyRequests: Array<{ resolve: (payload: HistoryPayload) => void; reject: (error: Error) => void }> = [];

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, cb: (event: { payload: unknown }) => void) => {
    listeners.set(eventName, cb);
    return Promise.resolve(() => listeners.delete(eventName));
  }),
}));

function emptyHistoryPayload(): HistoryPayload {
  return {
    schema_version: 5,
    timestamps: [],
    cpu: [],
    cpu_name: 'CPU',
    cpu_temp_c: null,
    mem: [],
    disks: [],
    net_recv: [],
    net_sent: [],
    gpus: [],
  };
}

let historyInvokeError: Error | null = null;
let historySchemaVersion: number | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => {
    if (command === 'retry_collection') {
      retryInvocations += 1;
      if (retryResult !== null) return Promise.resolve(retryResult);
      return Promise.resolve('failed');
    }
    if (command === 'get_collector_status') {
      collectorStatusInvokeCount += 1;
      if (collectorStatusAnswer === 'unset') {
        return Promise.reject(new Error('collector status not configured by test'));
      }
      if (collectorStatusAnswer === 'defer') {
        return new Promise<CollectorStatus>((resolve, reject) =>
          collectorStatusRequests.push({ resolve, reject })
        );
      }
      if ('error' in collectorStatusAnswer) return Promise.reject(collectorStatusAnswer.error);
      return Promise.resolve(collectorStatusAnswer.status);
    }
    if (deferredHistory) {
      return new Promise<HistoryPayload>((resolve, reject) => historyRequests.push({ resolve, reject }));
    }
    if (historyInvokeError) return Promise.reject(historyInvokeError);
    const payload = emptyHistoryPayload();
    if (historySchemaVersion !== null) payload.schema_version = historySchemaVersion;
    return Promise.resolve(payload);
  }),
}));

import { useMetrics, type SlicedHistory } from './useMetrics';
import type { CollectorStatus } from '../types/metrics';

function baseSnapshot(onTick: boolean): MetricsSnapshot {
  return {
    schema_version: 5,
    on_tick: onTick,
    cpu: 42,
    cpu_name: 'CPU',
    cpu_temp_c: 50,
    mem: 60,
    mem_used_gb: 8,
    mem_total_gb: 16,
    disks: [],
    net_recv_kib_s: 0,
    net_sent_kib_s: 0,
    gpus: [],
  };
}

function emit(eventName: string, payload: unknown) {
  const cb = listeners.get(eventName);
  if (!cb) throw new Error(`no listener registered for ${eventName}`);
  cb({ payload });
}

function status(state: CollectorStatus['state'], overrides: Partial<CollectorStatus> = {}): CollectorStatus {
  return {
    schema_version: 1,
    state,
    generation: 1,
    attempt: 0,
    max_attempts: 3,
    reason: null,
    timestamp_ms: Date.now(),
    ...overrides,
  };
}

interface RenderResult {
  result: () => SlicedHistory;
  historyLoadError: () => string | null;
  lifecycle: () => CollectorStatus | null;
  retryMetrics: () => Promise<CollectorStatus['state'] | null>;
  unmount: () => void;
  rerender: (windowSecs: number) => void;
}

function renderUseMetrics(windowSecs: number): RenderResult {
  let hookValue: ReturnType<typeof useMetrics> | undefined;
  const container = document.createElement('div');
  let root: Root;

  function TestComponent({ w }: { w: number }) {
    hookValue = useMetrics(w);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent, { w: windowSecs }));
  });

  return {
    result: () => {
      if (!hookValue?.metrics) throw new Error('metrics not loaded yet');
      return hookValue.metrics;
    },
    historyLoadError: () => hookValue?.historyLoadError ?? null,
    lifecycle: () => hookValue?.lifecycle ?? null,
    retryMetrics: () => (hookValue ? hookValue.retryMetrics() : Promise.resolve(null)),
    unmount: () => act(() => root.unmount()),
    rerender: (w: number) => act(() => root.render(React.createElement(TestComponent, { w }))),
  };
}

/** Resets every harness knob so a test starts from a pristine IPC mock. */
function freshIpcMock(): void {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  listeners.clear();
  historyInvokeError = null;
  historySchemaVersion = null;
  deferredHistory = false;
  retryInvocations = 0;
  retryResult = null;
  historyRequests.length = 0;
  collectorStatusAnswer = 'unset';
  collectorStatusRequests = [];
  collectorStatusInvokeCount = 0;
}

describe('useMetrics (Tauri event wiring)', () => {
  beforeEach(freshIpcMock);

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  // --- 4.3: get_history rejection surfaces historyLoadError (ERR-006) ---

  it('sets historyLoadError instead of only warning when get_history rejects', async () => {
    historyInvokeError = new Error('IPC channel closed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { historyLoadError, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(historyLoadError()).toBe('IPC channel closed');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    unmount();
  });

  // --- METRICS-001: a failed initial get_history is recovered by live events ---

  it('seeds charts from the first on_tick snapshot after get_history failed, and clears the error', async () => {
    historyInvokeError = new Error('IPC channel closed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, historyLoadError, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(historyLoadError()).toBe('IPC channel closed');
    expect(() => result()).toThrow('metrics not loaded yet'); // still null

    // A live snapshot with on_tick lands: the error is moot, history seeds.
    act(() => {
      emit('metrics-update', {
        ...baseSnapshot(true),
        disks: [{ key: 'C:', active: 12, read_mb_s: 1, write_mb_s: 2, avg_response_ms: 3 }],
        gpus: [{ key: 'gpu-a', name: 'GeForce RTX 4050', vendor: 'nvidia', util: 33, temp_c: 55 }],
      });
    });

    expect(historyLoadError()).toBeNull();
    expect(result().cpu).toEqual([42]);
    expect(result().disks).toHaveLength(1);
    expect(result().disks[0].key).toBe('C:');
    expect(result().gpus).toHaveLength(1);
    expect(result().gpus[0].latest).toBe(33);

    // Subsequent on_tick snapshots keep appending normally.
    act(() => {
      emit('metrics-update', baseSnapshot(true));
    });
    expect(result().cpu).toEqual([42, 42]);

    warnSpy.mockRestore();
    unmount();
  });

  it('does not seed history from non-on_tick snapshots when get_history failed', async () => {
    historyInvokeError = new Error('IPC channel closed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, historyLoadError, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      emit('metrics-update', baseSnapshot(false));
    });

    // A non-on_tick event proves liveness, but does not prove that the failed
    // history request for the selected window recovered.
    expect(historyLoadError()).toBe('IPC channel closed');
    expect(() => result()).toThrow('metrics not loaded yet');

    act(() => {
      emit('metrics-update', baseSnapshot(true));
    });
    expect(result().cpu).toEqual([42]); // exactly one point: the non-on_tick event seeded nothing

    warnSpy.mockRestore();
    unmount();
  });

  // --- 5.2 (updated for supervision): collectorError survives unrelated live
  // events and clears only on actual recovery proof (a healthy status) ---

  it('collectorError stays set across metrics-update events and clears when a healthy status arrives', async () => {
    const { result, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result().collectorError).toBeNull();

    act(() => {
      emit('collector-error', 'metrics collection stopped — restart the app');
    });
    expect(result().collectorError).toBe('metrics collection stopped — restart the app');

    // Further live snapshots must not clear it — only recovery proof does.
    act(() => {
      emit('metrics-update', baseSnapshot(true));
    });
    act(() => {
      emit('metrics-update', baseSnapshot(false));
    });
    expect(result().collectorError).toBe('metrics collection stopped — restart the app');

    // A recovering status alone must not clear it either...
    act(() => {
      emit('collector-status', status('recovering', { generation: 2, attempt: 1, reason: 'tick panicked' }));
    });
    expect(result().collectorError).toBe('metrics collection stopped — restart the app');
    expect(result().collectorState).toBe('recovering');

    // ...but a healthy status is actual recovery proof.
    act(() => {
      emit('collector-status', status('healthy', { generation: 3 }));
    });
    expect(result().collectorError).toBeNull();
    expect(result().collectorState).toBe('healthy');

    unmount();
  });

  // --- supervised lifecycle transitions ---

  it('tracks healthy → recovering → healthy with last-known metrics retained', async () => {
    const { result, lifecycle, unmount } = renderUseMetrics(60);
    await act(async () => { await Promise.resolve(); });

    act(() => emit('collector-status', status('starting', { generation: 1 })));
    act(() => emit('collector-status', status('healthy', { generation: 1 })));
    expect(lifecycle()?.state).toBe('healthy');

    act(() => emit('metrics-update', baseSnapshot(true)));
    const beforeFailure = result().cpu.length;

    act(() => emit('collector-status', status('recovering', { generation: 2, attempt: 1, reason: 'synthetic panic' })));
    expect(lifecycle()?.attempt).toBe(1);
    expect(lifecycle()?.reason).toBe('synthetic panic');
    expect(result().collectorState).toBe('recovering');
    // Last-known history is untouched during recovery (no zeros, no blanks).
    expect(result().cpu.length).toBe(beforeFailure);
    expect(result().cpu.every((v) => v === 42)).toBe(true);

    // Replacement session becomes healthy; metrics resume appending.
    act(() => emit('collector-status', status('healthy', { generation: 2 })));
    expect(result().collectorState).toBe('healthy');
    act(() => emit('metrics-update', baseSnapshot(true)));
    expect(result().cpu.length).toBe(beforeFailure + 1);

    unmount();
  });

  it('tracks healthy → recovering → failed and exposes the failure reason', async () => {
    const { result, lifecycle, unmount } = renderUseMetrics(60);
    await act(async () => { await Promise.resolve(); });

    act(() => emit('collector-status', status('recovering', { generation: 2, attempt: 1, reason: 'crash one' })));
    act(() => emit('collector-status', status('failed', { generation: 4, attempt: 4, reason: 'budget exhausted' })));
    expect(lifecycle()?.state).toBe('failed');
    expect(lifecycle()?.reason).toBe('budget exhausted');
    expect(result().collectorState).toBe('failed');
    unmount();
  });

  it('manual retry invokes retry_collection once and reports the backend answer', async () => {
    const { retryMetrics, lifecycle, unmount } = renderUseMetrics(60);
    await act(async () => { await Promise.resolve(); });

    act(() => emit('collector-status', status('failed', { generation: 4, attempt: 4, reason: 'exhausted' })));
    let answered: string | null = null;
    await act(async () => {
      retryResult = 'failed';
      answered = await retryMetrics();
    });
    expect(retryInvocations).toBe(1);
    expect(answered).toBe('failed');

    // Backend accepted the retry and transitioned.
    await act(async () => {
      retryResult = 'starting';
      answered = await retryMetrics();
    });
    expect(retryInvocations).toBe(2);
    expect(answered).toBe('starting');

    act(() => emit('collector-status', status('starting', { generation: 5, attempt: 0 })));
    act(() => emit('collector-status', status('healthy', { generation: 5 })));
    expect(lifecycle()?.state).toBe('healthy');
    unmount();
  });

  it('rejects an incompatible lifecycle payload without mutating lifecycle state and recovers on a valid one', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { lifecycle, historyLoadError, unmount } = renderUseMetrics(60);
    await act(async () => { await Promise.resolve(); });

    act(() => emit('collector-status', status('healthy')));
    expect(lifecycle()?.state).toBe('healthy');

    act(() => emit('collector-status', { ...status('recovering'), schema_version: 99 }));
    // Fail closed: state unchanged, actionable mismatch surfaced.
    expect(lifecycle()?.state).toBe('healthy');
    expect(historyLoadError()).toMatch(/lifecycle schema mismatch/i);
    expect(errorSpy).toHaveBeenCalled();

    // The listener remains attached: a compatible payload recovers cleanly.
    act(() => emit('collector-status', status('recovering', { generation: 2, attempt: 1, reason: 'ok again' })));
    expect(lifecycle()?.state).toBe('recovering');
    expect(historyLoadError()).toBeNull();

    errorSpy.mockRestore();
    unmount();
  });

  it('history appends exactly once per full tick across a collector generation change', async () => {
    const { result, unmount } = renderUseMetrics(3600);
    await act(async () => { await Promise.resolve(); });

    act(() => emit('metrics-update', baseSnapshot(true)));   // gen1 full tick
    act(() => emit('metrics-update', baseSnapshot(false)));  // gen1 live tick
    expect(result().cpu.length).toBe(1);

    // Generation boundary: old session dies, replacement starts emitting.
    act(() => emit('collector-status', status('recovering', { generation: 2, attempt: 1, reason: 'panic' })));
    act(() => emit('collector-status', status('healthy', { generation: 2 })));
    act(() => emit('metrics-update', baseSnapshot(true)));   // gen2 first full tick
    act(() => emit('metrics-update', baseSnapshot(false)));  // gen2 live tick
    act(() => emit('metrics-update', baseSnapshot(true)));   // gen2 second full tick

    expect(result().cpu.length).toBe(3); // exactly one append per full tick, no duplicates
    expect(result().timestamps).toHaveLength(3);
    const ts = result().timestamps;
    expect(ts.every((t, i) => i === 0 || t >= ts[i - 1])).toBe(true);

    unmount();
  });

  // --- 5.4: history length tracks on_tick count, not event count ---

  it('history array length matches the number of on_tick events, not the total event count', async () => {
    const { result, unmount } = renderUseMetrics(3600);
    await act(async () => {
      await Promise.resolve();
    });

    const initialLen = result().cpu.length; // 0 (mocked empty history payload)
    expect(initialLen).toBe(0);

    // 40 events at the real 250ms cadence (10s), 1/4 of which are full-poll
    // (on_tick) ticks — mirrors is_full_poll_tick's 4-tick cadence in main.rs.
    let onTickCount = 0;
    act(() => {
      for (let tick = 0; tick < 40; tick++) {
        const onTick = tick % 4 === 0;
        if (onTick) onTickCount++;
        emit('metrics-update', baseSnapshot(onTick));
      }
    });

    expect(onTickCount).toBe(10); // 10 seconds of elapsed time
    expect(result().cpu.length).toBe(10); // history grew 1:1 with elapsed seconds
    expect(result().cpu.length).not.toBe(40); // not 1:1 with raw event count

    unmount();
  });

  it('rejects an incompatible history payload before it can seed state', async () => {
    historySchemaVersion = 3;
    const { result, historyLoadError, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(historyLoadError()).toMatch(/schema mismatch/i);
    expect(() => result()).toThrow('metrics not loaded yet');
    unmount();
  });

  it('rejects an incompatible live snapshot without mutating current state', async () => {
    const { result, historyLoadError, unmount } = renderUseMetrics(60);
    await act(async () => { await Promise.resolve(); });
    act(() => emit('metrics-update', baseSnapshot(true)));
    expect(result().latestCpu).toBe(42);

    act(() => emit('metrics-update', { ...baseSnapshot(true), schema_version: 3, cpu: 99 }));
    expect(result().latestCpu).toBe(42);
    expect(result().cpu).toEqual([42]);
    expect(historyLoadError()).toMatch(/schema mismatch/i);
    unmount();
  });

  it('keeps the newer history request when an older deferred request resolves last', async () => {
    deferredHistory = true;
    const { result, unmount, rerender } = renderUseMetrics(30);
    rerender(60);
    expect(historyRequests).toHaveLength(2);
    const newer = { ...emptyHistoryPayload(), timestamps: [2_000], cpu: [20], mem: [20], net_recv: [0], net_sent: [0] };
    const older = { ...emptyHistoryPayload(), timestamps: [1_000], cpu: [10], mem: [10], net_recv: [0], net_sent: [0] };
    await act(async () => { historyRequests[1].resolve(newer); await Promise.resolve(); });
    await act(async () => { historyRequests[0].resolve(older); await Promise.resolve(); });
    expect(result().cpu).toEqual([20]);
    unmount();
  });

  it('keeps the metrics object referentially stable across unrelated re-renders', async () => {
    const { result, rerender, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => emit('metrics-update', baseSnapshot(true)));
    const first = result();

    // A re-render with unchanged inputs must not rebuild the sliced payload…
    rerender(60);
    expect(result()).toBe(first);

    // …but a new on_tick snapshot must produce a fresh object.
    act(() => emit('metrics-update', baseSnapshot(true)));
    expect(result()).not.toBe(first);
    expect(result().cpu).toEqual([42, 42]);

    unmount();
  });

  it('replays a live full-tick received during a deferred refetch instead of rolling back', async () => {
    deferredHistory = true;
    const { result, unmount } = renderUseMetrics(60);
    act(() => emit('metrics-update', { ...baseSnapshot(true), cpu: 42 }));
    await act(async () => {
      historyRequests[0].resolve({ ...emptyHistoryPayload(), timestamps: [1_000], cpu: [10], mem: [10], net_recv: [0], net_sent: [0] });
      await Promise.resolve();
    });
    expect(result().cpu.at(-1)).toBe(42);
    unmount();
  });
});

// --- Lifecycle bootstrap (get_collector_status on mount/reload) ---
//
// Regression coverage for the P1 finding: the Tauri branch used to install
// listeners without ever fetching the CURRENT managed status, so a webview
// that mounted/reloaded while supervision was already `failed` showed nothing
// until the next transition event.

describe('useMetrics lifecycle bootstrap', () => {
  beforeEach(freshIpcMock);

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  /** Drain the microtask queue enough times for listen→invoke→apply chains. */
  async function flush(times = 6): Promise<void> {
    await act(async () => {
      for (let i = 0; i < times; i += 1) await Promise.resolve();
    });
  }

  it('bootstraps a healthy-before-mount supervisor without any event', async () => {
    collectorStatusAnswer = { status: status('healthy', { generation: 7 }) };
    const { lifecycle, unmount } = renderUseMetrics(60);
    await flush();
    expect(collectorStatusInvokeCount).toBe(1);
    expect(lifecycle()?.state).toBe('healthy');
    expect(lifecycle()?.generation).toBe(7);
    unmount();
  });

  it('bootstraps failed-before-mount so the Retry UX is available immediately', async () => {
    collectorStatusAnswer = {
      status: status('failed', { generation: 4, attempt: 4, reason: 'budget exhausted' }),
    };
    const { lifecycle, result, unmount } = renderUseMetrics(60);
    await flush();
    expect(lifecycle()?.state).toBe('failed');
    expect(lifecycle()?.reason).toBe('budget exhausted');
    expect(result().collectorState).toBe('failed');
    unmount();
  });

  it('bootstraps recovering-before-mount with attempt metadata intact', async () => {
    collectorStatusAnswer = {
      status: status('recovering', { generation: 2, attempt: 2, reason: 'tick panicked' }),
    };
    const { lifecycle, result, unmount } = renderUseMetrics(60);
    await flush();
    expect(lifecycle()?.state).toBe('recovering');
    expect(result().collectorState).toBe('recovering');
    unmount();
  });

  it('an event applied during bootstrap wins over the older fetched status', async () => {
    collectorStatusAnswer = 'defer';
    const { lifecycle, unmount } = renderUseMetrics(60);
    await flush();

    // A live transition lands while the fetch is still in flight.
    act(() => emit('collector-status', status('healthy', { generation: 9 })));
    expect(lifecycle()?.generation).toBe(9);

    // The slower fetch resolves with an OLDER managed snapshot — it must be
    // discarded, not overwrite the newer observed state.
    await act(async () => {
      collectorStatusRequests[0].resolve(status('starting', { generation: 8 }));
      await Promise.resolve();
    });
    expect(lifecycle()?.state).toBe('healthy');
    expect(lifecycle()?.generation).toBe(9);
    unmount();
  });

  it('applies the fetched status when no event raced the bootstrap', async () => {
    collectorStatusAnswer = 'defer';
    const { lifecycle, unmount } = renderUseMetrics(60);
    await flush();
    expect(lifecycle()).toBeNull(); // nothing applied yet
    await act(async () => {
      collectorStatusRequests[0].resolve(status('healthy', { generation: 3 }));
      await Promise.resolve();
    });
    expect(lifecycle()?.state).toBe('healthy');
    expect(lifecycle()?.generation).toBe(3);
    unmount();
  });

  it('a malformed bootstrapped lifecycle payload fails visibly and recovers on a valid event', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    collectorStatusAnswer = {
      status: { ...status('failed'), schema_version: 99 },
    };
    const { lifecycle, historyLoadError, unmount } = renderUseMetrics(60);
    await flush();

    // Fail closed: no lifecycle state, actionable mismatch surfaced.
    expect(lifecycle()).toBeNull();
    expect(historyLoadError()).toMatch(/lifecycle schema mismatch/i);

    // Later valid recovery through the still-attached listener.
    act(() => emit('collector-status', status('recovering', { generation: 5 })));
    expect(lifecycle()?.state).toBe('recovering');
    expect(historyLoadError()).toBeNull();

    errorSpy.mockRestore();
    unmount();
  });

  it('unmount during bootstrap never applies the late response', async () => {
    collectorStatusAnswer = 'defer';
    const { lifecycle, unmount } = renderUseMetrics(60);
    await flush();
    unmount();
    await flush(2);
    expect(listeners.size).toBe(0); // all listeners detached
    await act(async () => {
      collectorStatusRequests[0].resolve(status('failed', { generation: 4 }));
      await Promise.resolve();
    });
    // No crash, no state resurrection — the harness cannot observe stale
    // updates because the hook instance is gone; assert via listener teardown.
    expect(lifecycle()).toBeNull();
  });

  it('remount after failure re-bootstraps the current failed status', async () => {
    collectorStatusAnswer = {
      status: status('failed', { generation: 4, attempt: 4, reason: 'exhausted' }),
    };
    const first = renderUseMetrics(60);
    await flush();
    expect(first.lifecycle()?.state).toBe('failed');
    first.unmount();

    collectorStatusInvokeCount = 0;
    const second = renderUseMetrics(60);
    await flush();
    expect(collectorStatusInvokeCount).toBe(1); // fresh bootstrap per mount
    expect(second.lifecycle()?.state).toBe('failed');
    second.unmount();
  });

  it('a rejected bootstrap fetch degrades gracefully and events keep working', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    collectorStatusAnswer = { error: new Error('IPC channel closed') };
    const { lifecycle, unmount } = renderUseMetrics(60);
    await flush();
    expect(lifecycle()).toBeNull(); // no bogus state invented
    expect(warnSpy).toHaveBeenCalled();

    // The listener remains authoritative.
    act(() => emit('collector-status', status('healthy', { generation: 2 })));
    expect(lifecycle()?.state).toBe('healthy');

    warnSpy.mockRestore();
    unmount();
  });
});
