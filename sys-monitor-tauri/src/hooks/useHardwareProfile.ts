import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface GpuProfileEntry {
  name: string;
  vendor: string;
  kind: string;
}

export interface DiskProfileEntry {
  name: string;
  kind: string;
}

export interface HardwareProfile {
  cpu_vendor: string;
  cpu_name: string;
  gpus: GpuProfileEntry[];
  disks: DiskProfileEntry[];
}

function fetchProfile(): Promise<HardwareProfile | null> {
  return invoke<HardwareProfile | null>('get_hardware_profile').then(result => {
    if (result) {
      result.gpus = result.gpus ?? [];
      result.disks = result.disks ?? [];
    }
    return result;
  });
}

export function useHardwareProfile(): HardwareProfile | null {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return;
    }
    fetchProfile().then(setProfile).catch(() => setProfile(null));

    const unlisten = listen('hardware-profile-ready', () => {
      fetchProfile().then(setProfile).catch(() => setProfile(null));
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  return profile;
}
