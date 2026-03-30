'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, ArrowLeft, FileText } from 'lucide-react';

interface TBRow {
  id: string;
  accountCode: string;
  description: string;
  fsStatement: string | null;
  fsNoteLevel: string | null;
  currentYear: number | null;
  priorYear: number | null;
  category: string | null;
}

interface Props {
  engagementId: string;
  onClose: () => void;
}

export function AuditPlanPanel({ engagementId, onClose }: Props) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatement, setActiveStatement] = useState('');
  const [activeNoteLevel, setActiveNoteLevel] = useState('');

  // Load TB data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/trial-balance`);
        if (res.ok) {
          const data = await res.json();
          setTbRows(data.rows || data.trialBalance || []);
        }
      } catch (err) {
        console.error('Failed to load TB for audit plan:', err);
      }
      setLoading(false);
    }
    load();
  }, [engagementId]);

  // Extract unique FS Statement Levels (top-level tabs)
  const statementLevels = useMemo(() => {
    const set = new Set<string>();
    for (const row of tbRows) {
      if (row.fsStatement) set.add(row.fsStatement);
    }
    return Array.from(set).sort();
  }, [tbRows]);

  // Extract FS Note Levels for active statement (sub-tabs)
  const noteLevels = useMemo(() => {
    if (!activeStatement) return [];
    const set = new Set<string>();
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsNoteLevel) {
        set.add(row.fsNoteLevel);
      }
    }
    return Array.from(set).sort();
  }, [tbRows, activeStatement]);

  // Rows for the active statement + note level
  const filteredRows = useMemo(() => {
    return tbRows.filter(row => {
      if (row.fsStatement !== activeStatement) return false;
      if (activeNoteLevel && row.fsNoteLevel !== activeNoteLevel) return false;
      return true;
    });
  }, [tbRows, activeStatement, activeNoteLevel]);

  // Auto-select first statement on load
  useEffect(() => {
    if (statementLevels.length > 0 && !activeStatement) {
      setActiveStatement(statementLevels[0]);
    }
  }, [statementLevels, activeStatement]);

  // Auto-select first note level when statement changes
  useEffect(() => {
    if (noteLevels.length > 0) {
      setActiveNoteLevel(noteLevels[0]);
    } else {
      setActiveNoteLevel('');
    }
  }, [noteLevels]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (statementLevels.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No FS Statement Levels found in the Trial Balance.</p>
        <p className="text-xs text-slate-400 mt-1">Assign FS Statement values in the TBCYvPY tab first.</p>
        <button onClick={onClose} className="mt-4 text-xs text-blue-600 hover:text-blue-800">
          &larr; Back to RMM
        </button>
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

      {/* FS Statement Level tabs (top-level) */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {statementLevels.map(stmt => (
          <button
            key={stmt}
            onClick={() => setActiveStatement(stmt)}
            className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeStatement === stmt
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {stmt}
          </button>
        ))}
      </div>

      {/* FS Note Level sub-tabs */}
      {noteLevels.length > 0 && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto">
          {noteLevels.map(note => (
            <button
              key={note}
              onClick={() => setActiveNoteLevel(note)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors ${
                activeNoteLevel === note
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {note}
            </button>
          ))}
        </div>
      )}

      {/* Content area — TB rows matching the selection */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            {activeStatement}
            {activeNoteLevel && <span className="text-slate-400"> / {activeNoteLevel}</span>}
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
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Category</th>
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
                  <td className="px-3 py-2 text-slate-500">{row.category || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {row.currentYear != null ? row.currentYear.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {row.priorYear != null ? row.priorYear.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
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
