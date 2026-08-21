import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../utils';

export interface GpuProfileEntry {
  /** Stable backend identity; display name is presentation-only. */
  key: string;
  name: string;
  vendor: string;
  kind: string;
}

export interface DiskProfileEntry {
  /** Stable backend identity; display name is presentation-only. */
  key: string;
  name: string;
  kind: string;
}

export interface HardwareProfile {
  cpu_vendor: string;
  cpu_name: string;
  gpus: GpuProfileEntry[];
  disks: DiskProfileEntry[];
}

export interface HardwareProfileState {
  profile: HardwareProfile | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

function fallbackKey(prefix: string, name: string): string {
  return `${prefix}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function normalizeProfile(result: HardwareProfile | null): HardwareProfile | null {
  if (!result) return null;
  return {
    ...result,
    gpus: (result.gpus ?? []).map((gpu) => ({
      ...gpu,
      key: gpu.key || fallbackKey('gpu', gpu.name),
    })),
    disks: (result.disks ?? []).map((disk) => ({
      ...disk,
      key: disk.key || fallbackKey('disk', disk.name),
    })),
  };
}

function fetchProfile(): Promise<HardwareProfile | null> {
  return invoke<HardwareProfile | null>('get_hardware_profile').then(normalizeProfile);
}

export function useHardwareProfile(): HardwareProfileState {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [loading, setLoading] = useState(isTauri());
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let requestInFlight = false;

    const load = () => {
      if (requestInFlight) return;
      requestInFlight = true;
      setLoading(true);
      fetchProfile()
        .then((next) => {
          if (cancelled) return;
          setProfile(next);
          setError(null);
        })
        .catch((reason) => {
          if (cancelled) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          // Preserve the last known good profile during a transient refetch
          // failure; the sidebar can show a retry affordance instead of
          // reverting to an indefinite "Detecting" state.
        })
        .finally(() => {
          requestInFlight = false;
          if (!cancelled) setLoading(false);
        });
    };

    load();
    const unlisten = listen('hardware-profile-ready', load);
    return () => {
      cancelled = true;
      unlisten.then((dispose) => dispose()).catch(() => undefined);
    };
  }, [retryToken]);

  // Stable result identity: consumers (App passes `profileState` straight
  // into the memoized HardwareSidebar) re-render on every metrics tick, and
  // a fresh object literal here would defeat that memo on each one.
  return useMemo(
    () => ({ profile, loading, error, retry }),
    [profile, loading, error, retry],
  );
}
