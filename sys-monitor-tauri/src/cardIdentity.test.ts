import { describe, it, expect } from 'vitest';
import {
  computeDefaultCardIds,
  computeHasNvidiaData,
  computeVisibleCardOrder,
  isCardPresent,
  mergeNewCardIds,
  shouldShowLoadingState,
  type CardMetricsShape,
} from './cardIdentity';

function metrics(overrides: Partial<CardMetricsShape> = {}): CardMetricsShape {
  return {
    disks: [{ key: 'C:' } as CardMetricsShape['disks'][number]],
    gpus: [{ name: 'GeForce RTX 4050' } as CardMetricsShape['gpus'][number]],
    net_recv: [10],
    net_sent: [5],
    ...overrides,
  };
}

// --- computeDefaultCardIds ---

describe('computeDefaultCardIds', () => {
  it('produces cpu, memory, disks, network, gpus in order', () => {
    const m = metrics({
      disks: [{ key: 'C:' }, { key: 'D:' }] as CardMetricsShape['disks'],
      gpus: [{ name: 'GeForce RTX 4050' }] as CardMetricsShape['gpus'],
    });
    expect(computeDefaultCardIds(m)).toEqual([
      'cpu',
      'memory',
      'disk_C:',
      'disk_D:',
      'network',
      'gpu_geforce_rtx_4050',
    ]);
  });
});

// --- mergeNewCardIds (2.3, 2.4, 2.6) ---

describe('mergeNewCardIds', () => {
  it('appends a newly-detected id to the end, preserving existing order', () => {
    const current = ['cpu', 'memory', 'network'];
    const defaultIds = ['cpu', 'memory', 'disk_C:', 'network', 'gpu_geforce_rtx_4050'];
    expect(mergeNewCardIds(current, defaultIds)).toEqual([
      'cpu',
      'memory',
      'network',
      'disk_C:',
      'gpu_geforce_rtx_4050',
    ]);
  });

  it('returns null (no write) when no new ids are present', () => {
    const current = ['cpu', 'memory', 'disk_C:', 'network'];
    const defaultIds = ['cpu', 'memory', 'disk_C:', 'network'];
    expect(mergeNewCardIds(current, defaultIds)).toBeNull();
  });

  it('a reappearing id already in current does not retrigger the merge (returns null, position unchanged)', () => {
    // disk_C: was hidden/absent from hardware for a session, but the saved
    // cardOrder still has it — the id is still "known", so its reappearance
    // in defaultIds should not be treated as new.
    const current = ['cpu', 'disk_C:', 'memory', 'network'];
    const defaultIds = ['cpu', 'memory', 'disk_C:', 'network'];
    expect(mergeNewCardIds(current, defaultIds)).toBeNull();
    // Position within `current` (disk_C: at index 1) is untouched since no merge occurred.
    expect(current).toEqual(['cpu', 'disk_C:', 'memory', 'network']);
  });
});

// --- isCardPresent / computeVisibleCardOrder (2.2, 2.5, 2.7) ---

describe('isCardPresent', () => {
  it('cpu and memory are present once metrics have arrived', () => {
    expect(isCardPresent('cpu', metrics())).toBe(true);
    expect(isCardPresent('memory', metrics())).toBe(true);
  });

  it('every card id is absent while metrics is null (no snapshot yet)', () => {
    expect(isCardPresent('cpu', null)).toBe(false);
    expect(isCardPresent('memory', null)).toBe(false);
    expect(isCardPresent('disk_C:', null)).toBe(false);
    expect(isCardPresent('gpu_geforce_rtx_4050', null)).toBe(false);
  });

  it('disk id absent from current snapshot (no disks) is not present', () => {
    const m = metrics({ disks: [] });
    expect(isCardPresent('disk_C:', m)).toBe(false);
  });
});

describe('computeVisibleCardOrder', () => {
  it('reproduces the same visible arrangement when hardware is unchanged between loads', () => {
    const cardOrder = ['cpu', 'memory', 'disk_C:', 'network', 'gpu_geforce_rtx_4050'];
    const m = metrics();
    const first = computeVisibleCardOrder(cardOrder, new Set(), m);
    const second = computeVisibleCardOrder(cardOrder, new Set(), metrics());
    expect(first).toEqual(second);
    expect(first).toEqual(cardOrder);
  });

  it('a ghost disk id (absent from current snapshot) is excluded from visible order, cardOrder itself untouched', () => {
    const cardOrder = ['cpu', 'memory', 'disk_C:', 'disk_D:', 'network'];
    const m = metrics({ disks: [] }); // both disks disappeared this session
    const visible = computeVisibleCardOrder(cardOrder, new Set(), m);
    expect(visible).toEqual(['cpu', 'memory', 'network']);
    // The caller's cardOrder array is a plain input — this function is pure
    // and never mutates it.
    expect(cardOrder).toEqual(['cpu', 'memory', 'disk_C:', 'disk_D:', 'network']);
  });

  it('a hidden card stays hidden across the underlying hardware disappearing and reappearing', () => {
    const cardOrder = ['cpu', 'memory', 'disk_C:', 'network'];
    const hidden = new Set(['disk_C:']);
    const gone = computeVisibleCardOrder(cardOrder, hidden, metrics({ disks: [] }));
    expect(gone).toEqual(['cpu', 'memory', 'network']);
    const back = computeVisibleCardOrder(cardOrder, hidden, metrics());
    expect(back).toEqual(['cpu', 'memory', 'network']); // still hidden, not just absent
  });
});

// --- computeHasNvidiaData (6.4) ---

describe('computeHasNvidiaData', () => {
  it('false when metrics is null', () => {
    expect(computeHasNvidiaData(null)).toBe(false);
  });

  it('false with an empty gpus array and all-null nvidia_* fields (no null-reference error)', () => {
    expect(
      computeHasNvidiaData({
        gpus: [],
        nvidia_power_w: null,
        nvidia_mem_used_mb: null,
        nvidia_mem_total_mb: null,
        nvidia_fan_speed_pct: null,
        nvidia_clock_mhz: null,
      })
    ).toBe(false);
  });

  it('true when an nvidia GPU is present and at least one NVML stat is available', () => {
    expect(
      computeHasNvidiaData({
        gpus: [{ vendor: 'nvidia' }],
        nvidia_power_w: 45,
        nvidia_mem_used_mb: null,
        nvidia_mem_total_mb: null,
        nvidia_fan_speed_pct: null,
        nvidia_clock_mhz: null,
      })
    ).toBe(true);
  });

  it('false when an nvidia GPU is present but no NVML stats are available', () => {
    expect(
      computeHasNvidiaData({
        gpus: [{ vendor: 'nvidia' }],
        nvidia_power_w: null,
        nvidia_mem_used_mb: null,
        nvidia_mem_total_mb: null,
        nvidia_fan_speed_pct: null,
        nvidia_clock_mhz: null,
      })
    ).toBe(false);
  });
});

// --- shouldShowLoadingState (6.3) ---

describe('shouldShowLoadingState', () => {
  it('true before any metrics/history has arrived', () => {
    expect(shouldShowLoadingState(null, [])).toBe(true);
  });

  it('true when metrics exist but cardOrder is still empty', () => {
    expect(shouldShowLoadingState(metrics(), [])).toBe(true);
  });

  it('false once metrics and a non-empty cardOrder are present', () => {
    expect(shouldShowLoadingState(metrics(), ['cpu'])).toBe(false);
  });
});
