import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { DndContext } from '@dnd-kit/core';
import { renderCardContent } from './renderCardContent';
import type { SlicedHistory } from '../hooks/useMetrics';

// These tests mount real Recharts trees under jsdom; on a heavily loaded
// machine (parallel cargo/vite builds) a full mount can exceed Vitest's 5s
// default. This extends only the wall-clock allowance — assertions are
// unchanged and still fail on genuinely broken rendering.
vi.setConfig({ testTimeout: 20_000 });

function sliced(overrides: Partial<SlicedHistory> = {}): SlicedHistory {
  return {
    timestamps: [1000, 2000],
    cpu: [10, 20],
    latestCpu: 12.345,
    cpu_name: 'Intel Core i7',
    cpu_temp_c: 52,
    mem: [80, 81],
    mem_used_gb: 8.4,
    mem_total_gb: 16,
    disks: [],
    net_recv: [0, 1200],
    net_sent: [0, 500],
    gpus: [],
    collectorError: null,
    collectorState: null,
    ...overrides,
  };
}

describe('renderCardContent', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
  });

  async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<DndContext>{node}</DndContext>);
      // Flush the lazily-imported chart module so Suspense resolves inside
      // act instead of updating after the test finished rendering.
      await Promise.resolve();
    });
    return container;
  }

  it('cpu card — title, live %, temperature badge', async () => {
    const c = await mount(
      renderCardContent({ id: 'cpu', metrics: sliced(), viewMode: 'default', hasNvidiaData: false })
    );
    expect(c.textContent).toContain('Intel Core i7');
    expect(c.textContent).toContain('12.3%');
    expect(c.textContent).toContain('52 °C');
  });

  it('memory card — title, %, used/total GB badge', async () => {
    const c = await mount(
      renderCardContent({ id: 'memory', metrics: sliced(), viewMode: 'default', hasNvidiaData: false })
    );
    expect(c.textContent).toContain('Memory');
    expect(c.textContent).toContain('81.0%');
    expect(c.textContent).toContain('8.4 / 16.0 GB');
  });

  it('memory card — non-finite capacity values render as unavailable', async () => {
    const c = await mount(
      renderCardContent({
        id: 'memory',
        metrics: sliced({ mem_used_gb: Number.NaN, mem_total_gb: Number.POSITIVE_INFINITY }),
        viewMode: 'default',
        hasNvidiaData: false,
      })
    );
    expect(c.textContent).toContain('— / —');
    expect(c.textContent).not.toContain('NaN');
    expect(c.textContent).not.toContain('Infinity');
  });

  it('disk card — key, active time, throughput, and response', async () => {
    const m = sliced({
      disks: [{ key: 'C:', values: [10, 42], read_mb_s: 10, write_mb_s: 5, avg_response_ms: 3.2 }],
    });
    const c = await mount(
      renderCardContent({ id: 'disk_C:', metrics: m, viewMode: 'default', hasNvidiaData: false })
    );
    expect(c.textContent).toContain('Disk C:');
    expect(c.textContent).toContain('Active Time 42.0%');
    expect(c.textContent).toContain('R: 10.0 MB/s · W: 5.0 MB/s');
    expect(c.textContent).toContain('Avg: 3.2 ms');
  });

  it('network card — dual throughput badges', async () => {
    const c = await mount(
      renderCardContent({ id: 'network', metrics: sliced(), viewMode: 'default', hasNvidiaData: false })
    );
    expect(c.textContent).toContain('Network');
    expect(c.textContent).toContain('↓ 1.2 MB/s');
    expect(c.textContent).toContain('↑ 500 KB/s');
  });

  it('gpu card with nvidia data — vendor badge, temp, power/vram/fan/clock', async () => {
    const m = sliced({
      gpus: [{ key: 'gpu-a', name: 'GeForce RTX 4050', vendor: 'nvidia', values: [40, 45], temp_c: 65, nvidia: { power_w: 250, mem_used_mb: 2048, mem_total_mb: 8192, fan_speed_pct: 55, clock_mhz: 1600 }, latest: 45 }],
    });
    const c = await mount(
      renderCardContent({ id: 'gpu_gpu-a', metrics: m, viewMode: 'default', hasNvidiaData: true })
    );
    expect(c.textContent).toContain('GeForce RTX 4050');
    expect(c.textContent).toContain('45.0%');
    expect(c.textContent).toContain('NVIDIA');
    expect(c.textContent).toContain('65.0°C');
    expect(c.textContent).toContain('250.0 W');
    expect(c.textContent).toContain('2048 / 8192 MB');
    expect(c.textContent).toContain('55%');
    expect(c.textContent).toContain('1600 MHz');
  });

  it('gpu card without nvidia data — no NVML badges', async () => {
    const m = sliced({
      gpus: [{ key: 'gpu-intel', name: 'Intel(R) Iris Xe Graphics', vendor: 'intel', values: [5], temp_c: null, nvidia: null, latest: 5 }],
    });
    const c = await mount(
      renderCardContent({ id: 'gpu_gpu-intel', metrics: m, viewMode: 'default', hasNvidiaData: false })
    );
    expect(c.textContent).toContain('Iris Xe Graphics');
    expect(c.textContent).toContain('Intel');
    expect(c.textContent).not.toContain('MHz');
    expect(c.textContent).not.toContain('MB');
  });

  it('list view — min/max line from history', async () => {
    const c = await mount(
      renderCardContent({ id: 'cpu', metrics: sliced(), viewMode: 'list', hasNvidiaData: false })
    );
    expect(c.textContent).toContain('Min: 10.0%  Max: 20.0%');
  });

  it('unknown id → null', () => {
    expect(renderCardContent({ id: 'bogus', metrics: sliced(), viewMode: 'default', hasNvidiaData: false })).toBeNull();
  });

  it('disk id not in current metrics → null', () => {
    expect(renderCardContent({ id: 'disk_D:', metrics: sliced(), viewMode: 'default', hasNvidiaData: false })).toBeNull();
  });

  it('gpu id not in current metrics → null', () => {
    expect(renderCardContent({ id: 'gpu_missing', metrics: sliced(), viewMode: 'default', hasNvidiaData: false })).toBeNull();
  });
});
