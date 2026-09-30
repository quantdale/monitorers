import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  appendToHistory,
  appendLiveEvent,
  sliceWindow,
  mergeDiskHistory,
  mergeGpuHistory,
  mergeLatestGpu,
  reconcileHistoryWithLiveEvents,
  appendSnapshotToHistory,
  assertSchemaVersion,
  resolveSnapshotTimestamp,
  resetMissingSnapshotTimestampWarning,
  SchemaMismatchError,
  EXPECTED_SCHEMA_VERSION,
} from './useMetrics';
import type { DiskHistory, GpuHistory, MetricsSnapshot } from '../types/metrics';

/** Minimal full-tick snapshot with an explicit backend timestamp. */
function baseSnap(timestamp_ms: number, on_tick = true): MetricsSnapshot {
  return {
    schema_version: EXPECTED_SCHEMA_VERSION,
    on_tick,
    timestamp_ms,
    cpu: 10,
    cpu_name: 'CPU',
    cpu_temp_c: null,
    mem: 2,
    mem_used_gb: 1,
    mem_total_gb: 2,
    disks: [],
    net_recv_kib_s: 0,
    net_sent_kib_s: 0,
    gpus: [],
  };
}

// --- appendToHistory ---

const MAX_HISTORY = 3600;

describe('appendToHistory', () => {
  it('appends a value to the array', () => {
    expect(appendToHistory([1, 2, 3], 4, MAX_HISTORY)).toEqual([1, 2, 3, 4]);
  });

  it('trims to maxLen when exceeding capacity', () => {
    const big = Array.from({ length: 3600 }, (_, i) => i);
    const result = appendToHistory(big, 9999, MAX_HISTORY);
    expect(result.length).toBe(3600);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(9999);
  });

  it('does not trim when under capacity', () => {
    const result = appendToHistory([10, 20], 30, MAX_HISTORY);
    expect(result).toEqual([10, 20, 30]);
  });

  it('works on an empty array', () => {
    expect(appendToHistory([], 42, MAX_HISTORY)).toEqual([42]);
  });
});

// --- sliceWindow ---

// --- appendLiveEvent (bounded live-event retention) ---

function fakeEvent(sequence: number): Parameters<typeof appendLiveEvent>[1] {
  return {
    sequence,
    snapshot: { schema_version: EXPECTED_SCHEMA_VERSION } as MetricsSnapshot,
    timestamp: sequence,
  };
}

describe('appendLiveEvent', () => {
  it('appends without copying while under the compaction threshold', () => {
    const buffer = [fakeEvent(1), fakeEvent(2)];
    const next = appendLiveEvent(buffer, fakeEvent(3));
    expect(next).toBe(buffer);
    expect(buffer.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('compacts to the newest retention window once past twice the cap', () => {
    const cap = 512;
    let buffer: ReturnType<typeof appendLiveEvent> = [];
    for (let i = 0; i < cap * 2; i += 1) {
      buffer = appendLiveEvent(buffer, fakeEvent(i));
    }
    // At the moment the threshold trips the buffer holds exactly `cap` events...
    expect(buffer.length).toBe(cap);
    expect(buffer[0].sequence).toBe(cap);
    expect(buffer[buffer.length - 1].sequence).toBe(cap * 2 - 1);
    // ...and continues appending afterwards without further growth.
    buffer = appendLiveEvent(buffer, fakeEvent(-1));
    expect(buffer.length).toBe(cap + 1);
    expect(buffer[buffer.length - 1].sequence).toBe(-1);
  });

  it('never exceeds a small bounded size regardless of event count', () => {
    let buffer: ReturnType<typeof appendLiveEvent> = [];
    for (let i = 0; i < 5000; i += 1) {
      buffer = appendLiveEvent(buffer, fakeEvent(i));
    }
    expect(buffer.length).toBeLessThanOrEqual(1024);
    expect(buffer[buffer.length - 1].sequence).toBe(4999);
  });
});

// --- sliceWindow ---

describe('sliceWindow', () => {
  const timestamps = [0, 1_000, 2_000, 3_000, 5_000];

  it('selects points by elapsed timestamp span, not sample count', () => {
    expect(sliceWindow([1, 2, 3, 4, 5], timestamps, 3)).toEqual([3, 4, 5]);
  });

  it('returns entire array when shorter than window', () => {
    expect(sliceWindow([1, 2], [0, 1_000], 10)).toEqual([1, 2]);
  });

  it('returns entire array when equal to window', () => {
    expect(sliceWindow([1, 2, 3], [0, 1_000, 2_000], 3)).toEqual([1, 2, 3]);
  });

  it('returns last 1 element for window = 1', () => {
    expect(sliceWindow([7, 8, 9], [0, 1_000, 2_000], 1)).toEqual([8, 9]);
  });
});

// --- mergeDiskHistory ---

describe('mergeDiskHistory', () => {
  const now = Date.now();
  const existing: DiskHistory[] = [
    { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, last_seen_ts: now },
  ];

  it('appends new active value to existing disk', () => {
    const snapshot = [{ key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0 }];
    const result = mergeDiskHistory(existing, snapshot, 3);
    expect(result.length).toBe(1);
    expect(result[0].values).toEqual([10, 20, 30]);
    expect(result[0].read_mb_s).toBe(6);
    expect(result[0].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('adds a newly discovered disk null-padded to align with timestamps', () => {
    const snapshot = [
      { key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0 },
      { key: 'D:', active: 5, read_mb_s: 1, write_mb_s: 0.5, avg_response_ms: 0.8 },
    ];
    const result = mergeDiskHistory(existing, snapshot, 4);
    expect(result.length).toBe(2);
    expect(result[1].key).toBe('D:');
    expect(result[1].values).toEqual([null, null, null, 5]);
    expect(result[1].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('preserves a ghost disk within the grace window (frozen)', () => {
    const ghost: DiskHistory[] = [
      { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, last_seen_ts: Date.now() },
    ];
    const result = mergeDiskHistory(ghost, [], 4);
    expect(result[0].values).toEqual([null, 10, 20, null]);
  });

  it('prunes a ghost disk absent past the grace window', () => {
    const stale: DiskHistory[] = [
      { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, last_seen_ts: Date.now() - 6000 },
    ];
    const result = mergeDiskHistory(stale, [], 4);
    expect(result.length).toBe(0);
  });

  it('reappearing disk re-aligns its values to the current timestamp length', () => {
    const reappear: DiskHistory[] = [
      { key: 'C:', values: [10, 20], read_mb_s: 5, write_mb_s: 3, avg_response_ms: 1.5, last_seen_ts: Date.now() - 6000 },
    ];
    const snapshot = [{ key: 'C:', active: 30, read_mb_s: 6, write_mb_s: 4, avg_response_ms: 2.0 }];
    const result = mergeDiskHistory(reappear, snapshot, 5);
    expect(result[0].values).toEqual([null, null, 10, 20, 30]);
    expect(result[0].last_seen_ts).toBeGreaterThanOrEqual(Date.now() - 100);
  });
});

// --- mergeGpuHistory ---

describe('mergeGpuHistory', () => {
  const now = Date.now();
  const existing: GpuHistory[] = [
    { key: 'gpu-a', name: 'RTX 4050', vendor: 'nvidia', values: [20, 40], temp_c: 55, nvidia: null, last_seen_ts: now },
  ];

  it('appends new util value to existing GPU', () => {
    const snapshot = [{ key: 'gpu-a', name: 'RTX 4050', vendor: 'nvidia', util: 60, temp_c: 58 }];
    const result = mergeGpuHistory(existing, snapshot, 3);
    expect(result.length).toBe(1);
    expect(result[0].values).toEqual([20, 40, 60]);
    expect(result[0].temp_c).toBe(58);
    expect(result[0].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('adds a newly discovered GPU with null gaps before its first sample', () => {
    const snapshot = [
      { key: 'gpu-a', name: 'RTX 4050', vendor: 'nvidia', util: 60, temp_c: 58 },
      { key: 'gpu-b', name: 'UHD Graphics', vendor: 'intel', util: 10, temp_c: 45 },
    ];
    const result = mergeGpuHistory(existing, snapshot, 4);
    expect(result.length).toBe(2);
    expect(result[1].name).toBe('UHD Graphics');
    expect(result[1].values).toEqual([null, null, null, 10]);
    expect(result[1].last_seen_ts).toBeGreaterThanOrEqual(now);
  });

  it('preserves temp_c from previous when snapshot has null', () => {
    const snapshot = [{ key: 'gpu-a', name: 'RTX 4050', vendor: 'nvidia', util: 70, temp_c: null }];
    const result = mergeGpuHistory(existing, snapshot, 3);
    expect(result[0].temp_c).toBe(55);
  });

  it('prunes a ghost GPU absent past the grace window', () => {
    const stale: GpuHistory[] = [
      { key: 'gpu-a', name: 'RTX 4050', vendor: 'nvidia', values: [20, 40], temp_c: 55, nvidia: null, last_seen_ts: Date.now() - 6000 },
    ];
    const result = mergeGpuHistory(stale, [], 3);
    expect(result.length).toBe(0);
  });

  it('preserves a ghost GPU within the grace window', () => {
    const ghost: GpuHistory[] = [
      { key: 'gpu-a', name: 'RTX 4050', vendor: 'nvidia', values: [20, 40], temp_c: 55, nvidia: null, last_seen_ts: Date.now() },
    ];
    const result = mergeGpuHistory(ghost, [], 3);
    expect(result[0].values).toEqual([20, 40, null]);
  });
});

// --- mergeLatestGpu (latest-value derivation, independent of history) ---
// NOTE: the on_tick history-commit gating that `shouldCommitHistory` provides
// is exercised end-to-end in useMetrics.hook.test.ts ("history array length
// matches the number of on_tick events"), so the identity behavior of the
// one-line function itself is not re-tested here.

describe('mergeLatestGpu', () => {
  it('sets latest util for a new GPU', () => {
    const result = mergeLatestGpu({}, [{ key: 'gpu-a', util: 42 }]);
    expect(result).toEqual({ 'gpu-a': 42 });
  });

  it('updates latest util for an existing GPU on every call, regardless of on_tick', () => {
    const prev = { 'gpu-a': 10 };
    const result = mergeLatestGpu(prev, [{ key: 'gpu-a', util: 55 }]);
    expect(result).toEqual({ 'gpu-a': 55 });
  });

  it('preserves entries for GPUs not present in the current snapshot', () => {
    const prev = { 'gpu-a': 10, 'gpu-b': 5 };
    const result = mergeLatestGpu(prev, [{ key: 'gpu-a', util: 20 }]);
    expect(result).toEqual({ 'gpu-a': 20, 'gpu-b': 5 });
  });
});

// --- assertSchemaVersion ---

describe('assertSchemaVersion', () => {
  it('does not log an error when versions match', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertSchemaVersion(EXPECTED_SCHEMA_VERSION, 'HistoryPayload')).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs an error when schema_version is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertSchemaVersion(undefined, 'HistoryPayload')).toThrow(/schema mismatch/i);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('logs an error when schema_version is greater than expected', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertSchemaVersion(EXPECTED_SCHEMA_VERSION + 1, 'HistoryPayload')).toThrow(/schema mismatch/i);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('logs an error when schema_version is lower than expected', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertSchemaVersion(EXPECTED_SCHEMA_VERSION - 1, 'HistoryPayload')).toThrow(/schema mismatch/i);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('reconcileHistoryWithLiveEvents', () => {
  it('does not duplicate an event already covered by the history response', () => {
    const payload = {
      schema_version: EXPECTED_SCHEMA_VERSION,
      timestamps: [1_000],
      cpu: [10],
      cpu_name: 'CPU',
      cpu_temp_c: null,
      mem: [20],
      disks: [],
      net_recv: [0],
      net_sent: [0],
      gpus: [],
    };
    const snapshot = {
      schema_version: EXPECTED_SCHEMA_VERSION,
      on_tick: true,
      cpu: 99,
      cpu_name: 'CPU',
      cpu_temp_c: null,
      mem: 30,
      mem_used_gb: 1,
      mem_total_gb: 2,
      disks: [],
      net_recv_kib_s: 0,
      net_sent_kib_s: 0,
      gpus: [],
      timestamp_ms: 1_000,
    };

    const result = reconcileHistoryWithLiveEvents(payload, [{ snapshot, timestamp: 1_000 }]);
    expect(result.timestamps).toEqual([1_000]);
    expect(result.cpu).toEqual([10]);
  });
});


describe('resolveSnapshotTimestamp (single-clock timestamp channel)', () => {
  beforeEach(() => {
    resetMissingSnapshotTimestampWarning();
  });

  const snapWith = (timestamp_ms: unknown): MetricsSnapshot =>
    ({
      schema_version: EXPECTED_SCHEMA_VERSION,
      on_tick: true,
      timestamp_ms,
      cpu: 1,
      cpu_name: 'CPU',
      cpu_temp_c: null,
      mem: 1,
      mem_used_gb: 1,
      mem_total_gb: 2,
      disks: [],
      net_recv_kib_s: 0,
      net_sent_kib_s: 0,
      gpus: [],
    }) as unknown as MetricsSnapshot;

  it('uses the backend payload timestamp, not the local clock', () => {
    expect(resolveSnapshotTimestamp(snapWith(1_700_000_123_456), 42)).toBe(1_700_000_123_456);
  });

  it('falls back to the newest known timestamp when the payload has none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // This is the regression this prevents: a missing timestamp must NOT be
    // replaced by Date.now(), which would place the sample on a second clock.
    expect(resolveSnapshotTimestamp(snapWith(undefined), 999)).toBe(999);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('warns only once across repeated degraded payloads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveSnapshotTimestamp(snapWith(undefined), 1);
    resolveSnapshotTimestamp(snapWith(undefined), 2);
    resolveSnapshotTimestamp(snapWith(undefined), 3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('rejects NaN, Infinity and negative payload timestamps', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveSnapshotTimestamp(snapWith(Number.NaN), 7)).toBe(7);
    expect(resolveSnapshotTimestamp(snapWith(Number.POSITIVE_INFINITY), 7)).toBe(7);
    expect(resolveSnapshotTimestamp(snapWith(-1), 7)).toBe(7);
    warn.mockRestore();
  });

  it('accepts timestamp 0 (a falsy but valid epoch value)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveSnapshotTimestamp(snapWith(0), 7)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('history growth is gated by on_tick, not by the timestamp', () => {
  it('an off-tick snapshot carrying a valid timestamp appends nothing', () => {
    const base = {
      schema_version: EXPECTED_SCHEMA_VERSION,
      timestamps: [1_000, 2_000],
      cpu: [10, 20],
      cpu_name: 'CPU',
      cpu_temp_c: null,
      mem: [1, 2],
      disks: [],
      net_recv: [0, 0],
      net_sent: [0, 0],
      gpus: [],
    };
    const offTick = { ...baseSnap(3_000, false) };
    const next = appendSnapshotToHistory(base, offTick, 3_000);
    // shouldCommitHistory(false) short-circuits: the SAME payload returned.
    expect(next).toBe(base);
  });
});

describe('reconcileHistoryWithLiveEvents still compares like with like', () => {
  it('suppresses an event already covered by the response tail', () => {
    const payload = {
      schema_version: EXPECTED_SCHEMA_VERSION,
      timestamps: [1_000, 2_000],
      cpu: [10, 20],
      cpu_name: 'CPU',
      cpu_temp_c: null,
      mem: [1, 2],
      disks: [],
      net_recv: [0, 0],
      net_sent: [0, 0],
      gpus: [],
    };
    // Now that both sides share the backend clock, "covered" is a real
    // comparison: 2_000 is exactly the response tail.
    const result = reconcileHistoryWithLiveEvents(payload, [
      { snapshot: baseSnap(2_000, true), timestamp: 2_000 },
    ]);
    expect(result.timestamps).toEqual([1_000, 2_000]);
  });

  it('does not drop a genuinely new event', () => {
    const payload = {
      schema_version: EXPECTED_SCHEMA_VERSION,
      timestamps: [1_000, 2_000],
      cpu: [10, 20],
      cpu_name: 'CPU',
      cpu_temp_c: null,
      mem: [1, 2],
      disks: [],
      net_recv: [0, 0],
      net_sent: [0, 0],
      gpus: [],
    };
    const result = reconcileHistoryWithLiveEvents(payload, [
      { snapshot: baseSnap(3_000, true), timestamp: 3_000 },
    ]);
    expect(result.timestamps).toEqual([1_000, 2_000, 3_000]);
    expect(result.cpu).toEqual([10, 20, 10]);
  });
});

describe('schema-version bump fails closed', () => {
  it('rejects a payload carrying the previous schema version', () => {
    expect(() => assertSchemaVersion(EXPECTED_SCHEMA_VERSION - 1, 'MetricsSnapshot')).toThrow(
      SchemaMismatchError
    );
    expect(() => assertSchemaVersion(EXPECTED_SCHEMA_VERSION - 1, 'MetricsSnapshot')).toThrow(
      /schema mismatch/i
    );
  });

  it('accepts the current version', () => {
    expect(() => assertSchemaVersion(EXPECTED_SCHEMA_VERSION, 'MetricsSnapshot')).not.toThrow();
  });
});
