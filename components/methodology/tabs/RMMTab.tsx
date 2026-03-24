'use client';

import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { ASSERTION_TYPES, INHERENT_RISK_COMPONENTS } from '@/types/methodology';
import { lookupInherentRisk, lookupOverallRisk, riskColor, inherentRiskDropdownColor } from '@/lib/risk-table-lookup';

interface Props {
  engagementId: string;
  auditType: string;
  teamMembers?: { userId: string; userName?: string; role: string }[];
  showCategoryOption?: boolean; // from TBCYvPY setting
}

interface RowSignOff { userId: string; userName: string; timestamp: string; }
interface RowSignOffs { reviewer?: RowSignOff; partner?: RowSignOff; }

interface RMMRow {
  id: string;
  lineItem: string;
  lineType: string;
  category: string | null;
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
  rowSignOffs?: RowSignOffs;
  lastEditedAt?: string;
}

const RISK_LEVELS = ['Remote', 'Low', 'Medium', 'High', 'Very High'] as const;
const LIKELIHOODS = ['Remote', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'] as const;
const MAGNITUDES = ['Very Low', 'Low', 'Medium', 'High', 'Very High'] as const;
const CONTROL_OPTIONS = ['Not Tested', 'Not Effective', 'Partially Effective', 'Effective'] as const;

const isControlsBased = (type: string) => type === 'SME_CONTROLS' || type === 'PIE_CONTROLS';

// Auto-expanding textarea helper
function AutoTextarea({ value, onChange, className, readOnly, placeholder }: {
  value: string; onChange: (v: string) => void; className?: string; readOnly?: boolean; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = ref.current.scrollHeight + 'px'; }
  }, [value]);
  return (
    <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} readOnly={readOnly} placeholder={placeholder}
      className={className} rows={1} style={{ minHeight: '24px', overflow: 'hidden', resize: 'none' }}
      onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }} />
  );
}

export function RMMTab({ engagementId, auditType, teamMembers = [], showCategoryOption = false }: Props) {
  const { data: session } = useSession();
  const [rows, setRows] = useState<RMMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialRows, setInitialRows] = useState<RMMRow[]>([]);
  const [viewMode, setViewMode] = useState<'fs_line' | 'tb_account'>('fs_line');
  const [showCategory, setShowCategory] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [generatingAI, setGeneratingAI] = useState<string | null>(null);
  const [importingTB, setImportingTB] = useState(false);

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

  const currentUserId = session?.user?.id;
  const userIsReviewer = currentUserId && teamMembers.some(m => m.role === 'Manager' && m.userId === currentUserId);
  const userIsPartner = currentUserId && teamMembers.some(m => m.role === 'RI' && m.userId === currentUserId);

  function makeEmptyRow(): RMMRow {
    return {
      id: '', lineItem: '', lineType: viewMode, category: null, riskIdentified: null, amount: null,
      assertions: [], relevance: null, complexityText: null, subjectivityText: null,
      changeText: null, uncertaintyText: null, susceptibilityText: null,
      inherentRiskLevel: null, aiSummary: null, isAiEdited: false,
      likelihood: null, magnitude: null, finalRiskAssessment: null,
      controlRisk: isControlsBased(auditType) ? null : 'Not Tested',
      overallRisk: null, isHidden: false, isMandatory: false, sortOrder: 0,
      rowSignOffs: {},
    };
  }

  function addRow() {
    setRows(prev => [...prev, { ...makeEmptyRow(), sortOrder: prev.length }]);
  }

  function duplicateRow(index: number) {
    const source = rows[index];
    const newRow: RMMRow = {
      ...source,
      id: '', // New row, no DB ID
      aiSummary: null, // Needs regeneration
      isAiEdited: false,
      rowSignOffs: {}, // Don't copy sign-offs
      lastEditedAt: undefined,
      sortOrder: index + 1,
      isMandatory: false, // Duplicated rows are never mandatory
    };
    setRows(prev => {
      const copy = [...prev];
      copy.splice(index + 1, 0, newRow);
      return copy.map((r, i) => ({ ...r, sortOrder: i }));
    });
  }

  function updateRow(index: number, field: keyof RMMRow, value: unknown) {
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const updated = { ...r, [field]: value, lastEditedAt: new Date().toISOString() };
      if (field !== 'rowSignOffs' && field !== 'lastEditedAt') {
        const signOffs = { ...(updated.rowSignOffs || {}) };
        if (signOffs.partner) delete signOffs.partner;
        if (signOffs.reviewer && !userIsReviewer) delete signOffs.reviewer;
        else if (signOffs.reviewer && userIsReviewer) delete signOffs.partner;
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
      const signOffData: RowSignOff = { userId: currentUserId || '', userName, timestamp: new Date().toISOString() };
      if (role === 'partner') { signOffs.partner = signOffData; signOffs.reviewer = signOffData; }
      else { signOffs.reviewer = signOffData; }
      return { ...r, rowSignOffs: signOffs };
    }));
  }

  function toggleAssertion(index: number, assertion: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const current = r.assertions || [];
      const has = current.includes(assertion);
      const updated = { ...r, assertions: has ? current.filter(a => a !== assertion) : [...current, assertion], lastEditedAt: new Date().toISOString() };
      const signOffs = { ...(updated.rowSignOffs || {}) };
      delete signOffs.partner;
      if (!userIsReviewer) delete signOffs.reviewer;
      updated.rowSignOffs = signOffs;
      return updated;
    }));
  }

  function removeRow(index: number) {
    if (rows[index].isMandatory) return;
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  // Import rows from Trial Balance
  async function importFromTB() {
    setImportingTB(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/trial-balance`);
      if (!res.ok) return;
      const json = await res.json();
      const tbRows = json.rows || [];
      const existingLineItems = new Set(rows.map(r => r.lineItem.toLowerCase().trim()));

      const newRows: RMMRow[] = [];
      for (const tb of tbRows) {
        const lineItem = tb.description || tb.accountCode || '';
        if (!lineItem || existingLineItems.has(lineItem.toLowerCase().trim())) continue;
        newRows.push({
          ...makeEmptyRow(),
          lineItem,
          lineType: 'tb_account',
          category: tb.category || null,
          amount: tb.periodEnd ?? tb.currentYear ?? null,
          sortOrder: rows.length + newRows.length,
        });
      }

      if (newRows.length > 0) {
        setRows(prev => [...prev, ...newRows]);
      }
    } catch (err) { console.error('Failed to import TB:', err); }
    finally { setImportingTB(false); }
  }

  // Split rows by assertion — rows with >1 assertion get duplicated with 1 assertion each
  function splitByAssertion() {
    const newRows: RMMRow[] = [];
    for (const row of rows) {
      const assertions = row.assertions || [];
      if (assertions.length <= 1) {
        newRows.push(row);
      } else {
        // First assertion keeps the original row (with its ID)
        newRows.push({
          ...row,
          assertions: [assertions[0]],
          rowSignOffs: {}, // Clear sign-offs - needs re-review
        });
        // Remaining assertions get new duplicate rows
        for (let a = 1; a < assertions.length; a++) {
          newRows.push({
            ...row,
            id: '', // New row, no DB ID
            assertions: [assertions[a]],
            aiSummary: null, // Needs regeneration
            isAiEdited: false,
            rowSignOffs: {}, // No sign-offs on new rows
            lastEditedAt: undefined,
            isMandatory: false, // Splits of mandatory rows are not mandatory
          });
        }
      }
    }
    setRows(newRows.map((r, i) => ({ ...r, sortOrder: i })));
  }

  function getRowOutline(row: RMMRow): string {
    if (!row.lastEditedAt) return '';
    const editTime = new Date(row.lastEditedAt).getTime();
    const partnerTime = row.rowSignOffs?.partner?.timestamp ? new Date(row.rowSignOffs.partner.timestamp).getTime() : 0;
    const reviewerTime = row.rowSignOffs?.reviewer?.timestamp ? new Date(row.rowSignOffs.reviewer.timestamp).getTime() : 0;
    if (partnerTime > 0 && editTime > partnerTime) return 'ring-2 ring-red-400 ring-offset-1';
    if (reviewerTime > 0 && editTime > reviewerTime) return 'ring-2 ring-orange-400 ring-offset-1';
    return '';
  }

  async function generateAISummary(index: number) {
    const row = rows[index];
    if (!row.lineItem) return;
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
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
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
          {viewMode === 'tb_account' && (
            <button onClick={importFromTB} disabled={importingTB}
              className="text-xs px-3 py-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100 disabled:opacity-50">
              {importingTB ? 'Importing...' : '📥 Import from TB'}
            </button>
          )}
          {showCategoryOption && (
            <button onClick={() => setShowCategory(!showCategory)}
              className={`text-xs px-3 py-1 rounded transition-colors ${showCategory ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {showCategory ? '☑ Category' : '☐ Category'}
            </button>
          )}
          <button onClick={splitByAssertion}
            className="text-xs px-3 py-1 bg-purple-50 text-purple-600 rounded hover:bg-purple-100">
            ✂ Split by Assertion
          </button>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
        </div>
      </div>

      {/* Table — max height with frozen header */}
      <div className="border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-280px)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="w-8 px-1 py-2"></th>
              {showCategory && <th className="text-left px-2 py-2 text-slate-500 font-medium w-28">Category</th>}
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-40">{viewMode === 'fs_line' ? 'FS Line Item' : 'TB Account'}</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-40">Risk Identified</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-28">Amount</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-28">Assertions</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-14" title="Relevant?">Rel. <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span></th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-16" title="Inherent Risk">IR <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span></th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-36">Risk Summation</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Likelihood</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Magnitude</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Final Risk</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-24">Control Risk</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Overall</th>
              <th className="text-center px-1 py-2 text-slate-500 font-medium w-14" title="Significant Risk">Sig.Risk <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span></th>
              <th className="text-center px-1 py-2 text-slate-500 font-medium w-28">
                <div className="flex gap-2 justify-center">
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
              const hasIRData = !!(row.complexityText || row.subjectivityText || row.changeText || row.uncertaintyText || row.susceptibilityText || row.inherentRiskLevel);

              return (
                <Fragment key={rowKey}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50/50 ${row.isMandatory ? 'bg-amber-50/20' : ''} ${outline}`}>
                    {/* Duplicate button */}
                    <td className="px-1 py-1 align-top text-center">
                      <button onClick={() => duplicateRow(i)} className="text-slate-300 hover:text-blue-500 text-[10px]" title="Duplicate row">⧉</button>
                    </td>
                    {showCategory && (
                      <td className="px-2 py-1 align-top">
                        <input type="text" value={row.category || ''} onChange={e => updateRow(i, 'category', e.target.value)}
                          className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" placeholder="—" />
                      </td>
                    )}
                    <td className="px-2 py-1 align-top">
                      <AutoTextarea value={row.lineItem} onChange={v => updateRow(i, 'lineItem', v)} readOnly={row.isMandatory}
                        className={`w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 ${row.isMandatory ? 'font-medium' : ''}`} />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <AutoTextarea value={row.riskIdentified || ''} onChange={v => updateRow(i, 'riskIdentified', v)}
                        className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <input type="number" value={row.amount ?? ''} onChange={e => updateRow(i, 'amount', e.target.value ? Number(e.target.value) : null)}
                        className="w-full border-0 bg-transparent text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                    </td>
                    <td className="px-2 py-1 align-top">
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
                    <td className="px-2 py-1 text-center align-top">
                      <select value={row.relevance || ''} onChange={e => updateRow(i, 'relevance', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-xs bg-white w-10">
                        <option value="">-</option><option value="Y">Y</option><option value="N">N</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center align-top">
                      <button onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                        className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                          isExpanded ? 'bg-blue-100 border-blue-300 text-blue-700' :
                          hasIRData ? 'bg-blue-50 border-blue-200 text-blue-600 font-medium' :
                          'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                        }`}>
                        {isExpanded ? '▼' : '▶'} IR{hasIRData && !isExpanded ? ' ●' : ''}
                      </button>
                    </td>
                    <td className="px-2 py-1 align-top">
                      <div className={`relative rounded border-2 ${row.aiSummary && !row.isAiEdited ? 'border-orange-300' : row.isAiEdited ? 'border-green-300' : 'border-transparent'}`}>
                        <AutoTextarea value={row.aiSummary || ''} onChange={v => { updateRow(i, 'aiSummary', v); if (row.aiSummary) updateRow(i, 'isAiEdited', true); }}
                          className="w-full border-0 bg-transparent text-xs focus:outline-none rounded px-1 py-0.5" placeholder="AI summary..." />
                        <button onClick={() => generateAISummary(i)} disabled={generatingAI === rowKey}
                          className="absolute -top-2 -right-2 w-4 h-4 bg-blue-500 text-white rounded-full text-[8px] hover:bg-blue-600 disabled:bg-slate-300"
                          title="Generate AI risk summary">✦</button>
                      </div>
                    </td>
                    <td className="px-2 py-1 text-center align-top">
                      <select value={row.likelihood || ''} onChange={e => updateRow(i, 'likelihood', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-[10px] bg-white w-16">
                        <option value="">-</option>
                        {LIKELIHOODS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center align-top">
                      <select value={row.magnitude || ''} onChange={e => updateRow(i, 'magnitude', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-[10px] bg-white w-16">
                        <option value="">-</option>
                        {MAGNITUDES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center align-top">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${riskColor(row.finalRiskAssessment)}`}>
                        {row.finalRiskAssessment || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-center align-top">
                      <select value={row.controlRisk || 'Not Tested'} onChange={e => updateRow(i, 'controlRisk', e.target.value)}
                        className="border border-slate-200 rounded px-0.5 py-0.5 text-[10px] bg-white w-20">
                        {CONTROL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center align-top">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${riskColor(row.overallRisk)}`}>
                        {row.overallRisk || '—'}
                      </span>
                    </td>
                    {/* Significant Risk */}
                    <td className="px-1 py-1 text-center align-top">
                      {(row.overallRisk === 'High' || row.overallRisk === 'Very High') && (
                        <span className="text-red-500 text-sm" title="Significant Risk">✓</span>
                      )}
                    </td>
                    {/* Row-level sign-off dots */}
                    <td className="px-1 py-1 align-top">
                      <div className="flex gap-2 justify-center items-start">
                        {/* Reviewer */}
                        <div className="flex flex-col items-center min-w-[45px]">
                          <button onClick={() => userIsReviewer && signOffRow(i, 'reviewer')} disabled={!userIsReviewer}
                            className={`w-4 h-4 rounded-full border-2 transition-all ${
                              reviewerSO && !reviewerStale ? 'bg-green-500 border-green-500'
                              : reviewerStale ? 'bg-white border-green-500'
                              : userIsReviewer ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                              : 'bg-white border-slate-200 opacity-50'
                            }`}
                            title={reviewerSO ? `${reviewerSO.userName} — ${new Date(reviewerSO.timestamp).toLocaleString('en-GB')}` : 'Reviewer sign-off'} />
                          {reviewerSO && !reviewerStale && (
                            <div className="text-center mt-0.5">
                              <p className="text-[6px] text-slate-500 leading-tight">{reviewerSO.userName}</p>
                              <p className="text-[6px] text-slate-400 leading-tight">{new Date(reviewerSO.timestamp).toLocaleDateString('en-GB')} {new Date(reviewerSO.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                          )}
                        </div>
                        {/* Partner */}
                        <div className="flex flex-col items-center min-w-[45px]">
                          <button onClick={() => userIsPartner && signOffRow(i, 'partner')} disabled={!userIsPartner}
                            className={`w-4 h-4 rounded-full border-2 transition-all ${
                              partnerSO && !partnerStale ? 'bg-green-500 border-green-500'
                              : partnerStale ? 'bg-white border-green-500'
                              : userIsPartner ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                              : 'bg-white border-slate-200 opacity-50'
                            }`}
                            title={partnerSO ? `${partnerSO.userName} — ${new Date(partnerSO.timestamp).toLocaleString('en-GB')}` : 'Partner sign-off'} />
                          {partnerSO && !partnerStale && (
                            <div className="text-center mt-0.5">
                              <p className="text-[6px] text-slate-500 leading-tight">{partnerSO.userName}</p>
                              <p className="text-[6px] text-slate-400 leading-tight">{new Date(partnerSO.timestamp).toLocaleDateString('en-GB')} {new Date(partnerSO.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-1 py-1 align-top">
                      {!row.isMandatory && (
                        <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-blue-50/30 border-b border-slate-200">
                      <td colSpan={showCategory ? 18 : 17} className="px-4 py-3">
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
