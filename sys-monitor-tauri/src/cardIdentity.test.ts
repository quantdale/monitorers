import { describe, it, expect } from 'vitest';
import {
  computeDefaultCardIds,
  computeHasNvidiaData,
  computeVisibleCardOrder,
  isCardPresent,
  migrateLegacyGpuCardOrder,
  mergeNewCardIds,
  moveCardId,
  shouldShowLoadingState,
  type CardMetricsShape,
} from './cardIdentity';

function metrics(overrides: Partial<CardMetricsShape> = {}): CardMetricsShape {
  return {
    disks: [{ key: 'C:' } as CardMetricsShape['disks'][number]],
    gpus: [{ key: 'gpu-a', name: 'GeForce RTX 4050', vendor: 'nvidia', nvidia: null } as CardMetricsShape['gpus'][number]],
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
      gpus: [{ key: 'gpu-a', name: 'GeForce RTX 4050', vendor: 'nvidia', nvidia: null }] as CardMetricsShape['gpus'],
    });
    expect(computeDefaultCardIds(m)).toEqual([
      'cpu',
      'memory',
      'disk_C:',
      'disk_D:',
      'network',
      'gpu_gpu-a',
    ]);
  });

  it('keeps identical display names separate when stable keys differ', () => {
    const m = metrics({
      gpus: [
        { key: 'luid-a', name: 'GeForce RTX 3060', vendor: 'nvidia', nvidia: null },
        { key: 'luid-b', name: 'GeForce RTX 3060', vendor: 'nvidia', nvidia: null },
      ] as CardMetricsShape['gpus'],
    });
    expect(computeDefaultCardIds(m).filter((id) => id.startsWith('gpu_'))).toEqual([
      'gpu_luid-a',
      'gpu_luid-b',
    ]);
  });
});

describe('migrateLegacyGpuCardOrder', () => {
  it('maps a unique display-name slug without changing placement', () => {
    expect(
      migrateLegacyGpuCardOrder(['cpu', 'gpu_geforce_rtx_4050', 'memory'], [
        { key: 'luid-a', name: 'GeForce RTX 4050' },
      ])
    ).toEqual(['cpu', 'gpu_luid-a', 'memory']);
  });

  it('leaves an ambiguous legacy slug in place so stable cards append deterministically', () => {
    expect(
      migrateLegacyGpuCardOrder(['cpu', 'gpu_geforce_rtx_3060'], [
        { key: 'luid-a', name: 'GeForce RTX 3060' },
        { key: 'luid-b', name: 'GeForce RTX 3060' },
      ])
    ).toEqual(['cpu', 'gpu_geforce_rtx_3060']);
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
    expect(isCardPresent('gpu_gpu-a', null)).toBe(false);
  });

  it('disk id absent from current snapshot (no disks) is not present', () => {
    const m = metrics({ disks: [] });
    expect(isCardPresent('disk_C:', m)).toBe(false);
  });

  // --- DISK-001 / GPU ghost-card fixes: per-key presence ---

  it('a disk id is present only when a disk with that exact key is in the snapshot (per-key, not per-metric)', () => {
    const m = metrics({
      disks: [{ key: 'C:' }, { key: 'E:' }] as CardMetricsShape['disks'],
    });
    expect(isCardPresent('disk_C:', m)).toBe(true);
    expect(isCardPresent('disk_E:', m)).toBe(true);
    // D: was unplugged — only its own ghost card drops out, C: and E: stay.
    expect(isCardPresent('disk_D:', m)).toBe(false);
  });

  it('a gpu id is present only when a GPU with the matching stable key is in the snapshot', () => {
    const m = metrics({
      gpus: [{ key: 'gpu-a', name: 'GeForce RTX 4050', vendor: 'nvidia', nvidia: null }] as CardMetricsShape['gpus'],
    });
    expect(isCardPresent('gpu_gpu-a', m)).toBe(true);
    // An unrelated slug (e.g. a second GPU that was hot-unplugged) is absent.
    expect(isCardPresent('gpu-gpu-b', m)).toBe(false);
  });

  it('computeVisibleCardOrder hides only the unplugged disk/gpu ghost cards, keeping the rest', () => {
    const cardOrder = [
      'cpu',
      'memory',
      'disk_C:',
      'disk_D:',
      'network',
      'gpu_gpu-a',
      'gpu_gpu-b',
    ];
    const m = metrics({
      disks: [{ key: 'C:' }] as CardMetricsShape['disks'],
      gpus: [{ key: 'gpu-a', name: 'GeForce RTX 4050', vendor: 'nvidia', nvidia: null }] as CardMetricsShape['gpus'],
    });
    const visible = computeVisibleCardOrder(cardOrder, new Set(), m);
    expect(visible).toEqual([
      'cpu',
      'memory',
      'disk_C:',
      'network',
      'gpu_gpu-a',
    ]);
  });
});

describe('computeVisibleCardOrder', () => {
  it('reproduces the same visible arrangement when hardware is unchanged between loads', () => {
    const cardOrder = ['cpu', 'memory', 'disk_C:', 'network', 'gpu_gpu-a'];
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

  it('false with an empty gpus array', () => {
    expect(
      computeHasNvidiaData({
        gpus: [],
      })
    ).toBe(false);
  });

  it('true when an nvidia GPU is present and at least one NVML stat is available', () => {
    expect(
      computeHasNvidiaData({
        gpus: [{ key: 'gpu-a', name: 'RTX', vendor: 'nvidia', values: [], latest: 0, nvidia: { power_w: 45 } }],
      })
    ).toBe(true);
  });

  it('false when an nvidia GPU is present but no NVML stats are available', () => {
    expect(
      computeHasNvidiaData({
        gpus: [{ key: 'gpu-a', name: 'RTX', vendor: 'nvidia', values: [], latest: 0, nvidia: null }],
      })
    ).toBe(false);
  });
});

// --- shouldShowLoadingState (6.3) ---

describe('shouldShowLoadingState', () => {
  it('true before any metrics/history has arrived', () => {
    expect(shouldShowLoadingState(null, [])).toBe(true);
  });

  it('true when metrics exist but visibleCardOrder is still empty', () => {
    expect(shouldShowLoadingState(metrics(), [])).toBe(true);
  });

  it('false once metrics and a non-empty visibleCardOrder are present', () => {
    expect(shouldShowLoadingState(metrics(), ['cpu'])).toBe(false);
  });

  it('true when every card has been hidden, even though the underlying cardOrder is non-empty (UX-006)', () => {
    // Caller must pass the filtered visibleCardOrder, not the raw saved cardOrder —
    // this pins that a fully-hidden dashboard shows the message, not a blank canvas.
    expect(shouldShowLoadingState(metrics(), [])).toBe(true);
  });
});

// --- moveCardId ---

describe('moveCardId', () => {
  it('moves a card down to the target position', () => {
    expect(moveCardId(['cpu', 'memory', 'network'], 'cpu', 'network')).toEqual([
      'memory',
      'network',
      'cpu',
    ]);
  });

  it('moves a card up without disturbing the other ids', () => {
    expect(moveCardId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('handles an adjacent swap like arrayMove does', () => {
    expect(moveCardId(['a', 'b', 'c'], 'a', 'b')).toEqual(['b', 'a', 'c']);
  });

  it('returns null for a no-op drop onto itself', () => {
    expect(moveCardId(['cpu', 'memory'], 'cpu', 'cpu')).toBeNull();
  });

  it('returns null when the dragged id is missing (stale drag source)', () => {
    expect(moveCardId(['cpu', 'memory'], 'ghost', 'cpu')).toBeNull();
  });

  it('returns null when the drop target id is missing (vanished mid-drag)', () => {
    expect(moveCardId(['cpu', 'memory'], 'cpu', 'ghost')).toBeNull();
  });

  it('returns null on an empty order', () => {
    expect(moveCardId([], 'cpu', 'memory')).toBeNull();
  });

  it('does not mutate the input order', () => {
    const order = ['cpu', 'memory'];
    moveCardId(order, 'cpu', 'memory');
    expect(order).toEqual(['cpu', 'memory']);
  });
});
