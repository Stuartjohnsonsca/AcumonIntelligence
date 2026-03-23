'use client';

import { BankToTBProvider, useBankToTB } from '@/components/bank-to-tb/BankToTBContext';
import { ClientPeriodSelector } from '@/components/bank-to-tb/ClientPeriodSelector';
import { BalanceBar } from '@/components/bank-to-tb/BalanceBar';
import { SpreadsheetToggle } from '@/components/bank-to-tb/SpreadsheetToggle';
import { BankTransactionsSheet } from '@/components/bank-to-tb/BankTransactionsSheet';
import { TrialBalanceSheet } from '@/components/bank-to-tb/TrialBalanceSheet';
import { AccountTabs } from '@/components/bank-to-tb/AccountTabs';
import { ControlsPanel } from '@/components/bank-to-tb/ControlsPanel';

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
  const { state } = useBankToTB();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-16 z-40 bg-white border-b shadow-sm">
        <ClientPeriodSelector clients={assignedClients} />
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
