/**
 * Multi-session tab manager.
 *
 * Allows users to work on multiple jobs/tasks concurrently.
 * Each "session tab" is a tool + client + period combination.
 *
 * Features:
 * - Track open sessions across browser tabs
 * - Quick switch between sessions (preserves state in IndexedDB)
 * - Background task tracking per session
 * - Session pinning (keep frequently used sessions accessible)
 */

import { create } from 'zustand';
import { loadFromIDB, saveToIDB, buildStorageKey } from './persist-idb';

export interface SessionTab {
  id: string; // Unique session ID
  tool: string; // e.g. 'bank-to-tb', 'doc-summary', 'audit-engagement'
  toolLabel: string; // Display name
  clientId: string;
  clientName: string;
  periodId?: string;
  periodLabel?: string;
  engagementId?: string;
  /** URL path for this session */
  path: string;
  /** Last time this session was active */
  lastActiveAt: number;
  /** Whether there's a background task running */
  hasBackgroundTask: boolean;
  /** Background task progress (0-100) */
  taskProgress?: number;
  /** Whether the session is pinned */
  isPinned: boolean;
}

interface SessionManagerState {
  /** All open session tabs */
  tabs: SessionTab[];
  /** Currently active tab ID */
  activeTabId: string | null;

  // Actions
  addTab: (tab: Omit<SessionTab, 'id' | 'lastActiveAt' | 'isPinned'>) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<SessionTab>) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;
  setTaskProgress: (id: string, progress: number | undefined, hasTask: boolean) => void;
  loadFromStorage: () => Promise<void>;
}

const IDB_KEY = 'acumon:session-manager';
const MAX_TABS = 20;

export const useSessionManager = create<SessionManagerState>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab(tabData) {
    const id = `${tabData.tool}:${tabData.clientId}:${tabData.periodId || 'none'}:${Date.now()}`;

    // Check if a similar tab already exists (same tool + client + period)
    const existing = get().tabs.find(t =>
      t.tool === tabData.tool &&
      t.clientId === tabData.clientId &&
      t.periodId === tabData.periodId &&
      t.engagementId === tabData.engagementId
    );

    if (existing) {
      // Reuse existing tab
      set(s => ({
        tabs: s.tabs.map(t => t.id === existing.id ? { ...t, lastActiveAt: Date.now() } : t),
        activeTabId: existing.id,
      }));
      persist(get());
      return existing.id;
    }

    const newTab: SessionTab = {
      ...tabData,
      id,
      lastActiveAt: Date.now(),
      isPinned: false,
    };

    set(s => {
      let tabs = [...s.tabs, newTab];

      // Trim to MAX_TABS (remove oldest unpinned)
      if (tabs.length > MAX_TABS) {
        const unpinned = tabs.filter(t => !t.isPinned).sort((a, b) => a.lastActiveAt - b.lastActiveAt);
        const toRemove = unpinned.slice(0, tabs.length - MAX_TABS);
        const removeIds = new Set(toRemove.map(t => t.id));
        tabs = tabs.filter(t => !removeIds.has(t.id));
      }

      return { tabs, activeTabId: id };
    });

    persist(get());
    return id;
  },

  removeTab(id) {
    set(s => ({
      tabs: s.tabs.filter(t => t.id !== id),
      activeTabId: s.activeTabId === id ? (s.tabs[0]?.id || null) : s.activeTabId,
    }));
    persist(get());
  },

  setActiveTab(id) {
    set(s => ({
      activeTabId: id,
      tabs: s.tabs.map(t => t.id === id ? { ...t, lastActiveAt: Date.now() } : t),
    }));
    persist(get());
  },

  updateTab(id, updates) {
    set(s => ({
      tabs: s.tabs.map(t => t.id === id ? { ...t, ...updates } : t),
    }));
    persist(get());
  },

  pinTab(id) {
    set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, isPinned: true } : t) }));
    persist(get());
  },

  unpinTab(id) {
    set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, isPinned: false } : t) }));
    persist(get());
  },

  setTaskProgress(id, progress, hasTask) {
    set(s => ({
      tabs: s.tabs.map(t => t.id === id ? { ...t, taskProgress: progress, hasBackgroundTask: hasTask } : t),
    }));
  },

  async loadFromStorage() {
    const data = await loadFromIDB<{ tabs: SessionTab[]; activeTabId: string | null }>(IDB_KEY);
    if (data) {
      set({ tabs: data.tabs, activeTabId: data.activeTabId });
    }
  },
}));

function persist(state: SessionManagerState) {
  saveToIDB(IDB_KEY, { tabs: state.tabs, activeTabId: state.activeTabId }).catch(() => {});
}

// Load from storage on module init (client-side only)
if (typeof window !== 'undefined') {
  useSessionManager.getState().loadFromStorage();
}
