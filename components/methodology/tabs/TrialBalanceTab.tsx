'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment, lazy, Suspense } from 'react';
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
  // ── Column widths — resizable by dragging the right edge of any
  // header cell. Defaults biased toward the "Description is the most
  // important column" ask: narrow Code, wide Description, compact FS
  // classification columns. Persisted to localStorage per engagement
  // so the admin's layout survives page reloads.
  const DEFAULT_COL_WIDTHS: Record<string, number> = {
    select: 32,
    accountCode: 90,
    description: 320,
    category: 110,
    currentYear: 110,
    priorYear: 110,
    fsNoteLevel: 170,
    fsLevel: 140,
    fsStatement: 140,
    aiConfidence: 60,
    groupName: 120,
    trailing: 32,
  };
  const widthsStorageKey = `tbcyvpy:widths:${engagementId}`;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return DEFAULT_COL_WIDTHS;
    try {
      const raw = window.localStorage.getItem(widthsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_COL_WIDTHS, ...parsed };
      }
    } catch { /* ignore */ }
    return DEFAULT_COL_WIDTHS;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(widthsStorageKey, JSON.stringify(columnWidths)); } catch { /* quota / disabled — ignore */ }
  }, [columnWidths, widthsStorageKey]);

  /** Start a drag-resize for the given column. Mouse events are
   *  attached at the document level so dragging outside the header
   *  cell still tracks. Min width 40px so a column can't be
   *  vanished by accident. */
  function startColumnResize(field: string, startX: number, startWidth: number) {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const next = Math.max(40, startWidth + dx);
      setColumnWidths(prev => ({ ...prev, [field]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  /** Reset all column widths to their defaults. Surfaced as a small
   *  link in the toolbar when any width has been customised. */
  function resetColumnWidths() { setColumnWidths(DEFAULT_COL_WIDTHS); }
  const anyCustomWidth = Object.entries(columnWidths).some(([k, v]) => DEFAULT_COL_WIDTHS[k] !== v);

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
  // Per-row record of what the AI most-recently suggested for that
  // row's FS classification. Keyed by rowKey (same identity the
  // selection helpers use). Feeds the feedback logger: when the
  // saved value diverges from the AI suggestion we log an "overridden"
  // event; when it matches, we log "accepted". Feedback events are
  // queued into a firm-wide corpus used to tune the classifier's
  // prompt. The map itself lives only in client state — it's cleared
  // on reload, which is fine since the server already has the final
  // saved values.
  const [aiSuggestionByRow, setAiSuggestionByRow] = useState<Record<string, { fsNoteLevel: string | null; fsLevel: string | null; fsStatement: string | null; aiConfidence: number | null }>>({});

  /** Fire-and-forget telemetry for a SINGLE row event (e.g. the user
   *  clicks an AI suggestion pill). Complements the tab-switch batch
   *  snapshot — which captures the final state of every row — by
   *  recording the specific moment of acceptance. */
  function logAiFeedback(row: TBRow, action: 'accepted' | 'overridden' | 'cleared' | 'modified', suggested: any | null) {
    try {
      fetch(`/api/engagements/${engagementId}/tb-ai-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountCode: row.accountCode,
          description: row.description,
          currentYear: row.currentYear,
          suggested,
          chosen: {
            fsNoteLevel: row.fsNoteLevel,
            fsLevel: row.fsLevel,
            fsStatement: row.fsStatement,
          },
          action,
        }),
      }).catch(() => { /* silent */ });
    } catch { /* silent */ }
  }

  /** Send a corpus snapshot of EVERY classified TB row to the server.
   *  The server stores it as a single ActivityLog entry which future
   *  prompt-tuning jobs read to build a canonical
   *    (description → FS classification)
   *  mapping across the firm. Captures the AI's suggestion alongside
   *  the auditor's final choice for each row so diffs surface any
   *  systematic mis-classifications by the model.
   *
   *  Fired on unmount (tab switch) — the user explicitly moving on
   *  is the best "I'm done with this set" signal we have. Uses
   *  navigator.sendBeacon when available so the request survives
   *  the page unmount cleanly. */
  const rowsRef = useRef<TBRow[]>(rows);
  rowsRef.current = rows;
  const aiSuggestionByRowRef = useRef(aiSuggestionByRow);
  aiSuggestionByRowRef.current = aiSuggestionByRow;
  useEffect(() => {
    return () => {
      const currentRows = rowsRef.current;
      const suggestions = aiSuggestionByRowRef.current;
      // Only rows with BOTH a description AND any classification are
      // worth sending — unclassified rows carry no teaching signal,
      // and description-less rows can't be keyed in the corpus.
      const snapshotRows = currentRows
        .filter(r => (r.description || r.accountCode) && (r.fsNoteLevel || r.fsLevel || r.fsStatement))
        .map((r, i) => {
          const k = rowKey(r, i);
          const aiSuggested = suggestions[k] || null;
          return {
            accountCode: r.accountCode || '',
            description: r.description || '',
            currentYear: r.currentYear ?? null,
            aiSuggested,
            final: {
              fsNoteLevel: r.fsNoteLevel || null,
              fsLevel: r.fsLevel || null,
              fsStatement: r.fsStatement || null,
            },
          };
        });
      if (snapshotRows.length === 0) return;
      const url = `/api/engagements/${engagementId}/tb-ai-feedback`;
      const payload = JSON.stringify({ rows: snapshotRows });
      // sendBeacon survives unmount + page navigation; fall back to
      // fetch with keepalive when the beacon API isn't available.
      try {
        if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon(url, blob);
        } else {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
          }).catch(() => { /* silent */ });
        }
      } catch { /* silent */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

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

  /** Default cleared value for a TB column by its field name.
   *  Numeric columns go to null; description columns go to '' (so
   *  they remain valid strings); FS classification columns go to
   *  null. Kept in one place so all three clear flows stay in sync. */
  function clearedValueFor(field: string): any {
    if (field === 'currentYear' || field === 'priorYear' || field === 'aiConfidence') return null;
    if (field === 'accountCode' || field === 'description') return '';
    return null;
  }

  /** Clear the values at the intersection of selected rows × selected
   *  columns. Only used when BOTH are selected. */
  function clearSelectedCells() {
    if (selectedRowKeys.size === 0 || selectedColumns.size === 0) return;
    const cellCount = selectedRowKeys.size * selectedColumns.size;
    if (!confirm(`Clear ${cellCount} cell${cellCount === 1 ? '' : 's'} (${selectedRowKeys.size} row${selectedRowKeys.size === 1 ? '' : 's'} × ${selectedColumns.size} column${selectedColumns.size === 1 ? '' : 's'})?`)) return;
    setRows(prev => prev.map((r, i) => {
      const k = rowKey(r, i);
      if (!selectedRowKeys.has(k)) return r;
      const patch: Partial<TBRow> = {};
      for (const field of selectedColumns) (patch as any)[field] = clearedValueFor(field);
      return { ...r, ...patch } as TBRow;
    }));
  }

  /** Copy the currently-visible (filtered + sorted) rows to the
   *  clipboard as tab-separated values. Headers on the first line,
   *  one row per TB entry — drops straight into Excel, Google
   *  Sheets, or any editor with a paste-as-table.
   *
   *  Column inclusion is driven by the existing column-selection
   *  checkboxes: if any are ticked, only those are copied, otherwise
   *  all columns are included. Feedback via a transient toolbar
   *  chip ("Copied N rows × M columns") rather than an alert. */
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  async function copyFilteredRows() {
    if (filteredRows.length === 0) return;
    // Column definitions mirror what the table renders. Keeps headers
    // in sync if showCategory / isGroupAudit toggle state-side.
    const allCols: Array<{ field: keyof TBRow | string; label: string }> = [
      { field: 'accountCode',  label: 'Account Code' },
      { field: 'description',  label: 'Description' },
      ...(showCategory ? [{ field: 'category', label: 'Category' }] : []),
      { field: 'currentYear',  label: formatDateDDMMYYYY(periodEndDate) || 'Current Year' },
      { field: 'priorYear',    label: dayBefore(periodStartDate) || 'Prior Year' },
      { field: 'fsNoteLevel',  label: 'FS Note' },
      { field: 'fsLevel',      label: 'FS Level' },
      { field: 'fsStatement',  label: 'FS Statement' },
      { field: 'aiConfidence', label: 'AI %' },
      ...(isGroupAudit ? [{ field: 'groupName', label: 'Group Name' }] : []),
    ];
    // Filter to selected columns if any are ticked, else copy all.
    const cols = selectedColumns.size > 0
      ? allCols.filter(c => selectedColumns.has(String(c.field)))
      : allCols;
    if (cols.length === 0) { setCopyFeedback('No columns selected to copy'); window.setTimeout(() => setCopyFeedback(null), 2000); return; }

    /** Escape a cell for TSV. Real-world TB descriptions sometimes
     *  contain tabs or newlines (pasted from PDFs) — we strip those
     *  rather than quote, since Excel's TSV paste handles
     *  space-normalised content better than quoted content. */
    const cell = (v: any): string => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'number' ? String(v) : String(v);
      return s.replace(/[\t\r\n]+/g, ' ');
    };

    const header = cols.map(c => cell(c.label)).join('\t');
    const body = filteredRows.map(r => cols.map(c => cell((r as any)[c.field])).join('\t')).join('\n');
    const tsv = `${header}\n${body}`;
    try {
      await navigator.clipboard.writeText(tsv);
      setCopyFeedback(`Copied ${filteredRows.length} row${filteredRows.length === 1 ? '' : 's'} × ${cols.length} column${cols.length === 1 ? '' : 's'}`);
    } catch {
      // Fallback for insecure contexts — drop the content into a
      // textarea the user can Ctrl+C from. Exits silently if even
      // that fails (older browsers / sandboxed iframes).
      try {
        const ta = document.createElement('textarea');
        ta.value = tsv;
        ta.style.position = 'fixed';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyFeedback(`Copied ${filteredRows.length} rows (fallback)`);
      } catch {
        setCopyFeedback('Copy failed — your browser blocked clipboard access');
      }
    }
    window.setTimeout(() => setCopyFeedback(null), 2500);
  }

  /** Clear the selected columns across EVERY visible row (respects
   *  current filters). This is the "delete column" action the user
   *  sees when columns are selected but no rows — same semantics as
   *  Excel's "clear column" rather than "delete column". Rows
   *  themselves aren't removed; only the cell values are emptied. */
  function clearSelectedColumnsAcrossVisibleRows() {
    if (selectedColumns.size === 0) return;
    const affectedRowCount = filteredRows.length;
    if (affectedRowCount === 0) return;
    if (!confirm(`Clear ${selectedColumns.size} column${selectedColumns.size === 1 ? '' : 's'} across ${affectedRowCount} visible row${affectedRowCount === 1 ? '' : 's'}?`)) return;
    const visibleKeys = new Set(filteredRows.map(r => rowKey(r, rows.indexOf(r))));
    setRows(prev => prev.map((r, i) => {
      const k = rowKey(r, i);
      if (!visibleKeys.has(k)) return r;
      const patch: Partial<TBRow> = {};
      for (const field of selectedColumns) (patch as any)[field] = clearedValueFor(field);
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
      // Kick off the background task. This used to return the
      // classification synchronously, but the endpoint has since
      // been moved to a background-task model (to handle large
      // batches + corpus aggregation). We now poll for the result
      // same as the "Populate All" button already does.
      const kickoff = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [{ index, accountCode: row.accountCode, description: row.description, currentYear: row.currentYear }],
        }),
      });
      if (!kickoff.ok) {
        const errData = await kickoff.json().catch(() => ({}));
        console.error('AI lookup kickoff failed:', kickoff.status, errData);
        setAiLookupResults([{ name: `❌ ${errData.error || `Error ${kickoff.status}`}`, label: `Error: ${errData.error || kickoff.status}`, fsLevel: '', fsStatement: '' }]);
        return;
      }
      const kickData = await kickoff.json();
      const taskId = kickData.taskId;
      if (!taskId) {
        // Legacy synchronous response — some older deployments may
        // still return classifications inline. Fall through to the
        // old handling for those.
        const c = kickData.classifications?.[0];
        if (c) {
          applyAiSuggestion(index, c, row);
          return;
        }
        setAiLookupResults([{ name: '❌ No taskId returned', label: 'Error', fsLevel: '', fsStatement: '' }]);
        return;
      }
      // Poll the task with a short interval (~800ms) until it
      // completes or 45s max. Single-row classifications normally
      // finish in <3s — the longer ceiling is for cold-start cases.
      const start = Date.now();
      while (Date.now() - start < 45_000) {
        await new Promise(r => setTimeout(r, 800));
        const pollRes = await fetch(`/api/engagements/${engagementId}/ai-classify-tb`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll', taskId }),
        });
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        if (pollData.status === 'completed' || pollData.status === 'complete' || pollData.status === 'succeeded') {
          // Pull the classification for this row from the saved DB
          // row — the background task writes results directly to
          // auditTBRow, so re-reading the engagement's TB gives the
          // latest values. Fast path: read the result field if the
          // task embedded classifications in it.
          const c = Array.isArray(pollData.result?.classifications)
            ? pollData.result.classifications.find((x: any) => x.index === index)
            : null;
          if (c) {
            applyAiSuggestion(index, c, row);
          } else {
            // Fallback: refresh the TB rows from server and read the
            // classification off the stored row.
            await loadData();
            const refreshed = rows[index];
            if (refreshed?.fsNoteLevel || refreshed?.fsLevel) {
              setAiLookupResults([{
                name: `${refreshed.fsNoteLevel || ''} → ${refreshed.fsLevel || ''} → ${refreshed.fsStatement || ''}`,
                label: refreshed.fsNoteLevel || refreshed.fsLevel || '',
                fsLevel: refreshed.fsLevel || '',
                fsStatement: refreshed.fsStatement || '',
              }]);
            } else {
              setAiLookupResults([{ name: 'ℹ No classification returned', label: '(empty)', fsLevel: '', fsStatement: '' }]);
            }
          }
          return;
        }
        if (pollData.status === 'failed' || pollData.status === 'error') {
          setAiLookupResults([{ name: `❌ ${pollData.error || 'Classification failed'}`, label: pollData.error || 'Error', fsLevel: '', fsStatement: '' }]);
          return;
        }
        // still running — loop
      }
      setAiLookupResults([{ name: '❌ Timed out — try again', label: 'Timeout', fsLevel: '', fsStatement: '' }]);
    } catch (err) {
      console.error('AI lookup failed:', err);
      setAiLookupResults([{ name: '❌ AI service unavailable', label: 'Error: service unavailable', fsLevel: '', fsStatement: '' }]);
    } finally {
      setAiLookupLoading(false);
    }
  }

  /** Shared apply-suggestion helper — wraps the "add to results +
   *  remember AI suggestion per row" logic that both the sync and
   *  async branches of handleAiLookup need. */
  function applyAiSuggestion(index: number, c: any, row: TBRow) {
    setAiLookupResults([{
      name: `${c.fsNoteLevel || ''} → ${c.fsLevel || ''} → ${c.fsStatement || ''}`,
      label: c.fsNoteLevel,
      fsLevel: c.fsLevel,
      fsStatement: c.fsStatement,
    }]);
    const key = rowKey(row, index);
    setAiSuggestionByRow(prev => ({
      ...prev,
      [key]: {
        fsNoteLevel: c.fsNoteLevel ?? null,
        fsLevel: c.fsLevel ?? null,
        fsStatement: c.fsStatement ?? null,
        aiConfidence: typeof c.aiConfidence === 'number' ? c.aiConfidence : null,
      },
    }));
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
    const updated = rows.map((r, i) => i === index ? {
      ...r,
      fsNoteLevel: result.label || r.fsNoteLevel,
      fsLevel: result.fsLevel || r.fsLevel,
      fsStatement: result.fsStatement || r.fsStatement,
    } : r);
    setRows(updated);
    setAiLookupRow(null);
    setAiLookupResults([]);
    // Log acceptance for the feedback corpus — the user picked the
    // AI suggestion wholesale, which is the strongest positive signal
    // we can send back.
    const r = updated[index];
    const key = rowKey(r, index);
    const suggested = {
      fsNoteLevel: result.label || null,
      fsLevel: result.fsLevel || null,
      fsStatement: result.fsStatement || null,
      aiConfidence: aiSuggestionByRow[key]?.aiConfidence ?? null,
    };
    logAiFeedback(r, 'accepted', suggested);
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
          {/* Bulk-action buttons — surface when EITHER rows or columns
              are selected. Three modes:
                • Only rows        → Delete N rows
                • Only columns     → Clear N cols across visible rows
                • Rows + columns   → Clear N×M cells (intersection) + Delete rows */}
          {(selectedRowKeys.size > 0 || selectedColumns.size > 0) && (
            <>
              <span className="text-[10px] text-slate-500">
                {selectedRowKeys.size > 0 && (
                  <>{selectedRowKeys.size} row{selectedRowKeys.size === 1 ? '' : 's'}</>
                )}
                {selectedRowKeys.size > 0 && selectedColumns.size > 0 && <> · </>}
                {selectedColumns.size > 0 && (
                  <>{selectedColumns.size} col{selectedColumns.size === 1 ? '' : 's'}</>
                )}
              </span>
              {/* Rows + columns selected → clear the intersection. */}
              {selectedRowKeys.size > 0 && selectedColumns.size > 0 && (
                <button onClick={clearSelectedCells}
                  className="text-xs px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 font-medium">
                  Clear {selectedRowKeys.size * selectedColumns.size} cells
                </button>
              )}
              {/* Only columns selected → clear the whole column across visible rows. */}
              {selectedRowKeys.size === 0 && selectedColumns.size > 0 && (
                <button onClick={clearSelectedColumnsAcrossVisibleRows}
                  className="text-xs px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 font-medium">
                  Clear {selectedColumns.size} column{selectedColumns.size === 1 ? '' : 's'}
                </button>
              )}
              {/* Rows selected → delete them entirely. */}
              {selectedRowKeys.size > 0 && (
                <button onClick={deleteSelectedRows}
                  className="text-xs px-3 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 font-medium">
                  Delete {selectedRowKeys.size} row{selectedRowKeys.size === 1 ? '' : 's'}
                </button>
              )}
              <button onClick={() => { clearRowSelection(); clearColumnSelection(); }}
                className="text-[10px] text-slate-400 hover:text-slate-700">Clear selection</button>
            </>
          )}
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          {copyFeedback && (
            <span className="text-[10px] text-green-600 font-medium">{copyFeedback}</span>
          )}
          {/* Copy filtered rows as TSV (Excel-friendly). When any
              column checkboxes are ticked, only those columns are
              included — handy for "just show me the Description +
              FS Level for this particular FS Statement" workflows. */}
          <button
            onClick={copyFilteredRows}
            disabled={filteredRows.length === 0}
            title={`Copy the ${filteredRows.length} visible row${filteredRows.length === 1 ? '' : 's'}${selectedColumns.size > 0 ? ` (${selectedColumns.size} selected column${selectedColumns.size === 1 ? '' : 's'})` : ' (all columns)'} to clipboard — paste into Excel`}
            className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50"
          >
            📋 Copy {filteredRows.length} row{filteredRows.length === 1 ? '' : 's'}
            {selectedColumns.size > 0 && <> <span className="text-slate-500">({selectedColumns.size} col{selectedColumns.size === 1 ? '' : 's'})</span></>}
          </button>
          {anyCustomWidth && (
            <button onClick={resetColumnWidths} className="text-[10px] text-slate-400 hover:text-slate-700" title="Reset column widths to defaults">
              Reset widths
            </button>
          )}
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
        <table className="text-xs" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          {/* Widths come from state so the drag-resize handles on
              each column header can update them. Persisted to
              localStorage per engagement. Row-select column first,
              then the data columns, then a trailing delete column. */}
          <colgroup>
            <col style={{ width: `${columnWidths.select}px` }} />{/* Row select */}
            <col style={{ width: `${columnWidths.accountCode}px` }} />
            <col style={{ width: `${columnWidths.description}px` }} />
            {showCategory && <col style={{ width: `${columnWidths.category}px` }} />}
            <col style={{ width: `${columnWidths.currentYear}px` }} />
            <col style={{ width: `${columnWidths.priorYear}px` }} />
            <col style={{ width: `${columnWidths.fsNoteLevel}px` }} />
            <col style={{ width: `${columnWidths.fsLevel}px` }} />
            <col style={{ width: `${columnWidths.fsStatement}px` }} />
            <col style={{ width: `${columnWidths.aiConfidence}px` }} />
            {isGroupAudit && <col style={{ width: `${columnWidths.groupName}px` }} />}
            <col style={{ width: `${columnWidths.trailing}px` }} />
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
                      <th
                        key={col.field}
                        className={`text-${col.align} px-2 py-2 text-slate-500 font-medium select-none relative`}
                        style={{ position: 'relative' }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.field)}
                          className="text-left w-full cursor-pointer hover:text-slate-700"
                          style={{ textAlign: col.align as any }}
                          title="Click to sort"
                        >
                          {col.label} {sortCol === col.field ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                        {/* Drag handle on the right edge — mousedown
                            captures the starting x + width, listeners
                            at document level handle the drag even if
                            the cursor leaves the header. */}
                        <span
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            startColumnResize(col.field, e.clientX, columnWidths[col.field] ?? 120);
                          }}
                          title="Drag to resize column"
                          className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize hover:bg-blue-300/60 active:bg-blue-500/60 transition-colors"
                          style={{ zIndex: 5 }}
                        />
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
                  {/* Description can be long and is the most important
                      field to see in full. title= shows the whole text
                      on hover when the narrow cell truncates it. */}
                  <input
                    type="text"
                    value={row.description}
                    onChange={e => updateRow(i, 'description', e.target.value)}
                    onPaste={e => handlePaste(e, i, 1)}
                    className={txtCls}
                    placeholder="Description"
                    title={row.description || undefined}
                  />
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
