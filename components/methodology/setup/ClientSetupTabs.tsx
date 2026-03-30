'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PeriodsTab } from './PeriodsTab';
import { SetupTeamTab } from './SetupTeamTab';
import { ConnectionTab } from './ConnectionTab';
import type { SetupMember } from './SetupTeamTab';
import type { AuditType } from '@/types/methodology';

interface Props {
  clientId: string;
  clientName: string;
  auditType: AuditType;
  setupTeam: SetupMember[];
  onSetupTeamChange: (members: SetupMember[]) => void;
  onProceed: (periodId: string, periodLabel: string) => void;
  selectedPeriodId: string;
  selectedPeriodLabel: string;
  onPeriodSelect: (periodId: string, periodLabel: string) => void;
  starting: boolean;
}

export function ClientSetupTabs({
  clientId, clientName, auditType, setupTeam, onSetupTeamChange,
  onProceed, selectedPeriodId, selectedPeriodLabel, onPeriodSelect, starting,
}: Props) {
  return (
    <div>
      {/* Start / Open Audit File button */}
      <div className="flex items-center justify-between mb-4 bg-white border border-slate-200 rounded-lg px-5 py-3">
        <div>
          {selectedPeriodId ? (
            <p className="text-sm text-slate-700">
              Period: <span className="font-medium">{selectedPeriodLabel}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-400">Select a period from the Periods tab to open the audit file</p>
          )}
        </div>
        <button
          onClick={() => onProceed(selectedPeriodId, selectedPeriodLabel)}
          disabled={!selectedPeriodId || starting}
          className="px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {starting ? 'Opening...' : 'Open Audit File'}
        </button>
      </div>

      <Tabs defaultValue="periods" className="w-full">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="periods">Periods</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>

        <TabsContent value="periods">
          <PeriodsTab
            clientId={clientId}
            selectedPeriodId={selectedPeriodId}
            onSelect={onPeriodSelect}
          />
        </TabsContent>

        <TabsContent value="team">
          <SetupTeamTab members={setupTeam} onChange={onSetupTeamChange} />
        </TabsContent>

        <TabsContent value="connection">
          <ConnectionTab clientId={clientId} clientName={clientName} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
