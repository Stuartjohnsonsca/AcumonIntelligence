'use client';

import { useBankToTB } from './BankToTBContext';
import { cn } from '@/lib/utils';

export function AccountTabs() {
  const { state, dispatch } = useBankToTB();

  if (state.accounts.length <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-slate-100 border-t overflow-x-auto">
      <button
        onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: null })}
        className={cn(
          'px-3 py-1 text-xs font-medium rounded-t-md border border-b-0 transition-colors whitespace-nowrap',
          !state.activeAccountTab
            ? 'bg-white text-blue-600 border-slate-300'
            : 'bg-slate-200 text-slate-600 border-transparent hover:bg-slate-50'
        )}
      >
        All
      </button>
      {state.accounts.map(acc => (
        <button
          key={acc.id}
          onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: acc.id })}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-t-md border border-b-0 transition-colors whitespace-nowrap',
            state.activeAccountTab === acc.id
              ? 'bg-white text-blue-600 border-slate-300'
              : 'bg-slate-200 text-slate-600 border-transparent hover:bg-slate-50'
          )}
        >
          {acc.accountNumber || acc.bankName || `Account ${acc.id.slice(0, 6)}`}
        </button>
      ))}
    </div>
  );
}
