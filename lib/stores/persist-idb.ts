/**
 * IndexedDB persistence layer for Zustand stores.
 *
 * Uses idb-keyval for simple key-value IndexedDB access.
 * Each store gets its own key prefix: `acumon:${storeName}:${sessionKey}`
 *
 * Features:
 * - Automatic save on state change (debounced)
 * - Fast restore from IndexedDB on page load
 * - Per-session scoping (user + client + period)
 * - Stale data cleanup (>7 days)
 * - Version tracking for cache invalidation
 */

import { get, set, del, keys as idbKeys } from 'idb-keyval';

const STORE_VERSION = 1;
const STALE_DAYS = 7;

interface PersistedData<T> {
  version: number;
  timestamp: number;
  state: T;
}

/**
 * Build a unique storage key for a store + session combination.
 */
export function buildStorageKey(storeName: string, sessionKey: string): string {
  return `acumon:${storeName}:${sessionKey}`;
}

/**
 * Save state to IndexedDB.
 */
export async function saveToIDB<T>(key: string, state: T): Promise<void> {
  const data: PersistedData<T> = {
    version: STORE_VERSION,
    timestamp: Date.now(),
    state,
  };
  await set(key, data);
}

/**
 * Load state from IndexedDB. Returns null if not found or stale.
 */
export async function loadFromIDB<T>(key: string): Promise<T | null> {
  try {
    const data = await get<PersistedData<T>>(key);
    if (!data) return null;
    if (data.version !== STORE_VERSION) return null;

    // Check staleness
    const ageMs = Date.now() - data.timestamp;
    if (ageMs > STALE_DAYS * 24 * 60 * 60 * 1000) {
      await del(key);
      return null;
    }

    return data.state;
  } catch {
    return null;
  }
}

/**
 * Delete state from IndexedDB.
 */
export async function deleteFromIDB(key: string): Promise<void> {
  await del(key);
}

/**
 * Clean up old entries (>STALE_DAYS old) for a given store prefix.
 */
export async function cleanupStaleEntries(storeName: string): Promise<number> {
  const allKeys = await idbKeys();
  const prefix = `acumon:${storeName}:`;
  let cleaned = 0;

  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(prefix)) {
      try {
        const data = await get<PersistedData<unknown>>(key);
        if (data && (Date.now() - data.timestamp > STALE_DAYS * 24 * 60 * 60 * 1000)) {
          await del(key);
          cleaned++;
        }
      } catch {
        await del(key);
        cleaned++;
      }
    }
  }

  return cleaned;
}
