/**
 * Zustand store for Bank to TB tool.
 *
 * Replaces the React Context + useReducer pattern with:
 * - Zustand for state management (works outside React components)
 * - IndexedDB persistence for instant page load
 * - Auto-save to backend API on changes
 * - Multi-session support (keyed by userId + clientId + periodId)
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { buildStorageKey, loadFromIDB, saveToIDB } from './persist-idb';
import { triggerAutoSave, type AutoSaveConfig } from './auto-save';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BTBFile {
  id: string;
  originalName: string;
  status: string;
  errorMessage?: string | null;
  pageCount?: number | null;
}

export interface BTBAccount {
  id: string;
  bankName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
}

export interface BTBTransaction {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  debit: number;
  credit: number;
  balance?: number | null;
  bankName?: string | null;
  sortCode?: string | null;
  accountNumber?: string | null;
  statementDate?: string | null;
  statementPage?: number | null;
  accountCode?: string | null;
  accountNameMapped?: string | null;
  categoryType?: string | null;
  accountId?: string | null;
  inPeriod: boolean;
}

export interface BTBTrialBalanceEntry {
  id: string;
  accountCode: string;
  accountName: string;
  categoryType: string;
  openingDebit: number;
  openingCredit: number;
  combinedDebit: number;
  combinedCredit: number;
  journalData?: Record<string, { debit: number; credit: number }> | null;
  columnData?: Record<string, { debit: number; credit: number }> | null;
  isFromOpeningPosition: boolean;
  sortOrder: number;
}

export interface BTBJournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export interface BTBJournal {
  id: string;
  category: string;
  description: string | null;
  status: string;
  journalRef: string | null;
  lines: BTBJournalLine[];
}

// ─── Store State & Actions ──────────────────────────────────────────────────

interface BTBState {
  // Session identity
  sessionId: string | null;
  clientId: string | null;
  periodId: string | null;
  accountingFramework: string | null;

  // Data
  files: BTBFile[];
  accounts: BTBAccount[];
  transactions: BTBTransaction[];
  trialBalance: BTBTrialBalanceEntry[];
  journals: BTBJournal[];

  // UI state
  activeView: 'bank-transactions' | 'trial-balance';
  activeAccountTab: string | null;
  isUploading: boolean;
  combineMode: string | null;
  openingPositionSource: string | null;
  balanceErrors: { type: string; message: string }[];
  hasOutOfPeriodTxns: boolean;
  hasMultipleAccounts: boolean;

  // Meta
  _initialized: boolean;
  _idbKey: string | null;
}

interface BTBActions {
  // Session management
  initSession: (sessionId: string, clientId: string, periodId: string) => Promise<void>;
  resetSession: () => void;

  // Data setters (trigger auto-save)
  setFiles: (files: BTBFile[]) => void;
  addFiles: (files: BTBFile[]) => void;
  updateFileStatus: (id: string, status: string, errorMessage?: string, pageCount?: number) => void;
  setTransactions: (txns: BTBTransaction[]) => void;
  setAccounts: (accounts: BTBAccount[]) => void;
  setTrialBalance: (tb: BTBTrialBalanceEntry[]) => void;
  setJournals: (journals: BTBJournal[]) => void;
  addJournal: (journal: BTBJournal) => void;
  updateJournal: (journal: BTBJournal) => void;

  // UI state
  setView: (view: 'bank-transactions' | 'trial-balance') => void;
  setActiveTab: (tab: string | null) => void;
  setUploading: (uploading: boolean) => void;
  setCombineMode: (mode: string | null) => void;
  setOpeningSource: (source: string | null) => void;
  setBalanceErrors: (errors: { type: string; message: string }[]) => void;
  setFramework: (framework: string | null) => void;
  setMultiAccounts: (has: boolean) => void;
  setOutOfPeriod: (has: boolean) => void;
}

const STORE_NAME = 'btb';

const initialState: BTBState = {
  sessionId: null,
  clientId: null,
  periodId: null,
  accountingFramework: null,
  files: [],
  accounts: [],
  transactions: [],
  trialBalance: [],
  journals: [],
  activeView: 'bank-transactions',
  activeAccountTab: null,
  isUploading: false,
  combineMode: null,
  openingPositionSource: null,
  balanceErrors: [],
  hasOutOfPeriodTxns: false,
  hasMultipleAccounts: false,
  _initialized: false,
  _idbKey: null,
};

// Fields that are UI-only and shouldn't be sent to the API
const UI_ONLY_FIELDS = [
  'activeView', 'activeAccountTab', 'isUploading', 'balanceErrors',
  '_initialized', '_idbKey',
];

function getAutoSaveConfig(state: BTBState): AutoSaveConfig | null {
  if (!state.sessionId || !state._idbKey) return null;
  return {
    idbKey: state._idbKey,
    apiEndpoint: `/api/bank-to-tb/session/${state.sessionId}/state`,
    method: 'PUT',
    debounceMs: 2000,
    excludeFields: UI_ONLY_FIELDS,
  };
}

// ─── Create Store ───────────────────────────────────────────────────────────

export const useBTBStore = create<BTBState & BTBActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ── Session management ──

    async initSession(sessionId: string, clientId: string, periodId: string) {
      const idbKey = buildStorageKey(STORE_NAME, `${clientId}:${periodId}`);

      // Try to load from IndexedDB first (instant)
      const cached = await loadFromIDB<Partial<BTBState>>(idbKey);
      if (cached && cached.sessionId === sessionId) {
        set({
          ...cached,
          sessionId,
          clientId,
          periodId,
          _initialized: true,
          _idbKey: idbKey,
        });
        return;
      }

      // Otherwise just set the session identity — data will be loaded from API
      set({
        ...initialState,
        sessionId,
        clientId,
        periodId,
        _initialized: true,
        _idbKey: idbKey,
      });
    },

    resetSession() {
      const idbKey = get()._idbKey;
      set({ ...initialState });
      // Don't clear IDB — session might be resumed
    },

    // ── Data setters ──

    setFiles(files) {
      set({ files });
      const state = get();
      const config = getAutoSaveConfig(state);
      if (config) triggerAutoSave(state, config);
    },

    addFiles(newFiles) {
      set(s => ({ files: [...s.files, ...newFiles] }));
      const state = get();
      const config = getAutoSaveConfig(state);
      if (config) triggerAutoSave(state, config);
    },

    updateFileStatus(id, status, errorMessage, pageCount) {
      set(s => ({
        files: s.files.map(f => f.id === id ? { ...f, status, errorMessage, pageCount } : f),
      }));
    },

    setTransactions(txns) {
      set({ transactions: txns });
      const state = get();
      const config = getAutoSaveConfig(state);
      if (config) triggerAutoSave(state, config);
    },

    setAccounts(accounts) {
      set({ accounts });
    },

    setTrialBalance(tb) {
      set({ trialBalance: tb });
      const state = get();
      const config = getAutoSaveConfig(state);
      if (config) triggerAutoSave(state, config);
    },

    setJournals(journals) {
      set({ journals });
    },

    addJournal(journal) {
      set(s => ({ journals: [...s.journals, journal] }));
    },

    updateJournal(journal) {
      set(s => ({
        journals: s.journals.map(j => j.id === journal.id ? journal : j),
      }));
    },

    // ── UI state ──

    setView(view) { set({ activeView: view }); },
    setActiveTab(tab) { set({ activeAccountTab: tab }); },
    setUploading(uploading) { set({ isUploading: uploading }); },
    setCombineMode(mode) { set({ combineMode: mode }); },
    setOpeningSource(source) { set({ openingPositionSource: source }); },
    setBalanceErrors(errors) { set({ balanceErrors: errors }); },
    setFramework(framework) { set({ accountingFramework: framework }); },
    setMultiAccounts(has) { set({ hasMultipleAccounts: has }); },
    setOutOfPeriod(has) { set({ hasOutOfPeriodTxns: has }); },
  }))
);

// ── Auto-persist to IndexedDB on any state change ──
// This runs outside React — captures every state update
useBTBStore.subscribe(
  (state) => state._idbKey,
  (idbKey, previousIdbKey) => {
    // When idbKey changes, set up persistence subscription
  }
);

// Subscribe to all data changes for IndexedDB persistence
let idbSaveTimer: NodeJS.Timeout | null = null;
useBTBStore.subscribe((state, prevState) => {
  if (!state._idbKey || !state._initialized) return;
  // Skip if only UI fields changed
  if (
    state.files === prevState.files &&
    state.transactions === prevState.transactions &&
    state.trialBalance === prevState.trialBalance &&
    state.journals === prevState.journals &&
    state.accounts === prevState.accounts &&
    state.combineMode === prevState.combineMode &&
    state.accountingFramework === prevState.accountingFramework
  ) return;

  // Debounce IndexedDB save to 500ms
  if (idbSaveTimer) clearTimeout(idbSaveTimer);
  idbSaveTimer = setTimeout(() => {
    const s = useBTBStore.getState();
    if (s._idbKey) {
      const { _initialized, _idbKey, ...data } = s;
      saveToIDB(s._idbKey, data).catch(() => {});
    }
  }, 500);
});
