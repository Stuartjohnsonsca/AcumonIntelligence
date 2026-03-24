'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { ASSERTION_TYPES, INHERENT_RISK_COMPONENTS } from '@/types/methodology';
import { lookupInherentRisk, lookupOverallRisk, riskColor, inherentRiskDropdownColor } from '@/lib/risk-table-lookup';

interface Props {
  engagementId: string;
  auditType: string;
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
}

const RISK_LEVELS = ['Remote', 'Low', 'Medium', 'High', 'Very High'] as const;
const LIKELIHOODS = ['Remote', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'] as const;
const MAGNITUDES = ['Remote', 'Low', 'Medium', 'High', 'Very High'] as const;
const CONTROL_OPTIONS = ['Not Tested', 'Not Effective', 'Partially Effective', 'Effective'] as const;

const isControlsBased = (type: string) => type === 'SME_CONTROLS' || type === 'PIE_CONTROLS';

export function RMMTab({ engagementId, auditType }: Props) {
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
        }));
        setRows(loaded);
        setInitialRows(loaded);
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId, auditType]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-compute final risk and overall risk
  const computedRows = useMemo(() => {
    return rows.map(row => {
      const finalRisk = row.relevance === 'N' ? 'N/A' : lookupInherentRisk(row.likelihood, row.magnitude);
      const overallRisk = finalRisk && finalRisk !== 'N/A' ? lookupOverallRisk(finalRisk, row.controlRisk) : null;
      return { ...row, finalRiskAssessment: finalRisk, overallRisk: overallRisk };
    });
  }, [rows]);

  function addRow() {
    setRows(prev => [...prev, {
      id: '', lineItem: '', lineType: viewMode, riskIdentified: null, amount: null,
      assertions: [], relevance: null, complexityText: null, subjectivityText: null,
      changeText: null, uncertaintyText: null, susceptibilityText: null,
      inherentRiskLevel: null, aiSummary: null, isAiEdited: false,
      likelihood: null, magnitude: null, finalRiskAssessment: null,
      controlRisk: isControlsBased(auditType) ? null : 'Not Tested',
      overallRisk: null, isHidden: false, isMandatory: false, sortOrder: prev.length,
    }]);
  }

  function updateRow(index: number, field: keyof RMMRow, value: unknown) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function toggleAssertion(index: number, assertion: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const current = r.assertions || [];
      const has = current.includes(assertion);
      return { ...r, assertions: has ? current.filter(a => a !== assertion) : [...current, assertion] };
    }));
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (row.isMandatory) return; // Cannot remove mandatory rows
    setRows(prev => prev.filter((_, i) => i !== index));
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
          rowId: row.id || null,
          lineItem: row.lineItem,
          complexityText: row.complexityText,
          subjectivityText: row.subjectivityText,
          changeText: row.changeText,
          uncertaintyText: row.uncertaintyText,
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
          <h2 className="text-base font-semibold text-slate-800">Identifying & Assessing RMM</h2>
          {/* Toggle: FS Line Items vs TB Accounts */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('fs_line')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'fs_line' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500'}`}
            >
              FS Line Items
            </button>
            <button
              onClick={() => setViewMode('tb_account')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'tb_account' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500'}`}
            >
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
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-36">Risk Identified</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-20">Amount</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-28">Assertions</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-14">Rel.</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-16">IR</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-36">Risk Summation</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Likelihood</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Magnitude</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Final Risk</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Control Risk</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Overall</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {computedRows.map((row, i) => {
              const isExpanded = expandedRow === (row.id || `new-${i}`);
              const rowKey = row.id || `new-${i}`;
              return (
                <Fragment key={rowKey}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50/50 ${row.isMandatory ? 'bg-amber-50/20' : ''}`}>
                    <td className="px-2 py-1">
                      <input type="text" value={row.lineItem} onChange={e => updateRow(i, 'lineItem', e.target.value)}
                        className={`w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 ${row.isMandatory ? 'font-medium' : ''}`}
                        readOnly={row.isMandatory} />
                    </td>
                    <td className="px-2 py-1">
                      <textarea value={row.riskIdentified || ''} onChange={e => updateRow(i, 'riskIdentified', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 resize-none min-h-[24px]" rows={1} />
                    </td>
                    <td className="px-2 py-1">
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
                      <button onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                        className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${isExpanded ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                        {isExpanded ? '▼' : '▶'} IR
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <div className={`relative rounded border-2 ${row.aiSummary && !row.isAiEdited ? 'border-orange-300' : row.isAiEdited ? 'border-green-300' : 'border-transparent'}`}>
                        <textarea
                          value={row.aiSummary || ''}
                          onChange={e => { updateRow(i, 'aiSummary', e.target.value); if (row.aiSummary) updateRow(i, 'isAiEdited', true); }}
                          className="w-full border-0 bg-transparent text-xs focus:outline-none rounded px-1 py-0.5 resize-none min-h-[24px]"
                          rows={1} placeholder="AI summary..." />
                        <button onClick={() => generateAISummary(i)}
                          disabled={generatingAI === rowKey}
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
                    <td className="px-2 py-1">
                      {!row.isMandatory && (
                        <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                      )}
                    </td>
                  </tr>
                  {/* Expanded Inherent Risk Sub-components */}
                  {isExpanded && (
                    <tr className="bg-blue-50/30 border-b border-slate-200">
                      <td colSpan={13} className="px-4 py-3">
                        <div className="grid grid-cols-5 gap-3">
                          {INHERENT_RISK_COMPONENTS.map(comp => {
                            const textKey = `${comp.key}Text` as keyof RMMRow;
                            const textVal = (row[textKey] as string) || '';
                            const riskKey = `inherentRiskLevel`;
                            return (
                              <div key={comp.key} className="space-y-1">
                                <label className="block text-[10px] font-medium text-slate-600">{comp.label}</label>
                                <textarea
                                  value={textVal}
                                  onChange={e => updateRow(i, textKey, e.target.value)}
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs min-h-[50px] resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder={`${comp.label} assessment...`}
                                />
                                <select
                                  value={row.inherentRiskLevel || ''}
                                  onChange={e => updateRow(i, riskKey, e.target.value)}
                                  className={`w-full border border-slate-200 rounded px-1 py-0.5 text-xs ${inherentRiskDropdownColor(row.inherentRiskLevel)}`}
                                >
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
