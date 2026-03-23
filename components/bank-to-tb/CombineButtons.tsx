'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useBankToTB } from './BankToTBContext';
import { UnmatchedPopup } from './UnmatchedPopup';

interface Props {
  sessionId: string;
  chartOfAccounts: { id: string; accountCode: string; accountName: string; categoryType: string; sortOrder: number }[];
}

interface UnmatchedTxn {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  accountId?: string;
}

export function CombineButtons({ sessionId, chartOfAccounts }: Props) {
  const { state, dispatch } = useBankToTB();
  const [loading, setLoading] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedTxn[]>([]);
  const [showUnmatched, setShowUnmatched] = useState(false);

  if (!state.openingPositionSource) return null;

  async function handleCombine(mode: 'together' | 'separate') {
    setLoading(mode);
    try {
      const res = await fetch('/api/bank-to-tb/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode }),
      });

      if (!res.ok) throw new Error('Combine failed');
      const data = await res.json();

      dispatch({ type: 'SET_TRIAL_BALANCE', payload: data.trialBalance });
      dispatch({ type: 'SET_COMBINE_MODE', payload: mode });
      dispatch({ type: 'SET_VIEW', payload: 'trial-balance' });

      if (data.unmatchedCount > 0) {
        setUnmatched(data.unmatched);
        setShowUnmatched(true);
      } else {
        // Run balance check
        await runBalanceCheck();
      }
    } catch (err) {
      console.error('Combine failed:', err);
    } finally {
      setLoading(null);
    }
  }

  async function runBalanceCheck() {
    try {
      const res = await fetch('/api/bank-to-tb/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      dispatch({ type: 'SET_BALANCE_ERRORS', payload: data.errors || [] });
    } catch (err) {
      console.error('Balance check failed:', err);
    }
  }

  function handleUnmatchedComplete() {
    setShowUnmatched(false);
    setUnmatched([]);
    // Reload TB
    fetch(`/api/bank-to-tb/session?clientId=${state.clientId}&periodId=${state.periodId}`)
      .then(r => r.json())
      .then(data => {
        if (data.session) {
          dispatch({ type: 'SET_TRIAL_BALANCE', payload: data.session.trialBalance });
        }
      });
    runBalanceCheck();
  }

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Combine</h3>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => handleCombine('together')}
          disabled={!!loading}
        >
          {loading === 'together' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Combine Together
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => handleCombine('separate')}
          disabled={!!loading}
        >
          {loading === 'separate' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Combine as Separate
        </Button>

        {state.combineMode && (
          <p className="text-xs text-green-600">
            Combined: {state.combineMode}
          </p>
        )}
      </div>

      <UnmatchedPopup
        isOpen={showUnmatched}
        onClose={() => setShowUnmatched(false)}
        unmatchedTransactions={unmatched}
        chartOfAccounts={chartOfAccounts}
        sessionId={sessionId}
        onComplete={handleUnmatchedComplete}
      />
    </>
  );
}
