import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild(): React.ReactNode {
  throw new Error('render boom');
}

function GoodChild({ label }: { label: string }) {
  return <div>{label}</div>;
}

// React logs caught render errors to console.error in dev — silence the noise.
function silenceErrorLogs() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

let container: HTMLDivElement;
let root: Root;
let errSpy: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  errSpy?.mockRestore();
  vi.useRealTimers();
});

describe('ErrorBoundary', () => {
  it('shows the fallback (with a Retry affordance) instead of the throwing child', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    errSpy = silenceErrorLogs();

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(ErrorBoundary, null, React.createElement(ThrowingChild)));
    });

    expect(container.textContent).toContain('Chart error');
    expect(container.querySelector('button')?.textContent).toBe('Retry');
  });

  it('auto-recovers when new children arrive once the retry cooldown has elapsed', () => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    errSpy = silenceErrorLogs();

    const boundary = React.createElement(ErrorBoundary, null, React.createElement(ThrowingChild));
    act(() => {
      root = createRoot(container);
      root.render(boundary);
    });
    expect(container.textContent).toContain('Chart error');

    // A new child arrives within the cooldown: still failing — no retry yet,
    // so the fallback must stay (no tight throw→reset→throw loop).
    act(() => {
      root.render(React.createElement(ErrorBoundary, null, React.createElement(GoodChild, { label: 'recovered' })));
    });
    expect(container.textContent).toContain('Chart error');

    // Once the cooldown elapses, the next new children trigger a retry: a
    // good card renders and the boundary recovers on its own.
    act(() => {
      vi.advanceTimersByTime(1100);
      root.render(React.createElement(ErrorBoundary, null, React.createElement(GoodChild, { label: 'recovered' })));
    });
    expect(container.textContent).toContain('recovered');
    expect(container.textContent).not.toContain('Chart error');
  });

  it('Recovers immediately via the Retry button, even within the cooldown', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    errSpy = silenceErrorLogs();

    act(() => {
      root = createRoot(container);
      root.render(React.createElement(ErrorBoundary, null, React.createElement(ThrowingChild)));
    });
    expect(container.textContent).toContain('Chart error');

    // Swap in a good child (within the cooldown — auto-retry is still gated)
    // and click Retry: the manual affordance must reset hasError right away.
    act(() => {
      root.render(React.createElement(ErrorBoundary, null, React.createElement(GoodChild, { label: 'manual recovery' })));
    });
    expect(container.textContent).toContain('Chart error');

    const retryButton = container.querySelector('button');
    expect(retryButton).not.toBeNull();
    act(() => {
      retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('manual recovery');
    expect(container.textContent).not.toContain('Chart error');
  });
});
