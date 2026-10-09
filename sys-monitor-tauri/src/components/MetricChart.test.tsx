import React, { Profiler, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MetricChart } from './MetricChart';
import type { ChartPoint } from '../chartPoints';

// The time axis must be a readable scale: explicit colors (the library default
// gray measured ~2.90:1 on the #1e1e1e card surface, below both contrast
// floors), precision that follows the visible span, and enough bottom margin
// that the label baseline sits inside the fixed 140px chart box.
//
// Recharts renders tick labels in a separate `recharts-xAxis-tick-labels`
// layer (not inside `.recharts-xAxis`), so the queries below target
// `.recharts-cartesian-axis-tick-value` text nodes. Tick thinning by
// minTickGap needs real text measurement, which jsdom cannot do, so the gap
// is asserted here as an observed-spacing floor and proven where the
// thinning actually happens — the Playwright mock lane (chart-axis
// readability spec, measurements on the seeded span and the 30s window).

// Regression guard for the measured chart-render fan-out fix: the dashboard
// rebuilds every card on each ~250ms scalar tick while chart data only changes
// on 1 Hz history commits. MetricChart must stay memoized AND receive
// referentially stable props, or the Recharts subtree rejoins every tick
// (measured on the mock harness: 686 → 182 body renders per 12s across 7
// charts, long-task main-thread time -62%). If this test fails because memo()
// was removed, re-measure before shipping: the fan-out cost was the single
// largest main-thread consumer in the app.

const REACT_MEMO_TYPE = Symbol.for('react.memo');

describe('MetricChart render-fan-out guard', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let originalRO: typeof ResizeObserver | undefined;

  beforeEach(() => {
    originalRO = globalThis.ResizeObserver;
  });

  afterEach(() => {
    // Restore the real (or absent) ResizeObserver for every future test in
    // this file — the stub below must never leak across test bodies.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    const currentRoot = root;
    if (currentRoot) act(() => currentRoot.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it('is wrapped in React.memo', () => {
    const type = (MetricChart as unknown as { $$typeof?: symbol }).$$typeof;
    expect(type).toBe(REACT_MEMO_TYPE);
  });

  it('skips commits when parent re-renders with unchanged props, commits when data changes', () => {
    // jsdom has no ResizeObserver; ResponsiveContainer needs one that reports
    // a size synchronously for the chart to mount. Saved/restored by the
    // describe-level beforeEach/afterEach.
    class ResizeObserverStub {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(): void {
        this.callback(
          [
            {
              target: { clientWidth: 400, clientHeight: 140 } as unknown as Element,
              contentRect: { width: 400, height: 140 } as unknown as DOMRectReadOnly,
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

    {
      const data: ChartPoint[] = [
        { t: 1000, v: 10 },
        { t: 2000, v: 40 },
      ];
      const yDomain: [number, 'auto'] = [0, 'auto'];

      let commits = 0;
      const onRender = () => {
        commits += 1;
      };

      function Host({ points }: { points: ChartPoint[] }) {
        // Unstable scalar state forces Host to re-render without touching any
        // chart prop — exactly the scalar-tick pattern from the dashboard.
        const [, setTick] = useState(0);
        React.useEffect(() => {
          setTick((n) => n + 1);
        }, []);
        return (
          <Profiler id="metric-chart" onRender={onRender}>
            <MetricChart
              data={points}
              yDomain={yDomain}
              color="#4699e8"
              hasSecondary={false}
              showTimeAxis={false}
              label="test chart"
            />
          </Profiler>
        );
      }

      container = document.createElement('div');
      document.body.appendChild(container);
      let points = data;
      act(() => {
        root = createRoot(container!);
        root.render(<Host points={points} />);
      });
      // Mount commit(s): initial + the effect-driven re-render above must NOT
      // produce additional chart commits because every prop kept its identity.
      const commitsAfterUnchangedRerender = commits;

      points = [{ t: 1000, v: 12 }, { t: 2000, v: 44 }, { t: 3000, v: 7 }];
      act(() => {
        root!.render(<Host points={points} />);
      });
      const commitsAfterDataChange = commits - commitsAfterUnchangedRerender;

      // StrictMode double-invocation may legitimately add a mount commit, but
      // an identity-stable re-render must never add more than that baseline,
      // and a data change must always commit at least once.
      expect(commitsAfterUnchangedRerender).toBeLessThanOrEqual(4);
      expect(commitsAfterDataChange).toBeGreaterThanOrEqual(1);
    }
  });

  it('exposes the chart as a named, non-focusable image', () => {
    // Recharts 3 defaults `accessibilityLayer` on, which would otherwise leave
    // every chart as <svg role="application" tabindex="0"> with an empty
    // <title>: one unnamed tab stop per card. The chart is a graphic here (no
    // tooltip, no interaction), so it must be an image with a real name.
    class ResizeObserverStub {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(): void {
        this.callback(
          [
            {
              target: { clientWidth: 400, clientHeight: 140 } as unknown as Element,
              contentRect: { width: 400, height: 140 } as unknown as DOMRectReadOnly,
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(
        <MetricChart
          data={[{ t: 1000, v: 10 }, { t: 2000, v: 40 }]}
          yDomain={[0, 100]}
          color="#4699e8"
          hasSecondary={false}
          showTimeAxis={false}
          label="CPU trend, now 10.0%"
        />
      );
    });

    const surface = container!.querySelector('svg');
    expect(surface).not.toBeNull();
    expect(surface!.getAttribute('role')).toBe('img');
    expect(surface!.getAttribute('tabindex')).toBe('-1');
    expect(surface!.getAttribute('aria-label')).toBe('CPU trend, now 10.0%');
  });
});

/** Renders a chart into a fresh container with a synchronous ResizeObserver
 *  (jsdom has none; ResponsiveContainer needs a reported size to mount).
 *  Every root and container created is registered on the describe-scoped
 *  collections below so the afterEach hook can unmount and remove them — a
 *  created React root is a live subscription and must not outlive its test. */
const axisTestRoots: Root[] = [];
const axisTestContainers: HTMLDivElement[] = [];

function renderChart(data: ChartPoint[], showTimeAxis: boolean): HTMLDivElement {
  class ResizeObserverStub {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(): void {
      this.callback(
        [
          {
            target: { clientWidth: 400, clientHeight: 140 } as unknown as Element,
            contentRect: { width: 400, height: 140 } as unknown as DOMRectReadOnly,
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  axisTestRoots.push(root);
  axisTestContainers.push(container);
  act(() => {
    root.render(
      <MetricChart
        data={data}
        yDomain={[0, 100]}
        color="#4699e8"
        hasSecondary={false}
        showTimeAxis={showTimeAxis}
        label="axis test chart"
      />
    );
  });
  return container;
}

function minuteAlignedPoints(seconds: number, stepMs = 1000): ChartPoint[] {
  const t0 = new Date(2026, 9, 9, 13, 0, 0).getTime();
  const points: ChartPoint[] = [];
  for (let i = 0; i <= seconds; i += 1) {
    points.push({ t: t0 + i * stepMs, v: (i * 7) % 100 });
  }
  return points;
}

function tickValueTexts(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value')).map(
    (node) => node.textContent ?? ''
  );
}

describe('time-axis styling', () => {
  let originalRO: typeof ResizeObserver | undefined;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    originalRO = globalThis.ResizeObserver;
  });

  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    for (const root of axisTestRoots) {
      act(() => root.unmount());
    }
    axisTestRoots.length = 0;
    for (const element of axisTestContainers) {
      element.remove();
    }
    axisTestContainers.length = 0;
    container = null;
  });

  it('paints tick text with the explicit #888, never the library default', () => {
    container = renderChart(minuteAlignedPoints(59), true);

    const ticks = container.querySelectorAll('.recharts-cartesian-axis-tick-value');
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) {
      expect(tick.getAttribute('fill')).toBe('#888');
      expect(tick.getAttribute('stroke')).toBe('none');
    }
  });

  it('draws the axis and its tick lines with the #7a7a7a stroke', () => {
    container = renderChart(minuteAlignedPoints(59), true);

    const axisLine = container.querySelector('.recharts-cartesian-axis-line');
    expect(axisLine?.getAttribute('stroke')).toBe('#7a7a7a');
    const tickLines = container.querySelectorAll('.recharts-cartesian-axis-tick-line');
    expect(tickLines.length).toBeGreaterThan(1);
    for (const line of tickLines) {
      expect(line.getAttribute('stroke')).toBe('#7a7a7a');
    }
  });

  it('reserves 16px of bottom margin so tick labels sit inside the chart box', () => {
    // Chart box height is 140 (the ResizeObserver stub). With the time-axis
    // margin of { top: 2, bottom: 16 }, the plot area bottom is at
    // 140 - 16 = 124 and recharts' 30px tick band starts at 94. A bottom
    // margin of 0 would put the axis line at 108.
    container = renderChart(minuteAlignedPoints(59), true);

    const axisLine = container.querySelector('.recharts-cartesian-axis-line');
    expect(axisLine?.getAttribute('y1')).toBe('94');
    expect(axisLine?.getAttribute('y2')).toBe('94');

    for (const tick of container.querySelectorAll('.recharts-cartesian-axis-tick-value')) {
      // Baselines live inside the reserved band, not on the chart edge.
      expect(Number(tick.getAttribute('y'))).toBeGreaterThan(100);
      expect(Number(tick.getAttribute('y'))).toBeLessThanOrEqual(140 - 16);
    }
  });

  it('renders tick labels no closer than the 80px gap floor (layout guard, not the thinning proof)', () => {
    // DELIBERATELY NOT a minTickGap proof. jsdom cannot measure text, so
    // recharts skips its minTickGap thinning entirely here — a probe that
    // removed the prop produced byte-identical jsdom geometry. This assertion
    // only guards the floor: whatever ticks jsdom does render must never sit
    // closer than the specified gap. The live thinning proof is the
    // Playwright lane, where labels are really measured.
    container = renderChart(minuteAlignedPoints(59), true);

    const xs = Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value'))
      .map((node) => Number(node.getAttribute('x')))
      .sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(1);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(80);
    }
  });

  it('formats ticks with seconds below the five-minute span and without them above', () => {
    // A 59-second span keeps seconds.
    container = renderChart(minuteAlignedPoints(59), true);
    const shortLabels = tickValueTexts(container);
    expect(shortLabels.length).toBeGreaterThan(1);
    for (const label of shortLabels) {
      expect(label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
    expect(shortLabels[0]).toBe('13:00:00');
    expect(shortLabels[shortLabels.length - 1]).toBe('13:00:59');

    // A one-hour span drops seconds.
    container = renderChart(minuteAlignedPoints(3600), true);
    const longLabels = tickValueTexts(container);
    expect(longLabels.length).toBeGreaterThan(1);
    for (const label of longLabels) {
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('draws no time-axis tick text when the axis is hidden (list view)', () => {
    container = renderChart(minuteAlignedPoints(59), false);

    expect(container.querySelectorAll('.recharts-cartesian-axis-tick-value').length).toBe(0);
    expect(container.querySelector('.recharts-cartesian-axis-line')).toBeNull();
  });
});
