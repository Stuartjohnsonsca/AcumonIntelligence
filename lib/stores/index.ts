/**
 * Store exports.
 *
 * Central export point for all Zustand stores and utilities.
 */

export { useBTBStore } from './bank-to-tb-store';
export { useEngagementStore } from './engagement-store';
export { useSessionManager } from './session-manager';
export { useEventStream } from '@/hooks/useEventStream';
export { buildStorageKey, loadFromIDB, saveToIDB, deleteFromIDB, cleanupStaleEntries } from './persist-idb';
export { triggerAutoSave, forceSave, getAutoSaveState, hasUnsavedChanges } from './auto-save';
export { withOptimisticLock, checkOptimisticLock } from './optimistic-lock';
export type { AutoSaveConfig } from './auto-save';
export type { SessionTab } from './session-manager';
export type { ConflictInfo, ConflictStrategy } from './optimistic-lock';
