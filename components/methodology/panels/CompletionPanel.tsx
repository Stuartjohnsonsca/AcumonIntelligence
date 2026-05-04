'use client';

import { useState, useEffect } from 'react';
import { FileText, CheckSquare, ClipboardList, BarChart3, Eye, AlertTriangle, ChevronDown, ChevronUp, ChevronRight, CheckCircle2, Loader2, Sparkles, ShieldAlert, ShieldCheck, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { buildVisibilityChecker, type Trigger, type TriggerContext } from '@/lib/schedule-triggers';
import { AuditTestSummaryPanel } from './AuditTestSummaryPanel';
import { ErrorSchedulePanel } from './ErrorSchedulePanel';
import { FSReviewPanel } from './FSReviewPanel';
import { AdjustedTBPanel } from './AdjustedTBPanel';
import { SignificantRiskPanel } from './SignificantRiskPanel';
import { EQRReviewPanel } from './EQRReviewPanel';
import type { TemplateQuestion, TemplateSectionMeta, SectionLayout, CompletionTemplateData } from '@/types/methodology';

type TeamMember = { userId: string; userName?: string; role: string };

// Role-key map for Completion-panel sign-offs (preparer/reviewer/ri/eqr).
// Kept distinct from SignOffHeader's operator/reviewer/partner scheme on purpose.
const COMPLETION_ROLE_MAP: Record<string, string> = { Junior: 'preparer', Manager: 'reviewer', RI: 'ri', EQR: 'eqr' };

function canUserSign(role: string, userId: string | undefined, teamMembers: TeamMember[] | undefined): boolean {
  if (!userId || !teamMembers || teamMembers.length === 0) return false;
  return teamMembers.some(m => COMPLETION_ROLE_MAP[m.role] === role && m.userId === userId);
}

function roleNotAllowedTooltip(role: string): string {
  if (role === 'ri') return 'Only the RI can sign here';
  if (role === 'eqr') return 'Only the EQR can sign here';
  if (role === 'preparer') return 'Only Preparers can sign here';
  if (role === 'reviewer') return 'Only Reviewers can sign here';
  return `Only ${role}s can sign here`;
}

function hasEQROnTeam(teamMembers: TeamMember[] | undefined): boolean {
  return !!teamMembers?.some(m => m.role === 'EQR');
}

export type AnswerSource =
  | { kind: 'materiality' }
  | { kind: 'rmm'; rowId?: string; label?: string }
  | { kind: 'test-conclusion'; conclusionId?: string; label?: string }
  | { kind: 'error-schedule'; itemId?: string }
  // Generic reference emitted by the AI Populate endpoint — points at
  // any main-tab key with an optional scroll anchor. Used when the AI
  // locates coverage for an Update Procedures row in a tab that isn't
  // one of the first-class kinds above.
  | { kind: 'ref'; tab: string; anchor?: string; label?: string };

interface Props {
  engagementId: string;
  clientId: string;
  userRole?: string;
  userId?: string;
  userName?: string;
  teamMembers?: TeamMember[];
  /** Ordered list of schedule keys for the Completion stage (from Part E config) */
  completionScheduleOrder?: string[];
  /** Triggers for the active audit type (new trigger-based visibility model) */
  scheduleTriggers?: Trigger[];
  /** Answers fetched from Q&A trigger source schedules (keyed by scheduleKey → questionId → answer) */
  qaAnswers?: Record<string, Record<string, string>>;
  /** Pre-computed AI fuzzy-match results for Q&A triggers with useAIFuzzyMatch */
  aiFuzzyCache?: Record<string, boolean>;
  /** From engagement payload for visibility evaluation */
  clientIsListed?: boolean;
  hasPriorPeriodEngagement?: boolean;
  onNavigateMainTab?: (tabKey: string, params?: Record<string, string>) => void;
  onClose?: () => void;
  /**
   * Initial Completion sub-tab when the panel mounts. EngagementTabs
   * passes the last-viewed sub-tab so re-entering Completion lands the
   * auditor where they were before navigating away to a Planning /
   * Fieldwork tab via the sidebar.
   */
  initialActiveTab?: string;
  /**
   * Fires whenever the active sub-tab changes so EngagementTabs can
   * remember it for the "Back to Completion: X" return affordance.
   */
  onActiveTabChange?: (key: string, label: string) => void;
}

const COMPLETION_TABS = [
  { key: 'summary-memo', label: 'Audit Summary Memo', icon: FileText, templateType: 'audit_summary_memo_questions', scheduleKey: 'audit_summary_memo' },
  { key: 'significant-risk', label: 'Significant Risk', icon: ShieldAlert, templateType: null, scheduleKey: 'significant_risk_completion' },
  { key: 'eqr-review', label: 'EQR Review', icon: ShieldCheck, templateType: null, scheduleKey: 'eqr_review' },
  { key: 'update-procedures', label: 'Update Procedures', icon: ClipboardList, templateType: 'update_procedures_questions', scheduleKey: 'update_procedures' },
  { key: 'completion-checklist', label: 'Completion Checklist', icon: CheckSquare, templateType: 'completion_checklist_questions', scheduleKey: 'completion_checklist' },
  { key: 'test-summary', label: 'Test Summary Results', icon: BarChart3, templateType: null, scheduleKey: 'test_summary_results' },
  { key: 'overall-review', label: 'Overall Review of FS', icon: Eye, templateType: 'overall_review_fs_questions', scheduleKey: 'overall_review_fs' },
  { key: 'fs-review', label: 'FS Review', icon: FileText, templateType: null, scheduleKey: 'fs_review' },
  { key: 'adj-tb', label: 'Adj TB', icon: FileText, templateType: null, scheduleKey: 'adj_tb' },
  { key: 'error-schedule', label: 'Error Schedule', icon: AlertTriangle, templateType: null, scheduleKey: 'error_schedule' },
] as const;

// Sub-tab pill dots aggregate the row-level Progress + Result dots
// inside each Completion sub-tab — three tiers in total:
//   1. Row-level dots inside the panel
//   2. Section-level aggregates inside the panel
//   3. Tab-pill aggregate (here) syncing with #2
// Each panel that opts in dispatches a window CustomEvent on load /
// state change with its overall { progress, result } aggregate; the
// pill listens and renders the dots in lockstep. Today only Test
// Summary Results emits — other sub-tabs can opt in by dispatching
// their own `engagement:<event-name>` event with the same shape.
const SUBTAB_AGGREGATE_EVENTS: Partial<Record<CompletionTabKey, string>> = {
  'test-summary': 'engagement:test-summary-aggregates',
};

type Dot = 'green' | 'orange' | 'red' | 'pending';
const DOT_BG: Record<Dot, string> = {
  green: 'bg-green-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pending: 'bg-slate-300',
};
interface SubTabAggregate { progress: Dot; result: Dot; }

type CompletionTabKey = typeof COMPLETION_TABS[number]['key'];

export function CompletionPanel({
  engagementId, clientId, userRole, userId, userName, teamMembers,
  completionScheduleOrder, scheduleTriggers, qaAnswers, aiFuzzyCache,
  clientIsListed, hasPriorPeriodEngagement,
  onNavigateMainTab, onClose,
  initialActiveTab, onActiveTabChange,
}: Props) {
  // Hydrate from initialActiveTab when supplied (e.g. on re-entry from
  // a sidebar-driven divert), falling back to the first tab.
  const [activeTab, setActiveTab] = useState<CompletionTabKey>(
    (initialActiveTab && (COMPLETION_TABS as readonly { key: string }[]).some(t => t.key === initialActiveTab))
      ? (initialActiveTab as CompletionTabKey)
      : 'summary-memo'
  );

  // Sub-tab pill Progress + Result aggregates — fed by CustomEvents
  // each opted-in panel dispatches on data change. We match by
  // `detail.engagementId` to ignore aggregates from a stale tab if
  // the user has multiple engagements open.
  const [subTabAggregates, setSubTabAggregates] = useState<Partial<Record<CompletionTabKey, SubTabAggregate>>>({});
  useEffect(() => {
    const handlers: Array<{ event: string; fn: (e: Event) => void }> = [];
    for (const [subTabKey, eventName] of Object.entries(SUBTAB_AGGREGATE_EVENTS)) {
      const fn = (e: Event) => {
        const detail = (e as CustomEvent).detail as { engagementId?: string; progress?: Dot; result?: Dot } | undefined;
        if (!detail || detail.engagementId !== engagementId) return;
        if (!detail.progress || !detail.result) return;
        setSubTabAggregates(prev => ({ ...prev, [subTabKey as CompletionTabKey]: { progress: detail.progress!, result: detail.result! } }));
      };
      window.addEventListener(eventName, fn);
      handlers.push({ event: eventName, fn });
    }
    return () => { for (const { event, fn } of handlers) window.removeEventListener(event, fn); };
  }, [engagementId]);

  // Notify the parent whenever the tab changes so EngagementTabs can
  // remember the user's location for the "Back to Completion: X"
  // button after they divert away.
  useEffect(() => {
    if (!onActiveTabChange) return;
    const def = COMPLETION_TABS.find(t => t.key === activeTab);
    if (def) onActiveTabChange(activeTab, def.label);
  }, [activeTab, onActiveTabChange]);

  // Visibility helper for sub-tabs — uses the trigger-based evaluation from
  // lib/schedule-triggers so Completion sub-tabs respect the same rules as main tabs.
  const teamHasEQR = !!teamMembers?.some(m => m.role === 'EQR');
  const triggerCtx: TriggerContext = {
    clientIsListed: !!clientIsListed,
    hasPriorPeriodEngagement: !!hasPriorPeriodEngagement,
    teamHasEQR,
    answers: qaAnswers || {},
    aiFuzzyCache,
  };
  const passesConditions = buildVisibilityChecker(scheduleTriggers || [], triggerCtx);

  // Build the visible+ordered completion tab list from the schedule config (Part F).
  // Falls back to the hardcoded order if no config is supplied.
  const orderedCompletionTabs = (() => {
    const filtered = COMPLETION_TABS.filter(t => passesConditions(t.scheduleKey));
    if (!completionScheduleOrder || completionScheduleOrder.length === 0) {
      return filtered;
    }
    // Sort by position in completionScheduleOrder; tabs not in the order go to the end in their original order
    const orderIdx = (key: string) => {
      const idx = completionScheduleOrder.indexOf(key);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    // Drop tabs that are not in the configured order — admin chose to hide them
    const inOrder = filtered.filter(t => completionScheduleOrder.includes(t.scheduleKey));
    return inOrder.sort((a, b) => orderIdx(a.scheduleKey) - orderIdx(b.scheduleKey));
  })();

  // Ensure the active tab is still visible — if not, default to first
  const visibleTabKeys = new Set(orderedCompletionTabs.map(t => t.key));
  if (!visibleTabKeys.has(activeTab) && orderedCompletionTabs.length > 0) {
    // Defer state set to next render via direct assignment is unsafe — use a useEffect-style fallback inline
    setTimeout(() => setActiveTab(orderedCompletionTabs[0].key as CompletionTabKey), 0);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
        {orderedCompletionTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          // Pill aggregate dots — Progress + Result rolled across
          // every row in the sub-tab. Only renders for sub-tabs
          // listed in SUBTAB_AGGREGATE_EVENTS that have actually
          // dispatched their first aggregate event.
          const agg = subTabAggregates[tab.key as CompletionTabKey];
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-md whitespace-nowrap transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}>
              <Icon className="h-3 w-3" /> {tab.label}
              {agg && (
                <span className="inline-flex items-center gap-0.5 ml-1" title={`Progress ${agg.progress} · Result ${agg.result}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${DOT_BG[agg.progress]}`} />
                  <span className={`w-1.5 h-1.5 rounded-full ${DOT_BG[agg.result]}`} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'test-summary' && <AuditTestSummaryPanel engagementId={engagementId} userRole={userRole} userId={userId} />}
        {activeTab === 'error-schedule' && <ErrorSchedulePanel engagementId={engagementId} />}
        {activeTab === 'fs-review' && <FSReviewPanel engagementId={engagementId} />}
        {activeTab === 'adj-tb' && <AdjustedTBPanel engagementId={engagementId} />}
        {activeTab === 'significant-risk' && <SignificantRiskPanel engagementId={engagementId} userId={userId} userName={userName} teamMembers={teamMembers} />}
        {activeTab === 'eqr-review' && <EQRReviewPanel engagementId={engagementId} userId={userId} userName={userName} teamMembers={teamMembers} />}
        {['summary-memo', 'update-procedures', 'completion-checklist', 'overall-review'].includes(activeTab) && (
          <StructuredScheduleTab
            engagementId={engagementId}
            templateType={COMPLETION_TABS.find(t => t.key === activeTab)?.templateType || ''}
            title={COMPLETION_TABS.find(t => t.key === activeTab)?.label || ''}
            showAutoComplete={activeTab === 'summary-memo'}
            userId={userId}
            userName={userName}
            userRole={userRole}
            teamMembers={teamMembers}
            onNavigateMainTab={onNavigateMainTab}
            onCompletionTabChange={setActiveTab}
          />
        )}
      </div>
    </div>
  );
}

// ─── Structured Schedule Tab (multi-column tables + section sign-offs) ───

function StructuredScheduleTab({ engagementId, templateType, title, showAutoComplete, userId, userName, userRole, teamMembers, onNavigateMainTab, onCompletionTabChange }: {
  engagementId: string; templateType: string; title: string; showAutoComplete?: boolean;
  userId?: string; userName?: string; userRole?: string;
  teamMembers?: TeamMember[];
  onNavigateMainTab?: (tabKey: string, params?: Record<string, string>) => void;
  onCompletionTabChange?: (key: CompletionTabKey) => void;
}) {
  const [questions, setQuestions] = useState<TemplateQuestion[]>([]);
  const [sectionMeta, setSectionMeta] = useState<Record<string, TemplateSectionMeta>>({});
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [answerSources, setAnswerSources] = useState<Record<string, AnswerSource>>({});
  const [signOffs, setSignOffs] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [autoCompleting, setAutoCompleting] = useState(false);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  // Tracks which cells are currently being populated by the AI Populate
  // button (keyed by `${questionId}_${columnKey}`). Used to render per-
  // cell spinners and to disable the tab-level "Populate All" while a
  // batch is in flight.
  const [populatingCells, setPopulatingCells] = useState<Set<string>>(new Set());
  const [bulkPopulating, setBulkPopulating] = useState(false);
  // Section collapse state — keyed by sectionKey. Sections default to
  // expanded; clicking the header toggles a single section. Persisted
  // per-user per-tab in localStorage so the preference survives page
  // reloads but not across different browsers.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(`completion-collapsed:${templateType}`);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });
  function toggleSection(sectionKey: string) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey);
      try { window.localStorage.setItem(`completion-collapsed:${templateType}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }
  // User-added custom sections (persisted to templateType-scoped extra
  // metadata on save; marked as userAdded=true so the RI can delete them
  // and nobody else can). Custom sections also carry their own rows
  // (customQuestions) because the template provides no questions for a
  // section the user invented after the template was designed.
  const [customSections, setCustomSections] = useState<Record<string, TemplateSectionMeta & { userAdded?: boolean; createdByUserId?: string }>>({});
  const [customQuestions, setCustomQuestions] = useState<Record<string, TemplateQuestion[]>>({});

  // Load template + engagement answers
  useEffect(() => {
    (async () => {
      try {
        // Load template
        // engagementId resolves the template for this engagement's
        // audit type, falling back to ALL. Prevents blank schedules
        // when the admin saved questions under SME/GRANT/CASS/GROUP.
        const tplRes = await fetch(`/api/methodology-admin/templates?templateType=${templateType}&engagementId=${encodeURIComponent(engagementId)}`);
        if (tplRes.ok) {
          const tplData = await tplRes.json();
          const items = tplData.template?.items || tplData.items || {};
          const qs = items.questions || (Array.isArray(items) ? items : []);
          const meta = items.sectionMeta || {};
          setQuestions(qs);
          setSectionMeta(meta);
        }

        // Load saved answers
        try {
          const dataRes = await fetch(`/api/engagements/${engagementId}/permanent-file?section=${templateType}`);
          if (dataRes.ok) {
            const data = await dataRes.json();
            const saved = data.answers?.[templateType] || data.data?.[templateType] || {};
            if (saved.answers) setAnswers(saved.answers);
            if (saved.answerSources) setAnswerSources(saved.answerSources);
            if (saved.signOffs) setSignOffs(saved.signOffs);
            // User-added sections + their rows persist in the same payload.
            if (saved.customSections) setCustomSections(saved.customSections);
            if (saved.customQuestions) setCustomQuestions(saved.customQuestions);
          }
        } catch {}
      } catch {} finally { setLoading(false); }
    })();
  }, [engagementId, templateType]);

  // Auto-save answers
  function updateAnswer(questionId: string, columnKey: string, value: string) {
    const key = `${questionId}_${columnKey}`;
    setAnswers(prev => ({ ...prev, [key]: value }));
    // Manual edit removes any auto-complete source marker for this cell
    let nextSources = answerSources;
    if (answerSources[key]) {
      nextSources = { ...answerSources };
      delete nextSources[key];
      setAnswerSources(nextSources);
    }
    debounceSave({ ...answers, [key]: value }, undefined, nextSources);
  }

  function debounceSave(
    data: Record<string, any>,
    so?: Record<string, any>,
    srcs?: Record<string, AnswerSource>,
    cs?: Record<string, TemplateSectionMeta & { userAdded?: boolean; createdByUserId?: string }>,
    cq?: Record<string, TemplateQuestion[]>,
  ) {
    if (saveTimeout) clearTimeout(saveTimeout);
    const t = setTimeout(async () => {
      try {
        await fetch(`/api/engagements/${engagementId}/permanent-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_data',
            section: templateType,
            data: { [templateType]: {
              answers: data || answers,
              signOffs: so || signOffs,
              answerSources: srcs || answerSources,
              customSections: cs || customSections,
              customQuestions: cq || customQuestions,
            } },
          }),
        });
      } catch {}
    }, 1000);
    setSaveTimeout(t);
  }

  // Section sign-off
  function handleSectionSignOff(sectionKey: string, role: string) {
    if (!canUserSign(role, userId, teamMembers)) return;
    const key = `${sectionKey}_${role}`;
    const existing = signOffs[key];
    let updated: Record<string, any>;
    if (existing) {
      updated = { ...signOffs };
      delete updated[key];
    } else {
      updated = { ...signOffs, [key]: { userId, userName: userName || 'User', timestamp: new Date().toISOString() } };
    }
    setSignOffs(updated);
    debounceSave(answers, updated);
  }

  // ─── User-added sections ──────────────────────────────────────────────
  /** Generate a unique key for a new section so we never collide with a
   *  template-provided sectionKey. Prefix is deliberate so the auto-load
   *  code can tell template from custom at a glance. */
  function newSectionKey(): string {
    return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }
  /** Find a reasonable default set of column headers for a new section —
   *  reuses the template's own headers when the tab already has a table
   *  layout, otherwise falls back to a two-column Question / Response. */
  function defaultColumnHeaders(): string[] {
    for (const meta of Object.values(sectionMeta)) {
      if (meta.columnHeaders && meta.columnHeaders.length >= 2) return [...meta.columnHeaders];
    }
    return ['Procedure', 'Response'];
  }
  function addCustomSection() {
    const label = (typeof window !== 'undefined' ? window.prompt('Section name?') : '')?.trim();
    if (!label) return;
    const key = newSectionKey();
    const headers = defaultColumnHeaders();
    const nextCs: typeof customSections = {
      ...customSections,
      [key]: {
        key,
        label,
        layout: (headers.length > 1 ? 'table' : 'standard') as SectionLayout,
        columnHeaders: headers,
        signOff: true,
        userAdded: true,
        createdByUserId: userId,
      },
    };
    // New sections start with one empty row so they render usably.
    const firstRow: TemplateQuestion = {
      id: `${key}_q_${Date.now()}`,
      sectionKey: key,
      questionText: '',
      inputType: 'text',
      isBold: false,
    } as TemplateQuestion;
    const nextCq = { ...customQuestions, [key]: [firstRow] };
    setCustomSections(nextCs);
    setCustomQuestions(nextCq);
    // Auto-expand the new section so the user can start typing immediately.
    setCollapsedSections(prev => { const next = new Set(prev); next.delete(key); return next; });
    debounceSave(answers, undefined, undefined, nextCs, nextCq);
  }
  function deleteCustomSection(sectionKey: string) {
    if (!customSections[sectionKey]?.userAdded) return; // Only user-added sections are deletable
    if (!currentUserIsRi) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete section "${customSections[sectionKey]?.label || sectionKey}"? Any answers entered will be lost.`)) return;
    const nextCs = { ...customSections };
    delete nextCs[sectionKey];
    const nextCq = { ...customQuestions };
    delete nextCq[sectionKey];
    // Also strip any answers / sign-offs keyed to this section so we don't
    // leave dangling data on the engagement record.
    const nextAnswers = { ...answers };
    const nextSources = { ...answerSources };
    const nextSignOffs = { ...signOffs };
    const deleteIds = (customQuestions[sectionKey] || []).map(q => q.id);
    for (const qid of deleteIds) {
      for (const k of Object.keys(nextAnswers)) if (k.startsWith(`${qid}_`)) delete nextAnswers[k];
      for (const k of Object.keys(nextSources)) if (k.startsWith(`${qid}_`)) delete nextSources[k];
    }
    for (const k of Object.keys(nextSignOffs)) if (k.startsWith(`${sectionKey}_`)) delete nextSignOffs[k];
    setCustomSections(nextCs);
    setCustomQuestions(nextCq);
    setAnswers(nextAnswers);
    setAnswerSources(nextSources);
    setSignOffs(nextSignOffs);
    debounceSave(nextAnswers, nextSignOffs, nextSources, nextCs, nextCq);
  }
  function addCustomRow(sectionKey: string) {
    if (!customSections[sectionKey]?.userAdded) return;
    const newRow: TemplateQuestion = {
      id: `${sectionKey}_q_${Date.now()}`,
      sectionKey,
      questionText: '',
      inputType: 'text',
      isBold: false,
    } as TemplateQuestion;
    const existing = customQuestions[sectionKey] || [];
    const nextCq = { ...customQuestions, [sectionKey]: [...existing, newRow] };
    setCustomQuestions(nextCq);
    debounceSave(answers, undefined, undefined, undefined, nextCq);
  }
  /** Edit the first-column text on a user-added row. Template rows have
   *  immutable question text so this only applies to customQuestions. */
  function updateCustomRowText(sectionKey: string, questionId: string, text: string) {
    if (!customSections[sectionKey]?.userAdded) return;
    const rows = customQuestions[sectionKey] || [];
    const nextRows = rows.map(r => r.id === questionId ? { ...r, questionText: text } : r);
    const nextCq = { ...customQuestions, [sectionKey]: nextRows };
    setCustomQuestions(nextCq);
    debounceSave(answers, undefined, undefined, undefined, nextCq);
  }
  function deleteCustomRow(sectionKey: string, questionId: string) {
    if (!customSections[sectionKey]?.userAdded) return;
    const rows = customQuestions[sectionKey] || [];
    const nextRows = rows.filter(r => r.id !== questionId);
    const nextCq = { ...customQuestions, [sectionKey]: nextRows };
    // Strip answers keyed to this row so nothing's orphaned.
    const nextAnswers = { ...answers };
    const nextSources = { ...answerSources };
    for (const k of Object.keys(nextAnswers)) if (k.startsWith(`${questionId}_`)) delete nextAnswers[k];
    for (const k of Object.keys(nextSources)) if (k.startsWith(`${questionId}_`)) delete nextSources[k];
    setCustomQuestions(nextCq);
    setAnswers(nextAnswers);
    setAnswerSources(nextSources);
    debounceSave(nextAnswers, undefined, nextSources, undefined, nextCq);
  }

  // Navigate to the origin of an auto-completed answer
  function navigateToSource(source: AnswerSource) {
    switch (source.kind) {
      case 'materiality':
        onNavigateMainTab?.('materiality');
        return;
      case 'rmm':
        onNavigateMainTab?.('rmm', source.rowId ? { rmmRowId: source.rowId } : undefined);
        return;
      case 'test-conclusion':
        onCompletionTabChange?.('test-summary');
        return;
      case 'error-schedule':
        onCompletionTabChange?.('error-schedule');
        return;
      case 'ref':
        // Generic tab + anchor reference from AI Populate. Target tabs
        // that support scroll-to-anchor read the `scroll` query param
        // on mount; tabs without that support will just switch to the
        // tab and the user scrolls manually.
        onNavigateMainTab?.(source.tab, source.anchor ? { scroll: source.anchor } : undefined);
        return;
    }
  }

  function sourceTooltip(source: AnswerSource): string {
    switch (source.kind) {
      case 'materiality': return 'Source: Materiality tab — click to open';
      case 'rmm': return source.label ? `Source: RMM — "${source.label}" — click to open` : 'Source: RMM tab — click to open';
      case 'test-conclusion': return source.label ? `Source: Test Conclusions — "${source.label}" — click to open` : 'Source: Test Summary Results — click to open';
      case 'error-schedule': return 'Source: Error Schedule — click to open';
      case 'ref': return source.label ? `Source: ${source.label} — click to open` : `Source: ${source.tab} — click to open`;
    }
  }

  // ─── AI Populate (per cell + tab-wide) ────────────────────────────────
  /** Returns the populate mode for this tab — 'references' on Update
   *  Procedures (fill reference column with deep links) and 'procedure'
   *  on Completion Checklist (write the procedure description). Default
   *  on any other template is 'references' which is the safer option —
   *  it won't rewrite existing audit text. */
  function aiPopulateMode(): 'references' | 'procedure' {
    if (templateType === 'completion_checklist_questions') return 'procedure';
    return 'references';
  }
  /** Returns true if the cell contains user-entered content that the AI
   *  Populate flow must not silently overwrite. AI-populated cells carry
   *  an entry in answerSources (cleared the moment the user manually
   *  edits, by updateAnswer) so we use that as the signal: content +
   *  no source ⇒ user-typed, protect. */
  function isUserEnteredCell(cellKey: string): boolean {
    const value = answers[cellKey];
    if (typeof value !== 'string') return false;
    if (value.trim().length === 0) return false;
    return !answerSources[cellKey];
  }
  /** Populate a single row+column via the AI Populate endpoint and commit
   *  the answer + source back into state. The first-column question text
   *  is the AI's primary prompt; the section label gives scope.
   *
   *  `force` bypasses the user-content protection — we pass true when
   *  the user has just confirmed an overwrite via the per-row button.
   */
  async function populateCell(
    questionId: string,
    columnKey: string,
    questionText: string,
    sectionLabel?: string,
    columnHeader?: string,
    force = false,
  ): Promise<boolean> {
    const cellKey = `${questionId}_${columnKey}`;
    if (!questionText.trim()) return false;
    // Protect manually-entered content — the user has to confirm before
    // the AI is allowed to replace their text. AI-populated cells (which
    // carry an answerSources entry) overwrite freely.
    if (!force && isUserEnteredCell(cellKey)) {
      const ok = typeof window !== 'undefined' && window.confirm('This cell already has text. Replace it with AI output?');
      if (!ok) return false;
    }
    setPopulatingCells(prev => { const n = new Set(prev); n.add(cellKey); return n; });
    try {
      const res = await fetch(`/api/engagements/${engagementId}/ai-populate-cell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateType,
          mode: aiPopulateMode(),
          questionText,
          sectionLabel,
          columnHeader,
        }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const text: string = typeof data.text === 'string' ? data.text : '';
      const refs: Array<{ tab: string; anchor?: string; label?: string }> = Array.isArray(data.references) ? data.references : [];
      if (!text && refs.length === 0) return false;

      const nextAnswers = { ...answers, [cellKey]: text };
      setAnswers(nextAnswers);
      // Attach the first reference (if any) as the cell's source so the
      // existing source-link icon renders and navigateToSource can jump
      // to the right tab/anchor.
      let nextSources = answerSources;
      if (refs.length > 0) {
        const r = refs[0];
        nextSources = { ...answerSources, [cellKey]: { kind: 'ref', tab: r.tab, anchor: r.anchor, label: r.label || r.tab } };
        setAnswerSources(nextSources);
      }
      debounceSave(nextAnswers, undefined, nextSources);
      return true;
    } catch {
      return false;
    } finally {
      setPopulatingCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; });
    }
  }
  /** Tab-level AI button — fires populateCell for every row's "response"
   *  column (col1 on standard layouts, col1 on table layouts) in sequence.
   *  Sequential rather than parallel so we don't hammer the provider. */
  async function populateAllCells() {
    if (bulkPopulating) return;
    setBulkPopulating(true);
    try {
      // Merge template questions + user-added questions for iteration.
      const allSections: Array<{ sectionKey: string; sectionLabel: string; questions: TemplateQuestion[]; headers: string[] }> = [];
      const combined = new Map<string, TemplateQuestion[]>();
      for (const q of questions) {
        if (!combined.has(q.sectionKey)) combined.set(q.sectionKey, []);
        combined.get(q.sectionKey)!.push(q);
      }
      for (const [k, qs] of Object.entries(customQuestions)) combined.set(k, qs);
      for (const [sk, qs] of combined.entries()) {
        const meta = sectionMeta[sk] || customSections[sk];
        allSections.push({
          sectionKey: sk,
          sectionLabel: meta?.label || sk,
          questions: qs,
          headers: meta?.columnHeaders || [],
        });
      }
      for (const sec of allSections) {
        for (const q of sec.questions) {
          if (q.isBold) continue; // Bold rows are section headers — skip.
          // Default target column is col1 (the "Response" column on
          // standard layouts, the first editable column on table layouts).
          const colKey = 'col1';
          const colHeader = sec.headers[1] || sec.headers[0] || undefined;
          if (!q.questionText?.trim()) continue; // Can't ask the AI about a blank row.
          // Bulk never overwrites anything that is already filled in —
          // whether that's user-typed text OR a previous AI answer. The
          // user can clear a cell and re-run per row if they want a
          // fresh AI suggestion.
          const existing = answers[`${q.id}_${colKey}`];
          if (typeof existing === 'string' && existing.trim().length > 0) continue;
          await populateCell(q.id, colKey, q.questionText, sec.sectionLabel, colHeader, true);
        }
      }
    } finally {
      setBulkPopulating(false);
    }
  }

  // Auto-complete from engagement data
  async function handleAutoComplete() {
    setAutoCompleting(true);
    try {
      const [matRes, rmmRes, concRes, errRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/materiality`),
        fetch(`/api/engagements/${engagementId}/rmm`),
        fetch(`/api/engagements/${engagementId}/test-conclusions`),
        fetch(`/api/engagements/${engagementId}/error-schedule`),
      ]);

      const matData = matRes.ok ? await matRes.json() : {};
      const rmmData = rmmRes.ok ? await rmmRes.json() : {};
      const concData = concRes.ok ? await concRes.json() : {};
      const errData = errRes.ok ? await errRes.json() : {};

      const mat = matData.materiality?.data || matData.data || {};
      const rmmRows = rmmData.rows || [];
      const conclusions = concData.conclusions || [];
      const errors = errData.items || errData.errors || [];

      // Resolve materiality values (stored as overallMateriality, performanceMateriality, clearlyTrivial)
      const omVal = mat.overallMateriality || mat.materiality || 0;
      const pmVal = mat.performanceMateriality || mat.pm || 0;
      const ctVal = mat.clearlyTrivial || mat.ct || 0;

      const autoAnswers: Record<string, any> = { ...answers };
      const autoSources: Record<string, AnswerSource> = { ...answerSources };
      let populated = 0;

      // Populate materiality section
      const matQs = questions.filter(q => q.sectionKey === 'Materiality');
      for (const q of matQs) {
        if (q.questionText === 'Overall materiality' && omVal) {
          autoAnswers[`${q.id}_col1`] = Number(omVal).toLocaleString('en-GB');
          autoAnswers[`${q.id}_col2`] = Number(omVal).toLocaleString('en-GB');
          autoSources[`${q.id}_col1`] = { kind: 'materiality' };
          autoSources[`${q.id}_col2`] = { kind: 'materiality' };
          populated++;
        }
        if (q.questionText === 'Performance materiality' && pmVal) {
          autoAnswers[`${q.id}_col1`] = Number(pmVal).toLocaleString('en-GB');
          autoAnswers[`${q.id}_col2`] = Number(pmVal).toLocaleString('en-GB');
          autoSources[`${q.id}_col1`] = { kind: 'materiality' };
          autoSources[`${q.id}_col2`] = { kind: 'materiality' };
          populated++;
        }
        if (q.questionText === 'Clearly Trivial Threshold' && ctVal) {
          autoAnswers[`${q.id}_col1`] = Number(ctVal).toLocaleString('en-GB');
          autoAnswers[`${q.id}_col2`] = Number(ctVal).toLocaleString('en-GB');
          autoSources[`${q.id}_col1`] = { kind: 'materiality' };
          autoSources[`${q.id}_col2`] = { kind: 'materiality' };
          populated++;
        }
      }

      // Populate significant risks from RMM
      const sigRisks = rmmRows.filter((r: any) => r.overallRisk === 'High' || r.overallRisk === 'Very High');
      const sigQs = questions.filter(q => q.sectionKey === 'Significant Risks');
      for (let i = 0; i < Math.min(sigRisks.length, sigQs.length); i++) {
        const key = `${sigQs[i].id}_col0`;
        const label = sigRisks[i].lineItem || sigRisks[i].riskIdentified || '';
        autoAnswers[key] = label;
        autoSources[key] = { kind: 'rmm', rowId: sigRisks[i].id, label };
      }

      // Populate areas of focus from RMM
      const aofRisks = rmmRows.filter((r: any) => r.overallRisk === 'Medium');
      const aofQs = questions.filter(q => q.sectionKey === 'Areas of Focus');
      for (let i = 0; i < Math.min(aofRisks.length, aofQs.length); i++) {
        const key = `${aofQs[i].id}_col0`;
        const label = aofRisks[i].lineItem || aofRisks[i].riskIdentified || '';
        autoAnswers[key] = label;
        autoSources[key] = { kind: 'rmm', rowId: aofRisks[i].id, label };
      }

      // Populate conclusions into procedures columns
      for (const conc of conclusions) {
        const matchQ = questions.find(q =>
          q.questionText.toLowerCase().includes(conc.testDescription?.toLowerCase()?.slice(0, 20) || '___')
        );
        if (matchQ) {
          const key = `${matchQ.id}_col2`;
          autoAnswers[key] = conc.conclusion === 'green' ? 'Satisfactory' : conc.conclusion === 'orange' ? 'Exceptions noted' : conc.conclusion === 'red' ? 'Material exceptions' : '';
          autoSources[key] = { kind: 'test-conclusion', conclusionId: conc.executionId, label: conc.testDescription };
        }
      }

      setAnswers(autoAnswers);
      setAnswerSources(autoSources);
      debounceSave(autoAnswers, undefined, autoSources);
      // Brief alert so user knows what happened
      console.log(`Auto-complete populated ${populated} fields. Mat: OM=${omVal} PM=${pmVal} CT=${ctVal}. RMM: ${rmmRows.length} rows (${sigRisks.length} sig risks, ${aofRisks.length} AoF). Conclusions: ${conclusions.length}. Errors: ${errors.length}.`);
    } catch (err) { console.error('Auto-complete failed:', err); } finally { setAutoCompleting(false); }
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading {title}...</div>;

  if (questions.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 space-y-2">
        <FileText className="h-8 w-8 mx-auto text-slate-300" />
        <p className="text-sm">No template configured for "{title}"</p>
        <p className="text-xs">Add questions in Methodology Admin → Schedules → "{title}" tab, or run the seed script.</p>
      </div>
    );
  }

  // Group questions by section
  const sections = new Map<string, TemplateQuestion[]>();
  for (const q of questions) {
    if (!sections.has(q.sectionKey)) sections.set(q.sectionKey, []);
    sections.get(q.sectionKey)!.push(q);
  }
  // Merge in any user-added sections with their own rows (custom questions
  // live alongside the sections map rather than in the template feed).
  for (const [k] of Object.entries(customSections)) {
    sections.set(k, customQuestions[k] || []);
  }
  // The current user is the RI if they hold that role on the engagement
  // team — only RIs may delete user-added sections.
  const currentUserIsRi = !!(userId && teamMembers?.some(m => m.role === 'RI' && m.userId === userId));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        <div className="flex items-center gap-2">
          {/*
            Tab-level "AI Populate" button — fires the per-row populate
            flow for every empty response cell in sequence. Available on
            templates whose response can usefully be AI-populated
            (Update Procedures → references; Completion Checklist →
            procedure text; Overall Review → references).
          */}
          {(templateType === 'update_procedures_questions' || templateType === 'completion_checklist_questions' || templateType === 'overall_review_fs_questions') && (
            <button
              onClick={populateAllCells}
              disabled={bulkPopulating || populatingCells.size > 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50"
              title={templateType === 'completion_checklist_questions' ? 'AI-write the procedure for every empty row' : 'AI-add references for every empty row'}
            >
              {bulkPopulating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {bulkPopulating ? 'Populating…' : 'AI Populate'}
            </button>
          )}
          {showAutoComplete && (
            <button onClick={handleAutoComplete} disabled={autoCompleting}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50">
              {autoCompleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {autoCompleting ? 'Auto-Completing...' : 'Auto-Complete'}
            </button>
          )}
        </div>
      </div>

      {/* Sections */}
      {Array.from(sections.entries()).map(([sectionKey, sectionQs]) => {
        // Merged meta lookup — template sections come from sectionMeta;
        // user-added sections come from customSections (and carry the
        // userAdded flag that unlocks delete).
        const meta = sectionMeta[sectionKey] || customSections[sectionKey];
        const customMeta = customSections[sectionKey];
        const isUserAdded = !!customMeta?.userAdded;
        const layout: SectionLayout = meta?.layout || 'standard';
        const headers = meta?.columnHeaders || [];
        const hasSignOff = meta?.signOff !== false; // Default to true
        const isCollapsed = collapsedSections.has(sectionKey);

        return (
          <div key={sectionKey} className="border rounded-lg overflow-hidden">
            {/* Section header — clickable to collapse/expand */}
            <div className="bg-blue-50 border-b border-blue-100 flex items-center">
              <button
                onClick={() => toggleSection(sectionKey)}
                className="flex-1 flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-100/40 transition-colors"
                title={isCollapsed ? 'Expand section' : 'Collapse section'}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-blue-700" /> : <ChevronDown className="h-3.5 w-3.5 text-blue-700" />}
                <h4 className="text-xs font-bold text-blue-800 uppercase flex-1">{meta?.label || sectionKey}</h4>
                {isUserAdded && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">Added</span>
                )}
                {!isCollapsed && sectionQs.length > 0 && (
                  <span className="text-[9px] text-blue-600">{sectionQs.length} row{sectionQs.length === 1 ? '' : 's'}</span>
                )}
              </button>
              {isUserAdded && currentUserIsRi && (
                <button
                  onClick={() => deleteCustomSection(sectionKey)}
                  className="px-2 py-2 text-red-600 hover:bg-red-50 transition-colors"
                  title="Delete this user-added section (RI only)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {!isCollapsed && (<>

            {/* Table layout */}
            {layout !== 'standard' && headers.length > 0 ? (
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-slate-100 border-b">
                    {headers.map((h, i) => (
                      <th key={i} className={`px-2 py-1.5 font-semibold text-slate-600 ${i === 0 ? 'text-left w-[35%]' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectionQs.map(q => {
                    // Sub-header rows span the whole table width. They
                    // carry no answer and don't route through the
                    // question-column rendering below.
                    if (q.inputType === 'subheader') {
                      return (
                        <tr key={q.id} className="bg-slate-100/80 border-b border-slate-200">
                          <td colSpan={headers.length} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                            {q.questionText}
                          </td>
                        </tr>
                      );
                    }
                    // For table layout the question text lives in col0 → check that for a source marker
                    const firstColSource = answerSources[`${q.id}_col0`];
                    return (
                    <tr key={q.id} className={`border-b border-slate-50 ${q.isBold ? 'bg-slate-50' : ''} ${answers[`${q.id}_auto`] ? 'bg-yellow-50/50' : ''}`}>
                      {/* Column 0: Question text (first column) — editable
                          for user-added rows so the team can write their
                          own procedure description; read-only otherwise. */}
                      <td className={`px-2 py-1.5 ${q.isBold ? 'font-bold text-slate-700' : 'text-slate-600'}`}>
                        <span className="inline-flex items-center gap-1 w-full">
                          {isUserAdded ? (
                            <>
                              <textarea
                                value={q.questionText || ''}
                                onChange={e => updateCustomRowText(sectionKey, q.id, e.target.value)}
                                placeholder="Describe the procedure / point..."
                                rows={1}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-blue-300 min-h-[28px] resize-y"
                              />
                              <button
                                onClick={() => deleteCustomRow(sectionKey, q.id)}
                                className="text-red-500 hover:text-red-700 flex-shrink-0"
                                title="Delete row"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          ) : q.questionText}
                          {firstColSource && (
                            <button
                              type="button"
                              onClick={() => navigateToSource(firstColSource)}
                              className="text-blue-500 hover:text-blue-700"
                              title={sourceTooltip(firstColSource)}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      </td>
                      {/* Remaining columns: editable cells */}
                      {headers.slice(1).map((_, ci) => {
                        const cellKey = `${q.id}_col${ci + 1}`;
                        const cellSource = answerSources[cellKey];
                        return (
                          <td key={ci} className="px-1 py-0.5">
                            {q.isBold ? null : (
                              <div className="flex items-start gap-1">
                                <div className="flex-1 min-w-0">
                                  {q.inputType === 'dropdown' && q.dropdownOptions ? (
                                    <select
                                      value={answers[cellKey] || ''}
                                      onChange={e => updateAnswer(q.id, `col${ci + 1}`, e.target.value)}
                                      className="w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-blue-300"
                                    >
                                      <option value="">Select...</option>
                                      {q.dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                  ) : (
                                    <textarea
                                      value={answers[cellKey] || ''}
                                      onChange={e => updateAnswer(q.id, `col${ci + 1}`, e.target.value)}
                                      rows={1}
                                      className={`w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-blue-300 min-h-[28px] resize-y ${
                                        cellSource ? 'bg-yellow-50' : ''
                                      }`}
                                    />
                                  )}
                                </div>
                                {cellSource && (
                                  <button
                                    type="button"
                                    onClick={() => navigateToSource(cellSource)}
                                    className="mt-1 text-blue-500 hover:text-blue-700 flex-shrink-0"
                                    title={sourceTooltip(cellSource)}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </button>
                                )}
                                {/* Per-cell AI Populate button — only on
                                    the primary response column (col1) to
                                    avoid clutter on wide tables. */}
                                {ci + 1 === 1 && q.questionText?.trim() && (templateType === 'update_procedures_questions' || templateType === 'completion_checklist_questions' || templateType === 'overall_review_fs_questions') && (
                                  <button
                                    type="button"
                                    onClick={() => populateCell(q.id, `col${ci + 1}`, q.questionText, meta?.label, headers[ci + 1])}
                                    disabled={populatingCells.has(`${q.id}_col${ci + 1}`) || bulkPopulating}
                                    className="mt-1 text-blue-500 hover:text-blue-700 flex-shrink-0 disabled:opacity-50"
                                    title={aiPopulateMode() === 'procedure' ? 'AI-write this procedure' : 'AI-find references for this row'}
                                  >
                                    {populatingCells.has(`${q.id}_col${ci + 1}`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* Standard Q&A layout */
              <div className="divide-y divide-slate-100">
                {sectionQs.map(q => {
                  // Sub-headers render as an inline grouping heading.
                  if (q.inputType === 'subheader') {
                    return (
                      <div key={q.id} className="px-3 py-2 bg-slate-100/70">
                        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">{q.questionText}</h5>
                      </div>
                    );
                  }
                  const cellKey = `${q.id}_col1`;
                  const cellSource = answerSources[cellKey];
                  return (
                  <div key={q.id} className="p-3 space-y-1.5">
                    {isUserAdded ? (
                      <div className="flex items-start gap-1">
                        <textarea
                          value={q.questionText || ''}
                          onChange={e => updateCustomRowText(sectionKey, q.id, e.target.value)}
                          placeholder="Describe the procedure / point..."
                          rows={1}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs font-medium focus:outline-none focus:border-blue-300 min-h-[32px] resize-y"
                        />
                        <button
                          onClick={() => deleteCustomRow(sectionKey, q.id)}
                          className="mt-1.5 text-red-500 hover:text-red-700 flex-shrink-0"
                          title="Delete row"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className={`text-xs ${q.isBold ? 'font-bold text-slate-700' : 'text-slate-600'}`}>{q.questionText}</div>
                    )}
                    {!q.isBold && (
                      <div className="flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          {q.inputType === 'dropdown' && q.dropdownOptions ? (
                            <select
                              value={answers[cellKey] || ''}
                              onChange={e => updateAnswer(q.id, 'col1', e.target.value)}
                              className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300"
                            >
                              <option value="">Select...</option>
                              {q.dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          ) : (
                            <textarea
                              value={answers[cellKey] || ''}
                              onChange={e => updateAnswer(q.id, 'col1', e.target.value)}
                              placeholder="Enter response..."
                              className={`w-full border border-slate-200 rounded px-2 py-1.5 text-xs min-h-[40px] focus:outline-none focus:border-blue-300 ${cellSource ? 'bg-yellow-50' : ''}`}
                            />
                          )}
                        </div>
                        {cellSource && (
                          <button
                            type="button"
                            onClick={() => navigateToSource(cellSource)}
                            className="mt-1.5 text-blue-500 hover:text-blue-700 flex-shrink-0"
                            title={sourceTooltip(cellSource)}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                        {/* Per-row AI Populate button */}
                        {q.questionText?.trim() && (templateType === 'update_procedures_questions' || templateType === 'completion_checklist_questions' || templateType === 'overall_review_fs_questions') && (
                          <button
                            type="button"
                            onClick={() => populateCell(q.id, 'col1', q.questionText, meta?.label, headers[1])}
                            disabled={populatingCells.has(`${q.id}_col1`) || bulkPopulating}
                            className="mt-1.5 text-blue-500 hover:text-blue-700 flex-shrink-0 disabled:opacity-50"
                            title={aiPopulateMode() === 'procedure' ? 'AI-write this procedure' : 'AI-find references for this row'}
                          >
                            {populatingCells.has(`${q.id}_col1`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {/* "+ Add row" control for user-added sections. Template sections
                have a fixed question list so this only appears on sections
                the user created themselves. */}
            {isUserAdded && (
              <div className="flex justify-start px-3 py-2 border-t border-slate-100 bg-white">
                <button
                  onClick={() => addCustomRow(sectionKey)}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded"
                >
                  <Plus className="h-3 w-3" /> Add row
                </button>
              </div>
            )}

            {/* Section sign-off — EQR dot only when an EQR is on the team */}
            {hasSignOff && (
              <div className="flex items-center gap-6 justify-center py-2 border-t border-slate-100 bg-slate-50/30">
                {(hasEQROnTeam(teamMembers) ? ['preparer', 'reviewer', 'ri', 'eqr'] : ['preparer', 'reviewer', 'ri']).map(role => {
                  const key = `${sectionKey}_${role}`;
                  const so = signOffs[key];
                  const isSigned = !!so;
                  const dateStr = so?.timestamp ? new Date(so.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
                  const canSign = canUserSign(role, userId, teamMembers);
                  return (
                    <div key={role} className="flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => canSign && handleSectionSignOff(sectionKey, role)}
                        disabled={!canSign && !isSigned}
                        className={`w-5 h-5 rounded-full border-2 transition-colors ${
                          isSigned
                            ? 'bg-green-500 border-green-500'
                            : canSign
                              // Unsigned dots default to the blank (slate) look — matches
                              // the main Preparer/Reviewer/Partner dots and stops the RI
                              // dot appearing green just because the logged-in user holds
                              // the role. Hover tint provides the click affordance.
                              ? 'border-slate-300 hover:border-green-400 hover:bg-green-50 cursor-pointer'
                              : 'border-slate-200 cursor-not-allowed opacity-50'
                        }`}
                        title={
                          isSigned ? `${so.userName} — ${dateStr}` :
                          canSign ? `Sign as ${role === 'ri' ? 'RI' : role === 'eqr' ? 'EQR' : role}` :
                          roleNotAllowedTooltip(role)
                        }
                      >
                        {isSigned && <CheckCircle2 className="h-3 w-3 text-white mx-auto" />}
                      </button>
                      <span className="text-[7px] text-slate-500 font-medium capitalize">{role === 'ri' ? 'RI' : role === 'eqr' ? 'EQR' : role.charAt(0).toUpperCase() + role.slice(1)}</span>
                      {isSigned && <span className="text-[6px] text-green-600">{so.userName}</span>}
                      {isSigned && dateStr && <span className="text-[6px] text-slate-400">{dateStr}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            </>)}
          </div>
        );
      })}

      {/* Add a new (user-defined) section — inserts below the template
          sections. The user is prompted for a label; the section inherits
          the same column headers as the tab's default layout and starts
          with one empty row. Anyone on the engagement team can add;
          delete is restricted to the RI (see deleteCustomSection). */}
      <div className="flex justify-center pt-1">
        <button
          onClick={addCustomSection}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded border border-blue-200 border-dashed"
        >
          <Plus className="h-3.5 w-3.5" /> Add section
        </button>
      </div>
    </div>
  );
}

// ─── Financial Statement Review ───

function FinancialStatementReview({ engagementId }: { engagementId: string }) {
  const [tbRows, setTbRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/trial-balance`);
        if (res.ok) { const data = await res.json(); setTbRows(data.rows || []); }
      } catch {} finally { setLoading(false); }
    })();
  }, [engagementId]);

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading...</div>;

  const byStatement = new Map<string, any[]>();
  for (const row of tbRows) {
    const stmt = row.fsStatement || 'Unclassified';
    if (!byStatement.has(stmt)) byStatement.set(stmt, []);
    byStatement.get(stmt)!.push(row);
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-700">Financial Statement Review</h3>
      {Array.from(byStatement.entries()).map(([stmt, rows]) => {
        const totalCY = rows.reduce((s: number, r: any) => s + (Number(r.currentYear) || 0), 0);
        const totalPY = rows.reduce((s: number, r: any) => s + (Number(r.priorYear) || 0), 0);
        return (
          <div key={stmt} className="border rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">{stmt}</span>
              <span className="text-[10px] text-slate-500">CY: {totalCY.toLocaleString('en-GB', { minimumFractionDigits: 2 })} | PY: {totalPY.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
            </div>
            <table className="w-full text-[10px]">
              <thead><tr className="bg-slate-50 border-b">
                <th className="text-left px-2 py-1 text-slate-600">Account</th>
                <th className="text-left px-2 py-1 text-slate-600">Description</th>
                <th className="text-left px-2 py-1 text-slate-600">FS Level</th>
                <th className="text-right px-2 py-1 text-slate-600">Current Year</th>
                <th className="text-right px-2 py-1 text-slate-600">Prior Year</th>
                <th className="text-right px-2 py-1 text-slate-600">Variance</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, 100).map((row: any) => {
                  const cy = Number(row.currentYear) || 0;
                  const py = Number(row.priorYear) || 0;
                  const v = cy - py;
                  return (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-2 py-1 font-mono text-slate-500">{row.accountCode}</td>
                      <td className="px-2 py-1 text-slate-700">{row.description}</td>
                      <td className="px-2 py-1 text-slate-400">{row.fsLevel || ''}</td>
                      <td className="px-2 py-1 text-right font-mono">{cy.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{py.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className={`px-2 py-1 text-right font-mono ${v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {v.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ({py !== 0 ? ((v / Math.abs(py)) * 100).toFixed(1) : '0.0'}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
