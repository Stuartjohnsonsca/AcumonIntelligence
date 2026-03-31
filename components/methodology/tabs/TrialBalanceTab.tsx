'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
  isGroupAudit?: boolean;
  showCategory?: boolean;
  onShowCategoryChange?: (show: boolean) => void;
  periodEndDate?: string | null;
  periodStartDate?: string | null;
}

function formatDateDDMMYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dayBefore(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

interface FsItem {
  id: string;
  name: string;
  lineType: string;
  statement: string;
}

export function TrialBalanceTab({ engagementId, isGroupAudit = false, showCategory: initialShowCategory = true, onShowCategoryChange, periodEndDate, periodStartDate }: Props) {
  const [rows, setRows] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialRows, setInitialRows] = useState<TBRow[]>([]);
  const [showCategory, setShowCategoryLocal] = useState(initialShowCategory);

  // FS hierarchy for cascading dropdowns
  const [fsStatements, setFsStatements] = useState<string[]>([]);
  const [fsLevels, setFsLevels] = useState<{ name: string; statement: string }[]>([]);
  const [fsNotes, setFsNotes] = useState<FsItem[]>([]);
  const [fsAllItems, setFsAllItems] = useState<FsItem[]>([]);

  function setShowCategory(show: boolean) {
    setShowCategoryLocal(show);
    onShowCategoryChange?.(show);
  }

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/trial-balance`,
    { rows },
    { enabled: JSON.stringify(rows) !== JSON.stringify(initialRows) }
  );

  // Create a set of blank rows for paste-ready spreadsheet
  function createBlankRows(count: number): TBRow[] {
    return Array.from({ length: count }, (_, i) => ({
      id: '', accountCode: '', description: '', category: null,
      currentYear: null, priorYear: null, fsNoteLevel: null,
      fsLevel: null, fsStatement: null, groupName: null,
      sortOrder: i,
    }));
  }

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/trial-balance`);
      if (res.ok) {
        const json = await res.json();
        const loaded = json.rows || [];
        if (loaded.length === 0) {
          // Start with a blank grid ready for paste
          const blank = createBlankRows(30);
          setRows(blank);
          setInitialRows([]);
        } else {
          setRows(loaded);
          setInitialRows(loaded);
        }
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load FS hierarchy for dropdowns
  useEffect(() => {
    async function loadFsHierarchy() {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/fs-hierarchy`);
        if (res.ok) {
          const data = await res.json();
          setFsStatements(data.statements || []);
          setFsLevels(data.levels || []);
          setFsNotes((data.allItems || []).filter((i: FsItem) => i.lineType === 'note_item'));
          setFsAllItems(data.allItems || []);
        }
      } catch (err) {
        console.error('Failed to load FS hierarchy:', err);
      }
    }
    loadFsHierarchy();
  }, [engagementId]);

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

  // When FS Note is selected, auto-populate FS Level and FS Statement
  function handleFsNoteChange(index: number, noteName: string) {
    const noteItem = fsAllItems.find(i => i.name === noteName && i.lineType === 'note_item');
    const statement = noteItem?.statement || null;
    // Find a matching FS Level in the same statement
    const matchingLevel = fsLevels.find(l => l.statement === statement);
    setRows(prev => prev.map((r, i) => i === index ? {
      ...r,
      fsNoteLevel: noteName || null,
      fsStatement: statement,
      // Keep existing fsLevel if it's in the same statement, otherwise suggest first match
      fsLevel: (r.fsLevel && fsLevels.find(l => l.name === r.fsLevel && l.statement === statement))
        ? r.fsLevel
        : (matchingLevel?.name || r.fsLevel),
    } : r));
  }

  // When FS Level is selected, auto-populate FS Statement
  function handleFsLevelChange(index: number, levelName: string) {
    const levelItem = fsLevels.find(l => l.name === levelName);
    setRows(prev => prev.map((r, i) => i === index ? {
      ...r,
      fsLevel: levelName || null,
      fsStatement: levelItem?.statement || r.fsStatement,
    } : r));
  }

  // Handle multi-cell paste from Excel/Sheets
  function handlePaste(e: React.ClipboardEvent, startRow: number, startCol: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!text || !text.includes('\t')) return; // Only intercept multi-cell paste
    e.preventDefault();

    const colFields: (keyof TBRow)[] = ['accountCode', 'description', 'currentYear', 'priorYear'];
    if (showCategory) colFields.splice(2, 0, 'category' as keyof TBRow);
    if (isGroupAudit) colFields.push('groupName' as keyof TBRow);

    const pastedRows = text.split('\n').filter(line => line.trim());
    setRows(prev => {
      const updated = [...prev];
      // Ensure enough rows
      while (updated.length < startRow + pastedRows.length) {
        updated.push({
          id: '', accountCode: '', description: '', category: null,
          currentYear: null, priorYear: null, fsNoteLevel: null,
          fsLevel: null, fsStatement: null, groupName: null,
          sortOrder: updated.length,
        });
      }
      pastedRows.forEach((line, ri) => {
        const cells = line.split('\t');
        cells.forEach((cell, ci) => {
          const fieldIdx = startCol + ci;
          if (fieldIdx < colFields.length) {
            const field = colFields[fieldIdx];
            const val = cell.trim();
            if (field === 'currentYear' || field === 'priorYear') {
              (updated[startRow + ri] as any)[field] = val ? parseFloat(val.replace(/[,£$€]/g, '')) || null : null;
            } else {
              (updated[startRow + ri] as any)[field] = val || null;
            }
          }
        });
      });
      return updated;
    });
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
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-28">{formatDateDDMMYYYY(periodEndDate) || 'Period End'}</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-28">{dayBefore(periodStartDate) || 'Period Start - 1'}</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-20">FS Note</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-20">FS Level</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-28">FS Statement</th>
              {isGroupAudit && <th className="text-left px-2 py-2 text-slate-500 font-medium w-28">Group Name</th>}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id || `new-${i}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-2 py-0.5">
                  <input type="text" value={row.accountCode} onChange={e => updateRow(i, 'accountCode', e.target.value)} onPaste={e => handlePaste(e, i, 0)} className={txtCls} placeholder="Code" />
                </td>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.description} onChange={e => updateRow(i, 'description', e.target.value)} onPaste={e => handlePaste(e, i, 1)} className={txtCls} placeholder="Description" />
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
                {/* FS Note — dropdown of note_items, auto-populates Level + Statement */}
                <td className="px-2 py-0.5">
                  <select
                    value={row.fsNoteLevel || ''}
                    onChange={e => handleFsNoteChange(i, e.target.value)}
                    className={`${txtCls} appearance-none`}
                  >
                    <option value=""></option>
                    {(row.fsStatement
                      ? fsNotes.filter(n => n.statement === row.fsStatement)
                      : fsNotes
                    ).map(n => (
                      <option key={n.id} value={n.name}>{n.name}</option>
                    ))}
                    {/* Allow current value even if not in list */}
                    {row.fsNoteLevel && !fsNotes.find(n => n.name === row.fsNoteLevel) && (
                      <option value={row.fsNoteLevel}>{row.fsNoteLevel}</option>
                    )}
                  </select>
                </td>
                {/* FS Level — dropdown of fs_line_items filtered by Statement */}
                <td className="px-2 py-0.5">
                  <select
                    value={row.fsLevel || ''}
                    onChange={e => handleFsLevelChange(i, e.target.value)}
                    className={`${txtCls} appearance-none`}
                  >
                    <option value=""></option>
                    {(row.fsStatement
                      ? fsLevels.filter(l => l.statement === row.fsStatement)
                      : fsLevels
                    ).map(l => (
                      <option key={l.name} value={l.name}>{l.name}</option>
                    ))}
                    {row.fsLevel && !fsLevels.find(l => l.name === row.fsLevel) && (
                      <option value={row.fsLevel}>{row.fsLevel}</option>
                    )}
                  </select>
                </td>
                {/* FS Statement — dropdown of statements */}
                <td className="px-2 py-0.5">
                  <select
                    value={row.fsStatement || ''}
                    onChange={e => updateRow(i, 'fsStatement', e.target.value || null)}
                    className={`${txtCls} appearance-none`}
                  >
                    <option value=""></option>
                    {fsStatements.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    {row.fsStatement && !fsStatements.includes(row.fsStatement) && (
                      <option value={row.fsStatement}>{row.fsStatement}</option>
                    )}
                  </select>
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
