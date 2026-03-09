import { Store } from 'tauri-plugin-store-api';
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
    if (typeof window === 'undefined' || !(window as unknown as { __TAURI__?: unknown }).__TAURI__) {
      setLoaded(true);
      return;
    }
    const s = new Store(STORE_PATH);
    setStore(s);
    (async () => {
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
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        if (store) {
          Object.entries(patch).forEach(([k, v]) => {
            store.set(k, v);
          });
          store.save();
        }
        return next;
      });
    },
    [store]
  );

  return { settings, save, loaded };
}
