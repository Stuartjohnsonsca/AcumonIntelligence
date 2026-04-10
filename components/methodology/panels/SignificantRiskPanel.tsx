'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronUp, AlertTriangle, Loader2, Plus, X } from 'lucide-react';

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
  fsLine: { id: string; name: string };
  test: { id: string; name: string; significantRisk: boolean };
}

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

interface Props {
  engagementId: string;
  userId?: string;
  userName?: string;
}

const SIGN_OFF_ROLES = [
  { key: 'preparer', label: 'Preparer' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'ri', label: 'RI' },
];

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
function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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

// ─── Main Panel ───────────────────────────────────────────────────────
export function SignificantRiskPanel({ engagementId, userId, userName }: Props) {
  const { data: session } = useSession();
  const [rmmRows, setRmmRows] = useState<RMMRow[]>([]);
  const [records, setRecords] = useState<Record<string, RiskRecord>>({});
  const [allocations, setAllocations] = useState<TestAllocation[]>([]);
  const [conclusions, setConclusions] = useState<TestConclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [rmmRes, sigRes, allocRes, concRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/rmm`),
        fetch(`/api/engagements/${engagementId}/significant-risk`),
        fetch(`/api/engagements/${engagementId}/test-allocations`),
        fetch(`/api/engagements/${engagementId}/test-conclusions`),
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
    } catch (err) {
      console.error('[SignificantRisk] load failed:', err);
    }
    setLoading(false);
  }, [engagementId, activeRiskId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const activeRisk = rmmRows.find(r => r.id === activeRiskId);
  const activeRecord = activeRiskId ? records[activeRiskId] : undefined;
  const activeAnswers = activeRecord?.answers || {};

  // Pre-fill defaults from RMM data
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

  // Find tests linked to this risk (by FS Line name match and significantRisk flag)
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

  return (
    <div>
      {/* Sub-tab bar for each significant risk */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 mb-4 overflow-x-auto">
        {rmmRows.map(risk => {
          const record = records[risk.id];
          const isActive = activeRiskId === risk.id;
          return (
            <button key={risk.id} onClick={() => setActiveRiskId(risk.id)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <span>{risk.lineItem || 'Unnamed Risk'}</span>
              <div className="flex items-center gap-0.5">
                {SIGN_OFF_ROLES.map(({ key }) => (
                  <span key={key} className={`w-2 h-2 rounded-full ${
                    record?.signOffs?.[key] ? 'bg-green-500' : 'border border-slate-300'
                  }`} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {saving && <div className="text-[10px] text-blue-500 mb-2 animate-pulse">Saving...</div>}

      {activeRisk && (
        <div className="space-y-2">
          {/* Risk header */}
          <div className="border border-red-200 bg-red-50/30 rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-xs font-semibold text-slate-800">{activeRisk.lineItem}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">{activeRisk.overallRisk || activeRisk.finalRiskAssessment}</span>
              </div>
              {activeRisk.riskIdentified && <p className="text-[11px] text-slate-600">{activeRisk.riskIdentified}</p>}
            </div>
            {/* Sign-off dots */}
            <div className="flex items-center gap-3">
              {SIGN_OFF_ROLES.map(({ key, label }) => {
                const so = activeRecord?.signOffs?.[key];
                const hasSigned = !!so?.timestamp;
                return (
                  <div key={key} className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-slate-500">{label}</span>
                    <button onClick={() => handleSignOff(activeRisk.id, key)}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                        hasSigned ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300 hover:border-blue-400'
                      }`}
                      title={hasSigned ? `${so.userName} — ${new Date(so.timestamp).toLocaleString()}` : `Sign off as ${label}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 1: Risk Description */}
          <Section title="Risk description" defaultOpen>
            <textarea value={effectiveAnswers.riskDescription || ''} onChange={e => updateAnswer('riskDescription', e.target.value)}
              rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y"
              placeholder="Describe the significant risk..." />
          </Section>

          {/* Section 2: Impacted Assertions */}
          <Section title="Impacted assertions">
            <textarea value={effectiveAnswers.impactedAssertions || ''} onChange={e => updateAnswer('impactedAssertions', e.target.value)}
              rows={2} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 3: Significant Estimates and Judgements */}
          <Section title="Significant estimates and judgements">
            <textarea value={effectiveAnswers.estimates || ''} onChange={e => updateAnswer('estimates', e.target.value)}
              rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 4: Control deficiencies */}
          <Section title="Significant deficiencies in design and implementation of controls addressing the significant risk">
            <textarea value={effectiveAnswers.controlDeficiencies || ''} onChange={e => updateAnswer('controlDeficiencies', e.target.value)}
              rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 5: Operating effectiveness of controls */}
          <Section title="Results of test of operating effectiveness of controls">
            <textarea value={effectiveAnswers.operatingEffectiveness || ''} onChange={e => updateAnswer('operatingEffectiveness', e.target.value)}
              rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 6: Testing approach */}
          <Section title="Testing approach">
            <select value={effectiveAnswers.testingApproach || ''} onChange={e => updateAnswer('testingApproach', e.target.value as any)}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
              <option value="">Select approach...</option>
              <option value="substantive">Substantive</option>
              <option value="controls">Controls</option>
              <option value="defrayment">Defrayment</option>
            </select>
          </Section>

          {/* Section 7: Changes to Assessed Risk */}
          <Section title="Changes to Assessed Risk">
            <p className="text-[10px] text-slate-500 mb-1">Did audit team note any additional information that require reassessment of the identified significant risk?</p>
            <textarea value={effectiveAnswers.changesToRisk || ''} onChange={e => updateAnswer('changesToRisk', e.target.value)}
              rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 8: Procedures */}
          <Section title="Procedures">
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

          {/* Section 9: Audit experts and specialists */}
          <Section title="Audit experts and specialists">
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

          {/* Section 10: Management expert */}
          <Section title="Management expert">
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

          {/* Section 11: Professional skepticism */}
          <Section title="Professional skepticism">
            <p className="text-[10px] text-slate-500 mb-1">Explain how audit team has exercised professional skepticism in relation to the audit of significant risk</p>
            <textarea value={effectiveAnswers.professionalSkepticism || ''} onChange={e => updateAnswer('professionalSkepticism', e.target.value)}
              rows={4} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 12: Summary of challenges to management */}
          <Section title="Summary of challenges to management">
            <p className="text-[10px] text-slate-500 mb-2">Summarise the challenges made by audit team to management, management responses, and audit team\u2019s conclusion</p>
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

          {/* Section 13: Consultation */}
          <Section title="Consultation">
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

          {/* Section 14: Summary of discussion with Audit Partner / RI */}
          <Section title="Summary of discussion with Audit Partner / RI">
            <p className="text-[10px] text-slate-500 mb-1">Summarise discussion with audit partner/RI including details of challenges raised and how they were addressed</p>
            <textarea value={effectiveAnswers.discussionRI || ''} onChange={e => updateAnswer('discussionRI', e.target.value)}
              rows={4} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 15: Summary of Discussion with EQR */}
          <Section title="Summary of Discussion with EQR">
            <p className="text-[10px] text-slate-500 mb-1">Summarise discussion with EQR including challenges raised and how they were addressed</p>
            <textarea value={effectiveAnswers.discussionEQR || ''} onChange={e => updateAnswer('discussionEQR', e.target.value)}
              rows={4} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 16: Misstatements */}
          <Section title="Misstatements">
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

          {/* Section 17: Other */}
          <Section title="Other">
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

          {/* Section 18: Standback assessment */}
          <Section title="Standback assessment">
            <p className="text-[10px] text-slate-500 mb-1">
              Audit team is required to perform standback assessment to confirm that the procedures performed, audit evidence reviewed, and conclusions reached in response to identified significant risk is appropriate.
            </p>
            <textarea value={effectiveAnswers.standback || ''} onChange={e => updateAnswer('standback', e.target.value)}
              rows={4} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 19: Difficulties */}
          <Section title="Difficulties">
            <p className="text-[10px] text-slate-500 mb-1">Provide details of difficult circumstances (if any) that audit team faced to obtain sufficient appropriate evidence</p>
            <textarea value={effectiveAnswers.difficulties || ''} onChange={e => updateAnswer('difficulties', e.target.value)}
              rows={3} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>

          {/* Section 20: Conclusion */}
          <Section title="Conclusion" defaultOpen>
            <p className="text-[10px] text-slate-500 mb-1">
              Audit team to confirm if all planned procedures have been performed, sufficient appropriate evidence is obtained and that there is no risk of material misstatement due to identified significant risk
            </p>
            <textarea value={effectiveAnswers.conclusion || ''} onChange={e => updateAnswer('conclusion', e.target.value)}
              rows={4} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y" />
          </Section>
        </div>
      )}
    </div>
  );
}
