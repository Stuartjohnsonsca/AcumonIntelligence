'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, CheckSquare, ClipboardList, BarChart3, Eye, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, Loader2, Sparkles, ShieldAlert, ShieldCheck, ExternalLink } from 'lucide-react';
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
  | { kind: 'error-schedule'; itemId?: string };

interface Props {
  engagementId: string;
  clientId: string;
  userRole?: string;
  userId?: string;
  userName?: string;
  teamMembers?: TeamMember[];
  /** Ordered list of schedule keys for the Completion stage (from Part E config) */
  completionScheduleOrder?: string[];
  /** Per-schedule visibility conditions (from Part E config) */
  scheduleConditions?: Record<string, { requiresListed?: boolean; requiresEQR?: boolean; requiresPriorPeriod?: boolean; requiresFirstYear?: boolean }>;
  /** From engagement payload for visibility evaluation */
  clientIsListed?: boolean;
  hasPriorPeriodEngagement?: boolean;
  onNavigateMainTab?: (tabKey: string, params?: Record<string, string>) => void;
  onClose?: () => void;
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

type CompletionTabKey = typeof COMPLETION_TABS[number]['key'];

export function CompletionPanel({
  engagementId, clientId, userRole, userId, userName, teamMembers,
  completionScheduleOrder, scheduleConditions, clientIsListed, hasPriorPeriodEngagement,
  onNavigateMainTab, onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<CompletionTabKey>('summary-memo');

  // Visibility helper for sub-tabs (Part G applied to completion sub-tabs too)
  const teamHasEQR = !!teamMembers?.some(m => m.role === 'EQR');
  function passesConditions(scheduleKey: string): boolean {
    const c = scheduleConditions?.[scheduleKey];
    if (!c) return true;
    if (c.requiresListed && !clientIsListed) return false;
    if (c.requiresEQR && !teamHasEQR) return false;
    if (c.requiresPriorPeriod && !hasPriorPeriodEngagement) return false;
    if (c.requiresFirstYear && hasPriorPeriodEngagement) return false;
    return true;
  }

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
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-md whitespace-nowrap transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}>
              <Icon className="h-3 w-3" /> {tab.label}
            </button>
          );
        })}
        {onClose && <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600 px-2">Close</button>}
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

  // Load template + engagement answers
  useEffect(() => {
    (async () => {
      try {
        // Load template
        const tplRes = await fetch(`/api/methodology-admin/templates?templateType=${templateType}&auditType=ALL`);
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

  function debounceSave(data: Record<string, any>, so?: Record<string, any>, srcs?: Record<string, AnswerSource>) {
    if (saveTimeout) clearTimeout(saveTimeout);
    const t = setTimeout(async () => {
      try {
        await fetch(`/api/engagements/${engagementId}/permanent-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_data',
            section: templateType,
            data: { [templateType]: { answers: data || answers, signOffs: so || signOffs, answerSources: srcs || answerSources } },
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
    }
  }

  function sourceTooltip(source: AnswerSource): string {
    switch (source.kind) {
      case 'materiality': return 'Source: Materiality tab — click to open';
      case 'rmm': return source.label ? `Source: RMM — "${source.label}" — click to open` : 'Source: RMM tab — click to open';
      case 'test-conclusion': return source.label ? `Source: Test Conclusions — "${source.label}" — click to open` : 'Source: Test Summary Results — click to open';
      case 'error-schedule': return 'Source: Error Schedule — click to open';
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        {showAutoComplete && (
          <button onClick={handleAutoComplete} disabled={autoCompleting}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50">
            {autoCompleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {autoCompleting ? 'Auto-Completing...' : 'Auto-Complete'}
          </button>
        )}
      </div>

      {/* Sections */}
      {Array.from(sections.entries()).map(([sectionKey, sectionQs]) => {
        const meta = sectionMeta[sectionKey];
        const layout: SectionLayout = meta?.layout || 'standard';
        const headers = meta?.columnHeaders || [];
        const hasSignOff = meta?.signOff !== false; // Default to true

        return (
          <div key={sectionKey} className="border rounded-lg overflow-hidden">
            {/* Section header */}
            <div className="bg-blue-50 px-3 py-2 border-b border-blue-100">
              <h4 className="text-xs font-bold text-blue-800 uppercase">{meta?.label || sectionKey}</h4>
            </div>

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
                    // For table layout the question text lives in col0 → check that for a source marker
                    const firstColSource = answerSources[`${q.id}_col0`];
                    return (
                    <tr key={q.id} className={`border-b border-slate-50 ${q.isBold ? 'bg-slate-50' : ''} ${answers[`${q.id}_auto`] ? 'bg-yellow-50/50' : ''}`}>
                      {/* Column 0: Question text (first column) */}
                      <td className={`px-2 py-1.5 ${q.isBold ? 'font-bold text-slate-700' : 'text-slate-600'}`}>
                        <span className="inline-flex items-center gap-1">
                          {q.questionText}
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
                  const cellKey = `${q.id}_col1`;
                  const cellSource = answerSources[cellKey];
                  return (
                  <div key={q.id} className="p-3 space-y-1.5">
                    <div className={`text-xs ${q.isBold ? 'font-bold text-slate-700' : 'text-slate-600'}`}>{q.questionText}</div>
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
                      </div>
                    )}
                  </div>
                  );
                })}
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
                              ? 'border-green-400 hover:bg-green-50 cursor-pointer'
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
          </div>
        );
      })}
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
