'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
  isGroupAudit?: boolean;
  showCategory?: boolean;
  onShowCategoryChange?: (show: boolean) => void;
}

interface TBRow {
  id: string;
  accountCode: string;
  description: string;
  category: string | null;
  currentYear: number | null;
  priorYear: number | null;
  fsNoteLevel: string | null;
  fsLevel: string | null;
  fsStatement: string | null;
  groupName: string | null;
  sortOrder: number;
}

export function TrialBalanceTab({ engagementId, isGroupAudit = false, showCategory: initialShowCategory = true, onShowCategoryChange }: Props) {
  const [rows, setRows] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialRows, setInitialRows] = useState<TBRow[]>([]);
  const [showCategory, setShowCategoryLocal] = useState(initialShowCategory);

  function setShowCategory(show: boolean) {
    setShowCategoryLocal(show);
    onShowCategoryChange?.(show);
  }

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/trial-balance`,
    { rows },
    { enabled: JSON.stringify(rows) !== JSON.stringify(initialRows) }
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/trial-balance`);
      if (res.ok) { const json = await res.json(); setRows(json.rows || []); setInitialRows(json.rows || []); }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  function addRow() {
    setRows(prev => [...prev, {
      id: '', accountCode: '', description: '', category: null,
      currentYear: null, priorYear: null, fsNoteLevel: null,
      fsLevel: null, fsStatement: null, groupName: null,
      sortOrder: prev.length,
    }]);
  }

  function updateRow(index: number, field: keyof TBRow, value: string | number | null) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Trial Balance...</div>;

  const numCls = 'w-full border-0 bg-transparent text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5';
  const txtCls = 'w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={showCategory} onChange={e => setShowCategory(e.target.checked)} className="w-3 h-3 rounded" />
            Show Category
          </label>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-auto flex-1" style={{ minHeight: '300px', maxHeight: 'calc(100vh - 280px)' }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-24">Account Code</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-48">Description</th>
              {showCategory && <th className="text-left px-2 py-2 text-slate-500 font-medium w-24">Category</th>}
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-28">Period End</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-28">Period Start - 1</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-20">FS Note</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-20">FS Level</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-28">FS Statement</th>
              {isGroupAudit && <th className="text-left px-2 py-2 text-slate-500 font-medium w-28">Group Name</th>}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-8 text-slate-400 italic">No trial balance data. Click &quot;Add Row&quot; to begin.</td></tr>
            ) : rows.map((row, i) => (
              <tr key={row.id || `new-${i}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-2 py-0.5">
                  <input type="text" value={row.accountCode} onChange={e => updateRow(i, 'accountCode', e.target.value)} className={txtCls} placeholder="Code" />
                </td>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.description} onChange={e => updateRow(i, 'description', e.target.value)} className={txtCls} placeholder="Description" />
                </td>
                {showCategory && (
                  <td className="px-2 py-0.5">
                    <input type="text" value={row.category || ''} onChange={e => updateRow(i, 'category', e.target.value || null)} className={txtCls} placeholder="Category" />
                  </td>
                )}
                <td className="px-2 py-0.5">
                  <input type="number" value={row.currentYear ?? ''} onChange={e => updateRow(i, 'currentYear', e.target.value ? Number(e.target.value) : null)} className={numCls} step="0.01" />
                </td>
                <td className="px-2 py-0.5">
                  <input type="number" value={row.priorYear ?? ''} onChange={e => updateRow(i, 'priorYear', e.target.value ? Number(e.target.value) : null)} className={numCls} step="0.01" />
                </td>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.fsNoteLevel || ''} onChange={e => updateRow(i, 'fsNoteLevel', e.target.value || null)} className={txtCls} />
                </td>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.fsLevel || ''} onChange={e => updateRow(i, 'fsLevel', e.target.value || null)} className={txtCls} />
                </td>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.fsStatement || ''} onChange={e => updateRow(i, 'fsStatement', e.target.value || null)} className={txtCls} />
                </td>
                {isGroupAudit && (
                  <td className="px-2 py-0.5">
                    <input type="text" value={row.groupName || ''} onChange={e => updateRow(i, 'groupName', e.target.value || null)} className={txtCls} />
                  </td>
                )}
                <td className="px-2 py-0.5">
                  <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-xs text-slate-400">{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
    </div>
  );
}
