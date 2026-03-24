'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AuditType } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import { SignOffHeader } from './SignOffHeader';
import { PermanentFileTab } from './tabs/PermanentFileTab';
import { EthicsTab } from './tabs/EthicsTab';
import { ContinuanceTab } from './tabs/ContinuanceTab';
import { MaterialityTab } from './tabs/MaterialityTab';
import { TrialBalanceTab } from './tabs/TrialBalanceTab';
import { PARTab } from './tabs/PARTab';
import { RMMTab } from './tabs/RMMTab';
import { DocumentRepositoryTab } from './tabs/DocumentRepositoryTab';
import { ClientPortalTab } from './tabs/ClientPortalTab';
import { OpeningTab } from './tabs/OpeningTab';

interface Props {
  engagement: EngagementData;
  auditType: AuditType;
  clientName: string;
  periodEndDate: string | null;
  currentUserId: string;
}

const TABS = [
  { key: 'opening', label: 'Opening' },
  { key: 'permanent-file', label: 'Permanent' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'continuance', label: 'Continuance' },
  { key: 'tb', label: 'TBCYvPY' },
  { key: 'materiality', label: 'Materiality' },
  { key: 'par', label: 'PAR' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Documents' },
  { key: 'portal', label: 'Portal' },
] as const;

// Tabs that get sign-off dots — everything except Documents and Portal
const SIGNOFF_TABS: Record<string, string> = {
  'opening': 'Opening',
  'permanent-file': 'Client Permanent File',
  'ethics': 'Ethics',
  'continuance': 'Continuance',
  'tb': 'Trial Balance CY v PY',
  'materiality': 'Materiality',
  'par': 'Preliminary Analytical Review',
  'rmm': 'Identifying & Assessing RMM',
};

// Map tab key to API endpoint for sign-offs
const TAB_ENDPOINTS: Record<string, string> = {
  'opening': 'permanent-file', // shares with permanent-file for now
  'permanent-file': 'permanent-file',
  'ethics': 'ethics',
  'continuance': 'continuance',
  'tb': 'trial-balance',
  'materiality': 'materiality',
  'par': 'par',
  'rmm': 'rmm',
};

type TabKey = typeof TABS[number]['key'];

export function EngagementTabs({ engagement, auditType, clientName, periodEndDate, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as TabKey) || 'opening';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  function switchTab(key: TabKey) {
    setActiveTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    router.replace(url.pathname + url.search, { scroll: false });
  }

  const continuanceLabel = 'Continuance';

  // Normalised team members for sign-off
  const teamMembers = engagement.teamMembers.map(m => ({
    userId: m.userId,
    userName: m.userName || (m as any).user?.name,
    role: m.role,
  }));

  function renderTabContent() {
    switch (activeTab) {
      case 'opening':
        return <OpeningTab engagement={engagement} auditType={auditType} clientName={clientName} periodEndDate={periodEndDate} />;
      case 'permanent-file':
        return <PermanentFileTab engagementId={engagement.id} teamMembers={teamMembers} />;
      case 'ethics':
        return <EthicsTab engagementId={engagement.id} />;
      case 'continuance':
        return <ContinuanceTab engagementId={engagement.id} />;
      case 'tb':
        return <TrialBalanceTab engagementId={engagement.id} isGroupAudit={engagement.isGroupAudit} />;
      case 'materiality':
        return <MaterialityTab engagementId={engagement.id} />;
      case 'par':
        return <PARTab engagementId={engagement.id} />;
      case 'rmm':
        return <RMMTab engagementId={engagement.id} auditType={auditType} teamMembers={teamMembers} />;
      case 'documents':
        return <DocumentRepositoryTab engagementId={engagement.id} />;
      case 'portal':
        return <ClientPortalTab engagementId={engagement.id} clientName={clientName} />;
      default:
        return null;
    }
  }

  // Wrap content with SignOffHeader for applicable tabs
  const hasSignOff = activeTab in SIGNOFF_TABS;
  const signOffTitle = SIGNOFF_TABS[activeTab] || '';
  const signOffEndpoint = TAB_ENDPOINTS[activeTab] || '';

  return (
    <div>
      {/* Tab Bar */}
      <div className="border-b border-slate-200 bg-white rounded-t-lg overflow-x-auto">
        <nav className="flex -mb-px" aria-label="Engagement tabs">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            const label = tab.key === 'continuance' ? continuanceLabel : tab.label;
            return (
              <button
                key={tab.key}
                onClick={() => switchTab(tab.key)}
                className={`whitespace-nowrap py-2.5 px-4 border-b-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-b-lg border border-t-0 border-slate-200 min-h-[500px]">
        <div className="p-4">
          {hasSignOff ? (
            <SignOffHeader
              engagementId={engagement.id}
              endpoint={signOffEndpoint}
              title={signOffTitle}
              teamMembers={teamMembers}
            >
              {renderTabContent()}
            </SignOffHeader>
          ) : (
            renderTabContent()
          )}
        </div>
      </div>
    </div>
  );
}
