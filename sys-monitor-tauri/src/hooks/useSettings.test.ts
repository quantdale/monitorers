import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useSettings } from './useSettings';

interface RenderResult {
  result: () => ReturnType<typeof useSettings>;
  rerender: () => void;
  unmount: () => void;
}

function renderUseSettings(): RenderResult {
  let hookValue: ReturnType<typeof useSettings> | undefined;
  const container = document.createElement('div');
  let root: Root;

  function TestComponent() {
    hookValue = useSettings();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent));
  });

  return {
    result: () => {
      if (!hookValue) {
        throw new Error('Hook value not initialized');
      }
      return hookValue;
    },
    rerender: () => {
      act(() => {
        root.render(React.createElement(TestComponent));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe('useSettings (non-Tauri)', () => {
  beforeEach(() => {
    // Ensure we are on the non-Tauri path for each test
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__TAURI_INTERNALS__;
    }
  });

  it('returns default values on first load', () => {
    const { result, unmount } = renderUseSettings();

    expect(result().loaded).toBe(true);
    expect(result().settings).toEqual({
      cardOrder: null,
      hiddenCardIds: [],
      sidebarCardOrder: null,
      viewMode: 'default',
      windowSecs: 60,
    });

    unmount();
  });

  it('save updates windowSecs value', () => {
    const { result, unmount } = renderUseSettings();

    act(() => {
      result().save({ windowSecs: 300 });
    });

    expect(result().settings.windowSecs).toBe(300);

    unmount();
  });

  it('save adds a card ID to hiddenCardIds', () => {
    const { result, unmount } = renderUseSettings();

    act(() => {
      result().save({ hiddenCardIds: ['gpu_rtx_4050'] });
    });

    expect(result().settings.hiddenCardIds).toContain('gpu_rtx_4050');

    unmount();
  });

  it('save can remove a hidden card ID by updating the array', () => {
    const { result, unmount } = renderUseSettings();

    act(() => {
      result().save({ hiddenCardIds: ['gpu_rtx_4050'] });
    });
    expect(result().settings.hiddenCardIds).toEqual(['gpu_rtx_4050']);

    act(() => {
      result().save({ hiddenCardIds: [] });
    });

    expect(result().settings.hiddenCardIds).toEqual([]);

    unmount();
  });
});

