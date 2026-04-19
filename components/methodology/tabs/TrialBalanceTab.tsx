'use client';

import { useState, useEffect, useCallback, useMemo, Fragment, lazy, Suspense } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useScrollToAnchor } from '@/lib/hooks/useScrollToAnchor';

const FixedAssetRegisterPopup = lazy(() => import('../FixedAssetRegisterPopup').then(m => ({ default: m.FixedAssetRegisterPopup })));

interface Props {
  engagementId: string;
  isGroupAudit?: boolean;
  showCategory?: boolean;
  onShowCategoryChange?: (show: boolean) => void;
  periodEndDate?: string | null;
  periodStartDate?: string | null;
  userRole?: string;
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
  aiConfidence: number | null;
  sortOrder: number;
}

interface FsItem {
  id: string;
  name: string;
  lineType: string;
  statement: string;
}

export function TrialBalanceTab({ engagementId, isGroupAudit = false, showCategory: initialShowCategory = true, onShowCategoryChange, periodEndDate, periodStartDate, userRole }: Props) {
  const [rows, setRows] = useState<TBRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Scroll to tbcyvpy-<accountCode> when arriving from the Completion
  // panel's AI Populate reference chips.
  useScrollToAnchor([loading, rows.length], { enabled: !loading });
  const [initialRows, setInitialRows] = useState<TBRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [showCategory, setShowCategoryLocal] = useState(initialShowCategory);
  const [farOpen, setFarOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showDifferences, setShowDifferences] = useState(false);
  // ── Bulk-select state ─────────────────────────────────────────────
  // Rows are keyed by the same identity we already use as the render
  // key (row.id OR `new-${index}` for unsaved rows). That keeps the
  // selection stable across re-renders as long as the admin isn't
  // also reordering rows.
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  function rowKey(r: TBRow, idx: number): string { return r.id || `new-${idx}`; }
  function toggleRowSelection(key: string) {
    setSelectedRowKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleColumnSelection(field: string) {
    setSelectedColumns(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  }

  // Compute unique values per column for filter dropdowns
  const columnValues = useMemo(() => {
    const cols: Record<string, Set<string>> = {};
    const fields = ['accountCode', 'description', 'category', 'currentYear', 'priorYear', 'fsNoteLevel', 'fsLevel', 'fsStatement', 'groupName'];
    for (const f of fields) cols[f] = new Set<string>();
    for (const row of rows) {
      for (const f of fields) {
        const v = String((row as any)[f] ?? '').trim();
        if (v) cols[f].add(v);
      }
    }
    return cols;
  }, [rows]);

  // Compute filtered and sorted rows
  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, vals]) => vals.size > 0);
    let result = activeFilters.length === 0 ? [...rows] : rows.filter(row => {
      for (const [field, allowed] of activeFilters) {
        const cellVal = String((row as any)[field] ?? '').trim();
        if (!allowed.has(cellVal)) return false;
      }
      return true;
    });
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const av = (a as any)[sortCol] ?? '';
        const bv = (b as any)[sortCol] ?? '';
        const numA = typeof av === 'number' ? av : parseFloat(av);
        const numB = typeof bv === 'number' ? bv : parseFloat(bv);
        if (!isNaN(numA) && !isNaN(numB)) return sortDir === 'asc' ? numA - numB : numB - numA;
        return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return result;
  }, [rows, filters, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortCol(col); setSortDir('asc'); }
  }

  const hasActiveFilters = Object.values(filters).some(v => v.size > 0);

  function toggleFilterValue(field: string, value: string) {
    setFilters(prev => {
      const current = new Set(prev[field] || []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [field]: current };
    });
  }

  function clearColumnFilter(field: string) {
    setFilters(prev => ({ ...prev, [field]: new Set<string>() }));
  }

  // Close filter dropdown when clicking outside
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.filter-dropdown') && !target.closest('button')) setOpenFilter(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFilter]);

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
  const [aiLookupResults, setAiLookupResults] = useState<{ name: string; label: string; fsLevel?: string; fsStatement?: string }[]>([]);
  const [aiLookupLoading, setAiLookupLoading] = useState(false);

  function setShowCategory(show: boolean) {
    setShowCategoryLocal(show);
    onShowCategoryChange?.(show);
  }

  const { saving, lastSaved, error, triggerSave } = useAutoSave(
    `/api/engagements/${engagementId}/trial-balance`,
    { rows },
    { enabled: !importing && JSON.stringify(rows) !== JSON.stringify(initialRows) }
  );

  // Create a set of blank rows for paste-ready spreadsheet
  const [xeroSummary, setXeroSummary] = useState<{ cyTotal: number; pyTotal: number; source: string; cyDate: string; pyDate: string } | null>(null);

  function createBlankRows(count: number): TBRow[] {
    return Array.from({ length: count }, (_, i) => ({
      id: '', accountCode: '', description: '', category: null,
      currentYear: null, priorYear: null, fsNoteLevel: null,
      fsLevel: null, fsStatement: null, groupName: null, aiConfidence: null,
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
      // Load Xero summary for verification
      const engRes = await fetch(`/api/engagements/${engagementId}`);
      if (engRes.ok) {
        const engData = await engRes.json();
        if (engData.tbXeroSummary) setXeroSummary(engData.tbXeroSummary);
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
      fsLevel: null, fsStatement: null, groupName: null, aiConfidence: null,
      sortOrder: prev.length,
    }]);
  }

  function updateRow(index: number, field: keyof TBRow, value: string | number | null) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  const canDeleteRows = userRole === 'RI' || userRole === 'Manager';

  async function removeRow(index: number) {
    const row = rows[index];
    setRows(prev => prev.filter((_, i) => i !== index));
    if (row?.id) {
      try {
        await fetch(`/api/engagements/${engagementId}/trial-balance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', rowId: row.id }),
        });
      } catch (err) {
        console.error('Failed to delete TB row:', err);
      }
    }
  }

  // ── Bulk-select helpers ──────────────────────────────────────────
  /** Select every visible row (filtered + sorted view). Useful when
   *  the admin wants to bulk-delete all rows matching a filter. */
  function selectAllVisibleRows() {
    const keys = new Set<string>();
    filteredRows.forEach((r) => {
      const originalIdx = rows.indexOf(r);
      keys.add(rowKey(r, originalIdx));
    });
    setSelectedRowKeys(keys);
  }
  function clearRowSelection() { setSelectedRowKeys(new Set()); }
  function selectAllColumns(fields: string[]) { setSelectedColumns(new Set(fields)); }
  function clearColumnSelection() { setSelectedColumns(new Set()); }

  /** Delete every selected row. Fires a single bulk DELETE for saved
   *  rows, filters out unsaved ones from local state. Server request
   *  is fire-and-forget; local state wins immediately. */
  async function deleteSelectedRows() {
    if (selectedRowKeys.size === 0) return;
    if (!confirm(`Delete ${selectedRowKeys.size} selected row${selectedRowKeys.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const toDeleteSavedIds: string[] = [];
    setRows(prev => prev.filter((r, i) => {
      const k = rowKey(r, i);
      if (!selectedRowKeys.has(k)) return true;
      if (r.id) toDeleteSavedIds.push(r.id);
      return false;
    }));
    setSelectedRowKeys(new Set());
    for (const rowId of toDeleteSavedIds) {
      fetch(`/api/engagements/${engagementId}/trial-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', rowId }),
      }).catch((err) => console.error('Failed to delete TB row', rowId, err));
    }
  }

  /** Clear the values at the intersection of selected rows × selected
   *  columns. Non-destructive at the row level — only empties cells.
   *  Saved rows will be re-saved via the existing autosave loop
   *  since the `rows` state changes. */
  function clearSelectedCells() {
    if (selectedRowKeys.size === 0 || selectedColumns.size === 0) return;
    const cellCount = selectedRowKeys.size * selectedColumns.size;
    if (!confirm(`Clear ${cellCount} cell${cellCount === 1 ? '' : 's'} (${selectedRowKeys.size} row${selectedRowKeys.size === 1 ? '' : 's'} × ${selectedColumns.size} column${selectedColumns.size === 1 ? '' : 's'})?`)) return;
    setRows(prev => prev.map((r, i) => {
      const k = rowKey(r, i);
      if (!selectedRowKeys.has(k)) return r;
      const patch: Partial<TBRow> = {};
      for (const field of selectedColumns) {
        // Numeric columns clear to null; string columns clear to '' or null.
        if (field === 'currentYear' || field === 'priorYear' || field === 'aiConfidence') {
          (patch as any)[field] = null;
        } else if (field === 'accountCode' || field === 'description') {
          (patch as any)[field] = '';
        } else {
          (patch as any)[field] = null;
        }
      }
      return { ...r, ...patch } as TBRow;
    }));
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
          setAiLookupResults([{
            name: `${c.fsNoteLevel} → ${c.fsLevel} → ${c.fsStatement}`,
            label: c.fsNoteLevel,
            fsLevel: c.fsLevel,
            fsStatement: c.fsStatement,
          }]);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error('AI lookup failed:', res.status, errData);
        setAiLookupResults([{ name: `❌ ${errData.error || `Error ${res.status}`}`, label: `Error: ${errData.error || res.status}`, fsLevel: '', fsStatement: '' }]);
      }
    } catch (err) {
      console.error('AI lookup failed:', err);
      setAiLookupResults([{ name: '❌ AI service unavailable', label: 'Error: service unavailable', fsLevel: '', fsStatement: '' }]);
    } finally {
      setAiLookupLoading(false);
    }
  }

  // AI classify all rows at once
  const [aiAllLoading, setAiAllLoading] = useState(false);
  const [aiAllProgress, setAiAllProgress] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  async function handleBackfillFsLineIds() {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backfill_fs_line_ids' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tb = data.tbRows || {};
      const te = data.testExecutions || {};
      const tc = data.testConclusions || {};
      setBackfillResult(
        `Backfilled ${tb.backfilled || 0} TB row${tb.backfilled === 1 ? '' : 's'}` +
        (tb.skipped ? ` (${tb.skipped} could not be resolved)` : '') +
        `, ${te.backfilled || 0} test execution${te.backfilled === 1 ? '' : 's'}, ${tc.backfilled || 0} test conclusion${tc.backfilled === 1 ? '' : 's'}.` +
        ` Rows with existing values were not touched.`
      );
      // Refresh TB rows
      await loadData();
    } catch (err: any) {
      setBackfillResult(`Backfill failed: ${err.message}`);
    } finally {
      setBackfilling(false);
    }
  }
  const [importResult, setImportResult] = useState<string | null>(null);

  async function handleAiClassifyAll() {
    setBackfillResult(null);
    const rowsToClassify = rows
      .map((r, i) => ({ index: i, accountCode: r.accountCode, description: r.description, currentYear: r.currentYear, category: r.category, sourceMetadata: (r as any).sourceMetadata, hasAllFs: !!(r.fsNoteLevel && r.fsLevel && r.fsStatement) }))
      .filter(r => (r.description || r.accountCode) && r.description !== '' && !r.hasAllFs);

    console.log('[AI Classify All] rows in state:', rows.length, 'rows to classify:', rowsToClassify.length);

    if (rowsToClassify.length === 0) {
      setBackfillResult(
        `Nothing to classify. All ${rows.length} row${rows.length === 1 ? '' : 's'} already have FS Note, FS Level, and FS Statement populated. ` +
        `To re-classify a row, clear at least one of those three cells first. ` +
        `If you need to populate the canonical FS Line IDs for existing rows, use the "Backfill FS Line IDs" button.`
      );
      return;
    }

    setAiAllLoading(true);
    setAiAllProgress(`Starting classification of ${rowsToClassify.length} rows...`);

    try {
      // Start background task on server
      const res = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsToClassify }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setBackfillResult(`AI Classify failed: ${errData.error || `HTTP ${res.status}`}`);
        setAiAllProgress('');
        setAiAllLoading(false);
        return;
      }
      const { taskId } = await res.json();

      // Poll for completion — server does the work even if we navigate away
      const poll = async () => {
        try {
          const pollRes = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'poll', taskId }),
          });
          if (!pollRes.ok) return;
          const data = await pollRes.json();

          if (data.status === 'running') {
            const p = data.progress || {};
            setAiAllProgress(`Classifying ${p.batch || '...'} (${p.classified || 0}/${p.total || '?'})...`);
            setTimeout(poll, 2000);
          } else if (data.status === 'completed') {
            const r = data.result || {};
            // Reload TB data from DB to get the server-saved classifications
            await loadData();
            setBackfillResult(
              `AI Classify complete. Classified ${r.classified || 0} of ${r.total || 0} row${r.total === 1 ? '' : 's'}.` +
              (r.backfilled ? ` Also backfilled ${r.backfilled} canonical FS Line ID${r.backfilled === 1 ? '' : 's'}.` : '')
            );
            setAiAllProgress('');
            setAiAllLoading(false);
          } else {
            setBackfillResult(`AI Classify failed: ${data.error || 'Unknown error'}`);
            setAiAllProgress('');
            setAiAllLoading(false);
          }
        } catch {
          setTimeout(poll, 3000); // Retry on network error
        }
      };
      setTimeout(poll, 2000);
    } catch (err: any) {
      console.error('AI classify all failed:', err);
      setBackfillResult(`AI Classify failed: ${err?.message || 'Unknown error'}`);
      setAiAllProgress('');
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
    return num < 0 ? `(${formatted}) Cr` : `${formatted} Dr`;
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
          fsLevel: null, fsStatement: null, groupName: null, aiConfidence: null,
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

  function exportCSV() {
    const headers = ['Account Code', 'Description', 'Category', formatDateDDMMYYYY(periodEndDate) || 'Current Year', dayBefore(periodStartDate) || 'Prior Year', 'FS Note', 'FS Level', 'FS Statement'];
    if (isGroupAudit) headers.push('Group Name');
    const csvRows = [headers.join(',')];
    for (const row of rows) {
      const vals = [
        `"${(row.accountCode || '').replace(/"/g, '""')}"`,
        `"${(row.description || '').replace(/"/g, '""')}"`,
        `"${(row.category || '').replace(/"/g, '""')}"`,
        row.currentYear ?? '',
        row.priorYear ?? '',
        `"${(row.fsNoteLevel || '').replace(/"/g, '""')}"`,
        `"${(row.fsLevel || '').replace(/"/g, '""')}"`,
        `"${(row.fsStatement || '').replace(/"/g, '""')}"`,
      ];
      if (isGroupAudit) vals.push(`"${(row.groupName || '').replace(/"/g, '""')}"`);
      csvRows.push(vals.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial-balance-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
          {/* Bulk-action buttons — only surface when something's selected.
              Two independent modes:
                • Rows selected → Delete N rows
                • Rows + columns selected → Clear the intersecting cells
             */}
          {selectedRowKeys.size > 0 && (
            <>
              <span className="text-[10px] text-slate-500">
                {selectedRowKeys.size} row{selectedRowKeys.size === 1 ? '' : 's'}
                {selectedColumns.size > 0 && <> · {selectedColumns.size} col{selectedColumns.size === 1 ? '' : 's'}</>}
              </span>
              {selectedColumns.size > 0 && (
                <button onClick={clearSelectedCells}
                  className="text-xs px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 font-medium">
                  Clear {selectedRowKeys.size * selectedColumns.size} cells
                </button>
              )}
              <button onClick={deleteSelectedRows}
                className="text-xs px-3 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 font-medium">
                Delete rows
              </button>
              <button onClick={() => { clearRowSelection(); clearColumnSelection(); }}
                className="text-[10px] text-slate-400 hover:text-slate-700">Clear selection</button>
            </>
          )}
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
          <button onClick={() => setFarOpen(true)} className="text-xs px-3 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 font-medium">📋 Add FAR</button>
          <button
            onClick={async () => {
              setImporting(true);
              setImportResult('Starting import...');
              try {
                const res = await fetch(`/api/engagements/${engagementId}/trial-balance/import-accounting`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (!res.ok) { setImportResult(`Import failed: ${data.error}`); setImporting(false); return; }
                const { taskId } = data;

                // Poll for completion — server does the work
                const poll = async () => {
                  try {
                    const pollRes = await fetch(`/api/engagements/${engagementId}/trial-balance/import-accounting`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'poll', taskId }),
                    });
                    if (!pollRes.ok) { setTimeout(poll, 3000); return; }
                    const pd = await pollRes.json();
                    if (pd.status === 'running') {
                      setImportResult(pd.progress?.message || 'Importing...');
                      setTimeout(poll, 2000);
                    } else if (pd.status === 'completed') {
                      const r = pd.result || {};
                      setImportResult(`Imported ${r.imported || 0} accounts from ${r.orgName || r.source || 'accounting system'}${r.updated ? `, updated ${r.updated} balances` : ''} [${r.debug || ''}]`);
                      await loadData(); // Reload from DB
                      setImporting(false);
                    } else {
                      setImportResult(`Import failed: ${pd.error || 'Unknown error'}`);
                      setImporting(false);
                    }
                  } catch { setTimeout(poll, 3000); }
                };
                setTimeout(poll, 2000);
              } catch (err: any) {
                setImportResult(`Import failed: ${err.message}`);
                setImporting(false);
              }
            }}
            disabled={importing}
            className="text-xs px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50 font-medium"
          >
            {importing ? '⏳ Importing...' : '📥 Import from Accounting System'}
          </button>
          <button
            onClick={handleAiClassifyAll}
            disabled={aiAllLoading}
            className="text-xs px-3 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 disabled:opacity-50 font-medium"
          >
            {aiAllLoading ? aiAllProgress : '⚡ AI Classify All'}
          </button>
          <button
            onClick={handleBackfillFsLineIds}
            disabled={backfilling}
            className="text-xs px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50 font-medium"
            title="Resolve missing FS Line IDs for rows that already have a classification. Only fills blanks — never overwrites existing values."
          >
            {backfilling ? '⏳ Backfilling...' : '🔗 Backfill FS Line IDs'}
          </button>
          <button
            onClick={exportCSV}
            className="text-xs px-3 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 font-medium"
          >
            📤 Export CSV
          </button>
          <button
            onClick={() => setShowDifferences(!showDifferences)}
            className={`text-xs px-3 py-1 rounded font-medium ${showDifferences ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'}`}
          >
            {showDifferences ? '✕ Close Differences' : '⚠ Differences'}
          </button>
        </div>
      </div>

      {backfillResult && (
        <div className={`text-xs px-3 py-2 rounded-lg flex items-start justify-between gap-2 ${backfillResult.toLowerCase().includes('failed') ? 'bg-red-50 text-red-700' : backfillResult.toLowerCase().includes('nothing to classify') ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-700'}`}>
          <span className="flex-1">{backfillResult}</span>
          <button onClick={() => setBackfillResult(null)} className="text-current opacity-60 hover:opacity-100 flex-shrink-0">✕</button>
        </div>
      )}

      {importResult && (
        <div className={`text-xs px-3 py-2 rounded-lg ${importResult.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {importResult}
          <button onClick={() => setImportResult(null)} className="ml-2 text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* Differences panel */}
      {showDifferences && (() => {
        const xPnlCats = new Set(['Revenue', 'Cost of Sales', 'Expenses', 'Administrative Expenses', 'Other Income', 'Depreciation']);
        const xRevCats = new Set(['Revenue', 'Other Income']);

        // Find rows where Xero P&L/BS classification disagrees with FS Statement
        const isXeroPnl = (r: TBRow) => xPnlCats.has(r.category || '');
        const isFsPnl = (r: TBRow) => r.fsStatement === 'Profit & Loss';
        const diffRows = rows.filter(r => {
          if (!r.category || !r.fsStatement) return false;
          return isXeroPnl(r) !== isFsPnl(r);
        });

        // Group by Xero category
        const byXeroCat: Record<string, TBRow[]> = {};
        for (const r of diffRows) {
          const cat = r.category || 'Uncategorised';
          if (!byXeroCat[cat]) byXeroCat[cat] = [];
          byXeroCat[cat].push(r);
        }

        const f = (v: number) => { const a = Math.abs(v); const s = '£' + a.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };

        return (
          <div className="border border-red-200 rounded-lg mb-2 bg-red-50/30 p-3">
            <h4 className="text-xs font-semibold text-red-700 mb-2">Classification Differences — {diffRows.length} row{diffRows.length !== 1 ? 's' : ''} where {xeroSummary?.source || 'Xero'} and FS disagree</h4>
            {diffRows.length === 0 ? (
              <p className="text-xs text-green-600">No differences — all rows agree between {xeroSummary?.source || 'Xero'} and FS classification.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-red-200">
                    <th className="text-left px-2 py-1 text-red-600 font-medium">Account Code</th>
                    <th className="text-left px-2 py-1 text-red-600 font-medium">Description</th>
                    <th className="text-left px-2 py-1 text-purple-600 font-medium">{xeroSummary?.source || 'Xero'} Category</th>
                    <th className="text-right px-2 py-1 text-purple-600 font-medium">{xeroSummary?.source || 'Xero'} Amt</th>
                    <th className="text-left px-2 py-1 text-blue-600 font-medium">FS Level</th>
                    <th className="text-left px-2 py-1 text-blue-600 font-medium">FS Statement</th>
                    <th className="text-right px-2 py-1 text-blue-600 font-medium">FS Amt</th>
                    <th className="text-right px-2 py-1 text-red-600 font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byXeroCat).map(([cat, catRows]) => (
                    <Fragment key={cat}>
                      <tr className="bg-purple-50/50">
                        <td colSpan={3} className="px-2 py-1 text-[10px] font-semibold text-purple-700">{cat}</td>
                        <td className="text-right px-2 py-1 text-[10px] font-semibold text-purple-700">{f(catRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0))}</td>
                        <td colSpan={2}></td>
                        <td className="text-right px-2 py-1 text-[10px] font-semibold text-blue-700">{f(catRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0))}</td>
                        <td></td>
                      </tr>
                      {catRows.map(r => {
                        const cyAmt = Number(r.currentYear) || 0;
                        // The "difference" is the amount — it's in one group but not the other
                        return (
                          <tr key={r.id || r.accountCode} className="border-b border-red-100 hover:bg-red-50/50">
                            <td className="px-2 py-0.5 font-mono text-slate-600">{r.accountCode}</td>
                            <td className="px-2 py-0.5 text-slate-700">{r.description}</td>
                            <td className="px-2 py-0.5 text-purple-600">{r.category}</td>
                            <td className="text-right px-2 py-0.5 text-purple-700">{f(cyAmt)}</td>
                            <td className="px-2 py-0.5 text-blue-600">{r.fsLevel || '—'}</td>
                            <td className="px-2 py-0.5 text-blue-600">{r.fsStatement || '—'}</td>
                            <td className="text-right px-2 py-0.5 text-blue-700">{f(cyAmt)}</td>
                            <td className="text-right px-2 py-0.5 font-semibold text-red-600">{f(cyAmt)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* Summary comparison table */}
      {(() => {
        const sum = (filter: (r: TBRow) => boolean, field: 'currentYear' | 'priorYear') =>
          rows.filter(filter).reduce((s, r) => s + (Number(r[field]) || 0), 0);

        // Xero categorisation (from imported category field)
        const xPnlCats = new Set(['Revenue', 'Cost of Sales', 'Expenses', 'Administrative Expenses', 'Other Income', 'Depreciation']);
        const xRevCats = new Set(['Revenue', 'Other Income']);
        const xCyRev = sum(r => xRevCats.has(r.category || ''), 'currentYear');
        const xPyRev = sum(r => xRevCats.has(r.category || ''), 'priorYear');
        const xCyCosts = sum(r => xPnlCats.has(r.category || '') && !xRevCats.has(r.category || ''), 'currentYear');
        const xPyCosts = sum(r => xPnlCats.has(r.category || '') && !xRevCats.has(r.category || ''), 'priorYear');
        const xCyPnL = sum(r => xPnlCats.has(r.category || ''), 'currentYear');
        const xPyPnL = sum(r => xPnlCats.has(r.category || ''), 'priorYear');
        const xCyGross = sum(r => !xPnlCats.has(r.category || '') && (r.currentYear || 0) > 0, 'currentYear');
        const xPyGross = sum(r => !xPnlCats.has(r.category || '') && (r.priorYear || 0) > 0, 'priorYear');
        const xCyBS = sum(r => !xPnlCats.has(r.category || ''), 'currentYear');
        const xPyBS = sum(r => !xPnlCats.has(r.category || ''), 'priorYear');

        // FS Classification (from AI / taxonomy)
        const fCyRev = sum(r => r.fsLevel === 'Revenue', 'currentYear');
        const fPyRev = sum(r => r.fsLevel === 'Revenue', 'priorYear');
        const fCyCosts = sum(r => r.fsStatement === 'Profit & Loss' && r.fsLevel !== 'Revenue', 'currentYear');
        const fPyCosts = sum(r => r.fsStatement === 'Profit & Loss' && r.fsLevel !== 'Revenue', 'priorYear');
        const fCyPnL = sum(r => r.fsStatement === 'Profit & Loss', 'currentYear');
        const fPyPnL = sum(r => r.fsStatement === 'Profit & Loss', 'priorYear');
        const fCyGross = sum(r => r.fsStatement === 'Balance Sheet' && (r.currentYear || 0) > 0, 'currentYear');
        const fPyGross = sum(r => r.fsStatement === 'Balance Sheet' && (r.priorYear || 0) > 0, 'priorYear');
        const fCyBS = sum(r => r.fsStatement === 'Balance Sheet', 'currentYear');
        const fPyBS = sum(r => r.fsStatement === 'Balance Sheet', 'priorYear');

        const cyTotal = rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
        const pyTotal = rows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
        const cyBal = Math.abs(cyTotal) < 0.01;
        const pyBal = Math.abs(pyTotal) < 0.01;
        const f = (v: number) => { const a = Math.abs(v); const s = '£' + a.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
        const xc = 'text-right px-2 py-px text-[10px] text-purple-600';
        const fc = 'text-right px-2 py-px text-[10px] text-blue-600';
        const lc = 'text-right pr-2 py-px text-[10px] text-slate-400';
        const src = xeroSummary?.source || 'Xero';
        const cyDateLabel = formatDateDDMMYYYY(periodEndDate) || 'CY';
        const pyDateLabel = dayBefore(periodStartDate) || 'PY';


        // Build tooltip: totals + only rows that DIFFER between Xero and FS
        function diffDot(
          xVal: number, fVal: number,
          xeroFilter: (r: TBRow) => boolean, fsFilter: (r: TBRow) => boolean,
          field: 'currentYear' | 'priorYear'
        ) {
          const match = Math.abs(xVal - fVal) < 0.01;
          if (match) return <span className="inline-block w-2 h-2 rounded-full bg-green-500 ml-1" title={`${src} and FS agree: ${f(xVal)}`} />;
          // Only rows where Xero and FS disagree on classification
          const diffs = rows.filter(r => xeroFilter(r) !== fsFilter(r));
          const lines = [
            `${src} Total: ${f(xVal)}`,
            `FS Total: ${f(fVal)}`,
            `Difference: ${f(xVal - fVal)}`,
            '',
            ...diffs.map(r => {
              const amt = Number(r[field]) || 0;
              const inXero = xeroFilter(r);
              const inFs = fsFilter(r);
              // Show: what Xero says, what FS says, and the amount that moved
              const xAmt = inXero ? f(amt) : '—';
              const fAmt = inFs ? f(amt) : '—';
              return `${r.description} (${r.accountCode}): ${src} ${xAmt} | FS ${fAmt} | Diff ${f(inXero ? amt : -amt)}`;
            }),
          ];
          return <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-1 cursor-help" title={lines.join('\n')} />;
        }

        return (
          <div className="border border-slate-200 rounded-lg mb-2 overflow-hidden">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="w-28"></th>
                  <th colSpan={3} className="text-center px-2 py-1 text-[10px] font-semibold text-slate-600 border-b border-slate-200">{cyDateLabel}</th>
                  <th colSpan={3} className="text-center px-2 py-1 text-[10px] font-semibold text-slate-600 border-b border-slate-200">{pyDateLabel}</th>
                </tr>
                <tr className="border-b border-slate-100">
                  <th></th>
                  <th className="text-right px-2 py-px text-[9px] text-purple-500 font-medium w-24">{src}</th>
                  <th className="text-right px-2 py-px text-[9px] text-blue-500 font-medium w-24">FS</th>
                  <th className="w-4"></th>
                  <th className="text-right px-2 py-px text-[9px] text-purple-500 font-medium w-24">{src}</th>
                  <th className="text-right px-2 py-px text-[9px] text-blue-500 font-medium w-24">FS</th>
                  <th className="w-4"></th>
                </tr>
              </thead>
              {(() => {
                // Filter functions for Xero and FS per summary line
                const xRevF = (r: TBRow) => xRevCats.has(r.category || '');
                const fRevF = (r: TBRow) => r.fsLevel === 'Revenue';
                const xCostF = (r: TBRow) => xPnlCats.has(r.category || '') && !xRevCats.has(r.category || '');
                const fCostF = (r: TBRow) => r.fsStatement === 'Profit & Loss' && r.fsLevel !== 'Revenue';
                const xPnlF = (r: TBRow) => xPnlCats.has(r.category || '');
                const fPnlF = (r: TBRow) => r.fsStatement === 'Profit & Loss';
                const xGrossF = (r: TBRow) => !xPnlCats.has(r.category || '') && (r.currentYear || 0) > 0;
                const fGrossF = (r: TBRow) => r.fsStatement === 'Balance Sheet' && (r.currentYear || 0) > 0;
                const xBsF = (r: TBRow) => !xPnlCats.has(r.category || '');
                const fBsF = (r: TBRow) => r.fsStatement === 'Balance Sheet';
                return (
              <tbody>
                <tr><td className={lc}>Revenue</td><td className={xc}>{f(xCyRev)}</td><td className={fc}>{f(fCyRev)}</td><td className="px-0.5">{diffDot(xCyRev, fCyRev, xRevF, fRevF, 'currentYear')}</td><td className={xc}>{f(xPyRev)}</td><td className={fc}>{f(fPyRev)}</td><td className="px-0.5">{diffDot(xPyRev, fPyRev, xRevF, fRevF, 'priorYear')}</td></tr>
                <tr><td className={lc}>Costs</td><td className={xc}>{f(xCyCosts)}</td><td className={fc}>{f(fCyCosts)}</td><td className="px-0.5">{diffDot(xCyCosts, fCyCosts, xCostF, fCostF, 'currentYear')}</td><td className={xc}>{f(xPyCosts)}</td><td className={fc}>{f(fPyCosts)}</td><td className="px-0.5">{diffDot(xPyCosts, fPyCosts, xCostF, fCostF, 'priorYear')}</td></tr>
                <tr><td className={`${lc} font-semibold text-slate-500`}>Profit</td><td className={`${xc} font-semibold`}>{f(xCyPnL)}</td><td className={`${fc} font-semibold`}>{f(fCyPnL)}</td><td className="px-0.5">{diffDot(xCyPnL, fCyPnL, xPnlF, fPnlF, 'currentYear')}</td><td className={`${xc} font-semibold`}>{f(xPyPnL)}</td><td className={`${fc} font-semibold`}>{f(fPyPnL)}</td><td className="px-0.5">{diffDot(xPyPnL, fPyPnL, xPnlF, fPnlF, 'priorYear')}</td></tr>
                <tr><td className={lc}>Gross Assets</td><td className={xc}>{f(xCyGross)}</td><td className={fc}>{f(fCyGross)}</td><td className="px-0.5">{diffDot(xCyGross, fCyGross, xGrossF, fGrossF, 'currentYear')}</td><td className={xc}>{f(xPyGross)}</td><td className={fc}>{f(fPyGross)}</td><td className="px-0.5">{diffDot(xPyGross, fPyGross, xGrossF, fGrossF, 'priorYear')}</td></tr>
                <tr><td className={`${lc} font-semibold text-slate-500`}>Net Assets</td><td className={`${xc} font-semibold`}>{f(xCyBS)}</td><td className={`${fc} font-semibold`}>{f(fCyBS)}</td><td className="px-0.5">{diffDot(xCyBS, fCyBS, xBsF, fBsF, 'currentYear')}</td><td className={`${xc} font-semibold`}>{f(xPyBS)}</td><td className={`${fc} font-semibold`}>{f(fPyBS)}</td><td className="px-0.5">{diffDot(xPyBS, fPyBS, xBsF, fBsF, 'priorYear')}</td></tr>
                <tr className="border-t border-slate-200">
                  <td className="text-right pr-2 py-px text-[10px] font-bold text-slate-500">Total</td>
                  <td colSpan={3} className="text-right px-2 py-px text-[10px] font-bold text-slate-800"><span className="inline-flex items-center gap-1 justify-end">{f(cyTotal)}<span className={`inline-block w-2 h-2 rounded-full ${cyBal ? 'bg-green-500' : 'bg-red-500'}`} /></span></td>
                  <td colSpan={3} className="text-right px-2 py-px text-[10px] font-bold text-slate-800"><span className="inline-flex items-center gap-1 justify-end">{f(pyTotal)}<span className={`inline-block w-2 h-2 rounded-full ${pyBal ? 'bg-green-500' : 'bg-red-500'}`} /></span></td>
                </tr>
              </tbody>
                );
              })()}
            </table>
          </div>
        );
      })()}

      {/* Main data table */}
      <div className="border border-slate-200 rounded-lg overflow-auto flex-1" style={{ minHeight: '300px', maxHeight: 'calc(100vh - 360px)' }}>
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
            <col style={{ width: '50px' }} />{/* AI Confidence */}
            {isGroupAudit && <col style={{ width: '112px' }} />}{/* Group */}
            <col style={{ width: '32px' }} />{/* Delete */}
          </colgroup>
          {/* Column headers only — summary is now a separate table above */}
          <thead className="sticky top-0 z-10">
            {(() => {
              const columnDefs = [
                { field: 'accountCode', label: 'Account Code', align: 'left' },
                { field: 'description', label: 'Description', align: 'left' },
                ...(showCategory ? [{ field: 'category', label: 'Category', align: 'left' }] : []),
                { field: 'currentYear', label: formatDateDDMMYYYY(periodEndDate) || 'Period End', align: 'right' },
                { field: 'priorYear', label: dayBefore(periodStartDate) || 'Period Start - 1', align: 'right' },
                { field: 'fsNoteLevel', label: 'FS Note', align: 'left' },
                { field: 'fsLevel', label: 'FS Level', align: 'left' },
                { field: 'fsStatement', label: 'FS Statement', align: 'left' },
                { field: 'aiConfidence', label: 'AI %', align: 'center' },
                ...(isGroupAudit ? [{ field: 'groupName', label: 'Group Name', align: 'left' }] : []),
              ];
              const allColumnFields = columnDefs.map(c => c.field);
              const allVisibleRowKeys = filteredRows.map(r => rowKey(r, rows.indexOf(r)));
              const allRowsSelected = allVisibleRowKeys.length > 0 && allVisibleRowKeys.every(k => selectedRowKeys.has(k));
              const allColumnsSelected = allColumnFields.length > 0 && allColumnFields.every(f => selectedColumns.has(f));
              return (
                <>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    {/* Master row-select checkbox in the far-left column */}
                    <th className="w-8 px-1 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={allRowsSelected}
                        onChange={() => allRowsSelected ? clearRowSelection() : selectAllVisibleRows()}
                        title={allRowsSelected ? 'Deselect all visible rows' : 'Select all visible rows'}
                        className="w-3.5 h-3.5 rounded cursor-pointer"
                      />
                    </th>
                    {columnDefs.map(col => (
                      <th key={col.field} className={`text-${col.align} px-2 py-2 text-slate-500 font-medium cursor-pointer hover:text-slate-700 select-none`} onClick={() => toggleSort(col.field)}>
                        {col.label} {sortCol === col.field ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </th>
                    ))}
                    <th className="w-8"></th>
                  </tr>
                  {/* Column-select checkbox row — tick a column to include
                      it in the "Clear selected cells" bulk action. The
                      far-left cell toggles the lot. */}
                  <tr className="bg-slate-50/70 border-b border-slate-200">
                    <th className="w-8 px-1 py-0.5 text-center">
                      <input
                        type="checkbox"
                        checked={allColumnsSelected}
                        onChange={() => allColumnsSelected ? clearColumnSelection() : selectAllColumns(allColumnFields)}
                        title={allColumnsSelected ? 'Deselect all columns' : 'Select all columns'}
                        className="w-3 h-3 rounded cursor-pointer"
                      />
                    </th>
                    {columnDefs.map(col => (
                      <th key={col.field} className="px-2 py-0.5 text-center">
                        <input
                          type="checkbox"
                          checked={selectedColumns.has(col.field)}
                          onChange={() => toggleColumnSelection(col.field)}
                          title={`Select column: ${col.label}`}
                          className="w-3 h-3 rounded cursor-pointer"
                        />
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </>
              );
            })()}
            {/* Filter row — dropdown arrows with checkbox options */}
            <tr className="bg-slate-50 border-b border-slate-200">
              {/* Spacer cell to align the filter row with the new
                  checkbox column on the left. */}
              <th className="w-8"></th>
              {['accountCode', 'description', ...(showCategory ? ['category'] : []), 'currentYear', 'priorYear', 'fsNoteLevel', 'fsLevel', 'fsStatement', 'aiConfidence', ...(isGroupAudit ? ['groupName'] : [])].map(field => {
                const vals = [...(columnValues[field] || [])].sort();
                const activeCount = filters[field]?.size || 0;
                return (
                  <th key={field} className="px-1 py-0.5 relative">
                    <button
                      onClick={() => setOpenFilter(openFilter === field ? null : field)}
                      className={`text-[10px] px-1 py-0.5 rounded hover:bg-slate-200 ${activeCount ? 'text-blue-600 font-bold' : 'text-slate-400'}`}
                      title={activeCount ? `${activeCount} selected` : 'Filter'}
                    >
                      ▼{activeCount ? ` (${activeCount})` : ''}
                    </button>
                    {openFilter === field && vals.length > 0 && (
                      <div className="filter-dropdown absolute left-0 top-full z-30 bg-white border border-slate-200 rounded-md shadow-lg mt-0.5 max-h-48 overflow-y-auto min-w-[120px] max-w-[220px]">
                        <div className="sticky top-0 bg-white border-b border-slate-100 px-2 py-1 flex gap-1">
                          <button onClick={() => { setFilters(prev => ({ ...prev, [field]: new Set(vals) })); }} className="text-[9px] text-blue-500 hover:underline">All</button>
                          <button onClick={() => clearColumnFilter(field)} className="text-[9px] text-red-400 hover:underline">None</button>
                        </div>
                        {vals.map(v => (
                          <label key={v} className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-slate-50 cursor-pointer text-[10px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={filters[field]?.has(v) || false}
                              onChange={() => toggleFilterValue(field, v)}
                              className="w-3 h-3 rounded"
                            />
                            <span className="truncate">{v}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="px-1 py-0.5">
                {hasActiveFilters && (
                  <button onClick={() => { setFilters({}); setOpenFilter(null); }} className="text-[9px] text-red-400 hover:text-red-600" title="Clear all filters">✕</button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const i = rows.indexOf(row);
              const key = rowKey(row, i);
              const isSelected = selectedRowKeys.has(key);
              return (
              <tr
                key={row.id || `new-${i}`}
                data-scroll-anchor={row.accountCode ? `tbcyvpy-${row.accountCode}` : undefined}
                className={`border-b border-slate-100 hover:bg-slate-50/50 ${isSelected ? 'bg-blue-50/40' : ''}`}
              >
                {/* Per-row selection checkbox. Clicking the cell outside
                    the checkbox also toggles — saves a pixel-perfect
                    click on a tiny element. */}
                <td className="w-8 px-1 py-0.5 text-center">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRowSelection(key)}
                    className="w-3.5 h-3.5 rounded cursor-pointer"
                  />
                </td>
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
                  {/* Datalist for paste/type suggestions. Offers BOTH
                      FS Notes (note_items) AND FS Lines (fs_line_items)
                      so the admin can classify a row at the FS Line
                      level directly — useful when there is no more-
                      specific note. handleFsNoteChange already resolves
                      an FS Line pick back to fsLevel, so picking "Revenue"
                      here populates fsLevel=Revenue and fsStatement
                      without needing a separate click. Duplicates are
                      de-duped by name so a line doubled up as a note
                      doesn't show twice. */}
                  <datalist id={`fs-notes-${i}`}>
                    {(() => {
                      const seen = new Set<string>();
                      const opts: JSX.Element[] = [];
                      for (const n of fsNotes) {
                        if (!n.name || seen.has(n.name)) continue;
                        seen.add(n.name);
                        opts.push(<option key={`note-${n.id || n.name}`} value={n.name} />);
                      }
                      for (const l of fsLevels) {
                        if (!l.name || seen.has(l.name)) continue;
                        seen.add(l.name);
                        opts.push(<option key={`line-${l.name}`} value={l.name} />);
                      }
                      return opts;
                    })()}
                  </datalist>
                  {/* AI loading spinner */}
                  {aiLookupRow === i && aiLookupLoading && (
                    <div className="absolute left-0 top-full z-20 w-48 bg-white border border-slate-200 rounded-md shadow-lg mt-0.5 px-3 py-2 text-[10px] text-blue-500 flex items-center gap-1">
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></span>
                      Classifying...
                    </div>
                  )}
                  {/* AI lookup results dropdown */}
                  {aiLookupRow === i && !aiLookupLoading && aiLookupResults.length > 0 && (
                    <div className="absolute left-0 top-full z-20 w-64 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto mt-0.5">
                      <div className="px-2 py-1 text-[9px] font-semibold text-slate-400 border-b bg-slate-50">AI Classification</div>
                      {aiLookupResults.map((r, ri) => (
                        r.name.startsWith('❌') ? (
                          <div key={ri} className="px-2 py-2 text-[10px] text-red-600 bg-red-50">
                            {r.name}
                          </div>
                        ) : (
                          <button
                            key={ri}
                            onClick={() => selectAiResult(i, r)}
                            className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-blue-50 border-b border-slate-50 last:border-0"
                          >
                            <span className="font-medium text-slate-800">{r.label}</span>
                            <span className="block text-[8px] text-slate-400 truncate">{r.name}</span>
                          </button>
                        )
                      ))}
                    </div>
                  )}
                  {aiLookupRow === i && !aiLookupLoading && aiLookupResults.length === 0 && (
                    <div className="absolute left-0 top-full z-20 w-48 bg-white border border-slate-200 rounded-md shadow-lg mt-0.5 px-3 py-2 text-[10px] text-slate-400">
                      No taxonomy matches found
                    </div>
                  )}
                </td>
                {/* FS Level — editable, can be set by AI or manually */}
                <td className="px-2 py-0.5">
                  <input type="text" value={row.fsLevel || ''} onChange={e => updateRow(i, 'fsLevel', e.target.value || null)} className={txtCls} placeholder="FS Level" list="fsLevelList" />
                </td>
                {/* FS Statement — editable dropdown */}
                <td className="px-2 py-0.5">
                  <select value={row.fsStatement || ''} onChange={e => updateRow(i, 'fsStatement', e.target.value || null)} className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5">
                    <option value="">—</option>
                    <option value="Profit & Loss">Profit & Loss</option>
                    <option value="Balance Sheet">Balance Sheet</option>
                    <option value="Cash Flow Statement">Cash Flow Statement</option>
                  </select>
                </td>
                {/* AI Confidence */}
                <td className="px-2 py-0.5 text-center">
                  {row.aiConfidence != null && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      row.aiConfidence >= 90 ? 'bg-green-100 text-green-700' :
                      row.aiConfidence >= 70 ? 'bg-blue-100 text-blue-700' :
                      row.aiConfidence >= 50 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {row.aiConfidence}%
                    </span>
                  )}
                </td>
                {isGroupAudit && (
                  <td className="px-2 py-0.5">
                    <input type="text" value={row.groupName || ''} onChange={e => updateRow(i, 'groupName', e.target.value || null)} className={txtCls} />
                  </td>
                )}
                {canDeleteRows && (
                  <td className="px-2 py-0.5">
                    <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                  </td>
                )}
              </tr>
              );
            })}
            {/* Filtered totals row at bottom of table */}
            {hasActiveFilters && (() => {
              const fCy = filteredRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
              const fPy = filteredRows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
              const f = (v: number) => { const a = Math.abs(v); const s = '£' + a.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
              const ls = showCategory ? 3 : 2;
              return (
                <tr className="bg-blue-50 border-t-2 border-blue-200 sticky bottom-0">
                  <td colSpan={ls} className="text-right pr-2 py-1 text-[10px] font-bold text-blue-700">Filtered Total ({filteredRows.length} rows)</td>
                  <td className="text-right px-2 py-1 text-[10px] font-bold text-blue-800">{f(fCy)}</td>
                  <td className="text-right px-2 py-1 text-[10px] font-bold text-blue-800">{f(fPy)}</td>
                  <td colSpan={10} />
                </tr>
              );
            })()}
          </tbody>
        </table>
        <datalist id="fsLevelList">
          {fsLevels.map((l, li) => <option key={`fsl-${li}`} value={l.name} />)}
        </datalist>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        {hasActiveFilters ? `${filteredRows.length} of ${rows.length} rows (filtered)` : `${rows.length} row${rows.length !== 1 ? 's' : ''}`}
      </div>

      {farOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" /></div>}>
          <FixedAssetRegisterPopup engagementId={engagementId} onClose={() => setFarOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
