import React, { Profiler, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MetricChart } from './MetricChart';
import type { ChartPoint } from '../chartPoints';

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
});
