import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Fakes the Tauri invoke surface (get_hardware_profile) and the
// "hardware-profile-ready" event listener so the hook's initial fetch,
// null/empty normalization and re-fetch wiring can be exercised end-to-end
// without a real Tauri runtime — same pattern as useMetrics.hook.test.ts.
const listeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, cb: (event: { payload: unknown }) => void) => {
    listeners.set(eventName, cb);
    return Promise.resolve(() => listeners.delete(eventName));
  }),
}));

/** What get_hardware_profile resolves to (swap between tests to simulate a
 *  profile appearing/changing — mirrors historyInvokeError in useMetrics.hook.test.ts). */
let profileResult: HardwareProfileFixture | null = null;
let profileFailure: Error | null = null;

interface HardwareProfileFixture {
  cpu_vendor: string;
  cpu_name: string;
  gpus?: { key?: string; name: string; vendor: string; kind: string }[];
  disks?: { key?: string; name: string; kind: string }[];
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => profileFailure
    ? Promise.reject(profileFailure)
    : profileResult ? Promise.resolve(profileResult) : Promise.resolve(null)),
}));

import { useHardwareProfile } from './useHardwareProfile';

function fullProfile(): HardwareProfileFixture {
  return {
    cpu_vendor: 'intel',
    cpu_name: 'Intel Core i7-13700K',
    gpus: [{ name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' }],
    disks: [{ name: 'C:', kind: 'Ssd' }],
  };
}

function emit(eventName: string, payload: unknown) {
  const cb = listeners.get(eventName);
  if (!cb) throw new Error(`no listener registered for ${eventName}`);
  cb({ payload });
}

interface RenderResult {
  result: () => ReturnType<typeof useHardwareProfile>;
  unmount: () => void;
  rerender: () => void;
}

function renderUseHardwareProfile(): RenderResult {
  let hookValue: ReturnType<typeof useHardwareProfile> | undefined;
  const container = document.createElement('div');
  let root: Root;

  function TestComponent() {
    hookValue = useHardwareProfile();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent));
  });

  return {
    result: () => {
      if (hookValue === undefined) throw new Error('Hook value not initialized');
      return hookValue;
    },
    unmount: () => act(() => root.unmount()),
    rerender: () => act(() => root.render(React.createElement(TestComponent))),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useHardwareProfile (Tauri event wiring)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    listeners.clear();
    profileResult = null;
    profileFailure = null;
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('fetches the profile once on mount', async () => {
    profileResult = fullProfile();

    const { result, unmount } = renderUseHardwareProfile();
    await flush();

    expect(result().profile).toEqual({
      cpu_vendor: 'intel',
      cpu_name: 'Intel Core i7-13700K',
      gpus: [{ key: 'gpu:geforce_rtx_4050', name: 'GeForce RTX 4050', vendor: 'Nvidia', kind: 'Discrete' }],
      disks: [{ key: 'disk:c', name: 'C:', kind: 'Ssd' }],
    });
    expect(result().error).toBeNull();

    unmount();
  });

  it('normalizes null (no profile yet) to null and missing gpus/disks to empty arrays', async () => {
    // No GPU/disk entries in the payload — those keys must not leak undefined.
    profileResult = { cpu_vendor: 'amd', cpu_name: 'Ryzen 9' };

    const { result, unmount } = renderUseHardwareProfile();
    await flush();

    expect(result().profile).toEqual({ cpu_vendor: 'amd', cpu_name: 'Ryzen 9', gpus: [], disks: [] });

    unmount();
  });

  it('stays null when the backend has no profile yet', async () => {
    profileResult = null;

    const { result, unmount } = renderUseHardwareProfile();
    await flush();

    expect(result().profile).toBeNull();

    unmount();
  });

  it('surfaces an initial profile failure instead of reporting endless detection', async () => {
    profileFailure = new Error('WMI profile unavailable');
    const { result, unmount } = renderUseHardwareProfile();
    await flush();

    expect(result().profile).toBeNull();
    expect(result().loading).toBe(false);
    expect(result().error).toBe('WMI profile unavailable');
    unmount();
  });

  it('re-fetches the profile when hardware-profile-ready arrives', async () => {
    profileResult = fullProfile();
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    expect(result().profile).toEqual(expect.objectContaining({ cpu_name: 'Intel Core i7-13700K' }));

    // Hardware enumeration finished: the backend now reports a different CPU.
    profileResult = { cpu_vendor: 'amd', cpu_name: 'Ryzen 9', gpus: [], disks: [] };
    act(() => {
      emit('hardware-profile-ready', {});
    });
    await flush();

    expect(result().profile).toEqual(expect.objectContaining({ cpu_name: 'Ryzen 9' }));

    unmount();
  });

  it('keeps the state object referentially stable across re-renders without profile changes', async () => {
    profileResult = fullProfile();
    const { result, rerender, unmount } = renderUseHardwareProfile();
    await flush();
    const first = result();

    // A parent re-render (e.g. a metrics tick) must not rebuild the state
    // object — App hands it straight to the memoized HardwareSidebar.
    rerender();
    expect(result()).toBe(first);

    // A real profile change must produce a fresh object.
    profileResult = { cpu_vendor: 'amd', cpu_name: 'Ryzen 9', gpus: [], disks: [] };
    act(() => emit('hardware-profile-ready', {}));
    await flush();
    expect(result()).not.toBe(first);
    expect(result().profile?.cpu_name).toBe('Ryzen 9');

    unmount();
  });

  it('preserves the last good profile through a failed refetch and recovers on retry', async () => {
    profileResult = fullProfile();
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    const original = result().profile;

    profileFailure = new Error('transient profile read failure');
    act(() => emit('hardware-profile-ready', {}));
    await flush();
    expect(result().profile).toEqual(original);
    expect(result().error).toBe('transient profile read failure');

    profileFailure = null;
    profileResult = { cpu_vendor: 'amd', cpu_name: 'Ryzen 9', gpus: [], disks: [] };
    act(() => emit('hardware-profile-ready', {}));
    await flush();
    expect(result().profile?.cpu_name).toBe('Ryzen 9');
    expect(result().error).toBeNull();
    unmount();
  });

  it('coalesces notifications during a pending fetch into one trailing refresh', async () => {
    let resolveFirst!: (value: HardwareProfileFixture) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    profileResult = { cpu_vendor: 'amd', cpu_name: 'New profile' };
    act(() => {
      emit('hardware-profile-ready', {});
      emit('hardware-profile-ready', {});
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst(fullProfile()); });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result().profile?.cpu_name).toBe('New profile');
    expect(result().loading).toBe(false);
    unmount();
  });

  it('reads bootstrap only after asynchronous listener registration', async () => {
    let attach!: () => void;
    const dispose = vi.fn();
    vi.mocked(listen).mockImplementationOnce(() => new Promise((resolve) => {
      attach = () => resolve(dispose);
    }));
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    profileResult = { cpu_vendor: 'amd', cpu_name: 'Changed before attach' };
    await act(async () => { attach(); });
    await flush();
    expect(result().profile?.cpu_name).toBe('Changed before attach');
    unmount();
    await flush();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('ignores old notifications after retry replaces the subscription', async () => {
    profileResult = fullProfile();
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    const oldListener = listeners.get('hardware-profile-ready')!;
    act(() => result().retry());
    await flush();
    vi.mocked(invoke).mockClear();
    act(() => oldListener({ payload: {} }));
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    unmount();
  });

  it('does not bootstrap when registration resolves after unmount', async () => {
    let attach!: () => void;
    const dispose = vi.fn();
    vi.mocked(listen).mockImplementationOnce(() => new Promise((resolve) => {
      attach = () => resolve(dispose);
    }));
    const { unmount } = renderUseHardwareProfile();
    unmount();
    await act(async () => { attach(); });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('still refreshes after a pending request fails with a notification queued', async () => {
    let rejectFirst!: (error: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    profileResult = fullProfile();
    act(() => emit('hardware-profile-ready', {}));
    await act(async () => { rejectFirst(new Error('old request failed')); });
    await flush();
    expect(result().profile?.cpu_name).toBe('Intel Core i7-13700K');
    expect(result().error).toBeNull();
    unmount();
  });

  it('does not run a trailing request after unmount', async () => {
    let resolveFirst!: (value: HardwareProfileFixture) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { unmount } = renderUseHardwareProfile();
    await flush();
    act(() => emit('hardware-profile-ready', {}));
    unmount();
    await act(async () => { resolveFirst(fullProfile()); });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('surfaces subscription failure while keeping a useful bootstrap profile and retries', async () => {
    profileResult = fullProfile();
    vi.mocked(listen).mockRejectedValueOnce(new Error('subscription unavailable'));
    const { result, unmount } = renderUseHardwareProfile();
    await flush();
    expect(result().profile?.cpu_name).toBe('Intel Core i7-13700K');
    expect(result().loading).toBe(false);
    expect(result().error).toBe('subscription unavailable');
    act(() => result().retry());
    await flush();
    expect(result().error).toBeNull();
    unmount();
  });
});
