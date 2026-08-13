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
const historyRequests: Array<{ resolve: (payload: HistoryPayload) => void; reject: (error: Error) => void }> = [];

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, cb: (event: { payload: unknown }) => void) => {
    listeners.set(eventName, cb);
    return Promise.resolve(() => listeners.delete(eventName));
  }),
}));

function emptyHistoryPayload(): HistoryPayload {
  return {
    schema_version: 4,
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
  invoke: vi.fn(() => {
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

function baseSnapshot(onTick: boolean): MetricsSnapshot {
  return {
    schema_version: 4,
    on_tick: onTick,
    cpu: 42,
    cpu_name: 'CPU',
    cpu_temp_c: 50,
    mem: 60,
    mem_used_gb: 8,
    mem_total_gb: 16,
    disks: [],
    net_recv_kb: 0,
    net_sent_kb: 0,
    gpus: [],
  };
}

function emit(eventName: string, payload: unknown) {
  const cb = listeners.get(eventName);
  if (!cb) throw new Error(`no listener registered for ${eventName}`);
  cb({ payload });
}

interface RenderResult {
  result: () => SlicedHistory;
  historyLoadError: () => string | null;
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
    unmount: () => act(() => root.unmount()),
    rerender: (w: number) => act(() => root.render(React.createElement(TestComponent, { w }))),
  };
}

describe('useMetrics (Tauri event wiring)', () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    listeners.clear();
    historyInvokeError = null;
    historySchemaVersion = null;
    deferredHistory = false;
    historyRequests.length = 0;
  });

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
        disks: [{ key: 'C:', active: 12, read_mb_s: 1, write_mb_s: 2, avg_response_ms: 3, temp_c: 40 }],
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

  // --- 5.2: collectorError never auto-clears ---

  it('collectorError stays set for the lifetime of the hook once received, even after further metrics-update events', async () => {
    const { result, unmount } = renderUseMetrics(60);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result().collectorError).toBeNull();

    act(() => {
      emit('collector-error', 'metrics collection stopped — restart the app');
    });
    expect(result().collectorError).toBe('metrics collection stopped — restart the app');

    // Further live snapshots must not clear it.
    act(() => {
      emit('metrics-update', baseSnapshot(true));
    });
    expect(result().collectorError).toBe('metrics collection stopped — restart the app');

    act(() => {
      emit('metrics-update', baseSnapshot(false));
    });
    expect(result().collectorError).toBe('metrics collection stopped — restart the app');

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
