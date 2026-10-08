import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { Profiler, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MetricCard } from './MetricCard';
import type { MetricValue } from '../types/metrics';

// The chart body is React.lazy'd and resolves asynchronously, which makes a real
// Recharts mount in jsdom unreliable. What this file guards is the CARD side of
// the chart contract: the accessible name it derives and hands to the chart, and
// (critically) that the name does not change on live scalar ticks, which would
// defeat MetricChart's memo and re-mount the Recharts subtree 4x per second.

vi.mock('./MetricChart', () => ({
  MetricChart: ({ label }: { label: string }) => (
    <div data-testid="chart-stub" data-label={label} />
  ),
}));

describe('MetricCard chart label', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    // jsdom has no ResizeObserver; the stub only matters for the real chart.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    const currentRoot = root;
    if (currentRoot) act(() => currentRoot.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  const HISTORY: MetricValue[] = [10, 40, 22, 66, 12];
  const TIMESTAMPS = [1000, 2000, 3000, 4000, 5000];

  const readLabel = (): string =>
    container!.querySelector('[data-testid="chart-stub"]')?.getAttribute('data-label') ?? '';

  it('summarises the metric for assistive technology', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <MetricCard
          id="cpu"
          title="CPU"
          value="42.0%"
          history={HISTORY}
          timestamps={TIMESTAMPS}
          color="#4699e8"
          viewMode="default"
        />
      );
    });

    expect(readLabel()).toBe('CPU trend, now 12.0%, Min: 10.0%  Max: 66.0% over the selected window');
  });

  it('clamps the range it reports, so a negative sample cannot be advertised', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <MetricCard
          id="cpu"
          title="CPU"
          value="1.0%"
          history={[-9.9, 12, 130.4]}
          timestamps={[1, 2, 3]}
          color="#4699e8"
          viewMode="default"
        />
      );
    });

    expect(readLabel()).toBe('CPU trend, now 100.0%, Min: 0.0%  Max: 100.0% over the selected window');
  });

  it('labels both series when the card carries a secondary channel', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <MetricCard
          id="network"
          title="Network"
          value=""
          history={[100, 300, 500]}
          secondaryHistory={[50, 150, 250]}
          timestamps={[1000, 2000, 3000]}
          color="#50d8f0"
          secondaryColor="#e88a50"
          viewMode="default"
        />
      );
    });

    expect(readLabel()).toBe('Network, now down 500 KB/s and up 250 KB/s over the selected window');
  });

  it('keeps the label stable while the live scalar ticks, and moves it only when the window does', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<TickingCard live="10.0%" history={HISTORY} />);
    });

    const stableLabel = readLabel();
    expect(stableLabel.length).toBeGreaterThan(0);

    // Four scalar ticks: a new live value every time, an IDENTICAL history
    // array — exactly the dashboard's per-tick shape (~250 ms).
    for (const live of ['25.5%', '31.2%', '44.8%', '50.0%']) {
      await act(async () => {
        root!.render(<TickingCard live={live} history={HISTORY} />);
      });
      expect(readLabel()).toBe(stableLabel);
    }

    // Positive control: when the committed window itself changes, the label must
    // follow it, so the assertion above is not vacuous.
    const extended: MetricValue[] = [...HISTORY, 77];
    await act(async () => {
      root!.render(<TickingCard live="50.0%" history={extended} />);
    });
    expect(readLabel()).not.toBe(stableLabel);
    expect(readLabel()).toBe('CPU trend, now 77.0%, Min: 10.0%  Max: 77.0% over the selected window');
  });
});

/** A card whose live scalar changes while the history array keeps its identity. */
function TickingCard({ live, history }: { live: string; history: MetricValue[] }) {
  const [, setTick] = useState(0);
  React.useEffect(() => {
    setTick((n) => n + 1);
  }, []);
  return (
    <Profiler id="card" onRender={() => undefined}>
      <MetricCard
        id="cpu"
        title="CPU"
        value={live}
        history={history}
        timestamps={[1000, 2000, 3000, 4000, 5000, 6000]}
        color="#4699e8"
        viewMode="default"
      />
    </Profiler>
  );
}
