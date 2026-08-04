import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Fakes @tauri-apps/plugin-store with an in-memory map keyed by store path,
// shared across Store.load() calls — models real on-disk persistence so a
// second "app restart" (a fresh useSettings mount that calls Store.load again)
// observes values written by an earlier mount, without touching the filesystem.
vi.mock('@tauri-apps/plugin-store', () => {
  const backing = new Map<string, Map<string, unknown>>();

  class FakeStore {
    constructor(private path: string) {
      if (!backing.has(path)) backing.set(path, new Map());
    }
    static async load(path: string): Promise<FakeStore> {
      return new FakeStore(path);
    }
    async get<T>(key: string): Promise<T | undefined> {
      return backing.get(this.path)!.get(key) as T | undefined;
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.get(this.path)!.set(key, value);
    }
    async save(): Promise<void> {
      // no-op — the in-memory map is already the "persisted" state
    }
  }

  return { Store: FakeStore };
});

import { useSettings, SettingsProvider } from './useSettings';

interface RenderResult {
  result: () => ReturnType<typeof useSettings>;
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
      if (!hookValue) throw new Error('Hook value not initialized');
      return hookValue;
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

describe('useSettings persistence across restart (4.3)', () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('a fresh useSettings load from the same store returns previously saved non-default values', async () => {
    const first = renderUseSettings();
    // Wait for the initial async Store.load() effect to resolve.
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await first.result().save({ windowSecs: 1800, viewMode: 'tile' });
    });
    expect(first.result().settings.windowSecs).toBe(1800);
    first.unmount();

    // Simulates an app restart: a brand-new hook instance, new Store.load()
    // call, same backing path.
    const second = renderUseSettings();
    await act(async () => {
      await Promise.resolve();
    });

    expect(second.result().settings.windowSecs).toBe(1800);
    expect(second.result().settings.viewMode).toBe('tile');
    second.unmount();
  });
});

describe('SettingsProvider — one shared instance for all consumers', () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('a save through one consumer is immediately visible to another (single store instance)', async () => {
    const consumers: Record<string, ReturnType<typeof useSettings>> = {};
    const container = document.createElement('div');
    let root: Root;

    function ConsumerA() {
      consumers.a = useSettings();
      return null;
    }
    function ConsumerB() {
      consumers.b = useSettings();
      return null;
    }

    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(
          SettingsProvider,
          null,
          React.createElement(ConsumerA),
          React.createElement(ConsumerB)
        )
      );
    });
    // Flush the async Store.load() effect so both consumers share the loaded store.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both consumers read the same context value — exactly one store + one save().
    expect(consumers.a).toBe(consumers.b);

    // Dashboard-style reorder through consumer A…
    await act(async () => {
      await consumers.a.save({ cardOrder: ['cpu', 'memory'] });
    });
    // …is visible to consumer B without a remount (no stale independent cache).
    expect(consumers.b.settings.cardOrder).toEqual(['cpu', 'memory']);

    // Sidebar-style reorder through consumer B does not clobber A's earlier write.
    await act(async () => {
      await consumers.b.save({ sidebarCardOrder: ['sb_cpu', 'sb_memory'] });
    });
    expect(consumers.a.settings.sidebarCardOrder).toEqual(['sb_cpu', 'sb_memory']);
    expect(consumers.a.settings.cardOrder).toEqual(['cpu', 'memory']);

    act(() => root.unmount());
  });
});
