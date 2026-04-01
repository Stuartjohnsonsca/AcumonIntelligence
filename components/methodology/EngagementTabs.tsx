'use client';

import { useState, useEffect } from 'react';
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
import { PriorPeriodTab } from './tabs/PriorPeriodTab';
import { AuditPlanPanel } from './panels/AuditPlanPanel';
import { EngagementOutstandingTab } from './tabs/EngagementOutstandingTab';
import { CommunicationTab } from './tabs/CommunicationTab';

interface Props {
  engagement: EngagementData;
  auditType: AuditType;
  clientName: string;
  periodEndDate: string | null;
  periodStartDate: string | null;
  currentUserId: string;
}

const TABS = [
  { key: 'opening', label: 'Opening' },
  { key: 'prior-period', label: 'Prior Period' },
  { key: 'permanent-file', label: 'Permanent' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'continuance', label: 'Continuance' },
  { key: 'tb', label: 'TBCYvPY' },
  { key: 'materiality', label: 'Materiality' },
  { key: 'par', label: 'PAR' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Documents' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'portal', label: 'Portal' },
  { key: 'communication', label: 'Communication' },
] as const;

// Tabs that get sign-off dots — everything except Documents and Portal
const SIGNOFF_TABS: Record<string, string> = {
  'opening': 'Opening',
  'prior-period': 'Prior Period',
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
  'prior-period': 'prior-period',
  'permanent-file': 'permanent-file',
  'ethics': 'ethics',
  'continuance': 'continuance',
  'tb': 'trial-balance',
  'materiality': 'materiality',
  'par': 'par',
  'rmm': 'rmm',
};

// Map tab key → schedule config key (used in audit type → schedule mapping)
const TAB_TO_SCHEDULE: Record<string, string> = {
  'opening': 'opening', // Opening always shown
  'prior-period': 'prior_period',
  'permanent-file': 'permanent_file_questions',
  'ethics': 'ethics_questions',
  'continuance': 'continuance_questions',
  'tb': 'trial_balance',
  'materiality': 'materiality_questions',
  'par': 'par',
  'rmm': 'rmm',
  'documents': 'documents',
  'portal': 'portal',
};

type TabKey = typeof TABS[number]['key'];

export function EngagementTabs({ engagement, auditType, clientName, periodEndDate, periodStartDate, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as TabKey) || 'opening';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [tbShowCategory, setTbShowCategory] = useState(true);
  const [showAuditPlan, setShowAuditPlan] = useState(false);
  const [enabledSchedules, setEnabledSchedules] = useState<Set<string> | null>(null); // null = loading/all enabled
  const [engStatus, setEngStatus] = useState(engagement.status);
  const [starting, setStarting] = useState(false);

  const isPreStart = engStatus === 'pre_start';

  async function handleStartAudit() {
    setStarting(true);
    try {
      const res = await fetch(`/api/engagements/${engagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (res.ok) {
        setEngStatus('active');
      }
    } catch (err) {
      console.error('Failed to start audit:', err);
    } finally {
      setStarting(false);
    }
  }

  // Fetch audit type → schedule mapping
  useEffect(() => {
    fetch('/api/methodology-admin/audit-type-schedules')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.mappings?.[auditType]) {
          setEnabledSchedules(new Set(data.mappings[auditType]));
        }
        // If no mapping configured, all tabs are enabled (null = show all)
      })
      .catch(() => {}); // Fail silently, show all tabs
  }, [auditType]);

  // Filter tabs based on engagement status and audit type schedule config
  const visibleTabs = TABS.filter(tab => {
    if (tab.key === 'opening') return true; // Opening always visible
    if (isPreStart) return false; // Only show Opening until audit is started
    if (!enabledSchedules) return true; // Not loaded yet or no config = show all
    const scheduleKey = TAB_TO_SCHEDULE[tab.key];
    return scheduleKey ? enabledSchedules.has(scheduleKey) : true;
  });

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
        return <OpeningTab engagement={engagement} auditType={auditType} clientName={clientName} periodEndDate={periodEndDate} onShowCategoryChange={setTbShowCategory} />;
      case 'prior-period':
        return <PriorPeriodTab engagementId={engagement.id} teamMembers={teamMembers} />;
      case 'permanent-file':
        return <PermanentFileTab engagementId={engagement.id} teamMembers={teamMembers} />;
      case 'ethics':
        return <EthicsTab engagementId={engagement.id} />;
      case 'continuance':
        return <ContinuanceTab engagementId={engagement.id} />;
      case 'tb':
        return <TrialBalanceTab engagementId={engagement.id} isGroupAudit={engagement.isGroupAudit} showCategory={tbShowCategory} onShowCategoryChange={setTbShowCategory} periodEndDate={periodEndDate} periodStartDate={periodStartDate} />;
      case 'materiality':
        return <MaterialityTab engagementId={engagement.id} currentUserId={currentUserId} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'par':
        return <PARTab engagementId={engagement.id} />;
      case 'rmm':
        return <RMMTab engagementId={engagement.id} auditType={auditType} teamMembers={teamMembers} showCategoryOption={tbShowCategory} />;
      case 'documents':
        return <DocumentRepositoryTab engagementId={engagement.id} />;
      case 'outstanding':
        return <EngagementOutstandingTab
          engagementId={engagement.id}
          clientId={engagement.clientId}
          currentUserId={currentUserId}
          currentUserRole={teamMembers.find(m => m.userId === currentUserId)?.role}
          teamMembers={teamMembers}
          specialists={engagement.specialists?.map(s => ({ name: s.name || '', specialistType: s.specialistType })) || []}
        />;
      case 'portal':
        return <ClientPortalTab engagementId={engagement.id} clientName={clientName} />;
      case 'communication':
        return <CommunicationTab engagementId={engagement.id} clientId={engagement.clientId} />;
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
          {visibleTabs.map(tab => {
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
          {/* Audit Plan overlay — shown when Create Plan is clicked from RMM */}
          {showAuditPlan ? (
            <AuditPlanPanel engagementId={engagement.id} onClose={() => setShowAuditPlan(false)} />
          ) : hasSignOff ? (
            <SignOffHeader
              engagementId={engagement.id}
              endpoint={signOffEndpoint}
              title={signOffTitle}
              teamMembers={teamMembers}
              headerActions={activeTab === 'rmm' ? (
                <button
                  onClick={() => setShowAuditPlan(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mr-3"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Create Plan
                </button>
              ) : undefined}
            >
              {renderTabContent()}
            </SignOffHeader>
          ) : (
            renderTabContent()
          )}

          {/* Start Audit button — only shown on Opening tab when engagement is pre_start */}
          {isPreStart && activeTab === 'opening' && (
            <div className="mt-6 pt-6 border-t border-slate-200 text-center">
              <button
                onClick={handleStartAudit}
                disabled={starting}
                className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {starting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    Starting...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Audit
                  </>
                )}
              </button>
              <p className="text-xs text-slate-400 mt-2">
                Review the opening details above, then click to start the audit and unlock all tabs
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
