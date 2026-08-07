import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { isTauri, type ViewMode } from '../utils';
import { isSimRunActive, getSimHandle } from '../sim/mockBackend';

const STORE_PATH = 'settings.json';

/**
 * Simulation-only override for the packaged-app store dir (set by the
 * real-app driver via SYSMON_SIM_APP_DATA). Returns null normally; when set,
 * the store is loaded from an absolute path so a sim run never touches the
 * developer's real settings.json.
 */
async function resolveStorePath(): Promise<string> {
  try {
    if (isTauri()) {
      const overrideDir = await invoke<string | null>('sim_store_override');
      if (overrideDir) {
        const sep = overrideDir.includes('\\') ? '\\' : '/';
        return `${overrideDir.replace(/[\\/]+$/, '')}${sep}${STORE_PATH}`;
      }
    }
  } catch {
    // degrade gracefully: fall through to the default relative path
  }
  return STORE_PATH;
}

// Bump when the persisted settings shape changes in a way future migrations
// need to key off of. Written on every save() but never read back today — the
// version is write-only bookkeeping until a migration that keys off it lands.
// A missing/older value is treated as pre-existing, not an error (see
// openspec/changes/fix-frontend-error-surfacing/design.md).
const SETTINGS_VERSION = 1;

/** Legal history-window sizes in seconds — the single source of truth for
 *  which `windowSecs` values are accepted. App.tsx builds the TimeRangeSelector
 *  options (labels) from this so validation and the UI can't drift apart. */
export const WINDOW_SECS_OPTIONS = [30, 60, 300, 600, 1800, 3600] as const;

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
      // Only the legal TimeRangeSelector sizes are accepted; anything else
      // (e.g. a stale/hand-edited value) falls back to the default instead of
      // producing a chart window the UI can't represent.
      if (
        typeof value === 'number' &&
        (WINDOW_SECS_OPTIONS as readonly number[]).includes(value)
      ) {
        return value as Settings[K];
      }
      break;
  }
  console.warn(`[useSettings] invalid persisted value for "${key}", falling back to default`);
  return DEFAULTS[key];
}

export interface SettingsContextValue {
  settings: Settings;
  /** True once the initial load settled (defaults or persisted values). */
  loaded: boolean;
  /** Set when the plugin-store load rejects; the app renders a fatal state. */
  error: string | null;
  /** Set when a save() call fails to persist; the app shows a non-fatal banner. */
  saveError: string | null;
  /** Persist a partial settings patch (no-op in the browser). */
  save: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * The single source of settings state. Holds the loaded settings, the one
 * plugin-store instance, and the one save() path. Mounted once by
 * `SettingsProvider` (see main.tsx) so every `useSettings()` consumer shares
 * one store — a dashboard reorder and a sidebar reorder can't clobber each
 * other's writes from separate stale caches.
 */
function useSettingsState(): SettingsContextValue {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [store, setStore] = useState<Store | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      if (isSimRunActive()) {
        // Mock-mode persistence journeys run against the bridge's per-run
        // localStorage shim so settings round-trip across reloads. Per-field
        // validation applies identically to shim entries, so a corrupt
        // settings scenario (simulated) falls back per-field, exactly like a
        // real corrupt store file.
        const sim = getSimHandle();
        if (sim) {
          void sim.settings.load().then((entries) => {
            setSettings({
              cardOrder: validateField('cardOrder', entries.cardOrder),
              hiddenCardIds: validateField('hiddenCardIds', entries.hiddenCardIds),
              sidebarCardOrder: validateField('sidebarCardOrder', entries.sidebarCardOrder),
              viewMode: validateField('viewMode', entries.viewMode),
              windowSecs: validateField('windowSecs', entries.windowSecs),
            });
            setLoaded(true);
          });
          return;
        }
      }
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const storePath = await resolveStorePath();
        const s = await Store.load(storePath);
        setStore(s);
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
        try {
          for (const [k, v] of Object.entries(patch)) {
            await store.set(k, v);
          }
          await store.set('settingsVersion', SETTINGS_VERSION);
          await store.save();
          setSaveError(null);
        } catch (err) {
          // In-memory state is already updated, so the session keeps working;
          // only persistence is lost. Surface the error as a non-fatal banner.
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('[useSettings] failed to persist settings:', msg);
          setSaveError(msg);
        }
        return;
      }
      if (isSimRunActive()) {
        const sim = getSimHandle();
        if (sim) {
          try {
            await sim.settings.save(patch as Record<string, unknown>);
            setSaveError(null);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('[useSettings] failed to persist mock settings:', msg);
            setSaveError(msg);
          }
        }
      }
    },
    [store]
  );

  return { settings, save, loaded, error, saveError };
}

/** Provides the app-wide settings instance to every `useSettings()` consumer. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettingsState();
  // createElement (not JSX) because this file is a .ts hook module, not .tsx.
  return createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context) return context;
  // No provider in the tree (unit tests that pin the hook's standalone
  // behavior). The app itself mounts SettingsProvider once, so all production
  // consumers share a single store instance and a single save() path.
  return useSettingsState();
}