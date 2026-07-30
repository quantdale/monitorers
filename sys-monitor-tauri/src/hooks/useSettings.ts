import { Store } from '@tauri-apps/plugin-store';
import { useState, useEffect, useCallback } from 'react';
import { isTauri, type ViewMode } from '../utils';

const STORE_PATH = 'settings.json';

// Bump when the persisted settings shape changes in a way future migrations
// need to key off of. A missing/older value is treated as pre-existing, not
// an error (see openspec/changes/fix-frontend-error-surfacing/design.md).
const SETTINGS_VERSION = 1;

export interface Settings {
  cardOrder: string[] | null;
  hiddenCardIds: string[];
  sidebarCardOrder: string[] | null;
  viewMode: ViewMode;
  windowSecs: number;
}

const DEFAULTS: Settings = {
  cardOrder: null,
  hiddenCardIds: [],
  sidebarCardOrder: null,
  viewMode: 'default',
  windowSecs: 60,
};

const VIEW_MODES: ViewMode[] = ['default', 'tile', 'list'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validates one persisted field's shape/type, falling back to its compiled-in
 * default when invalid so one corrupt/stale field can't break the whole load.
 * A missing (`undefined`) value is the normal first-run case, not a warning.
 */
function validateField<K extends keyof Settings>(key: K, value: unknown): Settings[K] {
  if (value === undefined) return DEFAULTS[key];
  switch (key) {
    case 'cardOrder':
    case 'sidebarCardOrder':
      if (value === null || isStringArray(value)) return value as Settings[K];
      break;
    case 'hiddenCardIds':
      if (isStringArray(value)) return value as Settings[K];
      break;
    case 'viewMode':
      if (typeof value === 'string' && VIEW_MODES.includes(value as ViewMode)) {
        return value as Settings[K];
      }
      break;
    case 'windowSecs':
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value as Settings[K];
      }
      break;
  }
  console.warn(`[useSettings] invalid persisted value for "${key}", falling back to default`);
  return DEFAULTS[key];
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [store, setStore] = useState<Store | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const s = await Store.load(STORE_PATH);
        setStore(s);
        // Missing settingsVersion means an install that predates versioning —
        // treated as the earliest known version, not an error.
        await s.get<number>('settingsVersion');
        const cardOrder = await s.get<string[]>('cardOrder');
        const hiddenCardIds = await s.get<string[]>('hiddenCardIds');
        const sidebarCardOrder = await s.get<string[]>('sidebarCardOrder');
        const viewMode = await s.get<ViewMode>('viewMode');
        const windowSecs = await s.get<number>('windowSecs');
        setSettings({
          cardOrder: validateField('cardOrder', cardOrder),
          hiddenCardIds: validateField('hiddenCardIds', hiddenCardIds),
          sidebarCardOrder: validateField('sidebarCardOrder', sidebarCardOrder),
          viewMode: validateField('viewMode', viewMode),
          windowSecs: validateField('windowSecs', windowSecs),
        });
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      if (store) {
        for (const [k, v] of Object.entries(patch)) {
          await store.set(k, v);
        }
        await store.set('settingsVersion', SETTINGS_VERSION);
        await store.save();
      }
    },
    [store]
  );

  return { settings, save, loaded, error };
}
