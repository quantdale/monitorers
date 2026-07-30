import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HardwareSidebar } from './HardwareSidebar';
import { defaultSidebarCardOrder, mergeSidebarCardOrder } from './HardwareSidebar';
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
        { name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
        { name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
      ],
      disks: [{ name: 'C:', kind: 'Ssd' }],
    });
    expect(defaultSidebarCardOrder(p)).toEqual([
      'sb_cpu',
      'sb_gpu_0',
      'sb_gpu_1',
      'sb_memory',
      'sb_disk_0',
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

  it('appends newly-detected positional ids to the end', () => {
    const current = ['sb_cpu', 'sb_memory', 'sb_network'];
    const defaultIds = ['sb_cpu', 'sb_gpu_0', 'sb_memory', 'sb_network'];
    expect(mergeSidebarCardOrder(current, defaultIds)).toEqual([
      'sb_cpu',
      'sb_memory',
      'sb_network',
      'sb_gpu_0',
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

// --- positional-identity characterization (3.1) ---
// sb_gpu_0 names "whatever occupies index 0 of profile.gpus" — not a specific
// physical GPU. If profile.gpus order changes between two profile objects
// (e.g. hardware enumeration order shifts across a reboot), the same id now
// refers to a different GPU. This is a known gap (see design.md Known Gaps),
// not a requirement — this test pins today's actual behavior.
describe('sb_gpu_${i} positional identity (known gap)', () => {
  it('the GPU at sb_gpu_0 changes when array order changes between profile objects', () => {
    const profileA = profile({
      gpus: [
        { name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
        { name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
      ],
    });
    const profileB = profile({
      gpus: [
        { name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' },
        { name: 'Iris Xe Graphics', vendor: 'Intel', kind: 'Integrated' },
      ],
    });

    const idx = parseInt('sb_gpu_0'.replace('sb_gpu_', ''), 10);
    expect(profileA.gpus[idx].name).toBe('Iris Xe Graphics');
    expect(profileB.gpus[idx].name).toBe('GeForce RTX 4050');
    // Same id, different underlying GPU — the positional scheme does not
    // guarantee stable identity the way the dashboard's content-keyed
    // gpuId() does (see cardIdentity.test.ts).
    expect(profileA.gpus[idx].name).not.toBe(profileB.gpus[idx].name);
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
      gpus: [{ name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' }],
      disks: [{ name: 'Samsung SSD 970', kind: 'Nvme' }],
    });

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(HardwareSidebar, { open: true, profile: p, metrics: null }));
    });

    expect(container.textContent).toContain('Intel Core i7');
    expect(container.textContent).toContain('GeForce RTX 4050');
    expect(container.textContent).toContain('Samsung SSD 970');
  });

  it('shows "Detecting hardware…" while profile is null', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(HardwareSidebar, { open: true, profile: null, metrics: null }));
    });

    expect(container.textContent).toContain('Detecting hardware');
  });
});
