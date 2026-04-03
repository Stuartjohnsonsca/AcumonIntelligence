'use client';

import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
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

const PRE_PLAN_KEYS = new Set(['opening', 'prior-period', 'permanent-file', 'ethics', 'continuance', 'tb', 'materiality', 'par', 'rmm']);

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

// Error boundary to catch tab-level crashes without taking down the whole page
class TabErrorBoundary extends Component<{ tabName: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-center">
          <div className="text-red-500 font-semibold mb-2">Error loading {this.props.tabName}</div>
          <pre className="text-xs text-red-400 bg-red-50 rounded p-3 max-h-[200px] overflow-auto text-left whitespace-pre-wrap">{this.state.error.message}{'\n'}{this.state.error.stack?.split('\n').slice(0, 5).join('\n')}</pre>
          <button onClick={() => this.setState({ error: null })} className="mt-3 text-xs text-blue-600 hover:text-blue-800 underline">Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function EngagementTabs({ engagement, auditType, clientName, periodEndDate, periodStartDate, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as TabKey) || 'opening';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [tbShowCategory, setTbShowCategory] = useState(true);
  const [showAuditPlan, setShowAuditPlan] = useState(false);
  const [planCreated, setPlanCreated] = useState(false);

  // Check if plan was previously created
  useEffect(() => {
    fetch(`/api/engagements/${engagement.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.engagement?.planCreated) setPlanCreated(true); })
      .catch(() => {});
  }, [engagement.id]);
  const [enabledSchedules, setEnabledSchedules] = useState<Set<string> | null>(null); // null = loading/all enabled
  const [outstandingTeamCount, setOutstandingTeamCount] = useState(0);
  const [outstandingClientCount, setOutstandingClientCount] = useState(0);
  const handleOutstandingCounts = useCallback((team: number, client: number) => {
    setOutstandingTeamCount(team);
    setOutstandingClientCount(client);
  }, []);
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
        return <PARTab engagementId={engagement.id} userId={currentUserId} userName={teamMembers.find(m => m.userId === currentUserId)?.userName} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
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
          onCountsChange={handleOutstandingCounts}
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
      {/* Persistent action buttons */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-t-lg">
        <button className="px-2.5 py-1 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors">
          Review Point
        </button>
        <button className="px-2.5 py-1 text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 transition-colors">
          Representation
        </button>
        <button className="px-2.5 py-1 text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 rounded hover:bg-orange-100 transition-colors">
          Management
        </button>
        <button className="px-2.5 py-1 text-[10px] font-medium bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors">
          RI Matters
        </button>
      </div>

      {/* When Audit Plan is open: split layout with vertical sidebar */}
      {showAuditPlan ? (
        <div className="flex border border-t-0 border-slate-200 rounded-b-lg bg-white min-h-[500px]">
          {/* Left sidebar: pre-plan tabs as vertical list */}
          <div className="w-28 flex-shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
            {visibleTabs.filter(t => PRE_PLAN_KEYS.has(t.key)).map(tab => {
              const isActive = activeTab === tab.key;
              const label = tab.key === 'continuance' ? continuanceLabel : tab.label;
              return (
                <button
                  key={tab.key}
                  onClick={() => { switchTab(tab.key); setShowAuditPlan(false); }}
                  className={`w-full text-left px-2 py-2 text-[10px] font-medium border-b border-slate-200 transition-colors flex items-center gap-1 ${
                    isActive ? 'bg-blue-50 text-blue-700 border-l-2 border-l-blue-500' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  {label}
                  {tab.key === 'outstanding' && outstandingTeamCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[16px] px-1 h-4 rounded-full bg-teal-500 text-white text-[8px] font-bold">{outstandingTeamCount}</span>
                  )}
                  {tab.key === 'outstanding' && outstandingClientCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[16px] px-1 h-4 rounded-full bg-orange-500 text-white text-[8px] font-bold">{outstandingClientCount}</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Main area: Audit Plan */}
          <div className="flex-1 p-4 overflow-auto">
            <TabErrorBoundary tabName="Audit Plan">
              <AuditPlanPanel engagementId={engagement.id} onClose={() => setShowAuditPlan(false)} periodEndDate={periodEndDate} periodStartDate={periodStartDate} />
            </TabErrorBoundary>
          </div>
        </div>
      ) : (
        <>
          {/* Normal horizontal tab bar */}
          <div className="border-x border-slate-200 bg-white overflow-x-auto">
            <nav className="flex -mb-px" aria-label="Engagement tabs">
              {visibleTabs.map(tab => {
                const isActive = activeTab === tab.key;
                const label = tab.key === 'continuance' ? continuanceLabel : tab.label;
                return (
                  <button
                    key={tab.key}
                    onClick={() => switchTab(tab.key)}
                    className={`whitespace-nowrap py-2.5 px-4 border-b-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {label}
                    {tab.key === 'outstanding' && outstandingTeamCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] px-1 h-[18px] rounded-full bg-teal-500 text-white text-[9px] font-bold leading-none">{outstandingTeamCount}</span>
                    )}
                    {tab.key === 'outstanding' && outstandingClientCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] px-1 h-[18px] rounded-full bg-orange-500 text-white text-[9px] font-bold leading-none">{outstandingClientCount}</span>
                    )}
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
              headerActions={activeTab === 'rmm' ? (
                <button
                  onClick={() => {
                    setShowAuditPlan(true);
                    if (!planCreated) {
                      setPlanCreated(true);
                      // Save flag to engagement
                      fetch(`/api/engagements/${engagement.id}`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ planCreated: true }),
                      }).catch(() => {});
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mr-3"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  {planCreated ? 'Open Plan' : 'Create Plan'}
                </button>
              ) : undefined}
            >
              <TabErrorBoundary tabName={signOffTitle}>{renderTabContent()}</TabErrorBoundary>
            </SignOffHeader>
          ) : (
            <TabErrorBoundary tabName={activeTab}>{renderTabContent()}</TabErrorBoundary>
          )}

          {/* Start Audit button — only shown on Opening tab when engagement is pre_start */}
          {isPreStart && activeTab === 'opening' && (() => {
            // Validation checks
            const hasRI = engagement.teamMembers.some(m => m.role === 'RI');
            const hasEthicsSpecialist = (engagement.specialists || []).some(s => s.specialistType === 'EthicsPartner' || s.specialistType === 'Ethics');
            const hasTechnicalSpecialist = (engagement.specialists || []).some(s => s.specialistType === 'TechnicalAdvisor' || s.specialistType === 'Technical');
            const mainContactWithPortal = (engagement.contacts || []).some(c =>
              c.isMainContact && c.email?.trim() && (c as any).portalAccess !== false
            );
            const checks = [
              { ok: hasRI, label: 'RI assigned to team' },
              { ok: hasEthicsSpecialist, label: 'Ethics Specialist assigned' },
              { ok: hasTechnicalSpecialist, label: 'Technical Specialist assigned' },
              { ok: mainContactWithPortal, label: 'Main contact with email and portal access' },
            ];
            const allPassed = checks.every(c => c.ok);
            const failedChecks = checks.filter(c => !c.ok);

            return (
            <div className="mt-6 pt-6 border-t border-slate-200 text-center">
              {/* Validation checklist */}
              {!allPassed && (
                <div className="mb-4 inline-block text-left bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-amber-800 mb-2">Before starting the audit, please ensure:</p>
                  <div className="space-y-1">
                    {checks.map((c, ci) => (
                      <div key={ci} className="flex items-center gap-2 text-xs">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${c.ok ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                          {c.ok ? '✓' : '✗'}
                        </span>
                        <span className={c.ok ? 'text-green-700' : 'text-red-700'}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <button
                  onClick={handleStartAudit}
                  disabled={starting || !allPassed}
                  className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Review the opening details above, then click to start the audit and unlock all tabs
              </p>
            </div>
            );
          })()}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
