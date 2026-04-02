'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, ArrowLeft, FileText } from 'lucide-react';

interface TBRow {
  id: string;
  accountCode: string;
  description: string;
  fsStatement: string | null;
  fsLevel: string | null;
  fsNoteLevel: string | null;
  currentYear: number | null;
  priorYear: number | null;
  category: string | null;
}

interface RMMItem {
  lineItem: string;
  overallRisk: string | null;
  amount: number | null;
}

interface Props {
  engagementId: string;
  onClose: () => void;
}

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];
// Statements that use 3-level hierarchy (Statement > Level > Note)
const THREE_LEVEL_STATEMENTS = new Set(['Balance Sheet']);
// Statements that use 2-level only (Statement > Level, notes listed inline)
// P&L, Cash Flow, Notes all use 2-level

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return '';
  const n = Number(v);
  if (isNaN(n)) return '';
  return `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2 })}${n < 0 ? ' Cr' : ' Dr'}`;
}

export function AuditPlanPanel({ engagementId, onClose }: Props) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [rmmItems, setRmmItems] = useState<RMMItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatement, setActiveStatement] = useState('');
  const [activeLevel, setActiveLevel] = useState('');
  const [activeNote, setActiveNote] = useState('');
  const [framework, setFramework] = useState('');
  const [fsLineOrder, setFsLineOrder] = useState<Record<string, number>>({});

  useEffect(() => {
    async function load() {
      try {
        const [tbRes, rmmRes, engRes, fsRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/rmm`),
          fetch(`/api/engagements/${engagementId}`),
          fetch('/api/methodology-admin/fs-lines'),
        ]);
        if (tbRes.ok) setTbRows((await tbRes.json()).rows || []);
        if (rmmRes.ok) {
          setRmmItems(((await rmmRes.json()).rows || []).map((r: any) => ({
            lineItem: r.lineItem, overallRisk: r.overallRisk || r.finalRiskAssessment, amount: r.amount,
          })));
        }
        if (fsRes.ok) {
          const fsData = await fsRes.json();
          const order: Record<string, number> = {};
          (fsData.fsLines || []).forEach((fl: any, idx: number) => { order[fl.name] = fl.sortOrder ?? idx; });
          setFsLineOrder(order);
        }
        if (engRes.ok) {
          const eng = (await engRes.json()).engagement;
          if (eng?.methodologyConfig?.config?.accountingFramework) {
            setFramework(eng.methodologyConfig.config.accountingFramework);
          }
        }
      } catch (err) { console.error('Failed to load:', err); }
      setLoading(false);
    }
    load();
  }, [engagementId]);

  const significantRiskItems = useMemo(() => {
    return new Set(rmmItems.filter(r => r.overallRisk === 'High' || r.overallRisk === 'Very High').map(r => r.lineItem));
  }, [rmmItems]);

  // Include Cash Flow if framework is IFRS/FRS101/FRS102
  const requiresCashFlow = ['IFRS', 'FRS101', 'FRS102'].includes(framework);

  const statements = useMemo(() => {
    const set = new Set<string>();
    for (const row of tbRows) { if (row.fsStatement) set.add(row.fsStatement); }
    // Always include Cash Flow for relevant frameworks even if no TB rows tagged
    if (requiresCashFlow) set.add('Cash Flow Statement');
    return STATEMENT_ORDER.filter(s => set.has(s)).concat(Array.from(set).filter(s => !STATEMENT_ORDER.includes(s)));
  }, [tbRows, requiresCashFlow]);

  const levels = useMemo(() => {
    if (!activeStatement) return [];
    const levelAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel) {
        levelAmounts[row.fsLevel] = (levelAmounts[row.fsLevel] || 0) + Math.abs(Number(row.currentYear) || 0);
      }
    }
    // Only include levels with monetary value or significant risk, sorted by FS Lines order
    return Object.keys(levelAmounts)
      .filter(l => levelAmounts[l] > 0 || significantRiskItems.has(l))
      .sort((a, b) => (fsLineOrder[a] ?? 9999) - (fsLineOrder[b] ?? 9999));
  }, [tbRows, activeStatement, significantRiskItems, fsLineOrder]);

  // Notes — only for 3-level statements (Balance Sheet), filtered by value/risk
  const notes = useMemo(() => {
    if (!activeLevel || !THREE_LEVEL_STATEMENTS.has(activeStatement)) return [];
    const noteAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel === activeLevel && row.fsNoteLevel) {
        noteAmounts[row.fsNoteLevel] = (noteAmounts[row.fsNoteLevel] || 0) + Math.abs(Number(row.currentYear) || 0);
      }
    }
    return Object.keys(noteAmounts)
      .filter(n => noteAmounts[n] > 0 || significantRiskItems.has(n))
      .sort((a, b) => (fsLineOrder[a] ?? 9999) - (fsLineOrder[b] ?? 9999));
  }, [tbRows, activeStatement, activeLevel, significantRiskItems, fsLineOrder]);

  const filteredRows = useMemo(() => {
    return tbRows.filter(row => {
      if (row.fsStatement !== activeStatement) return false;
      if (activeLevel && row.fsLevel && row.fsLevel !== activeLevel) return false;
      if (activeNote && row.fsNoteLevel && row.fsNoteLevel !== activeNote) return false;
      // Must have monetary value (CY or PY non-zero)
      const cy = Number(row.currentYear) || 0;
      const py = Number(row.priorYear) || 0;
      if (cy === 0 && py === 0) return false;
      return true;
    });
  }, [tbRows, activeStatement, activeLevel, activeNote]);

  useEffect(() => {
    if (statements.length > 0 && !activeStatement) setActiveStatement(statements[0]);
  }, [statements, activeStatement]);

  useEffect(() => {
    if (levels.length > 0) setActiveLevel(levels[0]); else setActiveLevel('');
    setActiveNote('');
  }, [levels]);

  useEffect(() => { setActiveNote(''); }, [activeLevel]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  if (statements.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No FS Statement data found.</p>
        <button onClick={onClose} className="mt-4 text-xs text-blue-600 hover:text-blue-800">&larr; Back to RMM</button>
      </div>
    );
  }

  const isThreeLevel = THREE_LEVEL_STATEMENTS.has(activeStatement);

  return (
    <div className="space-y-2">
      {/* Header — compact */}
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to RMM
        </button>
        <h2 className="text-sm font-semibold text-slate-800">Audit Plan</h2>
        {framework && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{framework}</span>}
      </div>

      {/* Level 1: FS Statement tabs */}
      <div className="flex gap-0.5 border-b border-slate-200 overflow-x-auto">
        {statements.map(stmt => (
          <button key={stmt}
            onClick={() => { setActiveStatement(stmt); setActiveLevel(''); setActiveNote(''); }}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeStatement === stmt ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {stmt}
          </button>
        ))}
      </div>

      {/* Level 2: FS Level sub-tabs */}
      {levels.length > 0 && (
        <div className="flex gap-0.5 bg-slate-100 rounded p-0.5 overflow-x-auto">
          {levels.map(level => (
            <button key={level}
              onClick={() => { setActiveLevel(level); setActiveNote(''); }}
              className={`px-2 py-1 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                activeLevel === level ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {level}
            </button>
          ))}
        </div>
      )}

      {/* Level 3: FS Note sub-sub-tabs — only for Balance Sheet */}
      {isThreeLevel && notes.length > 1 && (
        <div className="flex gap-0.5 overflow-x-auto">
          <button onClick={() => setActiveNote('')}
            className={`px-2 py-0.5 text-[9px] font-medium rounded border transition-colors ${!activeNote ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-slate-500 border-slate-200'}`}>
            All
          </button>
          {notes.map(note => {
            const isSig = significantRiskItems.has(note);
            return (
              <button key={note} onClick={() => setActiveNote(note)}
                className={`px-2 py-0.5 text-[9px] font-medium rounded border transition-colors ${
                  activeNote === note ? 'bg-blue-100 text-blue-700 border-blue-300' :
                  isSig ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-slate-500 border-slate-200'
                }`}>
                {note}{isSig && <span className="ml-0.5 text-red-500">⚠</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-slate-700">
            {activeStatement}{activeLevel && <span className="text-slate-400"> / {activeLevel}</span>}{activeNote && <span className="text-slate-300"> / {activeNote}</span>}
          </span>
          <span className="text-[9px] text-slate-400">{filteredRows.length} items</span>
        </div>

        {filteredRows.length === 0 ? (
          <div className="p-4 text-center text-[10px] text-slate-400">No items for this selection.</div>
        ) : (
          <table className="text-[10px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-1.5 py-1 text-left font-semibold text-slate-600">Code</th>
                <th className="px-1.5 py-1 text-left font-semibold text-slate-600">Description</th>
                {isThreeLevel && <th className="px-1.5 py-1 text-left font-semibold text-slate-600">FS Note</th>}
                <th className="px-1.5 py-1 text-right font-semibold text-slate-600">CY</th>
                <th className="px-1.5 py-1 text-right font-semibold text-slate-600">PY</th>
                <th className="px-1.5 py-1 text-left font-semibold text-slate-600">Approach</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-1.5 py-0.5 font-mono text-slate-500">{row.accountCode}</td>
                  <td className="px-1.5 py-0.5 text-slate-700">{row.description}</td>
                  {isThreeLevel && <td className="px-1.5 py-0.5 text-slate-400">{row.fsNoteLevel || ''}</td>}
                  <td className="px-1.5 py-0.5 text-right">{fmtAmount(row.currentYear)}</td>
                  <td className="px-1.5 py-0.5 text-right text-slate-500">{fmtAmount(row.priorYear)}</td>
                  <td className="px-1.5 py-0.5">
                    <span className="text-[9px] px-1 py-0.5 bg-blue-50 text-blue-600 rounded">Plan</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
