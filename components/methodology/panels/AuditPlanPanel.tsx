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

interface Props {
  engagementId: string;
  onClose: () => void;
}

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];

interface RMMItem {
  lineItem: string;
  overallRisk: string | null;
  amount: number | null;
}

export function AuditPlanPanel({ engagementId, onClose }: Props) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [rmmItems, setRmmItems] = useState<RMMItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatement, setActiveStatement] = useState('');
  const [activeLevel, setActiveLevel] = useState('');
  const [activeNote, setActiveNote] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [tbRes, rmmRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/rmm`),
        ]);
        if (tbRes.ok) {
          const data = await tbRes.json();
          setTbRows(data.rows || []);
        }
        if (rmmRes.ok) {
          const data = await rmmRes.json();
          setRmmItems((data.rows || []).map((r: any) => ({
            lineItem: r.lineItem,
            overallRisk: r.overallRisk || r.finalRiskAssessment,
            amount: r.amount,
          })));
        }
      } catch (err) {
        console.error('Failed to load data for audit plan:', err);
      }
      setLoading(false);
    }
    load();
  }, [engagementId]);

  // RMM significant risk items (High or Very High)
  const significantRiskItems = useMemo(() => {
    return new Set(rmmItems
      .filter(r => r.overallRisk === 'High' || r.overallRisk === 'Very High')
      .map(r => r.lineItem));
  }, [rmmItems]);

  // Top level: FS Statements (Balance Sheet, P&L, etc.)
  const statements = useMemo(() => {
    const set = new Set<string>();
    for (const row of tbRows) {
      if (row.fsStatement) set.add(row.fsStatement);
    }
    return STATEMENT_ORDER.filter(s => set.has(s)).concat(
      Array.from(set).filter(s => !STATEMENT_ORDER.includes(s))
    );
  }, [tbRows]);

  // Mid level: FS Level items for the active statement (e.g. Debtors, Revenue)
  const levels = useMemo(() => {
    if (!activeStatement) return [];
    const set = new Set<string>();
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel) set.add(row.fsLevel);
    }
    return Array.from(set).sort();
  }, [tbRows, activeStatement]);

  // Bottom level: FS Note items — only where monetary value exists OR significant risk in RMM
  const notes = useMemo(() => {
    if (!activeLevel) return [];
    const noteAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel === activeLevel && row.fsNoteLevel) {
        const cy = Number(row.currentYear) || 0;
        noteAmounts[row.fsNoteLevel] = (noteAmounts[row.fsNoteLevel] || 0) + Math.abs(cy);
      }
    }
    // Include note if it has a non-zero monetary value OR is flagged as significant risk in RMM
    return Object.keys(noteAmounts)
      .filter(note => noteAmounts[note] > 0 || significantRiskItems.has(note))
      .sort();
  }, [tbRows, activeStatement, activeLevel, significantRiskItems]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return tbRows.filter(row => {
      if (row.fsStatement !== activeStatement) return false;
      if (activeLevel && row.fsLevel !== activeLevel) return false;
      if (activeNote && row.fsNoteLevel !== activeNote) return false;
      return true;
    });
  }, [tbRows, activeStatement, activeLevel, activeNote]);

  // Auto-select first on load/change
  useEffect(() => {
    if (statements.length > 0 && !activeStatement) setActiveStatement(statements[0]);
  }, [statements, activeStatement]);

  useEffect(() => {
    if (levels.length > 0) setActiveLevel(levels[0]);
    else setActiveLevel('');
    setActiveNote('');
  }, [levels]);

  useEffect(() => {
    setActiveNote('');
  }, [activeLevel]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;
  }

  if (statements.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No FS Statement data found in the Trial Balance.</p>
        <p className="text-xs text-slate-400 mt-1">Assign FS Statement, FS Level, and FS Note values in the TBCYvPY tab first.</p>
        <button onClick={onClose} className="mt-4 text-xs text-blue-600 hover:text-blue-800">&larr; Back to RMM</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to RMM
        </button>
        <h2 className="text-sm font-semibold text-slate-800">Audit Plan</h2>
      </div>

      {/* Level 1: FS Statement tabs (P&L, Balance Sheet, etc.) */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {statements.map(stmt => (
          <button
            key={stmt}
            onClick={() => { setActiveStatement(stmt); setActiveLevel(''); setActiveNote(''); }}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeStatement === stmt
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {stmt}
            <span className="ml-1 text-[9px] text-slate-400">({tbRows.filter(r => r.fsStatement === stmt).length})</span>
          </button>
        ))}
      </div>

      {/* Level 2: FS Level sub-tabs (Revenue, Debtors, Fixed Assets, etc.) */}
      {levels.length > 0 && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto">
          {levels.map(level => (
            <button
              key={level}
              onClick={() => { setActiveLevel(level); setActiveNote(''); }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors ${
                activeLevel === level
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      )}

      {/* Level 3: FS Note sub-sub-tabs (Trade Debtors, Prepayments, etc.) */}
      {notes.length > 1 && (
        <div className="flex gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveNote('')}
            className={`px-2.5 py-1 text-[10px] font-medium rounded border transition-colors ${
              !activeNote ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
            }`}
          >
            All
          </button>
          {notes.map(note => {
            const isSigRisk = significantRiskItems.has(note);
            return (
            <button
              key={note}
              onClick={() => setActiveNote(note)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded border transition-colors ${
                activeNote === note ? 'bg-blue-100 text-blue-700 border-blue-300' :
                isSigRisk ? 'bg-red-50 text-red-700 border-red-200 hover:border-red-300' :
                'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
              }`}
            >
              {note}{isSigRisk && <span className="ml-1 text-red-500">⚠</span>}
            </button>
            );
          }
          ))}
        </div>
      )}

      {/* Content — TB rows matching selection */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            {activeStatement}
            {activeLevel && <span className="text-slate-400"> / {activeLevel}</span>}
            {activeNote && <span className="text-slate-300"> / {activeNote}</span>}
          </span>
          <span className="text-[10px] text-slate-400">{filteredRows.length} item{filteredRows.length !== 1 ? 's' : ''}</span>
        </div>

        {filteredRows.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">No items for this selection.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Account Code</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Description</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">FS Note</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Current Year</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Prior Year</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Audit Approach</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-600">{row.accountCode}</td>
                  <td className="px-3 py-2 text-slate-700">{row.description}</td>
                  <td className="px-3 py-2 text-slate-500 text-[10px]">{row.fsNoteLevel || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {row.currentYear != null ? `£${Math.abs(Number(row.currentYear)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}${Number(row.currentYear) < 0 ? ' Cr' : ' Dr'}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {row.priorYear != null ? `£${Math.abs(Number(row.priorYear)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}${Number(row.priorYear) < 0 ? ' Cr' : ' Dr'}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">To be planned</span>
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
