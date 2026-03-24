'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { ASSERTION_TYPES, INHERENT_RISK_COMPONENTS } from '@/types/methodology';
import { lookupInherentRisk, lookupOverallRisk, riskColor, inherentRiskDropdownColor } from '@/lib/risk-table-lookup';

interface Props {
  engagementId: string;
  auditType: string;
  teamMembers?: { userId: string; userName?: string; role: string }[];
}

interface RowSignOff {
  userId: string;
  userName: string;
  timestamp: string;
}

interface RowSignOffs {
  reviewer?: RowSignOff;
  partner?: RowSignOff;
}

interface RMMRow {
  id: string;
  lineItem: string;
  lineType: string;
  riskIdentified: string | null;
  amount: number | null;
  assertions: string[] | null;
  relevance: string | null;
  complexityText: string | null;
  subjectivityText: string | null;
  changeText: string | null;
  uncertaintyText: string | null;
  susceptibilityText: string | null;
  inherentRiskLevel: string | null;
  aiSummary: string | null;
  isAiEdited: boolean;
  likelihood: string | null;
  magnitude: string | null;
  finalRiskAssessment: string | null;
  controlRisk: string | null;
  overallRisk: string | null;
  isHidden: boolean;
  isMandatory: boolean;
  sortOrder: number;
  // Row-level sign-offs
  rowSignOffs?: RowSignOffs;
  lastEditedAt?: string;
}

const RISK_LEVELS = ['Remote', 'Low', 'Medium', 'High', 'Very High'] as const;
const LIKELIHOODS = ['Remote', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'] as const;
const MAGNITUDES = ['Very Low', 'Low', 'Medium', 'High', 'Very High'] as const;
const CONTROL_OPTIONS = ['Not Tested', 'Not Effective', 'Partially Effective', 'Effective'] as const;

const ROLE_MAP: Record<string, string> = { Junior: 'operator', Manager: 'reviewer', RI: 'partner' };

const isControlsBased = (type: string) => type === 'SME_CONTROLS' || type === 'PIE_CONTROLS';

export function RMMTab({ engagementId, auditType, teamMembers = [] }: Props) {
  const { data: session } = useSession();
  const [rows, setRows] = useState<RMMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialRows, setInitialRows] = useState<RMMRow[]>([]);
  const [viewMode, setViewMode] = useState<'fs_line' | 'tb_account'>('fs_line');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [generatingAI, setGeneratingAI] = useState<string | null>(null);

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/rmm`,
    { rows },
    { enabled: JSON.stringify(rows) !== JSON.stringify(initialRows) }
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/rmm`);
      if (res.ok) {
        const json = await res.json();
        const loaded = (json.rows || []).map((r: RMMRow) => ({
          ...r,
          assertions: Array.isArray(r.assertions) ? r.assertions : [],
          controlRisk: !isControlsBased(auditType) ? 'Not Tested' : r.controlRisk,
          rowSignOffs: r.rowSignOffs || {},
        }));
        setRows(loaded);
        setInitialRows(loaded);
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId, auditType]);

  useEffect(() => { loadData(); }, [loadData]);

  const computedRows = useMemo(() => {
    return rows.map(row => {
      const finalRisk = row.relevance === 'N' ? 'N/A' : lookupInherentRisk(row.likelihood, row.magnitude);
      const overallRisk = finalRisk && finalRisk !== 'N/A' ? lookupOverallRisk(finalRisk, row.controlRisk) : null;
      return { ...row, finalRiskAssessment: finalRisk, overallRisk };
    });
  }, [rows]);

  // Current user's sign-off role
  const currentUserId = session?.user?.id;
  const userIsReviewer = currentUserId && teamMembers.some(m => m.role === 'Manager' && m.userId === currentUserId);
  const userIsPartner = currentUserId && teamMembers.some(m => m.role === 'RI' && m.userId === currentUserId);

  function addRow() {
    setRows(prev => [...prev, {
      id: '', lineItem: '', lineType: viewMode, riskIdentified: null, amount: null,
      assertions: [], relevance: null, complexityText: null, subjectivityText: null,
      changeText: null, uncertaintyText: null, susceptibilityText: null,
      inherentRiskLevel: null, aiSummary: null, isAiEdited: false,
      likelihood: null, magnitude: null, finalRiskAssessment: null,
      controlRisk: isControlsBased(auditType) ? null : 'Not Tested',
      overallRisk: null, isHidden: false, isMandatory: false, sortOrder: prev.length,
      rowSignOffs: {},
    }]);
  }

  function updateRow(index: number, field: keyof RMMRow, value: unknown) {
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const updated = { ...r, [field]: value, lastEditedAt: new Date().toISOString() };
      // When a field changes, reset sign-offs for more senior staff
      if (field !== 'rowSignOffs' && field !== 'lastEditedAt') {
        const signOffs = { ...(updated.rowSignOffs || {}) };
        // If edited by operator-level or reviewer, reset partner sign-off
        if (signOffs.partner) {
          const editTime = new Date().getTime();
          const partnerTime = new Date(signOffs.partner.timestamp).getTime();
          if (editTime > partnerTime) {
            delete signOffs.partner;
          }
        }
        // If edited by operator-level, reset reviewer sign-off
        if (signOffs.reviewer) {
          const editTime = new Date().getTime();
          const reviewerTime = new Date(signOffs.reviewer.timestamp).getTime();
          if (editTime > reviewerTime) {
            // Only reset reviewer if the editor is not the reviewer themselves
            if (!userIsReviewer) {
              delete signOffs.reviewer;
            } else {
              // Reviewer editing their own row — still reset partner
              delete signOffs.partner;
            }
          }
        }
        updated.rowSignOffs = signOffs;
      }
      return updated;
    }));
  }

  function signOffRow(index: number, role: 'reviewer' | 'partner') {
    const userName = session?.user?.name || session?.user?.email || 'Unknown';
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const signOffs = { ...(r.rowSignOffs || {}) };
      const signOffData: RowSignOff = {
        userId: currentUserId || '',
        userName,
        timestamp: new Date().toISOString(),
      };
      if (role === 'partner') {
        // Partner sign-off implies reviewer approval too
        signOffs.partner = signOffData;
        signOffs.reviewer = signOffData;
      } else {
        signOffs.reviewer = signOffData;
      }
      return { ...r, rowSignOffs: signOffs };
    }));
  }

  function toggleAssertion(index: number, assertion: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const current = r.assertions || [];
      const has = current.includes(assertion);
      const updated = { ...r, assertions: has ? current.filter(a => a !== assertion) : [...current, assertion], lastEditedAt: new Date().toISOString() };
      // Reset sign-offs on change
      const signOffs = { ...(updated.rowSignOffs || {}) };
      delete signOffs.partner;
      if (!userIsReviewer) delete signOffs.reviewer;
      updated.rowSignOffs = signOffs;
      return updated;
    }));
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (row.isMandatory) return;
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  // Get outline for a row's cells based on sign-off state
  function getRowOutline(row: RMMRow): string {
    if (!row.lastEditedAt) return '';
    const editTime = new Date(row.lastEditedAt).getTime();
    const reviewerTime = row.rowSignOffs?.reviewer?.timestamp ? new Date(row.rowSignOffs.reviewer.timestamp).getTime() : 0;
    const partnerTime = row.rowSignOffs?.partner?.timestamp ? new Date(row.rowSignOffs.partner.timestamp).getTime() : 0;
    if (partnerTime > 0 && editTime > partnerTime) return 'ring-2 ring-red-400 ring-offset-1';
    if (reviewerTime > 0 && editTime > reviewerTime) return 'ring-2 ring-orange-400 ring-offset-1';
    return '';
  }

  async function generateAISummary(index: number) {
    const row = rows[index];
    if (!row.id && !row.lineItem) return;
    setGeneratingAI(row.id || `new-${index}`);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/rmm/ai-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: row.id || null, lineItem: row.lineItem,
          complexityText: row.complexityText, subjectivityText: row.subjectivityText,
          changeText: row.changeText, uncertaintyText: row.uncertaintyText,
          susceptibilityText: row.susceptibilityText,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        updateRow(index, 'aiSummary', data.summary);
        updateRow(index, 'isAiEdited', false);
      }
    } catch (err) { console.error('AI generation failed:', err); }
    finally { setGeneratingAI(null); }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading RMM...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Toggle: FS Line Items vs TB Accounts */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setViewMode('fs_line')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'fs_line' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500'}`}>
              FS Line Items
            </button>
            <button onClick={() => setViewMode('tb_account')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'tb_account' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500'}`}>
              TB Accounts
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-36">{viewMode === 'fs_line' ? 'FS Line Item' : 'TB Account'}</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-40">Risk Identified</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-28">Amount</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-28">Assertions</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-14" title="Relevant?">Rel. <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span></th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-16" title="Inherent Risk">IR <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span></th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-36">Risk Summation</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Likelihood</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Magnitude</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Final Risk</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Control Risk</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Overall</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-40">
                <div className="flex gap-4 justify-center">
                  <span className="text-[7px]">Reviewer</span>
                  <span className="text-[7px]">Partner</span>
                </div>
              </th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {computedRows.map((row, i) => {
              const isExpanded = expandedRow === (row.id || `new-${i}`);
              const rowKey = row.id || `new-${i}`;
              const outline = getRowOutline(row);
              const reviewerSO = row.rowSignOffs?.reviewer;
              const partnerSO = row.rowSignOffs?.partner;
              const reviewerStale = reviewerSO && row.lastEditedAt && new Date(row.lastEditedAt).getTime() > new Date(reviewerSO.timestamp).getTime();
              const partnerStale = partnerSO && row.lastEditedAt && new Date(row.lastEditedAt).getTime() > new Date(partnerSO.timestamp).getTime();

              return (
                <Fragment key={rowKey}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50/50 ${row.isMandatory ? 'bg-amber-50/20' : ''} ${outline}`}>
                    <td className="px-2 py-1 align-top">
                      <textarea value={row.lineItem} onChange={e => updateRow(i, 'lineItem', e.target.value)}
                        className={`w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 resize-none overflow-hidden ${row.isMandatory ? 'font-medium' : ''}`}
                        readOnly={row.isMandatory} rows={1}
                        style={{ height: 'auto', minHeight: '24px' }}
                        onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }} />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <textarea value={row.riskIdentified || ''} onChange={e => updateRow(i, 'riskIdentified', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 resize-none overflow-hidden" rows={1}
                        style={{ height: 'auto', minHeight: '24px' }}
                        onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }} />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <input type="number" value={row.amount ?? ''} onChange={e => updateRow(i, 'amount', e.target.value ? Number(e.target.value) : null)}
                        className="w-full border-0 bg-transparent text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex flex-wrap gap-0.5 justify-center">
                        {ASSERTION_TYPES.map(a => {
                          const short = a.split(' ')[0].slice(0, 3);
                          const selected = (row.assertions || []).includes(a);
                          return (
                            <button key={a} onClick={() => toggleAssertion(i, a)}
                              className={`px-1 py-0 text-[9px] rounded border ${selected ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300'}`}
                              title={a}>{short}</button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <select value={row.relevance || ''} onChange={e => updateRow(i, 'relevance', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-xs bg-white w-10">
                        <option value="">-</option><option value="Y">Y</option><option value="N">N</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center">
                      {(() => {
                        const hasIRData = !!(row.complexityText || row.subjectivityText || row.changeText || row.uncertaintyText || row.susceptibilityText || row.inherentRiskLevel);
                        return (
                          <button onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                            className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                              isExpanded ? 'bg-blue-100 border-blue-300 text-blue-700' :
                              hasIRData ? 'bg-blue-50 border-blue-200 text-blue-600 font-medium' :
                              'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                            }`}>
                            {isExpanded ? '▼' : '▶'} IR{hasIRData && !isExpanded ? ' ●' : ''}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1">
                      <div className={`relative rounded border-2 ${row.aiSummary && !row.isAiEdited ? 'border-orange-300' : row.isAiEdited ? 'border-green-300' : 'border-transparent'}`}>
                        <textarea value={row.aiSummary || ''}
                          onChange={e => { updateRow(i, 'aiSummary', e.target.value); if (row.aiSummary) updateRow(i, 'isAiEdited', true); }}
                          className="w-full border-0 bg-transparent text-xs focus:outline-none rounded px-1 py-0.5 resize-none min-h-[24px]" rows={1} placeholder="AI summary..." />
                        <button onClick={() => generateAISummary(i)} disabled={generatingAI === rowKey}
                          className="absolute -top-2 -right-2 w-4 h-4 bg-blue-500 text-white rounded-full text-[8px] hover:bg-blue-600 disabled:bg-slate-300"
                          title="Generate AI summary">✦</button>
                      </div>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <select value={row.likelihood || ''} onChange={e => updateRow(i, 'likelihood', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-[10px] bg-white w-16">
                        <option value="">-</option>
                        {LIKELIHOODS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <select value={row.magnitude || ''} onChange={e => updateRow(i, 'magnitude', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-[10px] bg-white w-16">
                        <option value="">-</option>
                        {MAGNITUDES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${riskColor(row.finalRiskAssessment)}`}>
                        {row.finalRiskAssessment || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-center">
                      {isControlsBased(auditType) ? (
                        <select value={row.controlRisk || ''} onChange={e => updateRow(i, 'controlRisk', e.target.value)}
                          className="border border-slate-200 rounded px-0.5 py-0.5 text-[10px] bg-white w-16">
                          <option value="">-</option>
                          {CONTROL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="text-[10px] text-slate-400">Not Tested</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${riskColor(row.overallRisk)}`}>
                        {row.overallRisk || '—'}
                      </span>
                    </td>
                    {/* Row-level sign-off dots */}
                    <td className="px-2 py-1">
                      <div className="flex gap-4 justify-center items-start">
                        {/* Reviewer dot */}
                        <div className="flex flex-col items-center min-w-[50px]">
                          <button
                            onClick={() => userIsReviewer && signOffRow(i, 'reviewer')}
                            disabled={!userIsReviewer}
                            className={`w-4 h-4 rounded-full border-2 transition-all ${
                              reviewerSO && !reviewerStale
                                ? 'bg-green-500 border-green-500'
                                : reviewerStale
                                  ? 'bg-white border-green-500'
                                  : userIsReviewer
                                    ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                                    : 'bg-white border-slate-200 opacity-50'
                            }`}
                            title={reviewerSO ? `${reviewerSO.userName} — ${new Date(reviewerSO.timestamp).toLocaleString('en-GB')}` : 'Reviewer sign-off'}
                          />
                          {reviewerSO && !reviewerStale && (
                            <div className="text-center mt-0.5">
                              <p className="text-[7px] text-slate-500 leading-tight">{reviewerSO.userName}</p>
                              <p className="text-[6px] text-slate-400 leading-tight">{new Date(reviewerSO.timestamp).toLocaleDateString('en-GB')} {new Date(reviewerSO.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                          )}
                        </div>
                        {/* Partner dot */}
                        <div className="flex flex-col items-center min-w-[50px]">
                          <button
                            onClick={() => userIsPartner && signOffRow(i, 'partner')}
                            disabled={!userIsPartner}
                            className={`w-4 h-4 rounded-full border-2 transition-all ${
                              partnerSO && !partnerStale
                                ? 'bg-green-500 border-green-500'
                                : partnerStale
                                  ? 'bg-white border-green-500'
                                  : userIsPartner
                                    ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                                    : 'bg-white border-slate-200 opacity-50'
                            }`}
                            title={partnerSO ? `${partnerSO.userName} — ${new Date(partnerSO.timestamp).toLocaleString('en-GB')}` : 'Partner sign-off'}
                          />
                          {partnerSO && !partnerStale && (
                            <div className="text-center mt-0.5">
                              <p className="text-[7px] text-slate-500 leading-tight">{partnerSO.userName}</p>
                              <p className="text-[6px] text-slate-400 leading-tight">{new Date(partnerSO.timestamp).toLocaleDateString('en-GB')} {new Date(partnerSO.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      {!row.isMandatory && (
                        <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                      )}
                    </td>
                  </tr>
                  {/* Expanded Inherent Risk Sub-components */}
                  {isExpanded && (
                    <tr className="bg-blue-50/30 border-b border-slate-200">
                      <td colSpan={15} className="px-4 py-3">
                        <div className="grid grid-cols-5 gap-3">
                          {INHERENT_RISK_COMPONENTS.map(comp => {
                            const textKey = `${comp.key}Text` as keyof RMMRow;
                            const textVal = (row[textKey] as string) || '';
                            return (
                              <div key={comp.key} className="space-y-1">
                                <label className="block text-[10px] font-medium text-slate-600">{comp.label}</label>
                                <textarea value={textVal} onChange={e => updateRow(i, textKey, e.target.value)}
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs min-h-[50px] resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder={`${comp.label} assessment...`} />
                                <select value={row.inherentRiskLevel || ''} onChange={e => updateRow(i, 'inherentRiskLevel', e.target.value)}
                                  className={`w-full border border-slate-200 rounded px-1 py-0.5 text-xs ${inherentRiskDropdownColor(row.inherentRiskLevel)}`}>
                                  <option value="">Select risk level...</option>
                                  {RISK_LEVELS.map(rl => <option key={rl} value={rl}>{rl}</option>)}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
