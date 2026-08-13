import React from 'react';
import { describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useCardOrderInitialization } from './useCardOrderInitialization';
import type { SlicedHistory } from './useMetrics';
import type { Settings } from './useSettings';

const metrics: SlicedHistory = {
  timestamps: [1],
  cpu: [10],
  latestCpu: 10,
  cpu_name: 'CPU',
  cpu_temp_c: null,
  mem: [20],
  mem_used_gb: 1,
  mem_total_gb: 2,
  disks: [],
  net_recv: [1],
  net_sent: [1],
  gpus: [],
  collectorError: null,
};

function Harness(props: {
  loaded: boolean;
  metrics: SlicedHistory | null;
  cardOrder: Settings['cardOrder'];
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  useCardOrderInitialization(props.loaded, props.metrics, props.cardOrder, props.save);
  return null;
}

describe('useCardOrderInitialization', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function mount(props: React.ComponentProps<typeof Harness>): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(React.createElement(Harness, props)));
  }

  function cleanup(): void {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  }

  it('waits for settings.loaded when metrics arrived first and initializes once', () => {
    const saves: Partial<Settings>[] = [];
    const save = async (patch: Partial<Settings>) => { saves.push(patch); };
    mount({ loaded: false, metrics, cardOrder: null, save });
    expect(saves).toEqual([]);

    act(() => root!.render(React.createElement(Harness, { loaded: true, metrics, cardOrder: null, save })));
    expect(saves).toEqual([{ cardOrder: ['cpu', 'memory', 'network'] }]);

    act(() => root!.render(React.createElement(Harness, { loaded: true, metrics, cardOrder: null, save })));
    expect(saves).toHaveLength(1);
    cleanup();
  });

  it('does not replace an existing persisted order', () => {
    const saves: Partial<Settings>[] = [];
    const save = async (patch: Partial<Settings>) => { saves.push(patch); };
    mount({ loaded: false, metrics, cardOrder: ['memory', 'cpu', 'network'], save });
    act(() => root!.render(React.createElement(Harness, {
      loaded: true,
      metrics,
      cardOrder: ['memory', 'cpu', 'network'],
      save,
    })));
    expect(saves).toEqual([]);
    cleanup();
  });

  it('appends a newly discovered hardware card without replacing the saved order', () => {
    const saves: Partial<Settings>[] = [];
    const save = async (patch: Partial<Settings>) => { saves.push(patch); };
    const persisted = ['memory', 'cpu', 'network'];
    mount({ loaded: true, metrics, cardOrder: persisted, save });
    expect(saves).toEqual([]);

    const withGpu: SlicedHistory = {
      ...metrics,
      gpus: [{ key: 'gpu-a', name: 'Fixture GPU', vendor: 'nvidia', values: [1], latest: 1 }],
    };
    act(() => root!.render(React.createElement(Harness, {
      loaded: true,
      metrics: withGpu,
      cardOrder: persisted,
      save,
    })));
    expect(saves).toEqual([{ cardOrder: ['memory', 'cpu', 'network', 'gpu_gpu-a'] }]);
    cleanup();
  });
});
