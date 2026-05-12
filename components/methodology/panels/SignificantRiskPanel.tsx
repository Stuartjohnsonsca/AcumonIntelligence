'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronUp, AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { PlanCustomiserModal } from './PlanCustomiserModal';

interface RMMRow {
  id: string;
  lineItem: string;
  riskIdentified: string | null;
  assertions: string[] | null;
  overallRisk: string | null;
  finalRiskAssessment: string | null;
}

interface TestAllocation {
  id: string;
  testId: string;
  fsLineId?: string;
  fsLine: { id: string; name: string };
  test: { id: string; name: string; significantRisk: boolean; description?: string | null; testTypeCode?: string; assertions?: string[] | null; framework?: string };
}

interface FsLineSummary { id: string; name: string }

interface TestConclusion {
  executionId?: string;
  fsLine?: string;
  testDescription?: string;
  conclusion?: 'green' | 'orange' | 'red' | 'pending';
  totalErrors?: number;
  extrapolatedError?: number;
}

interface CustomTest { name: string; outcome: string; }
interface ChallengeRow { challenge: string; response: string; conclusion: string; }
interface MisstatementRow {
  glCode: string; description: string; dr: number | string; cr: number | string;
  corrected: string; type: string;
}

interface RiskAnswers {
  riskDescription?: string;
  impactedAssertions?: string;
  estimates?: string;
  controlDeficiencies?: string;
  operatingEffectiveness?: string;
  testingApproach?: 'substantive' | 'controls' | 'defrayment' | '';
  changesToRisk?: string;
  customTests?: CustomTest[];
  auditExperts?: Record<string, string>;
  managementExpert?: Record<string, string>;
  professionalSkepticism?: string;
  challenges?: ChallengeRow[];
  consultation?: Record<string, string>;
  discussionRI?: string;
  discussionEQR?: string;
  misstatements?: MisstatementRow[];
  other?: Record<string, string>;
  standback?: string;
  difficulties?: string;
  conclusion?: string;
}

interface RiskRecord {
  answers: RiskAnswers;
  signOffs: Record<string, { userId: string; userName: string; timestamp: string }>;
}

type TeamMember = { userId: string; userName?: string; role: string };

interface Props {
  engagementId: string;
  userId?: string;
  userName?: string;
  teamMembers?: TeamMember[];
}

const SIGN_OFF_ROLES_BASE = [
  { key: 'preparer', label: 'Preparer' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'ri', label: 'RI' },
];
const SIGN_OFF_ROLES_WITH_EQR = [...SIGN_OFF_ROLES_BASE, { key: 'eqr', label: 'EQR' }];

// Mirrors CompletionPanel's role map (preparer/reviewer/ri/eqr).
const SIG_ROLE_MAP: Record<string, string> = { Junior: 'preparer', Manager: 'reviewer', RI: 'ri', EQR: 'eqr' };

function canSignSigRisk(role: string, userId: string | undefined, teamMembers: TeamMember[] | undefined): boolean {
  if (!userId || !teamMembers || teamMembers.length === 0) return false;
  return teamMembers.some(m => SIG_ROLE_MAP[m.role] === role && m.userId === userId);
}

const AUDIT_EXPERT_QUESTIONS = [
  'Did the engagement team involve audit experts / specialists in addressing the significant risk?',
  'Did audit team obtain confirmation from expert with regard to compliance with FRC Ethical Standard 2024?',
  'Has the audit team issued instructions to expert/specialist setting the scope of work?',
  'Is there any change in scope during the engagement? If there is a change in scope, did the engagement issue revised instructions to the expert?',
  'Has the audit team evaluated adequacy of auditor\u2019s expert/specialists work as required under ISA (UK) 620?',
  'Has the audit team tested the source data used by experts in his work?',
  'Did the audit team identify any caveats included in the report provided by auditor\u2019s expert/specialist?',
  'Provide list of those caveats and explain how audit team has concluded that the audit team can place reliance on the report irrespective of those conclusions?',
  'Provide MWP reference to the signed report received from auditor\u2019s expert/specialist.',
];

const MANAGEMENT_EXPERT_QUESTIONS = [
  'With respect to the identified significant risk, did use management expert?',
  'Did the audit team obtain a copy of the engagement letter signed by the entity with management expert?',
  'Did the audit team ensure that the management expert is compliant with FRC Ethical Standard?',
  'Provide detail of how audit team have obtained an understanding of the work performed by expert (reviewing relevance/reasonableness of findings, assumptions/methods, source data, reliability of external information).',
];

const CONSULTATION_QUESTIONS = [
  'Nature of issue that require consultation',
  'Conclusion reached relating to the issue',
  'Evidence of sign off by technical team relating to consultation',
  'Explain how the audit team has ensured that conclusions reached with the Audit Technical Team is implemented.',
];

const OTHER_QUESTIONS = [
  'Has the audit team considered whether misstatements identified indicate possible fraud or deficiencies in internal controls?',
  'Has the auditor communicated all uncorrected misstatements (if any) to those charged with governance, as required by ISA (UK) 450? (provide reference to the workpaper)',
  'Based on the misstatements listed above, has the audit team identified any impact on other areas of the financial statements?',
];

// ─── Collapsible Section ──────────────────────────────────────────────
// `hasContent` controls the auto-expand-when-filled / auto-collapse-when-
// empty behaviour requested by the audit team — sections with text
// already in them open on first render so reviewers don't have to
// click through every empty section to find the populated ones.
// `defaultOpen` is the explicit override (used on Risk Description and
// Conclusion regardless of content). The user can still toggle either
// way after load.
function Section({ title, children, defaultOpen = false, hasContent = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean; hasContent?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || hasContent);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {open && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}

// Auto-sizing textarea — rows defaults to 1 then grows with the
// content, capped by maxRows. Used in the Significant Risk panel so
// that pre-populated text is fully visible on open without the user
// having to drag-resize the box. Falls back to the static rows
// prop until the user types.
function AutoTextarea({ value, onChange, placeholder, minRows = 2, maxRows = 18, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number; maxRows?: number; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Resize on mount + every value change so prefilled text shows
  // in full, and the box keeps growing as the user types.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineH = 16; // ~text-xs line height
    const min = minRows * lineH + 12;
    const max = maxRows * lineH + 12;
    const next = Math.min(Math.max(el.scrollHeight, min), max);
    el.style.height = `${next}px`;
  }, [value, minRows, maxRows]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={minRows}
      className={`w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y overflow-hidden ${className}`}
    />
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────
export function SignificantRiskPanel({ engagementId, userId, userName, teamMembers }: Props) {
  const { data: session } = useSession();
  const [rmmRows, setRmmRows] = useState<RMMRow[]>([]);
  const [records, setRecords] = useState<Record<string, RiskRecord>>({});
  const [allocations, setAllocations] = useState<TestAllocation[]>([]);
  const [conclusions, setConclusions] = useState<TestConclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  // Plan Customiser — scoped to the active risk's FS Line so the auditor
  // can add custom tests / mark tests N/A without leaving the panel.
  const [fsLines, setFsLines] = useState<FsLineSummary[]>([]);
  const [planCustomiserOpen, setPlanCustomiserOpen] = useState(false);
  const [planCustomiserAllocated, setPlanCustomiserAllocated] = useState<any[]>([]);
  const [planCustomiserContext, setPlanCustomiserContext] = useState<{ fsLineId: string; fsLineName: string } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [rmmRes, sigRes, allocRes, concRes, fsRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/rmm`),
        fetch(`/api/engagements/${engagementId}/significant-risk`),
        fetch(`/api/engagements/${engagementId}/test-allocations`),
        fetch(`/api/engagements/${engagementId}/test-conclusions`),
        fetch(`/api/firm/fs-lines`),
      ]);

      if (rmmRes.ok) {
        const data = await rmmRes.json();
        const rows: RMMRow[] = (data.rows || []).filter((r: any) =>
          r.overallRisk === 'High' || r.overallRisk === 'Very High' || r.finalRiskAssessment === 'High' || r.finalRiskAssessment === 'Very High'
        );
        setRmmRows(rows);
        if (rows.length > 0 && !activeRiskId) setActiveRiskId(rows[0].id);
      }

      if (sigRes.ok) {
        const data = await sigRes.json();
        setRecords(data.records || {});
      }

      if (allocRes.ok) {
        const data = await allocRes.json();
        setAllocations(data.allocations || data.rows || []);
      }

      if (concRes.ok) {
        const data = await concRes.json();
        setConclusions(data.conclusions || data.rows || []);
      }

      if (fsRes.ok) {
        const data = await fsRes.json();
        setFsLines(Array.isArray(data?.fsLines) ? data.fsLines : []);
      }
    } catch (err) {
      console.error('[SignificantRisk] load failed:', err);
    }
    setLoading(false);
  }, [engagementId, activeRiskId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Plan Customiser button now lives in the Completion tab strip (so
  // it shares the row with the top tabs). It dispatches this event
  // when clicked; this panel still owns the modal + active-risk
  // context, so we open the customiser locally on receipt. Matched
  // by engagementId so a second open engagement in another tab
  // doesn't react. We route through a ref so the listener always
  // calls the latest function (active risk / fsLines can change).
  const openPlanCustomiserRef = useRef<() => void>(() => {});
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { engagementId?: string } | undefined;
      if (detail?.engagementId !== engagementId) return;
      openPlanCustomiserRef.current();
    }
    window.addEventListener('engagement:open-plan-customiser', onOpen);
    return () => window.removeEventListener('engagement:open-plan-customiser', onOpen);
  }, [engagementId]);

  // Roll up Reviewer + RI sign-off state across every significant
  // risk and broadcast it to CompletionPanel so the tab-strip dots
  // stay in sync with the per-risk dots inside this panel. Green
  // only when every risk has the role signed; pending otherwise.
  useEffect(() => {
    if (loading) return;
    try {
      const total = rmmRows.length;
      const reviewerOk = total > 0 && rmmRows.every(r => !!records[r.id]?.signOffs?.reviewer?.timestamp);
      const riOk = total > 0 && rmmRows.every(r => !!records[r.id]?.signOffs?.ri?.timestamp);
      window.dispatchEvent(new CustomEvent('engagement:significant-risk-signoffs', {
        detail: {
          engagementId,
          reviewer: reviewerOk ? 'green' : 'pending',
          ri: riOk ? 'green' : 'pending',
        },
      }));
    } catch {}
  }, [engagementId, rmmRows, records, loading]);

  const activeRisk = rmmRows.find(r => r.id === activeRiskId);
  const activeRecord = activeRiskId ? records[activeRiskId] : undefined;
  const activeAnswers = activeRecord?.answers || {};

  // Pre-fill defaults from RMM seed only. Order of preference per
  // field: completion-stage answer wins, then RMM seed, then empty.
  const effectiveAnswers: RiskAnswers = {
    riskDescription: activeAnswers.riskDescription ?? activeRisk?.riskIdentified ?? '',
    impactedAssertions: activeAnswers.impactedAssertions ?? (activeRisk?.assertions?.join(', ') || ''),
    estimates: activeAnswers.estimates ?? '',
    controlDeficiencies: activeAnswers.controlDeficiencies ?? '',
    operatingEffectiveness: activeAnswers.operatingEffectiveness ?? '',
    testingApproach: activeAnswers.testingApproach ?? '',
    changesToRisk: activeAnswers.changesToRisk ?? '',
    customTests: activeAnswers.customTests ?? [],
    auditExperts: activeAnswers.auditExperts ?? {},
    managementExpert: activeAnswers.managementExpert ?? {},
    professionalSkepticism: activeAnswers.professionalSkepticism ?? '',
    challenges: activeAnswers.challenges ?? [],
    consultation: activeAnswers.consultation ?? {},
    discussionRI: activeAnswers.discussionRI ?? '',
    discussionEQR: activeAnswers.discussionEQR ?? '',
    misstatements: activeAnswers.misstatements ?? [],
    other: activeAnswers.other ?? {},
    standback: activeAnswers.standback ?? '',
    difficulties: activeAnswers.difficulties ?? '',
    conclusion: activeAnswers.conclusion ?? '',
  };

  // Helper to test whether a string field has user-visible content
  // — used to drive the Section auto-expand behaviour.
  const hasText = (s?: string | null) => !!(s && s.toString().trim().length > 0);
  const hasArr = (a?: any[]) => Array.isArray(a) && a.length > 0;
  const hasRecord = (r?: Record<string, string>) => !!r && Object.values(r).some(v => hasText(v));

  function updateAnswer<K extends keyof RiskAnswers>(key: K, value: RiskAnswers[K]) {
    if (!activeRiskId) return;
    setRecords(prev => {
      const existing = prev[activeRiskId] || { answers: {}, signOffs: {} };
      return {
        ...prev,
        [activeRiskId]: {
          ...existing,
          answers: { ...existing.answers, [key]: value },
        },
      };
    });

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await fetch(`/api/engagements/${engagementId}/significant-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          rmmRowId: activeRiskId,
          answers: { [key]: value },
        }),
      });
      setSaving(false);
    }, 1000);
  }

  async function handleSignOff(rmmRowId: string, role: string) {
    if (!canSignSigRisk(role, session?.user?.id || userId, teamMembers)) return;
    const record = records[rmmRowId] || { answers: {}, signOffs: {} };
    const existing = record.signOffs[role];
    const isUnsigning = existing?.userId === (session?.user?.id || userId);
    const res = await fetch(`/api/engagements/${engagementId}/significant-risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isUnsigning ? 'unsignoff' : 'signoff', rmmRowId, role }),
    });
    if (res.ok) {
      const data = await res.json();
      setRecords(prev => ({
        ...prev,
        [rmmRowId]: {
          answers: prev[rmmRowId]?.answers || {},
          signOffs: data.signOffs || {},
        },
      }));
    }
  }

  // Find tests linked to this risk (by FS Line name match and significantRisk flag).
  // Defined BEFORE the early returns below so the sectionOrder useMemo
  // further down is reached on every render — React error #310
  // ("rendered more hooks than during the previous render") fires
  // otherwise when `loading` transitions from true to false.
  const relevantTests = activeRisk
    ? allocations.filter(a =>
        a.test?.significantRisk &&
        (a.fsLine?.name === activeRisk.lineItem || !activeRisk.lineItem)
      )
    : [];

  // Match conclusions by fsLine + testDescription
  const getTestConclusion = (testName: string, fsLine: string) => {
    return conclusions.find(c =>
      (c.fsLine === fsLine || !fsLine) &&
      (c.testDescription === testName || (testName && c.testDescription?.includes(testName)))
    );
  };

  // Resolve an FS Line id from the active risk's lineItem so the
  // Plan Customiser modal can scope to the right line. Mirrors
  // AuditPlanPanel's fallback chain (exact → ci → synthetic).
  function resolveFsLine(name: string | undefined): { id: string; name: string } {
    const fallback = name || 'Significant Risk';
    if (!name) return { id: `__synthetic__${fallback}`, name: fallback };
    const lower = name.toLowerCase().trim();
    let fl = fsLines.find(f => f.name === name);
    if (!fl) fl = fsLines.find(f => f.name.toLowerCase().trim() === lower);
    if (fl) return { id: fl.id, name: fl.name };
    return { id: `__synthetic__${name}`, name };
  }

  async function openPlanCustomiser() {
    // RI may always open the customiser — even when no significant
    // risk is selected — so they can pull more work into the plan
    // without the panel state blocking them. Falls back to a
    // synthetic "Significant Risks" scope when no risk is active.
    const ctx = activeRisk
      ? resolveFsLine(activeRisk.lineItem)
      : { id: '__synthetic__Significant Risks', name: 'Significant Risks' };
    setPlanCustomiserContext({ fsLineId: ctx.id, fsLineName: ctx.name });
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-allocations`);
      if (res.ok) {
        const data = await res.json();
        const allocated = (data.allocations || data.rows || [])
          .filter((a: any) => (a.fsLineId === ctx.id || a.fsLine?.id === ctx.id) && a.test)
          .map((a: any) => ({
            id: a.test.id,
            name: a.test.name,
            description: a.test.description,
            testTypeCode: a.test.testTypeCode,
            assertions: a.test.assertions,
            framework: a.test.framework,
          }));
        setPlanCustomiserAllocated(allocated);
      } else {
        setPlanCustomiserAllocated([]);
      }
    } catch {
      setPlanCustomiserAllocated([]);
    }
    setPlanCustomiserOpen(true);
  }

  // Keep the listener's ref pointed at the latest openPlanCustomiser
  // closure (so it sees the freshest activeRisk / fsLines).
  openPlanCustomiserRef.current = openPlanCustomiser;

  const visibleRoles = teamMembers?.some(m => m.role === 'EQR') ? SIGN_OFF_ROLES_WITH_EQR : SIGN_OFF_ROLES_BASE;

  // ─── Section render order ──────────────────────────────────────
  // Audit team wanted Conclusion pinned at the top, then the rest of
  // the form top-down in its original order BUT with empty sections
  // pushed below populated ones — so the auditor lands on the work
  // that already has content and can scroll down for the gaps. The
  // order is frozen at the time a risk is selected (or the tab is
  // entered, which remounts this panel) so a section the user just
  // started typing in doesn't jump up the page on every keystroke.
  // Each entry carries its own hasContent flag so the Section's
  // built-in "open when has content" auto-expand still works.

  const sectionDescriptors = [
    { key: 'risk-description',         hasContent: hasText(effectiveAnswers.riskDescription) },
    { key: 'impacted-assertions',      hasContent: hasText(effectiveAnswers.impactedAssertions) },
    { key: 'estimates',                hasContent: hasText(effectiveAnswers.estimates) },
    { key: 'control-deficiencies',     hasContent: hasText(effectiveAnswers.controlDeficiencies) },
    { key: 'operating-effectiveness',  hasContent: hasText(effectiveAnswers.operatingEffectiveness) },
    { key: 'testing-approach',         hasContent: hasText(effectiveAnswers.testingApproach) },
    { key: 'changes-to-risk',          hasContent: hasText(effectiveAnswers.changesToRisk) },
    { key: 'procedures',               hasContent: relevantTests.length > 0 || hasArr(effectiveAnswers.customTests) },
    { key: 'audit-experts',            hasContent: hasRecord(effectiveAnswers.auditExperts as Record<string, string>) },
    { key: 'management-expert',        hasContent: hasRecord(effectiveAnswers.managementExpert as Record<string, string>) },
    { key: 'professional-skepticism',  hasContent: hasText(effectiveAnswers.professionalSkepticism) },
    { key: 'challenges',               hasContent: hasArr(effectiveAnswers.challenges) },
    { key: 'consultation',             hasContent: hasRecord(effectiveAnswers.consultation as Record<string, string>) },
    { key: 'discussion-ri',            hasContent: hasText(effectiveAnswers.discussionRI) },
    { key: 'discussion-eqr',           hasContent: hasText(effectiveAnswers.discussionEQR) },
    { key: 'misstatements',            hasContent: hasArr(effectiveAnswers.misstatements) },
    { key: 'other',                    hasContent: hasRecord(effectiveAnswers.other as Record<string, string>) },
    { key: 'standback',                hasContent: hasText(effectiveAnswers.standback) },
    { key: 'difficulties',             hasContent: hasText(effectiveAnswers.difficulties) },
    { key: 'conclusion',               hasContent: true /* always pinned at top */ },
  ];

  // Freeze the order on risk-change so typing in a blank section
  // doesn't promote it past sections already filled in. Re-runs when
  // the user selects a different risk (or the panel remounts on tab
  // entry). React-hooks lint is happy without listing the snapshot
  // inputs because they're captured by closure at evaluation time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sectionOrder = useMemo(() => {
    const rest = sectionDescriptors.filter(s => s.key !== 'conclusion');
    return [
      'conclusion',
      ...rest.filter(s => s.hasContent).map(s => s.key),
      ...rest.filter(s => !s.hasContent).map(s => s.key),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRisk?.id]);

  // ─── Loading / empty-state gates ─────────────────────────────────
  // Placed AFTER every hook so all hooks (incl. sectionOrder useMemo
  // above) are called on every render. Putting these gates earlier
  // skipped the useMemo on first-render-while-loading and tripped
  // React error #310 once `loading` flipped to false.
  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading significant risks...</div>;

  if (rmmRows.length === 0) {
    return (
      <div className="text-center py-12 border border-slate-200 rounded-lg">
        <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-slate-300" />
        <p className="text-sm text-slate-400">No significant risks identified</p>
        <p className="text-xs text-slate-300 mt-1">Add Significant Risks in the RMM tab (overall risk = High or Very High)</p>
      </div>
    );
  }

  // Section content map — built each render so values stay live. The
  // order is computed once in sectionOrder above; this map just
  // looks up the node by key.
  const sectionsByKey: Record<string, React.ReactNode> = {
    'risk-description': (
      <Section title="Risk description" defaultOpen>
        <AutoTextarea value={effectiveAnswers.riskDescription || ''} onChange={v => updateAnswer('riskDescription', v)}
          minRows={3} placeholder="Describe the significant risk..." />
      </Section>
    ),
    'impacted-assertions': (
      <Section title="Impacted assertions" hasContent={hasText(effectiveAnswers.impactedAssertions)}>
        <AutoTextarea value={effectiveAnswers.impactedAssertions || ''} onChange={v => updateAnswer('impactedAssertions', v)} minRows={2} />
      </Section>
    ),
    'estimates': (
      <Section title="Significant estimates and judgements" hasContent={hasText(effectiveAnswers.estimates)}>
        <AutoTextarea value={effectiveAnswers.estimates || ''} onChange={v => updateAnswer('estimates', v)} minRows={3} />
      </Section>
    ),
    'control-deficiencies': (
      <Section title="Significant deficiencies in design and implementation of controls addressing the significant risk" hasContent={hasText(effectiveAnswers.controlDeficiencies)}>
        <AutoTextarea value={effectiveAnswers.controlDeficiencies || ''} onChange={v => updateAnswer('controlDeficiencies', v)} minRows={3} />
      </Section>
    ),
    'operating-effectiveness': (
      <Section title="Results of test of operating effectiveness of controls" hasContent={hasText(effectiveAnswers.operatingEffectiveness)}>
        <AutoTextarea value={effectiveAnswers.operatingEffectiveness || ''} onChange={v => updateAnswer('operatingEffectiveness', v)} minRows={3} />
      </Section>
    ),
    'testing-approach': (
      <Section title="Testing approach" hasContent={hasText(effectiveAnswers.testingApproach)}>
        <select value={effectiveAnswers.testingApproach || ''} onChange={e => updateAnswer('testingApproach', e.target.value as any)}
          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
          <option value="">Select approach...</option>
          <option value="substantive">Substantive</option>
          <option value="controls">Controls</option>
          <option value="defrayment">Defrayment</option>
        </select>
      </Section>
    ),
    'changes-to-risk': (
      <Section title="Changes to Assessed Risk" hasContent={hasText(effectiveAnswers.changesToRisk)}>
        <p className="text-[10px] text-slate-500 mb-1">Did audit team note any additional information that require reassessment of the identified significant risk?</p>
        <AutoTextarea value={effectiveAnswers.changesToRisk || ''} onChange={v => updateAnswer('changesToRisk', v)} minRows={3} />
      </Section>
    ),
    'procedures': (
      <Section title="Procedures" hasContent={relevantTests.length > 0 || hasArr(effectiveAnswers.customTests)}>
        <p className="text-[10px] text-slate-500 mb-2">Tests from the audit plan relating to this significant risk and their outcome</p>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden mb-2">
          <thead><tr className="bg-slate-100">
            <th className="px-2 py-1 text-left text-slate-500">Test</th>
            <th className="px-2 py-1 text-left text-slate-500 w-24">Outcome</th>
          </tr></thead>
          <tbody>
            {relevantTests.length === 0 ? (
              <tr><td colSpan={2} className="px-2 py-2 text-slate-400 italic text-center">No tests allocated to this risk yet</td></tr>
            ) : relevantTests.map(alloc => {
              const conc = getTestConclusion(alloc.test.name, alloc.fsLine.name);
              const dotClass = conc?.conclusion === 'green' ? 'bg-green-500' :
                               conc?.conclusion === 'orange' ? 'bg-orange-500' :
                               conc?.conclusion === 'red' ? 'bg-red-500' : 'bg-slate-300';
              return (
                <tr key={alloc.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <a href={`#test-${alloc.testId}`} className="text-blue-600 hover:underline">{alloc.test.name}</a>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                      <span className="text-slate-600">
                        {conc?.totalErrors != null ? `${conc.totalErrors} errors` : 'Not concluded'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(effectiveAnswers.customTests || []).map((ct, idx) => (
              <tr key={`custom-${idx}`} className="border-t border-slate-100 bg-amber-50/30">
                <td className="px-2 py-1.5">
                  <input type="text" value={ct.name} onChange={e => {
                    const next = [...(effectiveAnswers.customTests || [])];
                    next[idx] = { ...next[idx], name: e.target.value };
                    updateAnswer('customTests', next);
                  }} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5" />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <input type="text" value={ct.outcome} onChange={e => {
                      const next = [...(effectiveAnswers.customTests || [])];
                      next[idx] = { ...next[idx], outcome: e.target.value };
                      updateAnswer('customTests', next);
                    }} className="flex-1 text-[10px] border border-slate-200 rounded px-1 py-0.5" placeholder="Outcome" />
                    <button onClick={() => {
                      updateAnswer('customTests', (effectiveAnswers.customTests || []).filter((_, i) => i !== idx));
                    }} className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => updateAnswer('customTests', [...(effectiveAnswers.customTests || []), { name: '', outcome: '' }])}
          className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
          <Plus className="h-3 w-3 inline mr-1" />Add custom test
        </button>
      </Section>
    ),
    'audit-experts': (
      <Section title="Audit experts and specialists" hasContent={hasRecord(effectiveAnswers.auditExperts as Record<string, string>)}>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
          <tbody>
            {AUDIT_EXPERT_QUESTIONS.map((q, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-slate-600 w-1/2 align-top">{q}</td>
                <td className="px-2 py-1.5">
                  <textarea value={effectiveAnswers.auditExperts?.[idx] || ''}
                    onChange={e => updateAnswer('auditExperts', { ...(effectiveAnswers.auditExperts || {}), [idx]: e.target.value })}
                    rows={2} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 resize-y" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    ),
    'management-expert': (
      <Section title="Management expert" hasContent={hasRecord(effectiveAnswers.managementExpert as Record<string, string>)}>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
          <tbody>
            {MANAGEMENT_EXPERT_QUESTIONS.map((q, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-slate-600 w-1/2 align-top">{q}</td>
                <td className="px-2 py-1.5">
                  <textarea value={effectiveAnswers.managementExpert?.[idx] || ''}
                    onChange={e => updateAnswer('managementExpert', { ...(effectiveAnswers.managementExpert || {}), [idx]: e.target.value })}
                    rows={2} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 resize-y" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    ),
    'professional-skepticism': (
      <Section title="Professional skepticism" hasContent={hasText(effectiveAnswers.professionalSkepticism)}>
        <p className="text-[10px] text-slate-500 mb-1">Explain how audit team has exercised professional skepticism in relation to the audit of significant risk</p>
        <AutoTextarea value={effectiveAnswers.professionalSkepticism || ''} onChange={v => updateAnswer('professionalSkepticism', v)} minRows={4} />
      </Section>
    ),
    'challenges': (
      <Section title="Summary of challenges to management" hasContent={hasArr(effectiveAnswers.challenges)}>
        <p className="text-[10px] text-slate-500 mb-2">Summarise the challenges made by audit team to management, management responses, and audit team’s conclusion</p>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden mb-2">
          <thead><tr className="bg-slate-100">
            <th className="px-2 py-1 text-left text-slate-500">Challenge by audit team</th>
            <th className="px-2 py-1 text-left text-slate-500">Response from management</th>
            <th className="px-2 py-1 text-left text-slate-500">Conclusion</th>
            <th className="w-8"></th>
          </tr></thead>
          <tbody>
            {(effectiveAnswers.challenges || []).length === 0 ? (
              <tr><td colSpan={4} className="px-2 py-2 text-slate-400 italic text-center">No challenges recorded</td></tr>
            ) : (effectiveAnswers.challenges || []).map((row, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-1">
                  <textarea value={row.challenge} onChange={e => {
                    const next = [...(effectiveAnswers.challenges || [])];
                    next[idx] = { ...next[idx], challenge: e.target.value };
                    updateAnswer('challenges', next);
                  }} rows={2} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 resize-y" />
                </td>
                <td className="px-2 py-1">
                  <textarea value={row.response} onChange={e => {
                    const next = [...(effectiveAnswers.challenges || [])];
                    next[idx] = { ...next[idx], response: e.target.value };
                    updateAnswer('challenges', next);
                  }} rows={2} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 resize-y" />
                </td>
                <td className="px-2 py-1">
                  <textarea value={row.conclusion} onChange={e => {
                    const next = [...(effectiveAnswers.challenges || [])];
                    next[idx] = { ...next[idx], conclusion: e.target.value };
                    updateAnswer('challenges', next);
                  }} rows={2} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 resize-y" />
                </td>
                <td className="px-1 text-center">
                  <button onClick={() => updateAnswer('challenges', (effectiveAnswers.challenges || []).filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => updateAnswer('challenges', [...(effectiveAnswers.challenges || []), { challenge: '', response: '', conclusion: '' }])}
          className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
          <Plus className="h-3 w-3 inline mr-1" />Add row
        </button>
      </Section>
    ),
    'consultation': (
      <Section title="Consultation" hasContent={hasRecord(effectiveAnswers.consultation as Record<string, string>)}>
        <p className="text-[10px] text-slate-500 mb-2">Did the audit team identify any difficult or contentious matters requiring consultation?</p>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
          <tbody>
            {CONSULTATION_QUESTIONS.map((q, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-slate-600 w-1/2 align-top">{q}</td>
                <td className="px-2 py-1.5">
                  <textarea value={effectiveAnswers.consultation?.[idx] || ''}
                    onChange={e => updateAnswer('consultation', { ...(effectiveAnswers.consultation || {}), [idx]: e.target.value })}
                    rows={2} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5 resize-y" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    ),
    'discussion-ri': (
      <Section title="Summary of discussion with Audit Partner / RI" hasContent={hasText(effectiveAnswers.discussionRI)}>
        <p className="text-[10px] text-slate-500 mb-1">Summarise discussion with audit partner/RI including details of challenges raised and how they were addressed</p>
        <AutoTextarea value={effectiveAnswers.discussionRI || ''} onChange={v => updateAnswer('discussionRI', v)} minRows={4} />
      </Section>
    ),
    'discussion-eqr': (
      <Section title="Summary of Discussion with EQR" hasContent={hasText(effectiveAnswers.discussionEQR)}>
        <p className="text-[10px] text-slate-500 mb-1">Summarise discussion with EQR including challenges raised and how they were addressed</p>
        <AutoTextarea value={effectiveAnswers.discussionEQR || ''} onChange={v => updateAnswer('discussionEQR', v)} minRows={4} />
      </Section>
    ),
    'misstatements': (
      <Section title="Misstatements" hasContent={hasArr(effectiveAnswers.misstatements)}>
        <p className="text-[10px] text-slate-500 mb-2">List misstatements identified by the audit team with respect to the identified significant risk</p>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden mb-2">
          <thead><tr className="bg-slate-100">
            <th className="px-2 py-1 text-left text-slate-500">GL Code</th>
            <th className="px-2 py-1 text-left text-slate-500">Description</th>
            <th className="px-2 py-1 text-right text-slate-500">Dr</th>
            <th className="px-2 py-1 text-right text-slate-500">Cr</th>
            <th className="px-2 py-1 text-left text-slate-500">Status</th>
            <th className="px-2 py-1 text-left text-slate-500">Type</th>
            <th className="w-8"></th>
          </tr></thead>
          <tbody>
            {(effectiveAnswers.misstatements || []).length === 0 ? (
              <tr><td colSpan={7} className="px-2 py-2 text-slate-400 italic text-center">No misstatements recorded</td></tr>
            ) : (effectiveAnswers.misstatements || []).map((row, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-1 py-1">
                  <input type="text" value={row.glCode} onChange={e => {
                    const next = [...(effectiveAnswers.misstatements || [])];
                    next[idx] = { ...next[idx], glCode: e.target.value };
                    updateAnswer('misstatements', next);
                  }} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5" />
                </td>
                <td className="px-1 py-1">
                  <input type="text" value={row.description} onChange={e => {
                    const next = [...(effectiveAnswers.misstatements || [])];
                    next[idx] = { ...next[idx], description: e.target.value };
                    updateAnswer('misstatements', next);
                  }} className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5" />
                </td>
                <td className="px-1 py-1">
                  <input type="text" inputMode="decimal" value={row.dr} onChange={e => {
                    const next = [...(effectiveAnswers.misstatements || [])];
                    next[idx] = { ...next[idx], dr: e.target.value };
                    updateAnswer('misstatements', next);
                  }} className="w-20 text-right text-[10px] border border-slate-200 rounded px-1 py-0.5" />
                </td>
                <td className="px-1 py-1">
                  <input type="text" inputMode="decimal" value={row.cr} onChange={e => {
                    const next = [...(effectiveAnswers.misstatements || [])];
                    next[idx] = { ...next[idx], cr: e.target.value };
                    updateAnswer('misstatements', next);
                  }} className="w-20 text-right text-[10px] border border-slate-200 rounded px-1 py-0.5" />
                </td>
                <td className="px-1 py-1">
                  <select value={row.corrected} onChange={e => {
                    const next = [...(effectiveAnswers.misstatements || [])];
                    next[idx] = { ...next[idx], corrected: e.target.value };
                    updateAnswer('misstatements', next);
                  }} className="text-[10px] border border-slate-200 rounded px-1 py-0.5">
                    <option value="">Select...</option>
                    <option value="corrected">Corrected</option>
                    <option value="uncorrected">Uncorrected</option>
                  </select>
                </td>
                <td className="px-1 py-1">
                  <select value={row.type} onChange={e => {
                    const next = [...(effectiveAnswers.misstatements || [])];
                    next[idx] = { ...next[idx], type: e.target.value };
                    updateAnswer('misstatements', next);
                  }} className="text-[10px] border border-slate-200 rounded px-1 py-0.5">
                    <option value="">Select...</option>
                    <option value="factual">Factual</option>
                    <option value="judgemental">Judgemental</option>
                    <option value="projected">Projected</option>
                  </select>
                </td>
                <td className="px-1 text-center">
                  <button onClick={() => updateAnswer('misstatements', (effectiveAnswers.misstatements || []).filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => updateAnswer('misstatements', [...(effectiveAnswers.misstatements || []), { glCode: '', description: '', dr: '', cr: '', corrected: '', type: '' }])}
          className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
          <Plus className="h-3 w-3 inline mr-1" />Add row
        </button>
      </Section>
    ),
    'other': (
      <Section title="Other" hasContent={hasRecord(effectiveAnswers.other as Record<string, string>)}>
        <table className="w-full text-[10px] border border-slate-200 rounded overflow-hidden">
          <tbody>
            {OTHER_QUESTIONS.map((q, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-slate-600 w-2/3 align-top">{q}</td>
                <td className="px-2 py-1.5">
                  <select value={effectiveAnswers.other?.[idx] || ''}
                    onChange={e => updateAnswer('other', { ...(effectiveAnswers.other || {}), [idx]: e.target.value })}
                    className="w-full text-[10px] border border-slate-200 rounded px-1 py-0.5">
                    <option value="">Select...</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    ),
    'standback': (
      <Section title="Standback assessment" hasContent={hasText(effectiveAnswers.standback)}>
        <p className="text-[10px] text-slate-500 mb-1">
          Audit team is required to perform standback assessment to confirm that the procedures performed, audit evidence reviewed, and conclusions reached in response to identified significant risk is appropriate.
        </p>
        <AutoTextarea value={effectiveAnswers.standback || ''} onChange={v => updateAnswer('standback', v)} minRows={4} />
      </Section>
    ),
    'difficulties': (
      <Section title="Difficulties" hasContent={hasText(effectiveAnswers.difficulties)}>
        <p className="text-[10px] text-slate-500 mb-1">Provide details of difficult circumstances (if any) that audit team faced to obtain sufficient appropriate evidence</p>
        <AutoTextarea value={effectiveAnswers.difficulties || ''} onChange={v => updateAnswer('difficulties', v)} minRows={3} />
      </Section>
    ),
    'conclusion': (
      <Section title="Conclusion" defaultOpen>
        <p className="text-[10px] text-slate-500 mb-1">
          Audit team to confirm if all planned procedures have been performed, sufficient appropriate evidence is obtained and that there is no risk of material misstatement due to identified significant risk
        </p>
        <AutoTextarea value={effectiveAnswers.conclusion || ''} onChange={v => updateAnswer('conclusion', v)} minRows={4} />
      </Section>
    ),
  };

  return (
    <div className="flex flex-col gap-3">
      {saving && <div className="text-[10px] text-blue-500 animate-pulse">Saving...</div>}

      <div className="flex gap-4 min-h-[500px]">
        {/* Left sidebar — clickable significant-risk selector with the
            Reviewer/RI sign-off dots inline so progress is visible at
            a glance without switching tabs. */}
        <div className="w-56 flex-shrink-0 border-r border-slate-200 pr-3 space-y-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Significant Risks ({rmmRows.length})</p>
          {rmmRows.map(risk => {
            const record = records[risk.id];
            const isActive = activeRiskId === risk.id;
            const reviewerSigned = !!record?.signOffs?.reviewer?.timestamp;
            const riSigned = !!record?.signOffs?.ri?.timestamp;
            return (
              <button
                key={risk.id}
                onClick={() => setActiveRiskId(risk.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{risk.lineItem || 'Unnamed Risk'}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <span
                      className={`w-2 h-2 rounded-full ${reviewerSigned ? 'bg-green-500' : 'border border-slate-300'}`}
                      title={`Reviewer: ${reviewerSigned ? 'Signed' : 'Pending'}`}
                    />
                    <span
                      className={`w-2 h-2 rounded-full ${riSigned ? 'bg-green-500' : 'border border-slate-300'}`}
                      title={`RI: ${riSigned ? 'Signed' : 'Pending'}`}
                    />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right pane — risk detail + sign-off bar at top right */}
        <div className="flex-1 min-w-0">
          {activeRisk && (
            // key=activeRiskId remounts the whole section list when the
            // user switches between significant-risk tabs, so each Section
            // re-evaluates its hasContent / defaultOpen logic for the
            // newly-selected risk's data. Without this, the open/closed
            // state from the previous risk would carry over.
            <div key={activeRisk.id} className="space-y-2">
              {/* Top-right sign-off row. The Plan Customiser button
                  lives in the Completion tab strip (CompletionPanel)
                  and dispatches `engagement:open-plan-customiser` here
                  via the useEffect listener below. */}
              <div className="flex items-center justify-end gap-4">
                <div className="flex items-center gap-3">
                  {visibleRoles.map(({ key, label }) => {
                    const so = activeRecord?.signOffs?.[key];
                    const hasSigned = !!so?.timestamp;
                    const canSign = canSignSigRisk(key, session?.user?.id || userId, teamMembers);
                    return (
                      <div key={key} className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] text-slate-500">{label}</span>
                        <button onClick={() => canSign && handleSignOff(activeRisk.id, key)}
                          disabled={!canSign && !hasSigned}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${
                            hasSigned
                              ? 'bg-green-500 border-green-500'
                              : canSign
                                ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                                : 'bg-white border-slate-200 cursor-not-allowed opacity-50'
                          }`}
                          title={
                            hasSigned ? `${so.userName} — ${new Date(so.timestamp).toLocaleString()}` :
                            canSign ? `Sign off as ${label}` :
                            key === 'ri' ? 'Only the RI can sign here' :
                            key === 'eqr' ? 'Only the EQR can sign here' :
                            `Only ${label}s can sign here`
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Risk header */}
              <div className="border border-red-200 bg-red-50/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-semibold text-slate-800">{activeRisk.lineItem}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">{activeRisk.overallRisk || activeRisk.finalRiskAssessment}</span>
                </div>
                {activeRisk.riskIdentified && <p className="text-[11px] text-slate-600">{activeRisk.riskIdentified}</p>}
              </div>

          {sectionOrder.map(key => (
            <Fragment key={key}>{sectionsByKey[key]}</Fragment>
          ))}
            </div>
          )}
        </div>
      </div>

      {/* Plan Customiser modal — engagement-level test trimming + custom tests */}
      {planCustomiserOpen && planCustomiserContext && (
        <PlanCustomiserModal
          engagementId={engagementId}
          fsLineId={planCustomiserContext.fsLineId}
          fsLineName={planCustomiserContext.fsLineName}
          allocatedTests={planCustomiserAllocated}
          onClose={() => { setPlanCustomiserOpen(false); setPlanCustomiserContext(null); }}
        />
      )}
    </div>
  );
}
