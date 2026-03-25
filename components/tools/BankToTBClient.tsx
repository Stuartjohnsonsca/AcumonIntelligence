'use client';

import { useState } from 'react';
import { BankToTBProvider, useBankToTB } from '@/components/bank-to-tb/BankToTBContext';
import { ClientPeriodSelector } from '@/components/bank-to-tb/ClientPeriodSelector';
import { BalanceBar } from '@/components/bank-to-tb/BalanceBar';
import { SpreadsheetToggle } from '@/components/bank-to-tb/SpreadsheetToggle';
import { BankTransactionsSheet } from '@/components/bank-to-tb/BankTransactionsSheet';
import { TrialBalanceSheet } from '@/components/bank-to-tb/TrialBalanceSheet';
import { AccountTabs } from '@/components/bank-to-tb/AccountTabs';
import { ControlsPanel } from '@/components/bank-to-tb/ControlsPanel';
import { useBackgroundTasks } from '@/components/BackgroundTaskProvider';
import { RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChartOfAccountItem {
  id: string;
  accountCode: string;
  accountName: string;
  categoryType: string;
  sortOrder: number;
}

interface AssignedClient {
  id: string;
  clientName: string;
  periods: { id: string; startDate: string; endDate: string }[];
}

export interface BankToTBClientProps {
  userId: string;
  userName: string;
  firmId: string;
  firmName: string;
  assignedClients: AssignedClient[];
  isFirmAdmin: boolean;
  chartOfAccounts: ChartOfAccountItem[];
}

function BankToTBInner({ assignedClients, chartOfAccounts, userId }: {
  assignedClients: AssignedClient[];
  chartOfAccounts: ChartOfAccountItem[];
  userId: string;
}) {
  const { state, dispatch } = useBankToTB();
  const { updateTask } = useBackgroundTasks();
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    if (!state.sessionId) return;
    if (!confirm('This will clear ALL uploaded files, extracted transactions, trial balance, and journals for this session. Continue?')) return;
    setResetting(true);
    try {
      await fetch('/api/bank-to-tb/reset-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId }),
      });
      dispatch({ type: 'SET_FILES', payload: [] });
      dispatch({ type: 'SET_TRANSACTIONS', payload: [] });
      dispatch({ type: 'SET_ACCOUNTS', payload: [] });
      dispatch({ type: 'SET_TRIAL_BALANCE', payload: [] });
      dispatch({ type: 'SET_MULTI_ACCOUNTS', payload: false });
      dispatch({ type: 'SET_OUT_OF_PERIOD', payload: false });
      dispatch({ type: 'SET_OPENING_SOURCE', payload: '' });
      dispatch({ type: 'SET_VIEW', payload: 'bank-transactions' });
      updateTask(`btb-${state.sessionId}`, { status: 'completed', completedAt: Date.now() });
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-16 z-40 bg-white border-b shadow-sm">
        <div className="flex items-center">
          <div className="flex-1">
            <ClientPeriodSelector clients={assignedClients} />
          </div>
          {/* Accounting Framework selector */}
          <div className="px-3 border-l border-slate-200">
            <label className="text-[10px] text-slate-400 block leading-none mb-0.5">Framework</label>
            <select
              value={state.accountingFramework || ''}
              onChange={e => dispatch({ type: 'SET_FRAMEWORK', payload: e.target.value || null })}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 w-28"
            >
              <option value="">Select...</option>
              <option value="IFRS">IFRS</option>
              <option value="FRS102">FRS 102</option>
              <option value="FRS101">FRS 101</option>
              <option value="Charities">Charities</option>
            </select>
          </div>
          {/* Always-visible Reset button when session is active */}
          {state.sessionId && (
            <div className="pr-4">
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                disabled={resetting}
                className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-400"
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                )}
                Reset &amp; Clear All
              </Button>
            </div>
          )}
        </div>
      </div>

      {state.sessionId ? (
        <div className="flex gap-0 h-[calc(100vh-8rem)]">
          {/* Left 80% - Spreadsheet area */}
          <div className="w-4/5 flex flex-col border-r">
            <BalanceBar />
            <SpreadsheetToggle />
            <div className="flex-1 overflow-hidden">
              {state.activeView === 'bank-transactions' ? (
                <BankTransactionsSheet />
              ) : (
                <TrialBalanceSheet />
              )}
            </div>
            <AccountTabs />
          </div>

          {/* Right 20% - Controls panel */}
          <div className="w-1/5 overflow-y-auto bg-white">
            <ControlsPanel
              chartOfAccounts={chartOfAccounts}
              sessionId={state.sessionId}
              userId={userId}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
          <div className="text-center text-slate-500">
            <p className="text-lg font-medium">Bank to Trial Balance</p>
            <p className="mt-2 text-sm">Select a client and period to begin.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function BankToTBClient(props: BankToTBClientProps) {
  return (
    <BankToTBProvider>
      <BankToTBInner
        assignedClients={props.assignedClients}
        chartOfAccounts={props.chartOfAccounts}
        userId={props.userId}
      />
    </BankToTBProvider>
  );
}
