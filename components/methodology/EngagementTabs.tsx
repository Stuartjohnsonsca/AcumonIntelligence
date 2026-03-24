'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AuditType } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import { PermanentFileTab } from './tabs/PermanentFileTab';
import { EthicsTab } from './tabs/EthicsTab';
import { ContinuanceTab } from './tabs/ContinuanceTab';
import { MaterialityTab } from './tabs/MaterialityTab';
import { TrialBalanceTab } from './tabs/TrialBalanceTab';
import { PARTab } from './tabs/PARTab';
import { RMMTab } from './tabs/RMMTab';

// Tab placeholder for tabs not yet built
function TabPlaceholder({ name }: { name: string }) {
  return (
    <div className="py-12 text-center">
      <div className="text-3xl mb-2">🔧</div>
      <h3 className="text-lg font-medium text-slate-600">{name}</h3>
      <p className="text-sm text-slate-400 mt-1">This tab is under construction</p>
    </div>
  );
}

interface Props {
  engagement: EngagementData;
  auditType: AuditType;
  clientName: string;
  periodEndDate: string | null;
  currentUserId: string;
}

const TABS = [
  { key: 'opening', label: 'Opening' },
  { key: 'permanent-file', label: 'Client Permanent File' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'continuance', label: 'Continuance' },
  { key: 'tb', label: 'TBCYvPY' },
  { key: 'materiality', label: 'Materiality' },
  { key: 'par', label: 'PAR' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Document Repository' },
  { key: 'portal', label: 'Client Portal' },
] as const;

type TabKey = typeof TABS[number]['key'];

export function EngagementTabs({ engagement, auditType, clientName, periodEndDate, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as TabKey) || 'opening';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  function switchTab(key: TabKey) {
    setActiveTab(key);
    // Update URL without full navigation
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    router.replace(url.pathname + url.search, { scroll: false });
  }

  // Determine the continuance/new client tab label
  const continuanceLabel = 'Continuance'; // TODO: Check if new client based on prior auditor

  function renderTabContent() {
    switch (activeTab) {
      case 'opening':
        return <TabPlaceholder name="Opening" />;
      case 'permanent-file':
        return <PermanentFileTab engagementId={engagement.id} />;
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
        return <RMMTab engagementId={engagement.id} auditType={auditType} />;
      case 'documents':
        return <TabPlaceholder name="Document Repository" />;
      case 'portal':
        return <TabPlaceholder name="Client Portal (Read Only)" />;
      default:
        return null;
    }
  }

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
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
