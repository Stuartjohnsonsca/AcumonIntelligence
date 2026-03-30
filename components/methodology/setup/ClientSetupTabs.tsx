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
}

export function ClientSetupTabs({ clientId, clientName, auditType, setupTeam, onSetupTeamChange, onProceed }: Props) {
  return (
    <Tabs defaultValue="periods" className="w-full">
      <TabsList className="bg-slate-100">
        <TabsTrigger value="periods">Periods</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="connection">Connection</TabsTrigger>
      </TabsList>

      <TabsContent value="periods">
        <PeriodsTab clientId={clientId} onProceed={onProceed} />
      </TabsContent>

      <TabsContent value="team">
        <SetupTeamTab members={setupTeam} onChange={onSetupTeamChange} />
      </TabsContent>

      <TabsContent value="connection">
        <ConnectionTab clientId={clientId} clientName={clientName} />
      </TabsContent>
    </Tabs>
  );
}
