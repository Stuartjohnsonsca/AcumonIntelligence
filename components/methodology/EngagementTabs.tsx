'use client';

import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AuditType } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import { SignOffHeader } from './SignOffHeader';
import { PermanentFileTab } from './tabs/PermanentFileTab';
import { EthicsTab } from './tabs/EthicsTab';
import { ContinuanceTab } from './tabs/ContinuanceTab';
import { SubsequentEventsTab } from './tabs/SubsequentEventsTab';
import { NewClientTab } from './tabs/NewClientTab';
import { TaxTechnicalTab } from './tabs/TaxTechnicalTab';
import { MaterialityTab } from './tabs/MaterialityTab';
import { TrialBalanceTab } from './tabs/TrialBalanceTab';
import { PARTab } from './tabs/PARTab';
import { WalkthroughsTab } from './tabs/WalkthroughsTab';
import { RMMTab } from './tabs/RMMTab';
import { DocumentRepositoryTab } from './tabs/DocumentRepositoryTab';
import { ClientPortalTab } from './tabs/ClientPortalTab';
import { OpeningTab } from './tabs/OpeningTab';
import { PriorPeriodTab } from './tabs/PriorPeriodTab';
import { AuditPlanPanel } from './panels/AuditPlanPanel';
import { EngagementOutstandingTab } from './tabs/EngagementOutstandingTab';
import { CommunicationTab } from './tabs/CommunicationTab';
import { ReviewPointsPanel } from './panels/ReviewPointsPanel';
import { ManagementPointPanel } from './panels/ManagementPointPanel';
import { RIMattersPanel } from './panels/RIMattersPanel';
import { CompletionPanel } from './panels/CompletionPanel';

interface Props {
  engagement: EngagementData;
  auditType: AuditType;
  clientName: string;
  periodEndDate: string | null;
  periodStartDate: string | null;
  currentUserId: string;
}

const PRE_PLAN_KEYS = new Set(['opening', 'prior-period', 'permanent-file', 'ethics', 'continuance', 'new-client', 'tb', 'materiality', 'par', 'walkthroughs', 'rmm']);

const TABS = [
  { key: 'opening', label: 'Opening' },
  { key: 'prior-period', label: 'Prior Period' },
  { key: 'permanent-file', label: 'Permanent' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'continuance', label: 'Continuance' },
  { key: 'new-client', label: 'New Client Take-On' },
  { key: 'tb', label: 'TBCYvPY' },
  { key: 'materiality', label: 'Materiality' },
  { key: 'par', label: 'PAR' },
  { key: 'walkthroughs', label: 'Walkthroughs' },
  { key: 'rmm', label: 'Identifying & Assessing RMM' },
  { key: 'documents', label: 'Documents' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'portal', label: 'Portal' },
  { key: 'communication', label: 'Communication' },
  { key: 'subsequent-events', label: 'Subsequent Events' },
  { key: 'tax-technical', label: 'Tax Technical' },
] as const;

// Tabs that get sign-off dots — everything except Documents and Portal
const SIGNOFF_TABS: Record<string, string> = {
  'opening': 'Opening',
  'prior-period': 'Prior Period',
  'permanent-file': 'Client Permanent File',
  'ethics': 'Ethics',
  'continuance': 'Continuance',
  'new-client': 'New Client Take-On',
  'subsequent-events': 'Subsequent Events',
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
  'new-client': 'new-client-takeon',
  'subsequent-events': 'subsequent-events',
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
  'new-client': 'new_client_takeon_questions',
  'subsequent-events': 'subsequent_events_questions',
  'tax-technical': 'tax_technical_categories',
  'tb': 'trial_balance',
  'materiality': 'materiality_questions',
  'par': 'par',
  'rmm': 'rmm',
  'documents': 'documents',
  'portal': 'portal',
};

type TabKey = typeof TABS[number]['key'];

// Error boundary to catch tab-level crashes without taking down the whole page
// Automatically reports caught errors to /api/error-report for centralised logging
class TabErrorBoundary extends Component<{ tabName: string; engagementId?: string; children: ReactNode }, { error: Error | null; reported: boolean }> {
  state = { error: null as Error | null, reported: false };
  static getDerivedStateFromError(error: Error) { return { error, reported: false }; }
  componentDidCatch(error: Error) {
    if (!this.state.reported) {
      this.setState({ reported: true });
      fetch('/api/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `${this.props.tabName}: ${error.message}`,
          stack: error.stack,
          route: typeof window !== 'undefined' ? window.location.pathname : undefined,
          engagementId: this.props.engagementId,
          context: { tabName: this.props.tabName },
        }),
      }).catch(() => {}); // Fire and forget
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-center">
          <div className="text-red-500 font-semibold mb-2">Error loading {this.props.tabName}</div>
          <pre className="text-xs text-red-400 bg-red-50 rounded p-3 max-h-[200px] overflow-auto text-left whitespace-pre-wrap">{this.state.error.message}{'\n'}{this.state.error.stack?.split('\n').slice(0, 5).join('\n')}</pre>
          <button onClick={() => this.setState({ error: null, reported: false })} className="mt-3 text-xs text-blue-600 hover:text-blue-800 underline">Try Again</button>
          <div className="mt-1 text-[10px] text-slate-400">This error has been logged for investigation.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Sign-off status for tab-level dots
interface TabSignOffStatus {
  reviewer: 'none' | 'signed' | 'stale';
  partner: 'none' | 'signed' | 'stale';
}

export function EngagementTabs({ engagement, auditType, clientName, periodEndDate, periodStartDate, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Restore last page for this engagement
  const storageKey = `lastPage:${engagement.id}`;
  const urlTab = searchParams.get('tab') as TabKey | null;
  const savedState = typeof window !== 'undefined' ? (() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } })() : {};
  const initialTab = urlTab || savedState.tab || 'opening';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [tbShowCategory, setTbShowCategory] = useState(true);
  const [showAuditPlan, setShowAuditPlan] = useState(!!savedState.auditPlan);
  const [showCompletion, setShowCompletion] = useState(!!savedState.completion);
  const [tabSignOffs, setTabSignOffs] = useState<Record<string, TabSignOffStatus>>({});

  // Persist last page to localStorage
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ tab: activeTab, auditPlan: showAuditPlan, completion: showCompletion })); } catch {}
  }, [activeTab, showAuditPlan, showCompletion, storageKey]);
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
  const [openPanel, setOpenPanel] = useState<'review_point' | 'representation' | 'management' | 'ri_matter' | null>(null);

  const isPreStart = engStatus === 'pre_start';
  const [isNewClient, setIsNewClient] = useState<boolean | null>(engagement.isNewClient ?? null);

  // Auto-detect new client: check if prior engagement exists for same client
  useEffect(() => {
    if (isNewClient !== null) return; // Manual override set, skip auto-detect
    fetch(`/api/engagements/${engagement.id}?checkPriorAuditor=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.hasPriorEngagement !== undefined) {
          setIsNewClient(!d.hasPriorEngagement);
        }
      })
      .catch(() => {});
  }, [engagement.id, isNewClient]);

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

  // Fetch sign-off status for all tabs to show Reviewer/RI dots
  const loadTabSignOffs = useCallback(async () => {
    const statuses: Record<string, TabSignOffStatus> = {};
    await Promise.all(
      Object.entries(TAB_ENDPOINTS).map(async ([tabKey, ep]) => {
        try {
          const res = await fetch(`/api/engagements/${engagement.id}/${ep}?meta=signoffs`);
          if (!res.ok) return;
          const json = await res.json();
          const so = json.signOffs || {};
          const meta: Record<string, { lastEditedAt?: string }> = json.fieldMeta || {};

          function isStale(role: 'reviewer' | 'partner'): boolean {
            const ts = so[role]?.timestamp;
            if (!ts) return false;
            const signTime = new Date(ts).getTime();
            return Object.values(meta).some(m => m.lastEditedAt && new Date(m.lastEditedAt).getTime() > signTime);
          }

          statuses[tabKey] = {
            reviewer: so.reviewer?.timestamp ? (isStale('reviewer') ? 'stale' : 'signed') : 'none',
            partner: so.partner?.timestamp ? (isStale('partner') ? 'stale' : 'signed') : 'none',
          };
        } catch { /* ignore */ }
      })
    );
    setTabSignOffs(statuses);
  }, [engagement.id]);

  useEffect(() => { loadTabSignOffs(); }, [loadTabSignOffs]);

  // Re-fetch tab sign-offs when switching tabs (to pick up changes made inside SignOffHeader)
  useEffect(() => { loadTabSignOffs(); }, [activeTab, loadTabSignOffs]);

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

  // Filter tabs based on engagement status, audit type schedule config, and continuance/new-client
  const visibleTabs = TABS.filter(tab => {
    if (tab.key === 'opening') return true; // Opening always visible
    if (isPreStart) return false; // Only show Opening until audit is started

    // Continuance / New Client Take-On: show one or the other
    if (tab.key === 'continuance' && isNewClient === true) return false;
    if (tab.key === 'new-client' && isNewClient !== true) return false;

    if (!enabledSchedules) return true; // Not loaded yet or no config = show all
    const scheduleKey = TAB_TO_SCHEDULE[tab.key];
    return scheduleKey ? enabledSchedules.has(scheduleKey) : true;
  });

  function switchTab(key: TabKey) {
    setActiveTab(key);
    // Use history.replaceState instead of router.replace to avoid Next.js re-rendering the server component
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', key);
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch {}
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
      case 'new-client':
        return <NewClientTab engagementId={engagement.id} />;
      case 'subsequent-events':
        return <SubsequentEventsTab engagementId={engagement.id} />;
      case 'tax-technical':
        return <TaxTechnicalTab engagementId={engagement.id} clientName={clientName} />;
      case 'tb':
        return <TrialBalanceTab engagementId={engagement.id} isGroupAudit={engagement.isGroupAudit} showCategory={tbShowCategory} onShowCategoryChange={setTbShowCategory} periodEndDate={periodEndDate} periodStartDate={periodStartDate} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'materiality':
        return <MaterialityTab engagementId={engagement.id} currentUserId={currentUserId} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'par':
        return <PARTab engagementId={engagement.id} userId={currentUserId} userName={teamMembers.find(m => m.userId === currentUserId)?.userName} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'walkthroughs':
        return <WalkthroughsTab engagementId={engagement.id} />;
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
        <button onClick={() => setOpenPanel('review_point')} className="px-2.5 py-1 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors">
          Review Point
        </button>
        <button onClick={() => setOpenPanel('representation')} className="px-2.5 py-1 text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 transition-colors">
          Representation
        </button>
        <button onClick={() => setOpenPanel('management')} className="px-2.5 py-1 text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 rounded hover:bg-orange-100 transition-colors">
          Management
        </button>
        <button onClick={() => setOpenPanel('ri_matter')} className="px-2.5 py-1 text-[10px] font-medium bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors">
          RI Matters
        </button>
        <div className="flex-1" />
        {!isPreStart && (
          <>
            <button
              onClick={() => {
                if (showAuditPlan) return;
                setShowAuditPlan(true);
                setShowCompletion(false);
                if (!planCreated) {
                  setPlanCreated(true);
                  fetch(`/api/engagements/${engagement.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ planCreated: true }),
                  }).catch(() => {});
                }
              }}
              disabled={showAuditPlan}
              className={`px-3 py-1 text-[10px] font-medium rounded transition-colors ${
                showAuditPlan
                  ? 'bg-slate-200 text-slate-400 cursor-default'
                  : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              <svg className="h-3 w-3 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Audit Plan
            </button>
            <button
              onClick={() => {
                if (!planCreated || showCompletion) return;
                setShowCompletion(true);
                setShowAuditPlan(false);
              }}
              disabled={!planCreated || showCompletion}
              className={`px-3 py-1 text-[10px] font-medium rounded transition-colors ${
                !planCreated || showCompletion
                  ? 'bg-slate-200 text-slate-400 cursor-default'
                  : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
              }`}
              title={!planCreated ? 'Open Audit Plan first' : ''}
            >
              Completion
            </button>
          </>
        )}
      </div>

      {/* Panel modals */}
      {openPanel === 'review_point' && (
        <ReviewPointsPanel engagementId={engagement.id} userId={currentUserId} onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === 'management' && (
        <ManagementPointPanel engagementId={engagement.id} pointType="management" title="Management Letter Points" onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === 'representation' && (
        <ManagementPointPanel engagementId={engagement.id} pointType="representation" title="Representation Letter Points" onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === 'ri_matter' && (
        <RIMattersPanel engagementId={engagement.id} userId={currentUserId} onClose={() => setOpenPanel(null)} />
      )}

      {/* When Completion is open: split layout with vertical sidebar (left) + completion tabs (right) */}
      {showCompletion ? (
        <div className="flex border border-t-0 border-slate-200 rounded-b-lg bg-white min-h-[500px] overflow-hidden">
          {/* Left sidebar: audit plan tabs (collapsed) */}
          <div className="w-28 flex-shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
            {visibleTabs.map(tab => {
              const label = tab.key === 'continuance' ? continuanceLabel : tab.label;
              const tso = tabSignOffs[tab.key];
              return (
                <button
                  key={tab.key}
                  onClick={() => { switchTab(tab.key); setShowCompletion(false); }}
                  className="w-full text-left px-2 py-2 text-[10px] font-medium border-b border-slate-200 transition-colors flex items-center gap-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {label}
                  {tab.key in SIGNOFF_TABS && (
                    <span className="inline-flex items-center gap-0.5 ml-auto">
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.reviewer === 'signed' ? 'bg-green-500' : tso?.reviewer === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} />
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.partner === 'signed' ? 'bg-green-500' : tso?.partner === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} />
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => { setShowAuditPlan(true); setShowCompletion(false); }}
              className="w-full text-left px-2 py-2 text-[10px] font-medium border-b border-slate-200 text-blue-600 hover:bg-blue-50"
            >
              Audit Plan
            </button>
          </div>
          {/* Main area: Completion Panel */}
          <div className="flex-1 flex flex-col min-h-0">
            <CompletionPanel
              engagementId={engagement.id}
              clientId={engagement.clientId}
              userRole={teamMembers.find(m => m.userId === currentUserId)?.role}
              userId={currentUserId}
              onClose={() => setShowCompletion(false)}
            />
          </div>
        </div>
      ) : showAuditPlan ? (
        <div className="flex border border-t-0 border-slate-200 rounded-b-lg bg-white min-h-[500px] overflow-hidden">
          {/* Left sidebar: all tabs as vertical list — no tab highlighted while on Audit Plan */}
          <div className="w-28 flex-shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
            {visibleTabs.map(tab => {
              const label = tab.key === 'continuance' ? continuanceLabel : tab.label;
              const tso = tabSignOffs[tab.key];
              return (
                <button
                  key={tab.key}
                  onClick={() => { switchTab(tab.key); setShowAuditPlan(false); }}
                  className="w-full text-left px-2 py-2 text-[10px] font-medium border-b border-slate-200 transition-colors flex items-center gap-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {label}
                  {tab.key in SIGNOFF_TABS && (
                    <span className="inline-flex items-center gap-0.5 ml-auto">
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.reviewer === 'signed' ? 'bg-green-500' : tso?.reviewer === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} />
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.partner === 'signed' ? 'bg-green-500' : tso?.partner === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} />
                    </span>
                  )}
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
          <div className="flex-1 min-w-0 p-4 overflow-auto">
            <TabErrorBoundary tabName="Audit Plan" engagementId={engagement.id}>
              <AuditPlanPanel engagementId={engagement.id} clientId={engagement.clientId} periodId={engagement.periodId} onClose={() => setShowAuditPlan(false)} periodEndDate={periodEndDate} periodStartDate={periodStartDate} />
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
                const tso = tabSignOffs[tab.key];
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
                    {tab.key in SIGNOFF_TABS && (
                      <span className="inline-flex items-center gap-0.5 ml-0.5">
                        {/* Reviewer dot */}
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tso?.reviewer === 'signed' ? 'bg-green-500' :
                            tso?.reviewer === 'stale' ? 'border border-green-500 bg-transparent' :
                            'border border-slate-300 bg-transparent'
                          }`}
                          title={`Reviewer: ${tso?.reviewer === 'signed' ? 'Complete' : tso?.reviewer === 'stale' ? 'Partial (stale)' : 'Not signed'}`}
                        />
                        {/* RI dot */}
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tso?.partner === 'signed' ? 'bg-green-500' :
                            tso?.partner === 'stale' ? 'border border-green-500 bg-transparent' :
                            'border border-slate-300 bg-transparent'
                          }`}
                          title={`RI: ${tso?.partner === 'signed' ? 'Complete' : tso?.partner === 'stale' ? 'Partial (stale)' : 'Not signed'}`}
                        />
                      </span>
                    )}
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
              headerActions={undefined}
            >
              <TabErrorBoundary tabName={signOffTitle} engagementId={engagement.id}>{renderTabContent()}</TabErrorBoundary>
            </SignOffHeader>
          ) : (
            <TabErrorBoundary tabName={activeTab} engagementId={engagement.id}>{renderTabContent()}</TabErrorBoundary>
          )}

          {/* Start Audit button — only shown on Opening tab when engagement is pre_start */}
          {isPreStart && activeTab === 'opening' && (() => {
            // Validation checks
            const hasRI = engagement.teamMembers.some(m => m.role === 'RI' || m.role === 'Partner');
            const hasEthicsSpecialist = (engagement.specialists || []).some(s => s.specialistType === 'EthicsPartner' || s.specialistType === 'Ethics');
            const hasTechnicalSpecialist = (engagement.specialists || []).some(s => s.specialistType === 'TechnicalAdvisor' || s.specialistType === 'Technical');
            const hasClientContact = (engagement.contacts || []).some(c => c.email?.trim()) || (engagement as any).portalTeam?.length > 0;
            const checks = [
              { ok: hasRI, label: 'RI / Partner assigned to team', required: true },
              { ok: hasEthicsSpecialist, label: 'Ethics Specialist assigned', required: false },
              { ok: hasTechnicalSpecialist, label: 'Technical Specialist assigned', required: false },
              { ok: hasClientContact, label: 'Client contact available', required: false },
            ];
            const allPassed = checks.filter(c => c.required).every(c => c.ok);
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
