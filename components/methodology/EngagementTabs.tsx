'use client';

import { useState, useEffect, useCallback, useRef, Component, Fragment, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AuditType } from '@/types/methodology';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import { SignOffHeader } from './SignOffHeader';
import { ScheduleSpecialistReviewsPanel } from './ScheduleSpecialistReviewsPanel';
import { PermanentFileTab } from './tabs/PermanentFileTab';
import { EthicsTab } from './tabs/EthicsTab';
import { ContinuanceTab } from './tabs/ContinuanceTab';
import { SubsequentEventsTab } from './tabs/SubsequentEventsTab';
import { NewClientTab } from './tabs/NewClientTab';
import { TaxTechnicalTab } from './tabs/TaxTechnicalTab';
import { SpecialistsTab } from './tabs/SpecialistsTab';
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
import { TabDocumentsFooter } from './panels/TabDocumentsFooter';
import { SpecialistRequestsPanel } from './panels/SpecialistRequestsPanel';
import {
  buildVisibilityChecker,
  collectQAScheduleKeys,
  aiFuzzyCacheKey,
  type Trigger,
  type TriggerContext,
} from '@/lib/schedule-triggers';
import { setCurrentLocation, subscribeNav } from '@/lib/engagement-nav';

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
  // Tab key kept as 'tax-technical' for back-compat with existing
  // PF sections + sign-off entries; the user-facing label is
  // "Specialists" and the body renders SpecialistsTab.
  { key: 'tax-technical', label: 'Specialists' },
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
  // Walkthroughs stores its overall sign-off in the
  // walkthrough_overall_signoffs PF section (see TAB_SIGNOFF_PF_SECTIONS
  // below). The tab-label dots only render when the tab key is in
  // this map — without this entry the dots Walkthroughs writes go
  // unread on the tab bar.
  'walkthroughs': 'Walkthroughs',
  'tax-technical': 'Specialists',
  'communication': 'Communication',
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

// Tabs whose tab-bar dots should reflect a per-engagement
// permanent-file section instead of the standard ${ep}?meta=signoffs
// endpoint. Use this for tabs that store overall sign-off in their
// own PF section. The data shape is
//   { reviewer?: { at | timestamp }, partner?: {...}, ri?: {...} }
// where 'ri' aliases 'partner' for legacy data.
const TAB_SIGNOFF_PF_SECTIONS: Record<string, string> = {
  // Sub-process and per-step sign-offs already live in PF sections of
  // their own; the OVERALL sign-off lives in this section and is
  // what the tab-bar dot should reflect.
  walkthroughs: 'walkthrough_overall_signoffs',
  // Tax Technical / Specialists no longer uses the simple
  // PF-section loader — it has a partial / hollow / solid
  // aggregate that needs custom translation, see the custom
  // loader below.
};

// Tabs whose tab-bar dots come from a tab-specific endpoint that
// doesn't fit either of the standard shapes. Each entry returns a
// fully-formed TabSignOffStatus or null if it can't be determined.
// Used by Communication today; future tabs with bespoke overall
// sign-off plumbing land here too.
const TAB_SIGNOFF_CUSTOM_LOADERS: Record<string, (engagementId: string) => Promise<TabSignOffStatus | null>> = {
  // Specialists tab — reads the aggregate {reviewer, ri} states
  // SpecialistsTab writes to the tax_technical_overall_signoffs
  // section. The aggregate is one of 'all' | 'some' | 'none' per
  // role; we map that to signed / stale / none for the tab strip.
  // Reviewer cascades to Preparer (Preparer slot reads the same).
  'tax-technical': async (engagementId) => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/permanent-file?section=tax_technical_overall_signoffs`);
      if (!res.ok) return null;
      const json = await res.json();
      const data = (json?.data || {}) as { reviewer?: any; ri?: any; partial?: boolean };
      function translate(value: any): 'none' | 'signed' | 'stale' {
        if (value === 'all') return 'signed';
        if (value === 'some') return 'stale';
        return 'none';
      }
      // If the section was written by the legacy TaxTechnicalTab
      // (object-with-{at} shape) rather than the new aggregate
      // string shape, fall back to the simple "any sign-off →
      // signed" rule so old data still lights the dots.
      const reviewer = typeof data.reviewer === 'string' ? translate(data.reviewer)
        : (data.reviewer?.at || data.reviewer?.timestamp ? 'signed' : 'none');
      const ri = typeof data.ri === 'string' ? translate(data.ri)
        : (data.ri?.at || data.ri?.timestamp ? 'signed' : 'none');
      return {
        preparer: reviewer !== 'none' || ri !== 'none' ? 'signed' : 'none',
        reviewer,
        partner: ri,
      };
    } catch { return null; }
  },
  communication: async (engagementId) => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/communication`);
      if (!res.ok) return null;
      const data = await res.json();
      // signOffs.overall holds the tab-level sign-off; sub-section
      // sign-offs live under the section keys (board-minutes etc.)
      // and are aggregated for show in the tab body itself.
      const overall = data?.signOffs?.overall || {};
      const preparerSigned = !!(overall?.preparer?.timestamp || overall?.preparer?.at || overall?.operator?.timestamp || overall?.operator?.at);
      const reviewerSigned = !!(overall?.reviewer?.timestamp || overall?.reviewer?.at);
      const riSigned = !!(overall?.ri?.timestamp || overall?.ri?.at);
      // Cascade rule: each senior role implies the slots below it
      // are effectively signed (RI → Reviewer, Preparer; Reviewer
      // → Preparer). This is what the user sees on the tab strip.
      return {
        preparer: preparerSigned || reviewerSigned || riSigned ? 'signed' : 'none',
        reviewer: reviewerSigned || riSigned ? 'signed' : 'none',
        partner: riSigned ? 'signed' : 'none',
      };
    } catch { return null; }
  },
};

// Map tab key → schedule config key (used in audit type → schedule mapping).
//
// Every tab declared in TABS must also have an entry here — otherwise it's
// invisible to the admin configurator's order and drops to the end of the
// tab bar regardless of where the admin placed it. Added walkthroughs /
// outstanding / communication 2026-04-22 after a debug overlay revealed
// they were silently failing every indexOf lookup.
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
  'walkthroughs': 'walkthroughs',
  'documents': 'documents',
  'outstanding': 'outstanding',
  'portal': 'portal',
  'communication': 'communication',
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

// Sign-off status for tab-level dots. The tab strip renders three
// dots — Preparer / Reviewer / RI — so the senior reviewer can
// scan progress across every tab without opening each one. Each
// slot carries 'none' (not yet signed), 'signed' (current as of
// the last edit) or 'stale' (signed, but a field has been edited
// since — only detectable on tabs that expose fieldMeta).
interface TabSignOffStatus {
  preparer: 'none' | 'signed' | 'stale';
  reviewer: 'none' | 'signed' | 'stale';
  partner: 'none' | 'signed' | 'stale';
}

// ─── Horizontal tab strip with overflow-aware affordances ──────────
//
// The default <div className="overflow-x-auto"> wrapper hides extra
// tabs behind the right edge with no visual cue, and the auditor
// reported missing the planning tabs that scrolled off-screen. This
// component wraps the strip with:
//   - Left/right fade gradients that appear only when there's
//     content to scroll in that direction.
//   - Chevron buttons in those gradient zones — one click scrolls
//     ~80% of the visible width, so the user reaches the off-screen
//     tabs without fiddling with the scrollbar or shift-wheel.
//   - Per-tab Preparer + Reviewer + RI dots so the senior reviewer
//     can scan progress at a glance (was Reviewer + RI only).
function TabStrip({
  visibleTabs,
  activeTab,
  tabSignOffs,
  switchTab,
  continuanceLabel,
  outstandingTeamCount,
  outstandingClientCount,
}: {
  visibleTabs: { key: string; label: string }[];
  activeTab: string;
  tabSignOffs: Record<string, TabSignOffStatus>;
  switchTab: (key: string) => void;
  continuanceLabel: string;
  outstandingTeamCount: number;
  outstandingClientCount: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Recompute which directions can be scrolled. Runs on mount, on
  // window resize, on user scroll, and whenever the tab list itself
  // changes (e.g. schedule visibility filters flipping a tab on or
  // off). 1px tolerance avoids fade flicker on sub-pixel rounding.
  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    recompute();
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => recompute();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', recompute);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', recompute);
    };
  }, [recompute, visibleTabs.length]);

  // Auto-scroll the active tab into view when it changes — useful
  // when a deep link lands the user on a tab that's currently
  // off-screen.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeBtn = el.querySelector<HTMLElement>(`[data-tabkey="${activeTab}"]`);
    if (activeBtn) {
      const elRect = el.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      if (btnRect.left < elRect.left || btnRect.right > elRect.right) {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeTab]);

  function scrollBy(direction: 'left' | 'right') {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.8) * (direction === 'left' ? -1 : 1);
    el.scrollBy({ left: amount, behavior: 'smooth' });
  }

  return (
    <div className="relative border-x border-slate-200 bg-white">
      <div ref={scrollRef} data-howto-id="eng.tab-strip" className="overflow-x-auto scroll-smooth">
        <nav className="flex -mb-px" aria-label="Engagement tabs">
          {visibleTabs.map(tab => {
            const isActive = activeTab === tab.key;
            const label = tab.key === 'continuance' ? continuanceLabel : tab.label;
            const tso = tabSignOffs[tab.key];
            return (
              <button
                key={tab.key}
                data-tabkey={tab.key}
                onClick={() => switchTab(tab.key)}
                data-howto-id={`eng.tab.${tab.key}`}
                className={`whitespace-nowrap py-2.5 px-4 border-b-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {label}
                {tab.key in SIGNOFF_TABS && (
                  <span className="inline-flex items-center gap-0.5 ml-0.5">
                    {/* Preparer · Reviewer · RI — green when signed,
                        green ring when stale (signed but content
                        edited since), slate ring when unsigned. */}
                    <span
                      className={`w-2 h-2 rounded-full ${
                        tso?.preparer === 'signed' ? 'bg-green-500' :
                        tso?.preparer === 'stale' ? 'border border-green-500 bg-transparent' :
                        'border border-slate-300 bg-transparent'
                      }`}
                      title={`Preparer: ${tso?.preparer === 'signed' ? 'Complete' : tso?.preparer === 'stale' ? 'Partial (stale)' : 'Not signed'}`}
                    />
                    <span
                      className={`w-2 h-2 rounded-full ${
                        tso?.reviewer === 'signed' ? 'bg-green-500' :
                        tso?.reviewer === 'stale' ? 'border border-green-500 bg-transparent' :
                        'border border-slate-300 bg-transparent'
                      }`}
                      title={`Reviewer: ${tso?.reviewer === 'signed' ? 'Complete' : tso?.reviewer === 'stale' ? 'Partial (stale)' : 'Not signed'}`}
                    />
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
      {/* Left edge fade + scroll button — only render when there's
          actually content to the left. pointer-events-none on the
          gradient layer lets clicks pass through to the tabs
          underneath; the chevron has its own pointer-events-auto. */}
      {canScrollLeft && (
        <div className="absolute inset-y-0 left-0 w-12 pointer-events-none flex items-center bg-gradient-to-r from-white via-white/85 to-transparent">
          <button
            onClick={() => scrollBy('left')}
            className="pointer-events-auto ml-1 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-700 hover:border-slate-300"
            aria-label="Scroll tabs left"
            title="Scroll tabs left"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {canScrollRight && (
        <div className="absolute inset-y-0 right-0 w-12 pointer-events-none flex items-center justify-end bg-gradient-to-l from-white via-white/85 to-transparent">
          <button
            onClick={() => scrollBy('right')}
            className="pointer-events-auto mr-1 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-700 hover:border-slate-300"
            aria-label="More tabs to the right"
            title="More tabs to the right"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function EngagementTabs({ engagement, auditType, clientName, periodEndDate, periodStartDate, currentUserId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Restore last page for this engagement. When the engagement is still in
  // pre_start we FORCE the Opening tab — the Start Audit button only renders
  // on Opening and we'd otherwise hide it behind a stale saved tab from a
  // previous session.
  const storageKey = `lastPage:${engagement.id}`;
  const urlTab = searchParams.get('tab') as TabKey | null;
  const savedState = typeof window !== 'undefined' ? (() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } })() : {};
  const isPreStartInitial = engagement.status === 'pre_start';
  const initialTab = isPreStartInitial ? 'opening' : (urlTab || savedState.tab || 'opening');
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [tbShowCategory, setTbShowCategory] = useState(true);
  // Debug-overlay enable flag. Read from ?debug=... URL param AND
  // localStorage on mount — either path activates the tab-order
  // diagnostic. Kept as state so React re-renders once the client-
  // side hydration has resolved the source of truth; the SSR pass
  // starts with `false` and gets upgraded in the effect below.
  const [debugTabsEnabled, setDebugTabsEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const viaUrl = !!new URL(window.location.href).searchParams.get('debug');
      const viaStorage = window.localStorage.getItem('acumon-debug-tabs') === '1';
      setDebugTabsEnabled(viaUrl || viaStorage);
    } catch { /* ignore */ }
  }, []);
  const [showAuditPlan, setShowAuditPlan] = useState(!!savedState.auditPlan);
  const [showCompletion, setShowCompletion] = useState(!!savedState.completion);
  const [tabSignOffs, setTabSignOffs] = useState<Record<string, TabSignOffStatus>>({});
  // Last Completion sub-tab the user was on. Used by the "Back to
  // Completion: <X>" return affordance after they divert into a
  // Planning / Fieldwork / Audit Plan tab from the Completion sidebar.
  // Null when the user has never opened Completion this session.
  const [lastCompletionTab, setLastCompletionTab] = useState<{ key: string; label: string } | null>(
    savedState.lastCompletionTab && typeof savedState.lastCompletionTab === 'object'
      ? savedState.lastCompletionTab as { key: string; label: string }
      : null
  );
  // Audit Plan deep-link target — set when the user clicks an AP
  // shortcut in the Completion sidebar. Cleared once consumed.
  const [auditPlanTarget, setAuditPlanTarget] = useState<{ statement?: string; level?: string; otherTab?: string } | null>(null);
  // FS hierarchy fetched once, used by the Completion sidebar to
  // render FS Level shortcuts indented under each Statement. Loaded
  // lazily on first entry into Completion to avoid an extra
  // round-trip on engagements that never open the section.
  const [fsLevelsByStatement, setFsLevelsByStatement] = useState<Record<string, string[]>>({});
  const [fsLevelsLoaded, setFsLevelsLoaded] = useState(false);
  // Per-statement expand/collapse state for the FS Level shortcut
  // tree. Defaults to all collapsed so the sidebar stays compact;
  // clicking the chevron next to a statement reveals its levels.
  const [expandedSidebarStatements, setExpandedSidebarStatements] = useState<Set<string>>(new Set());
  // Which audit stage the Completion sidebar is currently filtering by
  // (Planning vs Fieldwork). Defaults to Fieldwork because that's where
  // the Audit Plan and most fieldwork tabs live.
  const [completionSidebarStage, setCompletionSidebarStage] = useState<'planning' | 'fieldwork'>('fieldwork');

  // Persist last page to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          tab: activeTab,
          auditPlan: showAuditPlan,
          completion: showCompletion,
          lastCompletionTab,
        }),
      );
    } catch {}
  }, [activeTab, showAuditPlan, showCompletion, lastCompletionTab, storageKey]);

  // Lazy-load the firm's FS hierarchy the first time the user opens
  // the Completion section. Used to render FS Level shortcuts
  // indented under each Statement in the sidebar.
  useEffect(() => {
    if (!showCompletion || fsLevelsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagement.id}/fs-hierarchy`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const grouped: Record<string, string[]> = {};
        const seen = new Set<string>();
        for (const lvl of (Array.isArray(data?.levels) ? data.levels : [])) {
          const stmt = (lvl?.statement || '').trim();
          const name = (lvl?.name || '').trim();
          if (!stmt || !name) continue;
          const key = `${stmt}::${name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!grouped[stmt]) grouped[stmt] = [];
          grouped[stmt].push(name);
        }
        if (!cancelled) {
          setFsLevelsByStatement(grouped);
          setFsLevelsLoaded(true);
        }
      } catch {
        if (!cancelled) setFsLevelsLoaded(true); // give up silently
      }
    })();
    return () => { cancelled = true; };
  }, [showCompletion, fsLevelsLoaded, engagement.id]);

  function toggleSidebarStatement(stmt: string) {
    setExpandedSidebarStatements(prev => {
      const next = new Set(prev);
      if (next.has(stmt)) next.delete(stmt); else next.add(stmt);
      return next;
    });
  }
  const [planCreated, setPlanCreated] = useState(false);

  // Check if plan was previously created
  useEffect(() => {
    fetch(`/api/engagements/${engagement.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.engagement?.planCreated) setPlanCreated(true); })
      .catch(() => {});
  }, [engagement.id]);
  const [enabledSchedules, setEnabledSchedules] = useState<Set<string> | null>(null); // null = loading/all enabled
  const [scheduleOrder, setScheduleOrder] = useState<string[] | null>(null); // ordered schedule keys from config
  // Triggers for visibility evaluation (new trigger-based model)
  const [scheduleTriggers, setScheduleTriggers] = useState<Trigger[]>([]);
  const [stageKeyedMapping, setStageKeyedMapping] = useState<{ planning: string[]; fieldwork: string[]; completion: string[] } | null>(null);
  // Answers fetched for Q&A trigger sources, keyed by scheduleKey → questionId → answer
  const [qaAnswers, setQaAnswers] = useState<Record<string, Record<string, string>>>({});
  // Pre-computed AI fuzzy-match results for Q&A triggers with useAIFuzzyMatch enabled
  const [aiFuzzyCache, setAiFuzzyCache] = useState<Record<string, boolean>>({});
  const [outstandingTeamCount, setOutstandingTeamCount] = useState(0);
  const [outstandingClientCount, setOutstandingClientCount] = useState(0);
  const handleOutstandingCounts = useCallback((team: number, client: number) => {
    setOutstandingTeamCount(team);
    setOutstandingClientCount(client);
  }, []);
  const [engStatus, setEngStatus] = useState(engagement.status);
  const [starting, setStarting] = useState(false);
  const [openPanel, setOpenPanel] = useState<'review_point' | 'representation' | 'management' | 'ri_matter' | null>(null);

  // RI Matters / Review Points / Management / Representation count
  // badges. Outstanding = new+open; closed = closed/committed/
  // cancelled. Refetched on mount and whenever the corresponding
  // panel closes so a new item or a status change shows up immediately.
  // One state object per pointType so each badge updates independently.
  const [riCounts, setRiCounts] = useState<{ outstanding: number; closed: number } | null>(null);
  const [reviewCounts, setReviewCounts] = useState<{ outstanding: number; closed: number } | null>(null);
  const [mgtCounts, setMgtCounts] = useState<{ outstanding: number; closed: number } | null>(null);
  const [repCounts, setRepCounts] = useState<{ outstanding: number; closed: number } | null>(null);
  const fetchPointCounts = useCallback(async (pointType: 'ri_matter' | 'review_point' | 'management' | 'representation') => {
    try {
      const res = await fetch(`/api/engagements/${engagement.id}/audit-points?type=${pointType}`);
      if (!res.ok) return null;
      const data = await res.json();
      const list: any[] = Array.isArray(data?.points) ? data.points : [];
      let outstanding = 0;
      let closed = 0;
      for (const p of list) {
        if (p.status === 'closed' || p.status === 'committed' || p.status === 'cancelled') closed++;
        else outstanding++;
      }
      return { outstanding, closed };
    } catch { return null; }
  }, [engagement.id]);
  const refreshRiCounts = useCallback(async () => {
    const next = await fetchPointCounts('ri_matter');
    if (next) setRiCounts(next);
  }, [fetchPointCounts]);
  const refreshReviewCounts = useCallback(async () => {
    const next = await fetchPointCounts('review_point');
    if (next) setReviewCounts(next);
  }, [fetchPointCounts]);
  const refreshMgtCounts = useCallback(async () => {
    const next = await fetchPointCounts('management');
    if (next) setMgtCounts(next);
  }, [fetchPointCounts]);
  const refreshRepCounts = useCallback(async () => {
    const next = await fetchPointCounts('representation');
    if (next) setRepCounts(next);
  }, [fetchPointCounts]);
  useEffect(() => {
    void refreshRiCounts(); void refreshReviewCounts();
    void refreshMgtCounts(); void refreshRepCounts();
  }, [refreshRiCounts, refreshReviewCounts, refreshMgtCounts, refreshRepCounts]);

  const isPreStart = engStatus === 'pre_start';
  const [isNewClient, setIsNewClient] = useState<boolean | null>(engagement.isNewClient ?? null);

  // Keep local state in sync when the engagement prop changes (e.g. when the
  // user flips the First-year / Continuance / Auto toggle on the Opening tab —
  // updateSetting() POSTs the change and the parent re-renders with the new
  // engagement object).
  useEffect(() => {
    setIsNewClient(engagement.isNewClient ?? null);
  }, [engagement.isNewClient]);

  // Auto-detect new client: check if prior engagement exists for same client.
  // Only runs when the manual override is null (Auto-detect mode).
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
        // Tell the IndependenceGate to re-check the server. Starting the
        // audit seeds an outstanding independence row for the user who
        // clicks Start (and every team member), and the gate's initial
        // fetch ran when status was still pre_start so it decided the
        // gate wasn't required. This event triggers a fresh fetch so the
        // popup appears immediately without a page reload.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('independence:refetch'));
        }
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
    await Promise.all([
      // Standard pattern — tab has a dedicated endpoint exposing
      // ?meta=signoffs returning { signOffs: { reviewer/partner }, fieldMeta }.
      ...Object.entries(TAB_ENDPOINTS).map(async ([tabKey, ep]) => {
        try {
          const res = await fetch(`/api/engagements/${engagement.id}/${ep}?meta=signoffs`);
          if (!res.ok) return;
          const json = await res.json();
          const so = json.signOffs || {};
          const meta: Record<string, { lastEditedAt?: string }> = json.fieldMeta || {};

          function isStaleByTimestamp(ts: string | undefined): boolean {
            if (!ts) return false;
            const signTime = new Date(ts).getTime();
            return Object.values(meta).some(m => m.lastEditedAt && new Date(m.lastEditedAt).getTime() > signTime);
          }

          // Cascade rules:
          //   Partner signed  → Reviewer effective AND Preparer effective
          //   Reviewer signed → Preparer effective
          // i.e. the senior role's sign-off implies all junior slots
          // are also "covered" so the tab-bar dots tell the truth at
          // a glance: a green RI dot means the whole tab is good.
          // Staleness is tested against the timestamp that drove the
          // effective state.
          const preparerTs = so.operator?.timestamp || so.preparer?.timestamp || so.reviewer?.timestamp || so.partner?.timestamp;
          const reviewerTs = so.reviewer?.timestamp || so.partner?.timestamp;
          const partnerTs = so.partner?.timestamp;
          statuses[tabKey] = {
            preparer: preparerTs ? (isStaleByTimestamp(preparerTs) ? 'stale' : 'signed') : 'none',
            reviewer: reviewerTs ? (isStaleByTimestamp(reviewerTs) ? 'stale' : 'signed') : 'none',
            partner: partnerTs ? (isStaleByTimestamp(partnerTs) ? 'stale' : 'signed') : 'none',
          };
        } catch { /* ignore */ }
      }),
      // PF-section pattern — tabs that store their OVERALL sign-off
      // inside an AuditPermanentFile section keyed by sectionKey.
      // Walkthroughs uses this; the data shape is
      //   { reviewer?: { at }, partner?: { at }, ri?: { at } }
      // where 'ri' is the legacy alias for 'partner'. No fieldMeta
      // is available so staleness can't be detected here — a sign-
      // off lands as 'signed' until cleared.
      ...Object.entries(TAB_SIGNOFF_PF_SECTIONS).map(async ([tabKey, section]) => {
        try {
          const res = await fetch(`/api/engagements/${engagement.id}/permanent-file?section=${encodeURIComponent(section)}`);
          if (!res.ok) return;
          const json = await res.json();
          const so = (json?.data || {}) as { preparer?: { at?: string; timestamp?: string }; reviewer?: { at?: string; timestamp?: string }; partner?: { at?: string; timestamp?: string }; ri?: { at?: string; timestamp?: string } };
          const preparerTs = so.preparer?.at || so.preparer?.timestamp || so.reviewer?.at || so.reviewer?.timestamp || so.partner?.at || so.partner?.timestamp || so.ri?.at || so.ri?.timestamp;
          const reviewerTs = so.reviewer?.at || so.reviewer?.timestamp || so.partner?.at || so.partner?.timestamp || so.ri?.at || so.ri?.timestamp;
          const partnerTs = so.partner?.at || so.partner?.timestamp || so.ri?.at || so.ri?.timestamp;
          statuses[tabKey] = {
            preparer: preparerTs ? 'signed' : 'none',
            reviewer: reviewerTs ? 'signed' : 'none',
            partner: partnerTs ? 'signed' : 'none',
          };
        } catch { /* ignore */ }
      }),
      // Custom-loader pattern — tabs whose overall sign-off comes
      // from a bespoke endpoint that doesn't fit either standard
      // shape. Communication uses this today.
      ...Object.entries(TAB_SIGNOFF_CUSTOM_LOADERS).map(async ([tabKey, loader]) => {
        try {
          const result = await loader(engagement.id);
          if (result) statuses[tabKey] = result;
        } catch { /* ignore */ }
      }),
    ]);
    setTabSignOffs(statuses);
  }, [engagement.id]);

  useEffect(() => { loadTabSignOffs(); }, [loadTabSignOffs]);

  // Re-fetch tab sign-offs when switching tabs (to pick up changes made inside SignOffHeader)
  useEffect(() => { loadTabSignOffs(); }, [activeTab, loadTabSignOffs]);

  // Cross-tab sign-off refresh — listens for custom events that
  // child tabs dispatch when they mutate their sign-off state. This
  // keeps the tab-bar dots in sync without each tab needing to know
  // about EngagementTabs internals.
  useEffect(() => {
    const handler = () => { void loadTabSignOffs(); };
    window.addEventListener('engagement:signoffs-changed', handler);
    return () => window.removeEventListener('engagement:signoffs-changed', handler);
  }, [loadTabSignOffs]);

  /**
   * Apply a fresh SignOffs payload (as returned by the tab's POST endpoint)
   * to the tab-label dot state immediately, without waiting for the next
   * loadTabSignOffs() round-trip. Called by SignOffHeader via its
   * `onSignOffChange` callback whenever the user clicks a main dot.
   *
   * We can't re-use the stale detection from loadTabSignOffs here because
   * the server response only contains the sign-off payload, not fieldMeta
   * — but a sign-off that was just made is by definition fresh, so marking
   * reviewer/partner as 'signed' (or 'none' after unsign) is correct.
   */
  const handleTabSignOffChange = useCallback((tabKey: string, signOffs: { operator?: { timestamp?: string } | null; preparer?: { timestamp?: string } | null; reviewer?: { timestamp?: string } | null; partner?: { timestamp?: string } | null }) => {
    // Cascade: Partner signed → Reviewer + Preparer effective.
    //          Reviewer signed → Preparer effective.
    const preparerEffective = !!(signOffs.operator?.timestamp || signOffs.preparer?.timestamp || signOffs.reviewer?.timestamp || signOffs.partner?.timestamp);
    const reviewerEffective = !!(signOffs.reviewer?.timestamp || signOffs.partner?.timestamp);
    const partnerSigned = !!signOffs.partner?.timestamp;
    setTabSignOffs(prev => ({
      ...prev,
      [tabKey]: {
        preparer: preparerEffective ? 'signed' : 'none',
        reviewer: reviewerEffective ? 'signed' : 'none',
        partner: partnerSigned ? 'signed' : 'none',
      },
    }));
  }, []);

  // Fetch (audit type, framework) → schedule mapping (order + stage-keyed
  // shape + triggers). The composite key `<auditType>::<framework>` is
  // tried first so each pair can carry its own list. If the firm hasn't
  // configured the engagement's framework, we fall back to the bare
  // auditType key so legacy data still resolves during the migration
  // window.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/methodology-admin/audit-type-schedules');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const fw = engagement.framework || 'FRS102';
        const compositeKey = `${auditType}::${fw}`;
        const lookupKeys = [compositeKey, auditType];
        const orderedKeys = lookupKeys
          .map(k => (data?.mappings as Record<string, string[]> | undefined)?.[k])
          .find(v => Array.isArray(v) && v.length > 0) as string[] | undefined;

        if (orderedKeys) {
          setEnabledSchedules(new Set(orderedKeys));
          setScheduleOrder(orderedKeys);
          // eslint-disable-next-line no-console
          console.debug('[EngagementTabs] scheduleOrder for', compositeKey, ':', orderedKeys);
        } else {
          // eslint-disable-next-line no-console
          console.debug('[EngagementTabs] no scheduleOrder mapping for', compositeKey, '— full response:', data);
        }

        const sk = lookupKeys
          .map(k => (data?.stageKeyedMappings as Record<string, any> | undefined)?.[k])
          .find(v => v);
        if (sk) {
          setStageKeyedMapping({ planning: sk.planning || [], fieldwork: sk.fieldwork || [], completion: sk.completion || [] });
          const triggers: Trigger[] = Array.isArray(sk.triggers) ? sk.triggers : [];
          setScheduleTriggers(triggers);

          // Fetch answers for any schedules referenced by Q&A triggers (bounded — one fetch per unique source)
          const qaSources = collectQAScheduleKeys(triggers);
          let answers: Record<string, Record<string, string>> = {};
          if (qaSources.length > 0) {
            await Promise.all(qaSources.map(async (scheduleKey) => {
              try {
                const r = await fetch(`/api/engagements/${engagement.id}/permanent-file?section=${scheduleKey}`);
                if (!r.ok) return;
                const j = await r.json();
                const saved = j.answers?.[scheduleKey] || j.data?.[scheduleKey] || {};
                const a = saved.answers || saved;
                if (a && typeof a === 'object') {
                  // Flatten to questionId → answer (strip any _col suffix from StructuredScheduleTab)
                  const flat: Record<string, string> = {};
                  for (const [k, v] of Object.entries(a)) {
                    // Strip _colN suffix so the admin can reference the logical questionId
                    const stripped = k.replace(/_col\d+$/, '');
                    if (v !== null && v !== undefined && v !== '') {
                      flat[stripped] = String(v);
                      flat[k] = String(v); // also keep exact key in case admin used it
                    }
                  }
                  answers[scheduleKey] = flat;
                }
              } catch { /* ignore */ }
            }));
            if (!cancelled) setQaAnswers(answers);
          }

          // Pre-compute AI fuzzy-match results for any Q&A triggers with useAIFuzzyMatch enabled
          // that don't already match exactly. Batched into a single API call.
          const pairs: Array<{ key: string; expected: string; actual: string }> = [];
          for (const t of triggers) {
            if (t.condition.kind !== 'questionAnswer') continue;
            if (!t.condition.useAIFuzzyMatch) continue;
            const actual = answers[t.condition.scheduleKey]?.[t.condition.questionId];
            if (!actual) continue;
            // Skip if exact match — no AI needed
            if (String(actual).trim().toLowerCase() === t.condition.expectedAnswer.trim().toLowerCase()) continue;
            pairs.push({
              key: aiFuzzyCacheKey(t.condition.questionId, t.condition.expectedAnswer, String(actual)),
              expected: t.condition.expectedAnswer,
              actual: String(actual),
            });
          }
          if (pairs.length > 0) {
            try {
              const r = await fetch('/api/ai/trigger-fuzzy-match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pairs: pairs.map(p => ({ expected: p.expected, actual: p.actual })) }),
              });
              if (r.ok) {
                const j = await r.json();
                const results: boolean[] = Array.isArray(j.results) ? j.results : [];
                const cache: Record<string, boolean> = {};
                for (let i = 0; i < pairs.length; i++) {
                  cache[pairs[i].key] = results[i] === true;
                }
                if (!cancelled) setAiFuzzyCache(prev => ({ ...prev, ...cache }));
              }
            } catch { /* ignore AI fuzzy failures — trigger simply won't fire */ }
          }
        }
      } catch {
        // Fail silently, show all tabs
      }
    })();
    return () => { cancelled = true; };
  }, [auditType, engagement.id, engagement.framework]);

  // ── Trigger-based visibility evaluation ──
  // Build the engagement context once per render, then compile a visibility checker
  // using the shared schedule-triggers helper. See lib/schedule-triggers.ts.
  const clientIsListed = !!(engagement as any).clientIsListed;
  const hasPriorPeriodEngagement = !!(engagement as any).hasPriorPeriodEngagement;
  const teamHasEQR = engagement.teamMembers.some(m => m.role === 'EQR');
  const triggerCtx: TriggerContext = {
    clientIsListed,
    hasPriorPeriodEngagement,
    teamHasEQR,
    answers: qaAnswers,
    aiFuzzyCache,
  };
  const scheduleConditionsPass = buildVisibilityChecker(scheduleTriggers, triggerCtx);

  // Collapse a schedule key to a comparable form so exact-spelling
  // variations don't break the enabled / order lookups. Same rule
  // the template resolver uses: lowercase + strip non-alphanumerics
  // + strip trailing 'questions'/'categories'. With this, TAB_TO_SCHEDULE's
  // `new_client_takeon_questions` matches the admin's
  // `new_client_take_on_questions` (or even `new-client-take-on`).
  const normaliseScheduleKey = (s: string | undefined) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .replace(/(questions|categories)$/, '');
  // Build a set of enabled-normalised keys once — avoids re-normalising
  // every entry on every filter iteration.
  const enabledNormalised = enabledSchedules
    ? new Set(Array.from(enabledSchedules).map(k => normaliseScheduleKey(k)))
    : null;
  // Positional map — scheduleKey (normalised) → index, so the sort
  // below is O(1) per comparison instead of O(n) indexOf scans.
  // `mappings[auditType]` on the server concatenates planning +
  // fieldwork + completion, so schedules that the admin configured
  // across multiple stages (portal / documents / outstanding) appear
  // more than once. Using `new Map([...entries])` keeps the LAST
  // occurrence, which dumps those tabs to the very end of the tab
  // bar (e.g. portal → idx=30 instead of the intended idx=12).
  // Fix: build the map manually and only set each normalised key on
  // its FIRST appearance — that reflects where the admin first
  // scheduled it in the workflow.
  const orderIndex: Map<string, number> | null = (() => {
    if (!scheduleOrder) return null;
    const m = new Map<string, number>();
    for (let i = 0; i < scheduleOrder.length; i++) {
      const nk = normaliseScheduleKey(scheduleOrder[i]);
      if (!m.has(nk)) m.set(nk, i);
    }
    return m;
  })();

  // Filter tabs based on engagement status, audit type schedule config, and continuance/new-client
  // Then sort by configured order
  const visibleTabs = TABS.filter(tab => {
    if (tab.key === 'opening') return true; // Opening always visible
    if (isPreStart) return false; // Only show Opening until audit is started

    // Continuance / New Client Take-On: show one or the other
    if (tab.key === 'continuance' && isNewClient === true) return false;
    if (tab.key === 'new-client' && isNewClient !== true) return false;

    if (!enabledNormalised) return true; // Not loaded yet or no config = show all
    const scheduleKey = TAB_TO_SCHEDULE[tab.key];
    if (!scheduleKey) return true;
    // Try exact match first (fast path), then normalised fallback —
    // handles firms whose audit-type-schedules config saved keys with
    // slightly different spellings than TAB_TO_SCHEDULE expects.
    if (!enabledSchedules!.has(scheduleKey) && !enabledNormalised.has(normaliseScheduleKey(scheduleKey))) {
      return false;
    }
    // Visibility conditions (Part G)
    return scheduleConditionsPass(scheduleKey);
  }).sort((a, b) => {
    if (!orderIndex) return 0; // No order config = keep hardcoded order
    if (a.key === 'opening') return -1; // Opening always first
    if (b.key === 'opening') return 1;
    const aKey = TAB_TO_SCHEDULE[a.key];
    const bKey = TAB_TO_SCHEDULE[b.key];
    // Normalised lookup so the admin's reordering DOES flow through
    // when their saved schedule keys aren't identical to TAB_TO_SCHEDULE
    // (e.g. extra underscore). Fall back to exact if normalisation
    // somehow collides — unlikely but cheap to be safe.
    const aIdx = aKey
      ? (orderIndex.get(normaliseScheduleKey(aKey)) ?? (scheduleOrder!.indexOf(aKey)))
      : -1;
    const bIdx = bKey
      ? (orderIndex.get(normaliseScheduleKey(bKey)) ?? (scheduleOrder!.indexOf(bKey)))
      : -1;
    // Tabs in config sort by their position; tabs not in config go to end
    if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    return 0;
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

  // Push the current top-level tab into the nav registry so anything
  // that opens over the page (e.g. RI Matters modal) can capture
  // "where was I" at the time. Sub-tab-aware tabs overwrite this with
  // their own location whenever their sub-tab changes.
  useEffect(() => {
    const tabLabel = TABS.find(t => t.key === activeTab)?.label ?? activeTab;
    setCurrentLocation({ tab: activeTab, label: tabLabel });
  }, [activeTab]);

  // Subscribe to navigateTo events from back-links elsewhere in the
  // app. Switching the top-level tab is enough at this layer; the sub-
  // tab (if any) is handled by the target tab's own subscription via
  // consumePendingNav on its mount.
  useEffect(() => {
    const unsub = subscribeNav((target) => {
      if (target.tab && target.tab !== activeTab) {
        switchTab(target.tab as TabKey);
      }
    });
    return unsub;
  }, [activeTab]);

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
        return (
          <PriorPeriodTab
            engagementId={engagement.id}
            teamMembers={teamMembers}
            clientName={clientName}
            periodEnd={periodEndDate ? String(periodEndDate).slice(0, 10) : undefined}
            auditTypeLabel={AUDIT_TYPE_LABELS[auditType]}
          />
        );
      case 'permanent-file':
        return <PermanentFileTab engagementId={engagement.id} />;
      case 'ethics':
        return <EthicsTab engagementId={engagement.id} />;
      case 'continuance':
        return <ContinuanceTab engagementId={engagement.id} />;
      case 'new-client':
        return <NewClientTab engagementId={engagement.id} />;
      case 'tb':
        return <TrialBalanceTab engagementId={engagement.id} isGroupAudit={engagement.isGroupAudit} showCategory={tbShowCategory} onShowCategoryChange={setTbShowCategory} periodEndDate={periodEndDate} periodStartDate={periodStartDate} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'materiality':
        return <MaterialityTab engagementId={engagement.id} currentUserId={currentUserId} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'par':
        return <PARTab engagementId={engagement.id} userId={currentUserId} userName={teamMembers.find(m => m.userId === currentUserId)?.userName} userRole={teamMembers.find(m => m.userId === currentUserId)?.role} />;
      case 'walkthroughs':
        return <WalkthroughsTab engagementId={engagement.id} userRole={String(teamMembers.find(m => m.userId === currentUserId)?.role || '')} />;
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
        return <CommunicationTab
          engagementId={engagement.id}
          clientId={engagement.clientId}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
        />;
      case 'tax-technical':
        // Tab key kept for back-compat; visible label is
        // "Specialists" and the body renders the new SpecialistsTab.
        return <SpecialistsTab
          engagementId={engagement.id}
          specialists={(engagement.specialists || []).map(s => ({
            id: s.id,
            specialistType: s.specialistType,
            name: s.name || '',
            email: s.email,
          }))}
          teamMembers={teamMembers as any}
          currentUserId={currentUserId}
          currentUserName={teamMembers.find(m => m.userId === currentUserId)?.userName || undefined}
        />;
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
        <button onClick={() => setOpenPanel('review_point')} data-howto-id="eng.action.add-review-point" className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors">
          Review Point
          {/* Mirror of the RI Matters dots: red = outstanding (new+open),
              green = closed. Both shown when > 0; hidden when zero so
              the button stays clean for empty engagements. */}
          {reviewCounts && reviewCounts.outstanding > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none">
              {reviewCounts.outstanding}
            </span>
          )}
          {reviewCounts && reviewCounts.closed > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-green-600 text-white text-[9px] font-bold leading-none">
              {reviewCounts.closed}
            </span>
          )}
        </button>
        <button onClick={() => setOpenPanel('representation')} data-howto-id="eng.action.add-representation-point" className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 transition-colors">
          Representation
          {repCounts && repCounts.outstanding > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none">
              {repCounts.outstanding}
            </span>
          )}
          {repCounts && repCounts.closed > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-green-600 text-white text-[9px] font-bold leading-none">
              {repCounts.closed}
            </span>
          )}
        </button>
        <button onClick={() => setOpenPanel('management')} data-howto-id="eng.action.add-management-point" className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 rounded hover:bg-orange-100 transition-colors">
          Management
          {mgtCounts && mgtCounts.outstanding > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none">
              {mgtCounts.outstanding}
            </span>
          )}
          {mgtCounts && mgtCounts.closed > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-green-600 text-white text-[9px] font-bold leading-none">
              {mgtCounts.closed}
            </span>
          )}
        </button>
        <button onClick={() => setOpenPanel('ri_matter')} data-howto-id="eng.action.add-ri-matter" className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors">
          RI Matters
          {/* Count dots: red = outstanding (new + open), green = closed.
              Both shown when both > 0; hidden when zero so the button
              stays clean for empty engagements. */}
          {riCounts && riCounts.outstanding > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none">
              {riCounts.outstanding}
            </span>
          )}
          {riCounts && riCounts.closed > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-green-600 text-white text-[9px] font-bold leading-none">
              {riCounts.closed}
            </span>
          )}
        </button>
        {/* Specialist review hub — sibling to RI Matters. Self-hides when
            no specialist requests have ever been sent, so engagements
            without specialists keep the action bar clean. */}
        <SpecialistRequestsPanel engagementId={engagement.id} />
        <div className="flex-1" />
        {!isPreStart && lastCompletionTab && !showCompletion && (
          <button
            onClick={() => {
              setShowCompletion(true);
              setShowAuditPlan(false);
            }}
            data-howto-id="eng.action.back-to-completion"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors"
            title={`Return to the Completion section you were on: ${lastCompletionTab.label}`}
          >
            ← Completion: {lastCompletionTab.label}
          </button>
        )}
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
              data-howto-id="eng.action.open-audit-plan"
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
              data-howto-id="eng.action.open-completion"
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
        <ReviewPointsPanel
          engagementId={engagement.id}
          userId={currentUserId}
          userRole={teamMembers.find(m => m.userId === currentUserId)?.role}
          onClose={() => { setOpenPanel(null); void refreshReviewCounts(); }}
        />
      )}
      {openPanel === 'management' && (
        <ManagementPointPanel engagementId={engagement.id} pointType="management" title="Management Letter Points" onClose={() => { setOpenPanel(null); void refreshMgtCounts(); }} />
      )}
      {openPanel === 'representation' && (
        <ManagementPointPanel engagementId={engagement.id} pointType="representation" title="Representation Letter Points" onClose={() => { setOpenPanel(null); void refreshRepCounts(); }} />
      )}
      {openPanel === 'ri_matter' && (
        <RIMattersPanel
          engagementId={engagement.id}
          userId={currentUserId}
          userRole={teamMembers.find(m => m.userId === currentUserId)?.role}
          onClose={() => { setOpenPanel(null); void refreshRiCounts(); }}
        />
      )}

      {/* Debug overlay — rendered outside the showCompletion /
          showAuditPlan / normal-tabs branching so it shows regardless
          of which view is active. Sourced from state, which is
          populated from URL ?debug=... or localStorage
          acumon-debug-tabs=1 via the useEffect at the top of this
          component. Zero impact when the flag is off. */}
      {debugTabsEnabled && (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 my-2 text-[10px] font-mono leading-relaxed overflow-x-auto">
          <div className="font-sans font-bold text-amber-800 mb-1 text-xs">Tab-order debug ({auditType})</div>
          <div><span className="text-slate-500">scheduleOrder (from API mappings[{auditType}]):</span></div>
          <div className="pl-3 mb-2">
            {scheduleOrder
              ? scheduleOrder.length > 0
                ? scheduleOrder.map((k, i) => (
                  <span key={i} className="inline-block bg-white border border-slate-200 rounded px-1.5 py-0.5 mr-1 mb-1">
                    <span className="text-slate-400">{i}:</span> {k}
                  </span>
                ))
                : <span className="text-red-600">EMPTY — admin config not loaded or no mapping for this audit type</span>
              : <span className="text-red-600">NOT LOADED</span>}
          </div>
          <div><span className="text-slate-500">Computed visibleTabs order (after sort):</span></div>
          <div className="pl-3 mb-2">
            {visibleTabs.map((t, i) => {
              const ck = TAB_TO_SCHEDULE[t.key];
              const nck = ck && orderIndex ? orderIndex.get(normaliseScheduleKey(ck)) : undefined;
              return (
                <span key={i} className="inline-block bg-white border border-slate-200 rounded px-1.5 py-0.5 mr-1 mb-1">
                  <span className="text-slate-400">{i}:</span> {t.key}
                  <span className="text-slate-400"> → {ck || '(no TAB_TO_SCHEDULE entry)'}</span>
                  {nck === undefined
                    ? <span className="text-red-600 ml-1">✗ no order match</span>
                    : <span className="text-green-700 ml-1">✓ idx={nck}</span>}
                </span>
              );
            })}
          </div>
          <div className="text-[10px] text-amber-700 font-sans">
            Enable via any <span className="font-mono">?debug=...</span> URL param or by running
            <span className="font-mono bg-white border border-amber-200 rounded px-1 mx-1">localStorage.setItem(&apos;acumon-debug-tabs&apos;,&apos;1&apos;)</span>
            in DevTools. To hide: clear the param or run
            <span className="font-mono bg-white border border-amber-200 rounded px-1 mx-1">localStorage.removeItem(&apos;acumon-debug-tabs&apos;)</span>.
          </div>
        </div>
      )}

      {/* When Completion is open: split layout with vertical sidebar (left) + completion tabs (right) */}
      {showCompletion ? (
        <div className="flex border border-t-0 border-slate-200 rounded-b-lg bg-white min-h-[500px] overflow-hidden">
          {/* Left sidebar: stage-toggled engagement tabs + Audit Plan
              shortcuts. The Planning / Fieldwork toggle filters the
              tabs to the relevant stage so the list isn't 15+ items
              tall. The Fieldwork view also exposes the Audit Plan's
              own sub-tabs (Statement row + Other row) as direct
              shortcuts so the auditor can jump straight to (e.g.)
              the Balance Sheet section without going through the
              generic Audit Plan landing. */}
          <div className="w-32 flex-shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
            {/* Planning / Fieldwork segmented toggle */}
            <div className="flex border-b border-slate-200 sticky top-0 bg-slate-50 z-10">
              {(['planning', 'fieldwork'] as const).map(stage => (
                <button
                  key={stage}
                  onClick={() => setCompletionSidebarStage(stage)}
                  className={`flex-1 text-center px-1 py-1.5 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
                    completionSidebarStage === stage
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {stage === 'planning' ? 'Planning' : 'Fieldwork'}
                </button>
              ))}
            </div>
            {/* Engagement tabs filtered by the active stage. We map
                each visible tab through TAB_TO_SCHEDULE → stage to
                decide whether it belongs to the current view. Tabs
                without a schedule mapping (e.g. ad-hoc utilities)
                appear in both views as a fallback. */}
            {visibleTabs
              .filter(tab => {
                const sk = TAB_TO_SCHEDULE[tab.key];
                if (!sk) return true;
                const planningKeys = stageKeyedMapping?.planning || [];
                const fieldworkKeys = stageKeyedMapping?.fieldwork || [];
                const norm = (k: string) => k.toLowerCase();
                const plan = planningKeys.map(norm);
                const fw = fieldworkKeys.map(norm);
                if (completionSidebarStage === 'planning') return plan.includes(norm(sk));
                return fw.includes(norm(sk));
              })
              .map(tab => {
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
                        <span className={`w-1.5 h-1.5 rounded-full ${tso?.preparer === 'signed' ? 'bg-green-500' : tso?.preparer === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} title={`Preparer: ${tso?.preparer === 'signed' ? 'Complete' : tso?.preparer === 'stale' ? 'Partial (stale)' : 'Not signed'}`} />
                        <span className={`w-1.5 h-1.5 rounded-full ${tso?.reviewer === 'signed' ? 'bg-green-500' : tso?.reviewer === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} title={`Reviewer: ${tso?.reviewer === 'signed' ? 'Complete' : tso?.reviewer === 'stale' ? 'Partial (stale)' : 'Not signed'}`} />
                        <span className={`w-1.5 h-1.5 rounded-full ${tso?.partner === 'signed' ? 'bg-green-500' : tso?.partner === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} title={`RI: ${tso?.partner === 'signed' ? 'Complete' : tso?.partner === 'stale' ? 'Partial (stale)' : 'Not signed'}`} />
                      </span>
                    )}
                  </button>
                );
              })}
            {/* Audit Plan section — collapsed entry on Planning, full
                shortcut list on Fieldwork. Each shortcut deep-links
                to the AP with the right Statement / Other tab
                pre-selected via auditPlanTarget. */}
            {completionSidebarStage === 'fieldwork' ? (
              <>
                <div className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 border-b border-slate-200">
                  Audit Plan
                </div>
                {/* Each Statement is its own expand/collapse group:
                    clicking the row name jumps straight into the AP
                    at that Statement; clicking the chevron reveals
                    the FS Levels indented underneath, each of which
                    deep-links into the AP with both the Statement
                    and the FS Level pre-selected. */}
                {(['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'] as const).map(stmt => {
                  const levelsForStmt = fsLevelsByStatement[stmt] || [];
                  const isExpanded = expandedSidebarStatements.has(stmt);
                  return (
                    <Fragment key={stmt}>
                      <div className="flex border-b border-slate-200">
                        <button
                          onClick={() => {
                            setAuditPlanTarget({ statement: stmt });
                            setShowAuditPlan(true);
                            setShowCompletion(false);
                          }}
                          className="flex-1 text-left pl-4 pr-1 py-1.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50"
                        >
                          {stmt}
                        </button>
                        {levelsForStmt.length > 0 && (
                          <button
                            onClick={() => toggleSidebarStatement(stmt)}
                            className="px-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50"
                            title={isExpanded ? 'Hide FS levels' : `Show ${levelsForStmt.length} FS level(s)`}
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            <svg className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {isExpanded && levelsForStmt.map(level => (
                        <button
                          key={`${stmt}::${level}`}
                          onClick={() => {
                            setAuditPlanTarget({ statement: stmt, level });
                            setShowAuditPlan(true);
                            setShowCompletion(false);
                          }}
                          className="w-full text-left pl-7 pr-2 py-1 text-[10px] border-b border-slate-200 text-slate-600 hover:bg-blue-50/60 hover:text-blue-700"
                        >
                          {level}
                        </button>
                      ))}
                    </Fragment>
                  );
                })}
                {(['Going Concern', 'Management Override', 'SRMM Memos', 'Subsequent Events', 'Tax Technical', 'Permanent', 'Disclosure'] as const).map(other => (
                  <button
                    key={other}
                    onClick={() => {
                      setAuditPlanTarget({ otherTab: other });
                      setShowAuditPlan(true);
                      setShowCompletion(false);
                    }}
                    className="w-full text-left pl-4 pr-2 py-1.5 text-[10px] font-medium border-b border-slate-200 text-purple-600 hover:bg-purple-50"
                  >
                    {other}
                  </button>
                ))}
              </>
            ) : (
              <button
                onClick={() => { setShowAuditPlan(true); setShowCompletion(false); }}
                className="w-full text-left px-2 py-2 text-[10px] font-medium border-b border-slate-200 text-blue-600 hover:bg-blue-50"
              >
                Audit Plan…
              </button>
            )}
          </div>
          {/* Main area: Completion Panel */}
          <div className="flex-1 flex flex-col min-h-0">
            <CompletionPanel
              engagementId={engagement.id}
              clientId={engagement.clientId}
              userRole={teamMembers.find(m => m.userId === currentUserId)?.role}
              userId={currentUserId}
              userName={teamMembers.find(m => m.userId === currentUserId)?.userName}
              teamMembers={teamMembers}
              completionScheduleOrder={stageKeyedMapping?.completion}
              scheduleTriggers={scheduleTriggers}
              qaAnswers={qaAnswers}
              aiFuzzyCache={aiFuzzyCache}
              clientIsListed={clientIsListed}
              hasPriorPeriodEngagement={hasPriorPeriodEngagement}
              periodStartDate={periodStartDate}
              periodEndDate={periodEndDate}
              initialActiveTab={lastCompletionTab?.key}
              onActiveTabChange={(key, label) => setLastCompletionTab({ key, label })}
              onNavigateMainTab={(key, params) => {
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.set('tab', key);
                  if (params) {
                    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
                  }
                  window.history.replaceState({}, '', url.pathname + url.search);
                } catch {}
                setActiveTab(key as any);
                setShowCompletion(false);
              }}
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
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.preparer === 'signed' ? 'bg-green-500' : tso?.preparer === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} title={`Preparer: ${tso?.preparer === 'signed' ? 'Complete' : tso?.preparer === 'stale' ? 'Partial (stale)' : 'Not signed'}`} />
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.reviewer === 'signed' ? 'bg-green-500' : tso?.reviewer === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} title={`Reviewer: ${tso?.reviewer === 'signed' ? 'Complete' : tso?.reviewer === 'stale' ? 'Partial (stale)' : 'Not signed'}`} />
                      <span className={`w-1.5 h-1.5 rounded-full ${tso?.partner === 'signed' ? 'bg-green-500' : tso?.partner === 'stale' ? 'border border-green-500' : 'border border-slate-300'}`} title={`RI: ${tso?.partner === 'signed' ? 'Complete' : tso?.partner === 'stale' ? 'Partial (stale)' : 'Not signed'}`} />
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
              <AuditPlanPanel
                engagementId={engagement.id}
                clientId={engagement.clientId}
                periodId={engagement.periodId}
                onClose={() => { setShowAuditPlan(false); setAuditPlanTarget(null); }}
                periodEndDate={periodEndDate}
                periodStartDate={periodStartDate}
                initialStatement={auditPlanTarget?.statement}
                initialLevel={auditPlanTarget?.level}
                initialOtherTab={auditPlanTarget?.otherTab}
              />
            </TabErrorBoundary>
          </div>
        </div>
      ) : (
        <>
          {/* Normal horizontal tab bar — wrapped in a relative
              container so we can overlay scroll-affordance fades on
              the left/right edges. The auditor reported that tabs
              past the viewport edge weren't discoverable; the fade
              gradients + chevron buttons make the overflow obvious. */}
          <TabStrip
            visibleTabs={visibleTabs}
            activeTab={activeTab}
            tabSignOffs={tabSignOffs}
            switchTab={(key) => switchTab(key as TabKey)}
            continuanceLabel={continuanceLabel}
            outstandingTeamCount={outstandingTeamCount}
            outstandingClientCount={outstandingClientCount}
          />

          {/* Tab Content */}
          <div data-howto-id="page.engagement.body" className="bg-white rounded-b-lg border border-t-0 border-slate-200 min-h-[500px]">
            <div className="p-4">
              {/* Pre-start Start-Audit banner — unmissable, sits above the
                  Opening tab content so the button doesn't get buried below
                  Engagement Details / Team / Specialists. Only rendered for
                  pre_start engagements on the Opening tab. */}
              {isPreStart && activeTab === 'opening' && (() => {
                const hasRI = engagement.teamMembers.some(m => m.role === 'RI' || m.role === 'Partner');
                return (
                  <div className="mb-4 p-4 rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-green-900">Ready to start this audit?</h3>
                      <p className="text-xs text-green-700 mt-0.5">
                        Review the Opening details below, then click <strong>Start Audit</strong>. Starting the audit
                        locks in the engagement and triggers Independence confirmation for every team member.
                      </p>
                    </div>
                    <button
                      onClick={handleStartAudit}
                      disabled={starting || !hasRI}
                      data-howto-id="eng.tab.opening.start-audit"
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      title={!hasRI ? 'Assign an RI / Partner to the team first' : 'Start the audit'}
                    >
                      {starting ? (
                        <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Starting...</>
                      ) : (
                        <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Start Audit</>
                      )}
                    </button>
                  </div>
                );
              })()}

              {hasSignOff ? (
            <SignOffHeader
              engagementId={engagement.id}
              endpoint={signOffEndpoint}
              title={signOffTitle}
              teamMembers={teamMembers}
              // Specialist-review control sits next to the sign-off dots
              // in the header so auditors can trigger reviews and see
              // history without scrolling. Self-hides when there are no
              // reviews AND Reviewer hasn't signed off. Receives the
              // schedule key (= sign-off endpoint) so each tab's reviews
              // stay scoped to that tab.
              headerActions={
                <ScheduleSpecialistReviewsPanel
                  engagementId={engagement.id}
                  scheduleKey={signOffEndpoint}
                />
              }
              onSignOffChange={(signOffs) => handleTabSignOffChange(activeTab, signOffs)}
            >
              <TabErrorBoundary tabName={signOffTitle} engagementId={engagement.id}>{renderTabContent()}</TabErrorBoundary>
            </SignOffHeader>
          ) : (
            <TabErrorBoundary tabName={activeTab} engagementId={engagement.id}>{renderTabContent()}</TabErrorBoundary>
          )}

          {/* Per-tab document attachments — every tab except Documents
              itself gets a footer that lists, uploads, allocates, and
              copies-from-prior-period documents associated with the tab.
              Documents tab is the master list, so showing the footer
              there would duplicate UI. */}
          {activeTab !== 'documents' && (
            <TabDocumentsFooter
              engagementId={engagement.id}
              tab={activeTab}
              tabLabel={TABS.find(t => t.key === activeTab)?.label}
              clientName={clientName}
              periodEnd={periodEndDate ? String(periodEndDate).slice(0, 10) : undefined}
              auditTypeLabel={AUDIT_TYPE_LABELS[auditType]}
            />
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
