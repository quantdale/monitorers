import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HardwareSidebar } from './HardwareSidebar';
import {
  defaultSidebarCardOrder,
  mergeSidebarCardOrder,
  migrateLegacySidebarCardOrder,
  persistSidebarCardOrder,
} from './HardwareSidebar';
import type { HardwareProfile } from '../hooks/useHardwareProfile';

function profile(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    cpu_vendor: 'intel',
    cpu_name: 'Intel Core i7',
    gpus: [],
    disks: [],
    ...overrides,
  };
}

// --- defaultSidebarCardOrder / mergeSidebarCardOrder (1.2) ---

describe('defaultSidebarCardOrder', () => {
  it('produces sb_cpu, per-gpu, sb_memory, per-disk, sb_network in order', () => {
    const p = profile({
      gpus: [
        { key: 'gpu-nvidia', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
        { key: 'gpu-intel', name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
      ],
      disks: [{ key: 'disk-c', name: 'C:', kind: 'Ssd' }],
    });
    expect(defaultSidebarCardOrder(p)).toEqual([
      'sb_cpu',
      'sb_gpu_gpu-nvidia',
      'sb_gpu_gpu-intel',
      'sb_memory',
      'sb_disk_disk-c',
      'sb_network',
    ]);
  });
});

describe('mergeSidebarCardOrder', () => {
  it('returns defaults when nothing saved yet', () => {
    expect(mergeSidebarCardOrder([], ['sb_cpu', 'sb_memory', 'sb_network'])).toEqual([
      'sb_cpu',
      'sb_memory',
      'sb_network',
    ]);
  });

  it('appends newly-detected stable ids to the end', () => {
    const current = ['sb_cpu', 'sb_memory', 'sb_network'];
    const defaultIds = ['sb_cpu', 'sb_gpu_gpu-a', 'sb_memory', 'sb_network'];
    expect(mergeSidebarCardOrder(current, defaultIds)).toEqual([
      'sb_cpu',
      'sb_memory',
      'sb_network',
      'sb_gpu_gpu-a',
    ]);
  });

  it('drops saved ids no longer in the default set (e.g. a disk unplugged)', () => {
    const current = ['sb_cpu', 'sb_disk_0', 'sb_memory', 'sb_network'];
    const defaultIds = ['sb_cpu', 'sb_memory', 'sb_network'];
    expect(mergeSidebarCardOrder(current, defaultIds)).toEqual(['sb_cpu', 'sb_memory', 'sb_network']);
  });

  it('leaves order untouched when nothing changed', () => {
    const current = ['sb_cpu', 'sb_memory', 'sb_network'];
    expect(mergeSidebarCardOrder(current, ['sb_cpu', 'sb_memory', 'sb_network'])).toEqual(current);
  });
});

// --- persistSidebarCardOrder (non-destructive store merge) ---

describe('persistSidebarCardOrder', () => {
  it('keeps saved stable ids the current discovery pass did not enumerate', () => {
    // Regression pin: Windows materializes GPU Engine counters lazily, so a
    // session can legitimately discover fewer adapters than the previous one.
    // Rendering hides absent cards, but the STORE must retain them or a
    // transient discovery gap permanently rewrites the user's arrangement.
    const saved = ['sb_cpu', 'sb_gpu_0x1', 'sb_memory', 'sb_disk_c', 'sb_network'];
    const nowDiscovered = ['sb_cpu', 'sb_memory', 'sb_network'];
    expect(persistSidebarCardOrder(saved, nowDiscovered)).toEqual(saved);
  });

  it('appends newly discovered ids and still drops legacy positional ids once', () => {
    const saved = ['sb_cpu', 'sb_gpu_3', 'sb_memory']; // sb_gpu_3 is legacy positional
    const discovered = ['sb_cpu', 'sb_gpu_0xa', 'sb_memory'];
    expect(persistSidebarCardOrder(saved, discovered)).toEqual(['sb_cpu', 'sb_memory', 'sb_gpu_0xa']);
  });

  it('persists the full default set on first run (null-equivalent empty saved)', () => {
    const defaults = ['sb_cpu', 'sb_gpu_a', 'sb_memory', 'sb_network'];
    expect(persistSidebarCardOrder([], defaults)).toEqual(defaults);
  });
});

// --- stable identity ---
describe('stable sidebar hardware identity', () => {
  it('keeps each GPU attached to its physical key when enumeration order changes', () => {
    const profileA = profile({
      gpus: [
        { key: 'gpu-intel', name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
        { key: 'gpu-nvidia', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
      ],
    });
    const profileB = profile({
      gpus: [
        { key: 'gpu-nvidia', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
        { key: 'gpu-intel', name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
      ],
    });

    expect(defaultSidebarCardOrder(profileA).filter((id) => id.startsWith('sb_gpu_'))).toEqual([
      'sb_gpu_gpu-intel', 'sb_gpu_gpu-nvidia',
    ]);
    expect(defaultSidebarCardOrder(profileB).filter((id) => id.startsWith('sb_gpu_'))).toEqual([
      'sb_gpu_gpu-nvidia', 'sb_gpu_gpu-intel',
    ]);
    expect(mergeSidebarCardOrder(['sb_gpu_gpu-nvidia', 'sb_gpu_gpu-intel'], defaultSidebarCardOrder(profileB), profileB).slice(0, 2)).toEqual([
      'sb_gpu_gpu-nvidia', 'sb_gpu_gpu-intel',
    ]);
  });

  it('does not map legacy positional ids onto a reordered physical device', () => {
    const profileB = profile({
      gpus: [
        { key: 'gpu-nvidia', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
        { key: 'gpu-intel', name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
      ],
      disks: [{ key: 'disk-d', name: 'Data', kind: 'Ssd' }],
    });
    const legacy = ['sb_cpu', 'sb_gpu_0', 'sb_memory', 'sb_disk_0', 'sb_network'];
    expect(migrateLegacySidebarCardOrder(legacy, profileB)).toEqual(['sb_cpu', 'sb_memory', 'sb_network']);
    expect(mergeSidebarCardOrder(legacy, defaultSidebarCardOrder(profileB), profileB)).toEqual([
      'sb_cpu', 'sb_memory', 'sb_network', 'sb_gpu_gpu-nvidia', 'sb_gpu_gpu-intel', 'sb_disk_disk-d',
    ]);
  });
});

// --- minimal render harness ---

describe('HardwareSidebar (render)', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
  });

  it('renders a card per profile entry when open', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const p = profile({
      gpus: [{ key: 'gpu-nvidia', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' }],
      disks: [{ key: 'disk-samsung', name: 'Samsung SSD 970', kind: 'Nvme' }],
    });

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(HardwareSidebar, { open: true, profile: p, memTotalGb: null }));
    });

    expect(container.textContent).toContain('Intel Core i7');
    expect(container.textContent).toContain('GeForce RTX 4050');
    expect(container.textContent).toContain('Samsung SSD 970');
  });

  it('exposes stable semantic ids in rendered order via [data-sb-id]', () => {
    // Regression pin for the real-lane sidebar-relaunch journey: the sim
    // engine reads this attribute to assert RENDERED ordering (and its
    // restoration across a true process relaunch) — if the attribute drifts,
    // that journey fails blind and this pin explains why.
    container = document.createElement('div');
    document.body.appendChild(container);
    const p = profile({
      gpus: [{ key: 'gpu-nvidia', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' }],
      disks: [{ key: 'disk-c', name: 'C:', kind: 'Ssd' }],
    });

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(HardwareSidebar, { open: true, profile: p, memTotalGb: null }));
    });

    const ids = Array.from(container.querySelectorAll('[data-sb-id]')).map((n) => n.getAttribute('data-sb-id'));
    expect(ids).toEqual([
      'sb_cpu',
      'sb_gpu_gpu-nvidia',
      'sb_memory',
      'sb_disk_disk-c',
      'sb_network',
    ]);
  });

  it('shows "Detecting hardware…" while profile is null', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(HardwareSidebar, { open: true, profile: null, memTotalGb: null }));
    });

    expect(container.textContent).toContain('Detecting hardware');
  });
});
