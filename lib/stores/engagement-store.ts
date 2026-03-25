/**
 * Zustand store for Audit Engagement.
 *
 * Manages engagement state with:
 * - IndexedDB persistence for instant tab switching
 * - Auto-save to backend API
 * - Optimistic locking
 */

import { create } from 'zustand';
import { buildStorageKey, loadFromIDB, saveToIDB } from './persist-idb';

export interface EngagementState {
  engagementId: string | null;
  clientId: string | null;
  periodId: string | null;
  auditType: string | null;
  status: string | null;
  activeTab: string;

  // Cached tab data (loaded on demand, persisted in IDB)
  tabData: Record<string, any>;

  // Sign-off state
  signOffs: Record<string, any>;

  // Meta
  _initialized: boolean;
  _idbKey: string | null;
  _updatedAt: string | null;
}

interface EngagementActions {
  initEngagement: (engagementId: string, clientId: string, periodId: string) => Promise<void>;
  setActiveTab: (tab: string) => void;
  setTabData: (tab: string, data: any) => void;
  updateSignOff: (tab: string, signOff: any) => void;
  setUpdatedAt: (updatedAt: string) => void;
  reset: () => void;
}

const STORE_NAME = 'engagement';

const initialState: EngagementState = {
  engagementId: null,
  clientId: null,
  periodId: null,
  auditType: null,
  status: null,
  activeTab: 'opening',
  tabData: {},
  signOffs: {},
  _initialized: false,
  _idbKey: null,
  _updatedAt: null,
};

export const useEngagementStore = create<EngagementState & EngagementActions>()((set, get) => ({
  ...initialState,

  async initEngagement(engagementId, clientId, periodId) {
    const idbKey = buildStorageKey(STORE_NAME, engagementId);

    // Try IndexedDB cache
    const cached = await loadFromIDB<Partial<EngagementState>>(idbKey);
    if (cached && cached.engagementId === engagementId) {
      set({
        ...cached,
        engagementId,
        clientId,
        periodId,
        _initialized: true,
        _idbKey: idbKey,
      });
      return;
    }

    set({
      ...initialState,
      engagementId,
      clientId,
      periodId,
      _initialized: true,
      _idbKey: idbKey,
    });
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
    persistState(get());
  },

  setTabData(tab, data) {
    set(s => ({ tabData: { ...s.tabData, [tab]: data } }));
    persistState(get());
  },

  updateSignOff(tab, signOff) {
    set(s => ({ signOffs: { ...s.signOffs, [tab]: signOff } }));
    persistState(get());
  },

  setUpdatedAt(updatedAt) {
    set({ _updatedAt: updatedAt });
  },

  reset() {
    set({ ...initialState });
  },
}));

let persistTimer: NodeJS.Timeout | null = null;
function persistState(state: EngagementState) {
  if (!state._idbKey) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = useEngagementStore.getState();
    if (s._idbKey) {
      const { _initialized, _idbKey, ...data } = s;
      saveToIDB(s._idbKey, data).catch(() => {});
    }
  }, 500);
}
