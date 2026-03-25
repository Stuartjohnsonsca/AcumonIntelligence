'use client';

import { useState } from 'react';
import { useBankToTB } from './BankToTBContext';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';
import { TaxonomyMatchPopup } from './TaxonomyMatchPopup';

export function SpreadsheetToggle() {
  const { state, dispatch } = useBankToTB();
  const [showMatchPopup, setShowMatchPopup] = useState(false);

  return (
    <>
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

        {/* Match to Taxonomy button — only shows on TB view when framework is set */}
        {state.activeView === 'trial-balance' && state.trialBalance.length > 0 && (
          <div className="ml-auto">
            <button
              onClick={() => setShowMatchPopup(true)}
              disabled={!state.accountingFramework}
              title={state.accountingFramework ? `Match account codes to ${state.accountingFramework} taxonomy` : 'Select an Accounting Framework first'}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                state.accountingFramework
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-200'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Match to Taxonomy
              {state.accountingFramework && (
                <span className="text-[10px] bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">{state.accountingFramework}</span>
              )}
            </button>
          </div>
        )}
      </div>

      {showMatchPopup && state.sessionId && (
        <TaxonomyMatchPopup
          isOpen={showMatchPopup}
          onClose={() => setShowMatchPopup(false)}
          sessionId={state.sessionId}
        />
      )}
    </>
  );
}
