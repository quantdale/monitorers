import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
export async function resolveStorePath(): Promise<string> {
  if (isTauri()) {
    // A command failure is significant: in the packaged simulation lane it
    // means isolation could not be established. Never fall back to the real
    // developer store after an override lookup error.
    const overrideDir = await invoke<string | null>('sim_store_override');
    if (overrideDir) {
      const isAbsoluteWindows = /^[A-Za-z]:[\\/]/.test(overrideDir) || overrideDir.startsWith('\\\\');
      const isAbsolutePosix = overrideDir.startsWith('/');
      if (!isAbsoluteWindows && !isAbsolutePosix) {
        throw new Error('simulation settings override must be an absolute directory');
      }
      const sep = overrideDir.includes('\\') ? '\\' : '/';
      return `${overrideDir.replace(/[\\/]+$/, '')}${sep}${STORE_PATH}`;
    }
  }
  return STORE_PATH;
}

/** Persisted schema version. Migrations must be stepwise and fail closed for future data. */
export const SETTINGS_VERSION = 2;

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

export class FutureSettingsVersionError extends Error {
  constructor(public readonly version: number) {
    super(`Settings file version ${version} is newer than this app supports (${SETTINGS_VERSION}).`);
    this.name = 'FutureSettingsVersionError';
  }
}

/**
 * Read/migrate the complete persisted object. Version 0 means the legacy
 * write-only format; version 1 is accepted as the previous known shape; the
 * current version is validated field-by-field. A future version is never
 * downgraded or overwritten.
 */
export function migratePersistedSettings(raw: Record<string, unknown>): Settings {
  const rawVersion = raw.settingsVersion;
  const version = rawVersion === undefined ? 0 : Number(rawVersion);
  if (!Number.isInteger(version) || version < 0) {
    console.warn('[useSettings] invalid settingsVersion; treating file as legacy v0');
  } else if (version > SETTINGS_VERSION) {
    throw new FutureSettingsVersionError(version);
  }
  return {
    cardOrder: validateField('cardOrder', raw.cardOrder),
    hiddenCardIds: validateField('hiddenCardIds', raw.hiddenCardIds),
    sidebarCardOrder: validateField('sidebarCardOrder', raw.sidebarCardOrder),
    viewMode: validateField('viewMode', raw.viewMode),
    windowSecs: validateField('windowSecs', raw.windowSecs),
  };
}

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
  const saveQueue = useRef(Promise.resolve());

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
            setSettings(migratePersistedSettings(entries));
            setLoaded(true);
          }).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
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
        // Read the schema marker first. Do not set the store reference until
        // migration succeeds, so a future-version file cannot be overwritten
        // by a later save from this process.
        const settingsVersion = await s.get<unknown>('settingsVersion');
        const [cardOrder, hiddenCardIds, sidebarCardOrder, viewMode, windowSecs] = await Promise.all([
          s.get<string[]>('cardOrder'),
          s.get<string[]>('hiddenCardIds'),
          s.get<string[]>('sidebarCardOrder'),
          s.get<ViewMode>('viewMode'),
          s.get<number>('windowSecs'),
        ]);
        const migrated = migratePersistedSettings({
          settingsVersion,
          cardOrder,
          hiddenCardIds,
          sidebarCardOrder,
          viewMode,
          windowSecs,
        });
        setStore(s);
        setSettings(migrated);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    const sim = !store && isSimRunActive() ? getSimHandle() : null;
    if (!store && !sim) return;

    const persist = async () => {
      try {
        if (store) {
          for (const [key, value] of Object.entries(patch)) await store.set(key, value);
          await store.set('settingsVersion', SETTINGS_VERSION);
          await store.save();
        } else if (sim) {
          await sim.settings.save({ ...patch, settingsVersion: SETTINGS_VERSION });
        }
        setSaveError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[useSettings] failed to persist settings:', msg);
        setSaveError(msg);
      }
    };

    // Serialize saves so rapid drag/toggle operations cannot interleave store
    // writes. React state still updates immediately for responsive UI.
    const queued = saveQueue.current.catch(() => undefined).then(persist);
    saveQueue.current = queued.then(() => undefined, () => undefined);
    await queued;
  }, [store]);

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
