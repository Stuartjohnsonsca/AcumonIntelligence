'use client';

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

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

export interface BankToTBState {
  sessionId: string | null;
  clientId: string | null;
  periodId: string | null;
  activeView: 'bank-transactions' | 'trial-balance';
  activeAccountTab: string | null;
  files: BTBFile[];
  accounts: BTBAccount[];
  transactions: BTBTransaction[];
  trialBalance: BTBTrialBalanceEntry[];
  journals: BTBJournal[];
  isUploading: boolean;
  combineMode: string | null;
  openingPositionSource: string | null;
  balanceErrors: { type: string; message: string }[];
  hasOutOfPeriodTxns: boolean;
  hasMultipleAccounts: boolean;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_SESSION'; payload: Partial<BankToTBState> & { sessionId: string } }
  | { type: 'SET_CLIENT_PERIOD'; payload: { clientId: string; periodId: string } }
  | { type: 'ADD_FILES'; payload: BTBFile[] }
  | { type: 'UPDATE_FILE_STATUS'; payload: { id: string; status: string; errorMessage?: string; pageCount?: number } }
  | { type: 'SET_FILES'; payload: BTBFile[] }
  | { type: 'SET_TRANSACTIONS'; payload: BTBTransaction[] }
  | { type: 'SET_ACCOUNTS'; payload: BTBAccount[] }
  | { type: 'SET_TRIAL_BALANCE'; payload: BTBTrialBalanceEntry[] }
  | { type: 'SET_JOURNALS'; payload: BTBJournal[] }
  | { type: 'ADD_JOURNAL'; payload: BTBJournal }
  | { type: 'UPDATE_JOURNAL'; payload: BTBJournal }
  | { type: 'SET_VIEW'; payload: 'bank-transactions' | 'trial-balance' }
  | { type: 'SET_ACTIVE_TAB'; payload: string | null }
  | { type: 'SET_UPLOADING'; payload: boolean }
  | { type: 'SET_COMBINE_MODE'; payload: string | null }
  | { type: 'SET_OPENING_SOURCE'; payload: string | null }
  | { type: 'SET_BALANCE_ERRORS'; payload: { type: string; message: string }[] }
  | { type: 'SET_MULTI_ACCOUNTS'; payload: boolean }
  | { type: 'SET_OUT_OF_PERIOD'; payload: boolean }
  | { type: 'RESET' };

const initialState: BankToTBState = {
  sessionId: null,
  clientId: null,
  periodId: null,
  activeView: 'bank-transactions',
  activeAccountTab: null,
  files: [],
  accounts: [],
  transactions: [],
  trialBalance: [],
  journals: [],
  isUploading: false,
  combineMode: null,
  openingPositionSource: null,
  balanceErrors: [],
  hasOutOfPeriodTxns: false,
  hasMultipleAccounts: false,
};

function reducer(state: BankToTBState, action: Action): BankToTBState {
  switch (action.type) {
    case 'SET_SESSION':
      return { ...state, ...action.payload };
    case 'SET_CLIENT_PERIOD':
      return { ...initialState, clientId: action.payload.clientId, periodId: action.payload.periodId };
    case 'ADD_FILES':
      return { ...state, files: [...state.files, ...action.payload] };
    case 'UPDATE_FILE_STATUS':
      return {
        ...state,
        files: state.files.map(f =>
          f.id === action.payload.id
            ? { ...f, status: action.payload.status, errorMessage: action.payload.errorMessage, pageCount: action.payload.pageCount }
            : f
        ),
      };
    case 'SET_FILES':
      return { ...state, files: action.payload };
    case 'SET_TRANSACTIONS':
      return { ...state, transactions: action.payload };
    case 'SET_ACCOUNTS':
      return { ...state, accounts: action.payload };
    case 'SET_TRIAL_BALANCE':
      return { ...state, trialBalance: action.payload };
    case 'SET_JOURNALS':
      return { ...state, journals: action.payload };
    case 'ADD_JOURNAL':
      return { ...state, journals: [...state.journals, action.payload] };
    case 'UPDATE_JOURNAL':
      return {
        ...state,
        journals: state.journals.map(j => j.id === action.payload.id ? action.payload : j),
      };
    case 'SET_VIEW':
      return { ...state, activeView: action.payload };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeAccountTab: action.payload };
    case 'SET_UPLOADING':
      return { ...state, isUploading: action.payload };
    case 'SET_COMBINE_MODE':
      return { ...state, combineMode: action.payload };
    case 'SET_OPENING_SOURCE':
      return { ...state, openingPositionSource: action.payload };
    case 'SET_BALANCE_ERRORS':
      return { ...state, balanceErrors: action.payload };
    case 'SET_MULTI_ACCOUNTS':
      return { ...state, hasMultipleAccounts: action.payload };
    case 'SET_OUT_OF_PERIOD':
      return { ...state, hasOutOfPeriodTxns: action.payload };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────────────────

const BankToTBContext = createContext<{ state: BankToTBState; dispatch: Dispatch<Action> } | null>(null);

export function BankToTBProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <BankToTBContext.Provider value={{ state, dispatch }}>
      {children}
    </BankToTBContext.Provider>
  );
}

export function useBankToTB() {
  const ctx = useContext(BankToTBContext);
  if (!ctx) throw new Error('useBankToTB must be used within BankToTBProvider');
  return ctx;
}
