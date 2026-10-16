import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  useSettings,
  useSettingsState,
  migratePersistedSettings,
  FutureSettingsVersionError,
  SETTINGS_VERSION,
} from './useSettings';

interface RenderResult {
  result: () => ReturnType<typeof useSettingsState>;
  rerender: () => void;
  unmount: () => void;
}

// The provider-less engine (useSettingsState) is what SettingsProvider mounts;
// these tests pin its standalone behavior directly. useSettings() itself
// requires a provider and is pinned in the last describe below.
function renderUseSettings(): RenderResult {
  let hookValue: ReturnType<typeof useSettingsState> | undefined;
  const container = document.createElement('div');
  let root: Root;

  function TestComponent() {
    hookValue = useSettingsState();
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

  // --- concurrent / rapid save() calls (4.1, 4.2) ---

  it('several rapid, non-awaited save() calls to the same key converge to the last-applied value', () => {
    const { result, unmount } = renderUseSettings();

    act(() => {
      // None of these are awaited — every drag-end/toggle in the real app
      // fires an independent, un-awaited save() the same way.
      void result().save({ windowSecs: 60 });
      void result().save({ windowSecs: 300 });
      void result().save({ windowSecs: 1800 });
    });

    expect(result().settings.windowSecs).toBe(1800);

    unmount();
  });

  it('concurrent save() calls to different keys both land (no clobbering across keys)', () => {
    const { result, unmount } = renderUseSettings();

    act(() => {
      void result().save({ windowSecs: 600 });
      void result().save({ viewMode: 'tile' });
      void result().save({ hiddenCardIds: ['gpu_rtx_4050'] });
    });

    expect(result().settings.windowSecs).toBe(600);
    expect(result().settings.viewMode).toBe('tile');
    expect(result().settings.hiddenCardIds).toEqual(['gpu_rtx_4050']);

    unmount();
  });
});

describe('persisted settings migration', () => {
  it('treats an absent version as legacy v0 and migrates known fields', () => {
    expect(migratePersistedSettings({ windowSecs: 300, viewMode: 'tile' })).toMatchObject({
      windowSecs: 300,
      viewMode: 'tile',
    });
  });

  it('validates current-version fields independently', () => {
    const migrated = migratePersistedSettings({
      settingsVersion: SETTINGS_VERSION,
      windowSecs: 999,
      hiddenCardIds: ['gpu-a'],
    });
    expect(migrated.windowSecs).toBe(60);
    expect(migrated.hiddenCardIds).toEqual(['gpu-a']);
  });

  it('rejects a future version without producing a downgrade payload', () => {
    expect(() => migratePersistedSettings({ settingsVersion: SETTINGS_VERSION + 1 })).toThrow(FutureSettingsVersionError);
  });

  it('falls back per field for corrupt data', () => {
    expect(migratePersistedSettings({
      settingsVersion: SETTINGS_VERSION,
      cardOrder: 'bad',
      hiddenCardIds: ['ok'],
      viewMode: 'bad',
      windowSecs: NaN,
    })).toEqual({
      cardOrder: null,
      hiddenCardIds: ['ok'],
      sidebarCardOrder: null,
      viewMode: 'default',
      windowSecs: 60,
    });
  });
});

// useSettings() is the provider-required context hook. Without a provider it
// must fail loudly instead of silently falling back: the old fallback called
// a hook after an early return (a rules-of-hooks violation), so the hook count
// differed between renders with and without a provider. This pin keeps the
// thrown contract from being softened back into a fallback.
describe('useSettings without a provider', () => {
  it('throws with an actionable message', () => {
    const container = document.createElement('div');
    let root: Root;

    function OrphanConsumer() {
      useSettings();
      return null;
    }

    expect(() => {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OrphanConsumer));
      });
    }).toThrow(/SettingsProvider/);
    act(() => root.unmount());
  });
});

