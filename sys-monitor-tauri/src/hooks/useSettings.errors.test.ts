import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Fakes @tauri-apps/plugin-store, with a switch to make Store.load() reject
// (ERR-001) and a pre-seedable backing map to exercise per-field validation
// on read (ARC-005), without touching the filesystem.
const backing = new Map<string, Map<string, unknown>>();
let failLoad = false;

vi.mock('@tauri-apps/plugin-store', () => {
  class FakeStore {
    constructor(private path: string) {
      if (!backing.has(path)) backing.set(path, new Map());
    }
    static async load(path: string): Promise<FakeStore> {
      if (failLoad) throw new Error('disk read failed');
      return new FakeStore(path);
    }
    async get<T>(key: string): Promise<T | undefined> {
      return backing.get(this.path)!.get(key) as T | undefined;
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.get(this.path)!.set(key, value);
    }
    async save(): Promise<void> {
      // no-op
    }
  }

  return { Store: FakeStore };
});

import { useSettings } from './useSettings';

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
    unmount: () => act(() => root.unmount()),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSettings load failure (4.1 / ERR-001)', () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    backing.clear();
    failLoad = false;
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('sets the error state instead of leaving loaded false forever when Store.load rejects', async () => {
    failLoad = true;
    const { result, unmount } = renderUseSettings();
    await flush();

    expect(result().error).toBe('disk read failed');
    // Not silently faked as a successful load with defaults.
    expect(result().loaded).toBe(false);

    unmount();
  });
});

describe('useSettings versioning and per-field validation (4.2 / ARC-005)', () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    backing.clear();
    failLoad = false;
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('falls back per-field to compiled-in defaults on invalid shape/type, leaving valid fields untouched', async () => {
    backing.set(
      'settings.json',
      new Map<string, unknown>([
        ['cardOrder', 'not-an-array'],
        ['viewMode', 'bogus-mode'],
        ['windowSecs', 300],
      ])
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, unmount } = renderUseSettings();
    await flush();

    expect(result().loaded).toBe(true);
    expect(result().error).toBeNull();
    expect(result().settings.cardOrder).toBeNull();
    expect(result().settings.viewMode).toBe('default');
    expect(result().settings.windowSecs).toBe(300);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    unmount();
  });

  it('treats a missing settingsVersion as valid rather than rejecting the load', async () => {
    backing.set('settings.json', new Map<string, unknown>([['windowSecs', 600]]));

    const { result, unmount } = renderUseSettings();
    await flush();

    expect(result().loaded).toBe(true);
    expect(result().error).toBeNull();
    expect(result().settings.windowSecs).toBe(600);

    unmount();
  });

  it('a settingsVersion mismatch still preserves valid fields rather than resetting them', async () => {
    backing.set(
      'settings.json',
      new Map<string, unknown>([
        ['settingsVersion', 999],
        ['windowSecs', 1800],
      ])
    );

    const { result, unmount } = renderUseSettings();
    await flush();

    expect(result().loaded).toBe(true);
    expect(result().settings.windowSecs).toBe(1800);

    unmount();
  });
});
