/**
 * Auto-save middleware for Zustand stores.
 *
 * Debounced save: writes to both IndexedDB (instant local cache)
 * and the backend API (persistent storage) on state changes.
 *
 * Features:
 * - Debounced 2s writes to avoid API spam
 * - IndexedDB write is immediate (no debounce)
 * - Tracks dirty state for save indicator
 * - Retry on API failure with exponential backoff
 * - Version conflict detection via `updatedAt`
 */

import { saveToIDB } from './persist-idb';

export interface AutoSaveConfig {
  /** Storage key for IndexedDB */
  idbKey: string;
  /** API endpoint to save to */
  apiEndpoint: string;
  /** HTTP method (default PUT) */
  method?: 'PUT' | 'POST' | 'PATCH';
  /** Debounce time in ms (default 2000) */
  debounceMs?: number;
  /** Fields to exclude from API save (e.g. UI-only state) */
  excludeFields?: string[];
  /** Transform state before sending to API */
  transformForApi?: (state: any) => any;
  /** Called on save success */
  onSaveSuccess?: (response: any) => void;
  /** Called on save error */
  onSaveError?: (error: Error) => void;
  /** Called on version conflict */
  onConflict?: (serverVersion: string, localVersion: string) => void;
}

interface SaveState {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;
  lastError: string | null;
  retryCount: number;
}

const saveStates = new Map<string, SaveState>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

function getSaveState(key: string): SaveState {
  if (!saveStates.has(key)) {
    saveStates.set(key, {
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      lastError: null,
      retryCount: 0,
    });
  }
  return saveStates.get(key)!;
}

/**
 * Trigger an auto-save cycle. Call this from Zustand's subscribe or middleware.
 *
 * 1. Immediately saves to IndexedDB (fast, local)
 * 2. Debounces API save by `debounceMs`
 */
export function triggerAutoSave<T extends Record<string, any>>(
  state: T,
  config: AutoSaveConfig,
): void {
  const { idbKey, debounceMs = 2000 } = config;
  const ss = getSaveState(idbKey);

  // 1. Immediate IndexedDB save (non-blocking)
  const idbData = config.excludeFields
    ? Object.fromEntries(Object.entries(state).filter(([k]) => !config.excludeFields!.includes(k)))
    : state;
  saveToIDB(idbKey, idbData).catch(() => {});

  // 2. Mark dirty
  ss.isDirty = true;

  // 3. Debounced API save
  const existingTimer = debounceTimers.get(idbKey);
  if (existingTimer) clearTimeout(existingTimer);

  debounceTimers.set(idbKey, setTimeout(() => {
    saveToApi(state, config);
  }, debounceMs));
}

/**
 * Force an immediate save (e.g. on page unload or explicit save button).
 */
export async function forceSave<T extends Record<string, any>>(
  state: T,
  config: AutoSaveConfig,
): Promise<boolean> {
  // Cancel any pending debounce
  const timer = debounceTimers.get(config.idbKey);
  if (timer) clearTimeout(timer);

  // Save to IndexedDB
  const idbData = config.excludeFields
    ? Object.fromEntries(Object.entries(state).filter(([k]) => !config.excludeFields!.includes(k)))
    : state;
  await saveToIDB(config.idbKey, idbData);

  // Save to API
  return saveToApi(state, config);
}

async function saveToApi<T extends Record<string, any>>(
  state: T,
  config: AutoSaveConfig,
): Promise<boolean> {
  const { idbKey, apiEndpoint, method = 'PUT', excludeFields = [] } = config;
  const ss = getSaveState(idbKey);

  if (ss.isSaving) return false; // Already saving
  if (!ss.isDirty) return true; // Nothing to save

  ss.isSaving = true;

  try {
    const payload = config.transformForApi
      ? config.transformForApi(state)
      : Object.fromEntries(Object.entries(state).filter(([k]) => !excludeFields.includes(k)));

    const res = await fetch(apiEndpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      // Version conflict
      const data = await res.json();
      ss.lastError = 'Version conflict — someone else modified this data';
      config.onConflict?.(data.serverVersion, data.localVersion);
      return false;
    }

    if (!res.ok) {
      throw new Error(`Save failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    ss.isDirty = false;
    ss.lastSavedAt = Date.now();
    ss.lastError = null;
    ss.retryCount = 0;
    config.onSaveSuccess?.(data);
    return true;
  } catch (err: any) {
    ss.lastError = err.message;
    ss.retryCount++;
    config.onSaveError?.(err);

    // Retry with exponential backoff (max 3 retries)
    if (ss.retryCount <= 3) {
      const delay = Math.min(1000 * Math.pow(2, ss.retryCount), 30000);
      debounceTimers.set(idbKey, setTimeout(() => {
        ss.isSaving = false; // Allow retry
        saveToApi(state, config);
      }, delay));
    }

    return false;
  } finally {
    ss.isSaving = false;
  }
}

/**
 * Get the current save state for a given store key.
 */
export function getAutoSaveState(idbKey: string): SaveState {
  return getSaveState(idbKey);
}

/**
 * Check if there are unsaved changes.
 */
export function hasUnsavedChanges(idbKey: string): boolean {
  return getSaveState(idbKey).isDirty;
}
