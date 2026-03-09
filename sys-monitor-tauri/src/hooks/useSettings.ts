import { Store } from '@tauri-apps/plugin-store';
import { useState, useEffect, useCallback } from 'react';
import type { ViewMode } from '../utils';

const STORE_PATH = 'settings.json';

export interface Settings {
  cardOrder: string[] | null;
  hiddenCardIds: string[];
  viewMode: ViewMode;
  windowSecs: number;
}

const DEFAULTS: Settings = {
  cardOrder: null,
  hiddenCardIds: [],
  viewMode: 'default',
  windowSecs: 60,
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [store, setStore] = useState<Store | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      setLoaded(true);
      return;
    }
    (async () => {
      const s = await Store.load(STORE_PATH);
      setStore(s);
      const cardOrder = await s.get<string[]>('cardOrder');
      const hiddenCardIds = await s.get<string[]>('hiddenCardIds');
      const viewMode = await s.get<ViewMode>('viewMode');
      const windowSecs = await s.get<number>('windowSecs');
      setSettings({
        cardOrder: cardOrder ?? null,
        hiddenCardIds: hiddenCardIds ?? [],
        viewMode: viewMode ?? 'default',
        windowSecs: windowSecs ?? 60,
      });
      setLoaded(true);
    })();
  }, []);

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      if (store) {
        for (const [k, v] of Object.entries(patch)) {
          await store.set(k, v);
        }
        await store.save();
      }
    },
    [store]
  );

  return { settings, save, loaded };
}
