'use client';

import { useBankToTB } from './BankToTBContext';
import { cn } from '@/lib/utils';

export function SpreadsheetToggle() {
  const { state, dispatch } = useBankToTB();

  return (
    <div className="px-4 py-2 border-b bg-white flex items-center gap-1">
      <button
        onClick={() => dispatch({ type: 'SET_VIEW', payload: 'bank-transactions' })}
        className={cn(
          'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
          state.activeView === 'bank-transactions'
            ? 'bg-blue-600 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        )}
      >
        Bank Transactions
      </button>
      <button
        onClick={() => dispatch({ type: 'SET_VIEW', payload: 'trial-balance' })}
        className={cn(
          'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
          state.activeView === 'trial-balance'
            ? 'bg-blue-600 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        )}
      >
        Trial Balance
      </button>
    </div>
  );
}
