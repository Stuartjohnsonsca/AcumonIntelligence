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

  // Sync when parent changes (e.g. Opening tab toggle)
  useEffect(() => {
    setShowCategoryLocal(initialShowCategory);
  }, [initialShowCategory]);

  // FS hierarchy for cascading dropdowns
  const [fsStatements, setFsStatements] = useState<string[]>([]);
  const [fsLevels, setFsLevels] = useState<{ name: string; statement: string }[]>([]);
  const [fsNotes, setFsNotes] = useState<FsItem[]>([]);
  const [fsAllItems, setFsAllItems] = useState<FsItem[]>([]);

  // AI lookup state for FS Note
  const [aiLookupRow, setAiLookupRow] = useState<number | null>(null);
  const [aiLookupResults, setAiLookupResults] = useState<{ name: string; label: string }[]>([]);
  const [aiLookupLoading, setAiLookupLoading] = useState(false);

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
          // Start with a single blank row
          const blank = createBlankRows(1);
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
          setFsNotes(data.notes || []);
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

  // When FS Note is selected, auto-populate FS Level (from parent) and FS Statement
  function handleFsNoteChange(index: number, noteName: string) {
    // 1. Look up from hierarchy API (parentName from FS Lines with parentFsLineId)
    const noteItem = fsNotes.find(n => n.name === noteName);
    let parentName = (noteItem as any)?.parentName || null;
    let statement = (noteItem as any)?.statement || null;

    // 2. Fallback: look up from fsAllItems
    if (!parentName || !statement) {
      const allItem = fsAllItems.find(i => i.name === noteName);
      if (allItem) {
        if (!statement) statement = allItem.statement || null;
        if (!parentName) parentName = (allItem as any).parentName || null;
      }
    }

    // 3. Fallback: look at other TB rows that have the same fsNoteLevel and already have fsLevel/fsStatement set
    if (!parentName || !statement) {
      const matchingRow = rows.find(r => r.fsNoteLevel === noteName && r.fsLevel);
      if (matchingRow) {
        if (!parentName) parentName = matchingRow.fsLevel;
        if (!statement) statement = matchingRow.fsStatement;
      }
    }

    // 4. Fallback: look at FS Levels list — if noteName matches a level name, it IS the level
    if (!parentName) {
      const levelMatch = fsLevels.find(l => l.name === noteName);
      if (levelMatch) {
        parentName = levelMatch.name;
        if (!statement) statement = levelMatch.statement;
      }
    }

    setRows(prev => prev.map((r, i) => i === index ? {
      ...r,
      fsNoteLevel: noteName || null,
      fsLevel: parentName || r.fsLevel,
      fsStatement: statement || r.fsStatement,
    } : r));
  }

  // When FS Level is selected, auto-populate FS Statement
  function handleFsLevelChange(index: number, levelName: string) {
    const levelItem = fsLevels.find(l => l.name === levelName);
    let statement = levelItem?.statement || null;

    // Fallback: look at other TB rows with the same fsLevel
    if (!statement) {
      const matchingRow = rows.find(r => r.fsLevel === levelName && r.fsStatement);
      if (matchingRow) statement = matchingRow.fsStatement;
    }

    setRows(prev => prev.map((r, i) => i === index ? {
      ...r,
      fsLevel: levelName || null,
      fsStatement: statement || r.fsStatement,
    } : r));
  }

  // AI classify: use Claude to intelligently classify a single row
  async function handleAiLookup(index: number) {
    const row = rows[index];
    if (!row.description && !row.accountCode) return;

    setAiLookupRow(index);
    setAiLookupResults([]);
    setAiLookupLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [{ index, accountCode: row.accountCode, description: row.description, currentYear: row.currentYear }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const c = data.classifications?.[0];
        if (c) {
          // Show result for confirmation
          setAiLookupResults([{
            name: `${c.fsNoteLevel} → ${c.fsLevel} → ${c.fsStatement}`,
            label: c.fsNoteLevel,
            fsLevel: c.fsLevel,
            fsStatement: c.fsStatement,
          }]);
        }
      }
    } catch (err) {
      console.error('AI lookup failed:', err);
    } finally {
      setAiLookupLoading(false);
    }
  }

  // AI classify all rows at once
  const [aiAllLoading, setAiAllLoading] = useState(false);
  const [aiAllProgress, setAiAllProgress] = useState('');

  async function handleAiClassifyAll() {
    const rowsToClassify = rows
      .map((r, i) => ({ index: i, accountCode: r.accountCode, description: r.description, currentYear: r.currentYear, hasFs: !!(r.fsNoteLevel || r.fsLevel || r.fsStatement) }))
      .filter(r => (r.description || r.accountCode) && r.description !== '' && !r.hasFs);

    if (rowsToClassify.length === 0) return;

    setAiAllLoading(true);
    setAiAllProgress(`Classifying ${rowsToClassify.length} rows...`);

    try {
      // Process in batches of 30
      for (let i = 0; i < rowsToClassify.length; i += 30) {
        const batch = rowsToClassify.slice(i, i + 30);
        setAiAllProgress(`Classifying rows ${i + 1}–${Math.min(i + 30, rowsToClassify.length)} of ${rowsToClassify.length}...`);

        const res = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.classifications) {
            setRows(prev => {
              const updated = [...prev];
              for (const c of data.classifications) {
                if (c.index >= 0 && c.index < updated.length) {
                  updated[c.index] = {
                    ...updated[c.index],
                    fsNoteLevel: c.fsNoteLevel || updated[c.index].fsNoteLevel,
                    fsLevel: c.fsLevel || updated[c.index].fsLevel,
                    fsStatement: c.fsStatement || updated[c.index].fsStatement,
                  };
                }
              }
              return updated;
            });
          }
        }
      }
      setAiAllProgress('Done!');
      setTimeout(() => setAiAllProgress(''), 2000);
    } catch (err) {
      console.error('AI classify all failed:', err);
      setAiAllProgress('Failed');
    } finally {
      setAiAllLoading(false);
    }
  }

  function selectAiResult(index: number, result: any) {
    setRows(prev => prev.map((r, i) => i === index ? {
      ...r,
      fsNoteLevel: result.label || r.fsNoteLevel,
      fsLevel: result.fsLevel || r.fsLevel,
      fsStatement: result.fsStatement || r.fsStatement,
    } : r));
    setAiLookupRow(null);
    setAiLookupResults([]);
  }

  // Track which number cell is being edited (show raw value while editing)
  const [editingCell, setEditingCell] = useState<string | null>(null);

  // Format number as GBP-style: 1,234.56 / (1,234.56) for negatives
  function formatGBP(val: number | null | undefined | string): string {
    if (val == null || val === '') return '';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '';
    const abs = Math.abs(num);
    const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return num < 0 ? `(${formatted})` : formatted;
  }

  // Parse a number string, treating (1,234.56) as -1234.56
  function parseNumber(val: string): number | null {
    if (!val) return null;
    let s = val.trim();
    // Brackets mean negative: (1,234.56) → -1234.56
    let negative = false;
    if (s.startsWith('(') && s.endsWith(')')) {
      negative = true;
      s = s.slice(1, -1);
    } else if (s.startsWith('-')) {
      negative = true;
      s = s.slice(1);
    }
    // Strip currency symbols and commas
    s = s.replace(/[,£$€\s]/g, '');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return negative ? -n : n;
  }

  // Handle multi-cell paste from Excel/Sheets — all columns supported
  function handlePaste(e: React.ClipboardEvent, startRow: number, startCol: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!text || !text.includes('\t')) return; // Only intercept multi-cell paste
    e.preventDefault();

    // Build column map matching visible table order
    const colFields: (keyof TBRow)[] = ['accountCode', 'description'];
    if (showCategory) colFields.push('category');
    colFields.push('currentYear', 'priorYear', 'fsNoteLevel', 'fsLevel', 'fsStatement');
    if (isGroupAudit) colFields.push('groupName');

    const numericFields = new Set<keyof TBRow>(['currentYear', 'priorYear']);

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
            if (numericFields.has(field)) {
              (updated[startRow + ri] as any)[field] = parseNumber(val);
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
          <button
            onClick={handleAiClassifyAll}
            disabled={aiAllLoading}
            className="text-xs px-3 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 disabled:opacity-50 font-medium"
          >
            {aiAllLoading ? aiAllProgress : '⚡ AI Classify All'}
          </button>
        </div>
      </div>

      {/* Unified table: summary rows + header + data — all share same column widths */}
      <div className="border border-slate-200 rounded-lg overflow-auto flex-1" style={{ minHeight: '300px', maxHeight: 'calc(100vh - 280px)' }}>
        <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '96px' }} />{/* Account Code */}
            <col style={{ width: '192px' }} />{/* Description */}
            {showCategory && <col style={{ width: '96px' }} />}{/* Category */}
            <col style={{ width: '130px' }} />{/* CY */}
            <col style={{ width: '130px' }} />{/* PY */}
            <col style={{ width: '160px' }} />{/* FS Note */}
            <col style={{ width: '100px' }} />{/* FS Level */}
            <col style={{ width: '120px' }} />{/* FS Statement */}
            {isGroupAudit && <col style={{ width: '112px' }} />}{/* Group */}
            <col style={{ width: '32px' }} />{/* Delete */}
          </colgroup>
          {/* Compact summary rows above the column header */}
          {(() => {
            const sum = (filter: (r: TBRow) => boolean, field: 'currentYear' | 'priorYear') =>
              rows.filter(filter).reduce((s, r) => s + (Number(r[field]) || 0), 0);
            const cyRev = sum(r => r.fsLevel === 'Revenue', 'currentYear');
            const pyRev = sum(r => r.fsLevel === 'Revenue', 'priorYear');
            const cyPnL = sum(r => r.fsStatement === 'Profit & Loss', 'currentYear');
            const pyPnL = sum(r => r.fsStatement === 'Profit & Loss', 'priorYear');
            const cyCosts = sum(r => r.fsStatement === 'Profit & Loss' && r.fsLevel !== 'Revenue', 'currentYear');
            const pyCosts = sum(r => r.fsStatement === 'Profit & Loss' && r.fsLevel !== 'Revenue', 'priorYear');
            const cyBS = sum(r => r.fsStatement === 'Balance Sheet', 'currentYear');
            const pyBS = sum(r => r.fsStatement === 'Balance Sheet', 'priorYear');
            // Gross Assets = total of debit-side BS items (positive amounts on BS)
            const cyGross = sum(r => r.fsStatement === 'Balance Sheet' && (r.currentYear || 0) > 0, 'currentYear');
            const pyGross = sum(r => r.fsStatement === 'Balance Sheet' && (r.priorYear || 0) > 0, 'priorYear');
            const cyTotal = rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
            const pyTotal = rows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
            const cyBal = Math.abs(cyTotal) < 0.01;
            const pyBal = Math.abs(pyTotal) < 0.01;
            const f = (v: number) => { const a = Math.abs(v); const s = '£' + a.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
            const ls = showCategory ? 3 : 2;
            const rc = 'text-right px-2 py-px text-[10px]';
            const lc = `text-right pr-2 py-px text-[10px] text-slate-400`;
            return (
              <thead>
                <tr><th colSpan={ls} className={lc}>Revenue</th><th className={`${rc} text-slate-600`}>{f(cyRev)}</th><th className={`${rc} text-slate-600`}>{f(pyRev)}</th><th colSpan={10} /></tr>
                <tr><th colSpan={ls} className={lc}>Costs</th><th className={`${rc} text-slate-600`}>{f(cyCosts)}</th><th className={`${rc} text-slate-600`}>{f(pyCosts)}</th><th colSpan={10} /></tr>
                <tr><th colSpan={ls} className={`${lc} font-semibold text-slate-500`}>Profit</th><th className={`${rc} font-semibold text-slate-700`}>{f(cyPnL)}</th><th className={`${rc} font-semibold text-slate-700`}>{f(pyPnL)}</th><th colSpan={10} /></tr>
                <tr><th colSpan={ls} className={lc}>Gross Assets</th><th className={`${rc} text-slate-600`}>{f(cyGross)}</th><th className={`${rc} text-slate-600`}>{f(pyGross)}</th><th colSpan={10} /></tr>
                <tr><th colSpan={ls} className={`${lc} font-semibold text-slate-500`}>Net Assets</th><th className={`${rc} font-semibold text-slate-700`}>{f(cyBS)}</th><th className={`${rc} font-semibold text-slate-700`}>{f(pyBS)}</th><th colSpan={10} /></tr>
                <tr className="border-b border-slate-200">
                  <th colSpan={ls} className="text-right pr-2 py-px text-[10px] font-bold text-slate-500">Total</th>
                  <th className="text-right px-2 py-px text-[10px] font-bold text-slate-800"><span className="inline-flex items-center gap-1 justify-end">{f(cyTotal)}<span className={`inline-block w-2 h-2 rounded-full ${cyBal ? 'bg-green-500' : 'bg-red-500'}`} /></span></th>
                  <th className="text-right px-2 py-px text-[10px] font-bold text-slate-800"><span className="inline-flex items-center gap-1 justify-end">{f(pyTotal)}<span className={`inline-block w-2 h-2 rounded-full ${pyBal ? 'bg-green-500' : 'bg-red-500'}`} /></span></th>
                  <th colSpan={10} />
                </tr>
              </thead>
            );
          })()}
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-2 py-2 text-slate-500 font-medium">Account Code</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium">Description</th>
              {showCategory && <th className="text-left px-2 py-2 text-slate-500 font-medium">Category</th>}
              <th className="text-right px-2 py-2 text-slate-500 font-medium">{formatDateDDMMYYYY(periodEndDate) || 'Period End'}</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium">{dayBefore(periodStartDate) || 'Period Start - 1'}</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium">FS Note</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium">FS Level</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium">FS Statement</th>
              {isGroupAudit && <th className="text-left px-2 py-2 text-slate-500 font-medium">Group Name</th>}
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
                  <input
                    type="text" inputMode="decimal"
                    value={editingCell === `cy-${i}` ? (row.currentYear ?? '') : formatGBP(row.currentYear)}
                    onChange={e => updateRow(i, 'currentYear', parseNumber(e.target.value))}
                    onFocus={() => setEditingCell(`cy-${i}`)}
                    onBlur={() => setEditingCell(null)}
                    onPaste={e => handlePaste(e, i, showCategory ? 3 : 2)}
                    className={numCls}
                  />
                </td>
                <td className="px-2 py-0.5">
                  <input
                    type="text" inputMode="decimal"
                    value={editingCell === `py-${i}` ? (row.priorYear ?? '') : formatGBP(row.priorYear)}
                    onChange={e => updateRow(i, 'priorYear', parseNumber(e.target.value))}
                    onFocus={() => setEditingCell(`py-${i}`)}
                    onBlur={() => setEditingCell(null)}
                    onPaste={e => handlePaste(e, i, showCategory ? 4 : 3)}
                    className={numCls}
                  />
                </td>
                {/* FS Note — text input (pastable) + AI lookup button */}
                <td className="px-2 py-0.5 relative">
                  <div className="flex items-center gap-0.5">
                    <input
                      type="text"
                      value={row.fsNoteLevel || ''}
                      onChange={e => handleFsNoteChange(i, e.target.value)}
                      onPaste={e => handlePaste(e, i, showCategory ? 5 : 4)}
                      className={`${txtCls} flex-1`}
                      list={`fs-notes-${i}`}
                    />
                    <button
                      type="button"
                      onClick={() => aiLookupRow === i ? setAiLookupRow(null) : handleAiLookup(i)}
                      title="AI lookup from XBRL taxonomy"
                      className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-[9px] font-bold transition-colors ${
                        aiLookupRow === i ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-blue-600'
                      }`}
                    >
                      {aiLookupLoading && aiLookupRow === i ? '…' : '⚡'}
                    </button>
                  </div>
                  {/* Datalist for paste/type suggestions from FS Lines */}
                  <datalist id={`fs-notes-${i}`}>
                    {fsNotes.map((n, ni) => <option key={n.id || `note-${ni}`} value={n.name} />)}
                  </datalist>
                  {/* AI lookup results dropdown */}
                  {aiLookupRow === i && aiLookupResults.length > 0 && (
                    <div className="absolute left-0 top-full z-20 w-64 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto mt-0.5">
                      <div className="px-2 py-1 text-[9px] font-semibold text-slate-400 border-b bg-slate-50">XBRL Taxonomy Matches</div>
                      {aiLookupResults.map((r, ri) => (
                        <button
                          key={ri}
                          onClick={() => selectAiResult(i, r)}
                          className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-blue-50 border-b border-slate-50 last:border-0"
                        >
                          <span className="font-medium text-slate-800">{r.label}</span>
                          <span className="block text-[8px] text-slate-400 truncate">{r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {aiLookupRow === i && !aiLookupLoading && aiLookupResults.length === 0 && (
                    <div className="absolute left-0 top-full z-20 w-48 bg-white border border-slate-200 rounded-md shadow-lg mt-0.5 px-3 py-2 text-[10px] text-slate-400">
                      No taxonomy matches found
                    </div>
                  )}
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
