'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

interface Props {
  engagementId: string;
}

interface SignOff {
  userId: string;
  userName: string;
  timestamp: string;
}

interface MemoData {
  rmmRowId: string;
  lineItem: string;
  riskIdentified: string | null;
  aiSummary: string | null;
  assertions: string[] | null;
  overallRisk: string | null;
  controlRisk: string | null;
  complexityText: string | null;
  subjectivityText: string | null;
  uncertaintyText: string | null;
  changeText: string | null;
  susceptibilityText: string | null;
  fsStatement: string | null;
  fsLevel: string | null;
  autoPop: {
    testConclusions: { testDescription: string; conclusion: string; auditorNotes: string | null; populationSize: number | null; sampleSize: number | null }[];
    walkthroughs: { question: string; response: string | null; status: string }[];
    specialists: { name: string; specialistType: string; firmName: string | null }[];
  };
  memo: Record<string, string>;
  signOffs: Record<string, SignOff>;
}

const MEMO_FIELDS = [
  { key: 'riskDescription', label: 'Risk Description', hint: 'Detailed description of the significant risk' },
  { key: 'estimatesJudgements', label: 'Significant Estimates & Judgements', hint: 'Any significant accounting estimates or judgements related to this risk' },
  { key: 'walkthroughConfirmation', label: 'Walkthrough Confirmation', hint: 'Confirm the audit team performed walkthroughs per ISA(UK) 315. Include WP cross-references.' },
  { key: 'controlDeficiencies', label: 'Control Deficiencies Identified', hint: 'Any significant deficiencies in design and implementation of controls' },
  { key: 'controlEffectiveness', label: 'Test of Operating Effectiveness', hint: 'Results of control testing (if relevant)' },
  { key: 'testingApproach', label: 'Testing Approach', hint: 'Control / Substantive / Combined' },
  { key: 'plannedProcedures', label: 'Planned Procedures', hint: 'Outline planned audit procedures to address this risk. Must align with audit plan and planning letter.', large: true },
  { key: 'changesAssessedRisk', label: 'Changes to Assessed Risk', hint: 'Did the audit team note any additional information requiring reassessment?' },
  { key: 'resultsOfProcedures', label: 'Results of Procedures Performed', hint: 'Detailed list of procedures performed with WP cross-references.', large: true },
  { key: 'expertInvolved', label: 'Expert/Specialist Involvement', hint: 'Did the engagement team involve audit experts/specialists?' },
  { key: 'expertFrcCompliance', label: 'FRC Ethical Standard Compliance', hint: 'Confirmation from expert re FRC Ethical Standard 2024 compliance' },
  { key: 'expertScopeIssued', label: 'Expert Scope Instructions', hint: 'Has audit team issued scope instructions to the expert?' },
  { key: 'expertScopeChanged', label: 'Expert Scope Changes', hint: 'Any change in scope during the engagement?' },
  { key: 'expertAdequacy', label: 'Expert Work Adequacy (ISA 620)', hint: 'Has audit team evaluated adequacy of expert work per ISA (UK) 620?' },
  { key: 'expertSourceData', label: 'Expert Source Data Testing', hint: 'Has audit team tested the source data used by the expert?' },
  { key: 'expertCaveats', label: 'Expert Report Caveats', hint: 'Any caveats identified in the expert report?' },
  { key: 'expertCaveatsList', label: 'Caveats List & Reliance Basis', hint: 'List caveats and explain basis for reliance' },
  { key: 'expertReportRef', label: 'Expert Report Reference', hint: 'MWP reference to signed expert report' },
  { key: 'mgmtExpertUsed', label: 'Management Expert Used', hint: 'Did management use a management expert for this risk?' },
  { key: 'mgmtExpertCompetence', label: 'Management Expert Competence', hint: 'Assessment of management expert competence and objectivity' },
  { key: 'mgmtExpertSourceData', label: 'Management Expert Source Data', hint: 'Has audit team tested management expert source data?' },
  { key: 'mgmtExpertCaveats', label: 'Management Expert Caveats', hint: 'Any caveats in management expert report?' },
  { key: 'conclusion', label: 'Conclusion', hint: 'Overall conclusion of the audit team on this significant risk.', large: true },
];

const SIGN_OFF_ROLES = [
  { key: 'preparer', label: 'Preparer', teamRole: 'Junior' },
  { key: 'reviewer', label: 'Reviewer', teamRole: 'Manager' },
  { key: 'ri', label: 'RI / Partner', teamRole: 'RI' },
];

export function SRMMPanel({ engagementId }: Props) {
  const { data: session } = useSession();
  const [memos, setMemos] = useState<MemoData[]>([]);
  const [team, setTeam] = useState<{ userId: string; userName: string; role: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRisk, setSelectedRisk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const loadMemos = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/srmm`);
      if (res.ok) {
        const data = await res.json();
        setMemos(data.memos || []);
        setTeam(data.team || []);
        if (!selectedRisk && data.memos?.length > 0) setSelectedRisk(data.memos[0].rmmRowId);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [engagementId, selectedRisk]);

  useEffect(() => { loadMemos(); }, [loadMemos]);

  const currentMemo = memos.find(m => m.rmmRowId === selectedRisk);

  // Auto-save with debounce
  function updateMemoField(rmmRowId: string, field: string, value: string) {
    setMemos(prev => prev.map(m => {
      if (m.rmmRowId !== rmmRowId) return m;
      return { ...m, memo: { ...m.memo, [field]: value } };
    }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const memo = memos.find(m => m.rmmRowId === rmmRowId);
      if (!memo) return;
      setSaving(true);
      await fetch(`/api/engagements/${engagementId}/srmm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', rmmRowId, data: { ...memo.memo, [field]: value } }),
      });
      setSaving(false);
    }, 1500);
  }

  async function handleSignOff(rmmRowId: string, role: string) {
    const memo = memos.find(m => m.rmmRowId === rmmRowId);
    if (!memo) return;
    const existing = memo.signOffs[role];
    const isUnsigning = existing?.userId === session?.user?.id;

    const res = await fetch(`/api/engagements/${engagementId}/srmm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isUnsigning ? 'unsignoff' : 'signoff', rmmRowId, role }),
    });
    if (res.ok) {
      const data = await res.json();
      setMemos(prev => prev.map(m => m.rmmRowId === rmmRowId ? { ...m, signOffs: data.signOffs } : m));
    }
  }

  async function handleExport(rmmRowId: string) {
    setExporting(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/srmm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_docx', rmmRowId }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SRMM_Memo.docx`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
    finally { setExporting(false); }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Significant Risk Memos...</div>;

  if (memos.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-slate-400 text-sm mb-2">No Significant Risks Identified</div>
        <p className="text-xs text-slate-300">Significant risks (High / Very High overall risk) from the RMM tab will appear here automatically.</p>
      </div>
    );
  }

  // Completion percentage per memo
  function completionPct(memo: MemoData): number {
    const filled = MEMO_FIELDS.filter(f => (memo.memo[f.key] || '').trim().length > 0).length;
    return Math.round((filled / MEMO_FIELDS.length) * 100);
  }

  return (
    <div className="flex gap-4 min-h-[500px]">
      {/* Left sidebar: risk list */}
      <div className="w-56 flex-shrink-0 border-r border-slate-200 pr-3 space-y-1">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Significant Risks ({memos.length})</p>
        {memos.map(m => {
          const isActive = selectedRisk === m.rmmRowId;
          const pct = completionPct(m);
          const allSigned = SIGN_OFF_ROLES.every(r => m.signOffs[r.key]);
          return (
            <button
              key={m.rmmRowId}
              onClick={() => setSelectedRisk(m.rmmRowId)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="font-medium truncate">{m.lineItem}</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${allSigned ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[9px] text-slate-400">{pct}%</span>
                {allSigned && <span className="w-2 h-2 rounded-full bg-green-500" title="All signed off" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Right panel: memo form */}
      {currentMemo ? (
        <div className="flex-1 min-w-0 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 sticky top-0 bg-white z-10 pb-2 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">SRMM: {currentMemo.lineItem}</h3>
              <p className="text-[10px] text-slate-400">{currentMemo.overallRisk} Risk | {currentMemo.fsStatement || ''} | Assertions: {(currentMemo.assertions || []).join(', ')}</p>
            </div>
            <div className="flex items-center gap-3">
              {saving && <span className="text-[10px] text-blue-500 animate-pulse">Saving...</span>}
              <button onClick={() => handleExport(currentMemo.rmmRowId)} disabled={exporting}
                className="text-[10px] px-3 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded hover:bg-purple-100 disabled:opacity-50">
                {exporting ? 'Generating...' : 'Export .docx'}
              </button>
            </div>
          </div>

          {/* Auto-populated info cards */}
          {currentMemo.autoPop.testConclusions.length > 0 && (
            <div className="mb-3 p-2 bg-blue-50 rounded border border-blue-200">
              <p className="text-[10px] font-semibold text-blue-600 mb-1">Test Conclusions ({currentMemo.autoPop.testConclusions.length})</p>
              {currentMemo.autoPop.testConclusions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className={`w-2 h-2 rounded-full ${c.conclusion === 'green' ? 'bg-green-500' : c.conclusion === 'orange' ? 'bg-amber-500' : 'bg-red-500'}`} />
                  <span className="text-slate-600">{c.testDescription}</span>
                  {c.auditorNotes && <span className="text-slate-400 truncate">- {c.auditorNotes}</span>}
                </div>
              ))}
            </div>
          )}

          {currentMemo.autoPop.specialists.length > 0 && (
            <div className="mb-3 p-2 bg-violet-50 rounded border border-violet-200">
              <p className="text-[10px] font-semibold text-violet-600 mb-1">Specialists Assigned</p>
              {currentMemo.autoPop.specialists.map((s, i) => (
                <div key={i} className="text-[10px] text-slate-600">{s.name} ({s.specialistType}){s.firmName ? ` - ${s.firmName}` : ''}</div>
              ))}
            </div>
          )}

          {/* Memo form fields */}
          <div className="space-y-3">
            {MEMO_FIELDS.map(field => (
              <div key={field.key}>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">{field.label}</label>
                {field.hint && <p className="text-[9px] text-slate-300 mb-1">{field.hint}</p>}
                <textarea
                  value={currentMemo.memo[field.key] || ''}
                  onChange={e => updateMemoField(currentMemo.rmmRowId, field.key, e.target.value)}
                  rows={field.large ? 6 : 2}
                  className="w-full text-xs border border-slate-200 rounded px-2.5 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
            ))}
          </div>

          {/* Sign-off bar */}
          <div className="mt-6 pt-4 border-t border-slate-200">
            <p className="text-[10px] font-semibold text-slate-500 mb-2">Sign-off</p>
            <div className="flex items-center gap-8">
              {SIGN_OFF_ROLES.map(({ key, label, teamRole }) => {
                const so = currentMemo.signOffs[key] as SignOff | undefined;
                const hasSigned = !!so?.timestamp;
                const currentUserId = session?.user?.id;
                const canSign = currentUserId && team.some(m => {
                  const mappedRole = m.role === 'Junior' ? 'preparer' : m.role === 'Manager' ? 'reviewer' : m.role === 'RI' ? 'ri' : '';
                  return mappedRole === key && m.userId === currentUserId;
                });

                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-slate-500 font-medium">{label}</span>
                    <button
                      onClick={() => canSign && handleSignOff(currentMemo.rmmRowId, key)}
                      disabled={!canSign}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        hasSigned
                          ? 'bg-green-500 border-green-500'
                          : canSign
                            ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                            : 'bg-white border-slate-200 cursor-not-allowed opacity-50'
                      }`}
                      title={hasSigned ? `${so?.userName} - ${so?.timestamp ? new Date(so.timestamp).toLocaleString() : ''}` : canSign ? `Click to sign off as ${label}` : `Only ${label}s can sign off`}
                    />
                    {hasSigned && (
                      <div className="text-center">
                        <p className="text-[9px] text-slate-600">{so?.userName}</p>
                        <p className="text-[8px] text-slate-400">{so?.timestamp ? new Date(so.timestamp).toLocaleDateString('en-GB') : ''}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Select a significant risk to view its memo
        </div>
      )}
    </div>
  );
}
