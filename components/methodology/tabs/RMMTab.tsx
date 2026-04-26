'use client';

import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { ASSERTION_TYPES, INHERENT_RISK_COMPONENTS } from '@/types/methodology';
import { lookupInherentRisk, lookupOverallRisk, riskColor, inherentRiskDropdownColor } from '@/lib/risk-table-lookup';
import { useScrollToAnchor } from '@/lib/hooks/useScrollToAnchor';
import { PlanningLetterModal } from '../panels/PlanningLetterModal';

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
  /** Drives the Planning Letter's Significant Risks / Areas of Focus sections. */
  rowCategory: 'significant_risk' | 'area_of_focus' | null;
  isHidden: boolean;
  isMandatory: boolean;
  notes: string | null;
  sortOrder: number;
  rowSignOffs?: RowSignOffs;
  lastEditedAt?: string;
  // FS hierarchy mirrored from the underlying Prisma model — used to filter
  // applicable assertions by statement (P&L vs Balance Sheet etc.).
  fsStatement?: string | null;
  fsLevel?: string | null;
  fsNote?: string | null;
  // Origin marker — 'par' for rows pushed over from the PAR tab via
  // Send to RMM. Null for manually added / TB-imported rows. Drives
  // the bottom-of-list grouping + shading.
  source?: string | null;
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

/**
 * Resizable table header cell. Renders a <th> plus a thin drag-handle
 * on the right edge; mousedown on the handle kicks off a global
 * mousemove/mouseup listener (installed by the parent's
 * `startColumnResize`) that streams the new width back into the
 * parent's `columnWidths` state. Widths are pixel values; the parent
 * persists them in localStorage.
 *
 * Kept as a local component rather than a shared hook because each
 * tab that wants this (PAR / TBCYvPY / RMM …) has its own set of
 * column keys and alignment rules — centralising would mean threading
 * a config object through that's bigger than the component itself.
 */
function ResizableTh({
  colKey, widths, onResizeStart, align = 'left', title, children,
}: {
  colKey: string;
  widths: Record<string, number>;
  onResizeStart: (field: string, startX: number, startWidth: number) => void;
  align?: 'left' | 'center' | 'right';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className="relative px-2 py-2 text-slate-500 font-medium whitespace-nowrap"
      style={{ textAlign: align }}
      title={title}
    >
      {children}
      <span
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(colKey, e.clientX, widths[colKey] ?? 120);
        }}
        title="Drag to resize column"
        className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize hover:bg-blue-300/60 active:bg-blue-500/60 transition-colors"
        style={{ zIndex: 5 }}
      />
    </th>
  );
}

export function RMMTab({ engagementId, auditType, teamMembers = [], showCategoryOption = false }: Props) {
  const { data: session } = useSession();
  const [rows, setRows] = useState<RMMRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Scroll to the row referenced by any incoming ?scroll=rmm-<rowId>
  // URL param (written by the AI Populate deep-link chips on the
  // Completion panel). Re-runs when loading flips so it catches the
  // anchor once rows have actually rendered.
  useScrollToAnchor([loading, rows.length], { enabled: !loading });
  const [initialRows, setInitialRows] = useState<RMMRow[]>([]);
  const [viewMode, setViewMode] = useState<'fs_line' | 'tb_account'>('fs_line');
  const [showCategory, setShowCategory] = useState(false);
  // Planning Letter modal — two modes, same component. Opened from
  // the toolbar buttons added below.
  const [planningLetterMode, setPlanningLetterMode] = useState<'send' | 'download' | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [generatingAI, setGeneratingAI] = useState<string | null>(null);
  const [importingTB, setImportingTB] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [hasPriorYear, setHasPriorYear] = useState(false);

  // Nature dropdown options from Firm Wide Assumptions (e.g. Revenue Recognition)
  const [natureDropdowns, setNatureDropdowns] = useState<Record<string, string[]>>({});
  // FS Line → category mapping to determine which lines get dropdowns
  const [fsLineCategories, setFsLineCategories] = useState<Record<string, string>>({});

  // ── Resizable column widths (mirrors the PAR / TBCYvPY pattern) ───
  // Persisted per engagement in localStorage so a reviewer's layout
  // choices stick across reloads. Width values are pixels. Action
  // columns (duplicate / delete) stay hardcoded — they're icons that
  // need no stretching. Re-hydrates from storage on mount, falling
  // back to the defaults below on any parse failure or first visit.
  const DEFAULT_COL_WIDTHS: Record<string, number> = {
    category: 112,
    lineItem: 160,
    nature: 160,
    amount: 112,
    assertions: 112,
    relevance: 56,
    inherentRisk: 64,
    riskSummation: 144,
    likelihood: 80,
    magnitude: 80,
    finalRisk: 80,
    controlRisk: 96,
    overall: 80,
    sigRisk: 56,
    notes: 200,
    signOffs: 112,
  };
  const widthsStorageKey = `rmm:widths:${engagementId}`;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return DEFAULT_COL_WIDTHS;
    try {
      const raw = window.localStorage.getItem(widthsStorageKey);
      if (raw) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_COL_WIDTHS;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(widthsStorageKey, JSON.stringify(columnWidths)); } catch { /* ignore */ }
  }, [columnWidths, widthsStorageKey]);

  // Performance materiality — used to shade the Amount cell grey when
  // a row's amount is BELOW PM. Signals at a glance which line items
  // don't individually clear the materiality threshold. Fetched once
  // on mount; re-fetched when the engagement changes. Zero if the
  // materiality schedule hasn't been populated yet — in which case we
  // don't shade anything.
  const [performanceMateriality, setPerformanceMateriality] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/materiality`);
        if (!res.ok) return;
        const json = await res.json();
        const pm = Number(json?.data?.performanceMateriality);
        if (!cancelled && Number.isFinite(pm) && pm > 0) setPerformanceMateriality(pm);
      } catch { /* quiet — shading is non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  function startColumnResize(field: string, startX: number, startWidth: number) {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      setColumnWidths(prev => ({ ...prev, [field]: Math.max(40, startWidth + dx) }));
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

  // Per-row save failure surfaced from the server. The PUT runs each
  // row's persist in its own try/catch and returns a `failures` array
  // on the response — when non-empty we show it inline next to the
  // "Saved" indicator so the auditor knows their typed value didn't
  // land. Without this the user only saw "Saved" even when, say, the
  // Nature column update silently failed for one row.
  const [saveFailures, setSaveFailures] = useState<Array<{ id: string | null; lineItem: string | null; error: string }>>([]);

  const { saving, lastSaved, error } = useAutoSave<{ rows: RMMRow[] }, { rows: unknown[]; failures?: Array<{ id: string | null; lineItem: string | null; error: string }> }>(
    `/api/engagements/${engagementId}/rmm`,
    { rows },
    {
      enabled: JSON.stringify(rows) !== JSON.stringify(initialRows),
      onSaveSuccess: (resp) => {
        const f = Array.isArray(resp?.failures) ? resp.failures : [];
        setSaveFailures(f);
        if (f.length > 0) {
          // Helpful for self-diagnosis without Vercel logs — open
          // browser DevTools console to see exactly which row + why.
          console.error('[RMM autosave] partial failure:', f);
        }
        // Diagnostic — confirm what the server actually persisted for
        // any row whose riskIdentified is non-empty. Pairs with the
        // [RMM updateRow] log on typing: if a typed value shows up in
        // updateRow but is ABSENT here, the server is losing it
        // (or the client isn't sending it).
        if (typeof window !== 'undefined' && Array.isArray(resp?.rows)) {
          const natureSamples = (resp.rows as Array<Record<string, unknown>>)
            .filter(r => typeof r.riskIdentified === 'string' && (r.riskIdentified as string).trim() !== '')
            .map(r => ({ id: r.id, lineItem: r.lineItem, riskIdentified: r.riskIdentified }));
          console.log(`[RMM autosave] server returned ${(resp.rows as unknown[]).length} rows; ${natureSamples.length} have riskIdentified populated`, natureSamples.slice(0, 5));
        }
      },
    }
  );

  const [riskClassificationTable, setRiskClassificationTable] = useState<Record<string, string> | null>(null);
  // Per-row Inherent Risk sub-component levels: { [rowId]: { complexity?, subjectivity?, change?, uncertainty?, susceptibility? } }
  // Stored server-side in auditPermanentFile (sectionKey 'rmm_ir_levels'); see RMM API.
  const [irLevels, setIrLevels] = useState<Record<string, Record<string, string>>>({});
  const irSaveTimer = useRef<NodeJS.Timeout | null>(null);
  // Assertions matrix from Firm Wide Assumptions (which assertions apply to BS / PNL etc.)
  const [assertionsTable, setAssertionsTable] = useState<{ rows: Array<{ key: string; [k: string]: any }> } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [res, rcRes, asRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/rmm`),
        fetch('/api/methodology-admin/risk-tables?tableType=riskClassification'),
        fetch('/api/methodology-admin/risk-tables?tableType=assertions'),
      ]);
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
        // Hydrate per-component IR levels.  When no map exists yet, seed every
        // row from its legacy `inherentRiskLevel` so existing data remains visible
        // until the user edits a sub-component.
        const serverIr = (json.irLevels || {}) as Record<string, Record<string, string>>;
        const hydrated: Record<string, Record<string, string>> = {};
        for (const r of loaded) {
          const existing = serverIr[r.id];
          if (existing && Object.keys(existing).length > 0) {
            hydrated[r.id] = existing;
          } else if (r.inherentRiskLevel) {
            hydrated[r.id] = {
              complexity: r.inherentRiskLevel,
              subjectivity: r.inherentRiskLevel,
              change: r.inherentRiskLevel,
              uncertainty: r.inherentRiskLevel,
              susceptibility: r.inherentRiskLevel,
            };
          }
        }
        setIrLevels(hydrated);
      }
      if (rcRes.ok) {
        const rcData = await rcRes.json();
        if (rcData.table?.data) setRiskClassificationTable(rcData.table.data);
      }
      if (asRes.ok) {
        const asData = await asRes.json();
        if (asData.table?.data) setAssertionsTable(asData.table.data);
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId, auditType]);

  // Persist IR sub-component levels (debounced) — separate save path from the
  // main RMM rows because the data lives in auditPermanentFile, not on the row.
  function updateIrLevel(rowId: string, component: string, level: string) {
    setIrLevels(prev => {
      const next = { ...prev, [rowId]: { ...(prev[rowId] || {}), [component]: level } };
      if (level === '') delete next[rowId][component];
      if (irSaveTimer.current) clearTimeout(irSaveTimer.current);
      irSaveTimer.current = setTimeout(async () => {
        await fetch(`/api/engagements/${engagementId}/rmm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_ir_levels', irLevels: next }),
        }).catch(() => {});
      }, 800);
      return next;
    });
  }

  useEffect(() => { loadData(); }, [loadData]);

  // Map assertion display name → camelCase key used in the Firm Wide Assumptions
  // assertions table (so we can ask "is Completeness applicable to BS?").
  const ASSERTION_KEY_MAP: Record<string, string> = {
    'Completeness': 'completeness',
    'Occurrence & Accuracy': 'occurrenceAccuracy',
    'Cut Off': 'cutOff',
    'Classification': 'classification',
    'Presentation': 'presentation',
    'Existence': 'existence',
    'Valuation': 'valuation',
    'Rights & Obligations': 'rightsObligations',
  };

  /** Returns the subset of ASSERTION_TYPES that are applicable to a row, based on
   *  the row's FS Statement (P&L vs Balance Sheet) and the firm-configured
   *  Assertions matrix. Falls back to ALL assertions if the matrix or the row's
   *  statement aren't set yet, so the UI never silently hides everything. */
  function applicableAssertionsFor(row: RMMRow): readonly string[] {
    if (!assertionsTable?.rows?.length) return ASSERTION_TYPES;
    const stmt = row.fsStatement || '';
    let key: string | null = null;
    if (/profit/i.test(stmt) || /loss/i.test(stmt) || /pnl/i.test(stmt) || /income/i.test(stmt)) key = 'PNL';
    else if (/balance/i.test(stmt) || /^bs$/i.test(stmt)) key = 'BS';
    else if (/cash/i.test(stmt) || /cf/i.test(stmt)) key = 'CF';
    if (!key) return ASSERTION_TYPES;
    const matrixRow = assertionsTable.rows.find(r => r.key === key);
    if (!matrixRow) return ASSERTION_TYPES;
    return ASSERTION_TYPES.filter(a => {
      const k = ASSERTION_KEY_MAP[a];
      return k ? matrixRow[k] === true : true;
    });
  }

  // Auto-derive Planning Letter category from Sig.Risk dot.  Whenever
  // any of the user-editable inputs (Likelihood / Magnitude / Control
  // Risk / Relevance) changes, OR the firm-wide riskClassificationTable
  // loads, recompute the chain:
  //
  //   Likelihood × Magnitude  → finalRiskAssessment (inherent)
  //   inherent × controlRisk  → overallRisk
  //   overallRisk + classMap  → 'Significant Risk' | 'Area of Focus' | null
  //   classification          → rowCategory
  //
  // Then persist all three derived values (`overallRisk`,
  // `finalRiskAssessment`, `rowCategory`) so:
  //   • the saved data matches what computedRows shows in the table,
  //   • the Audit Planning Letter's `auditPlan.significantRisks` and
  //     `auditPlan.areasOfFocus` filters in template-context.ts (which
  //     read straight off the saved row) actually see populated rows.
  //
  // Previously this read `r.overallRisk` directly, but overallRisk was
  // only ever computed in the `computedRows` useMemo for display and
  // never written back — so rowCategory stayed null forever, even on
  // rows the auditor had filled in. We only bump state when something
  // actually changes to avoid a render loop with useAutoSave.
  useEffect(() => {
    setRows(prev => {
      let mutated = false;
      const next = prev.map(r => {
        const finalRisk = r.relevance === 'N' ? 'N/A' : lookupInherentRisk(r.likelihood, r.magnitude);
        const finalRiskValue = finalRisk === 'N/A' ? null : finalRisk;
        const overall = finalRisk && finalRisk !== 'N/A' ? lookupOverallRisk(finalRisk, r.controlRisk) : null;
        const classification = overall ? (riskClassificationTable?.[overall]
          || (overall === 'High' || overall === 'Very High' ? 'Significant Risk'
              : overall === 'Medium' ? 'Area of Focus' : null)) : null;
        const target = classification === 'Significant Risk' ? 'significant_risk'
          : classification === 'Area of Focus' ? 'area_of_focus'
          : null;
        const changed =
          (r.rowCategory || null) !== target
          || (r.overallRisk || null) !== (overall || null)
          || (r.finalRiskAssessment || null) !== (finalRiskValue || null);
        if (changed) {
          mutated = true;
          return { ...r, rowCategory: target as any, overallRisk: overall as any, finalRiskAssessment: finalRiskValue as any };
        }
        return r;
      });
      return mutated ? next : prev;
    });
  }, [riskClassificationTable, rows.map(r => `${r.likelihood}|${r.magnitude}|${r.controlRisk}|${r.relevance}`).join('||')]);

  // Check if prior year engagement exists
  useEffect(() => {
    fetch(`/api/engagements/${engagementId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.engagement?.clientId) {
          fetch(`/api/engagements?clientId=${data.engagement.clientId}&auditType=${auditType}&prior=true&currentEngagementId=${engagementId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.engagement?.id) setHasPriorYear(true); })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [engagementId, auditType]);

  // Populate Data — from PAR or TB depending on viewMode
  async function populateData() {
    setPopulating(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/rmm/populate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: viewMode }),
      });
      if (res.ok) await loadData();
    } catch (err) { console.error('Populate failed:', err); }
    setPopulating(false);
  }

  // Populate from Previous — copy prior year RMM with new amounts
  async function populateFromPrevious() {
    setPopulating(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/rmm/populate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'previous' }),
      });
      if (res.ok) await loadData();
    } catch (err) { console.error('Populate from previous failed:', err); }
    setPopulating(false);
  }

  // Load nature dropdown config from Firm Wide Assumptions + FS Line categories
  useEffect(() => {
    async function loadNatureConfig() {
      try {
        const [revRes, fsRes] = await Promise.all([
          fetch('/api/methodology-admin/risk-tables?tableType=revenue_recognition'),
          fetch('/api/methodology-admin/fs-lines'),
        ]);
        // Revenue Recognition items → dropdown for revenue FS lines
        if (revRes.ok) {
          const d = await revRes.json();
          const items = d.table?.data?.items;
          if (Array.isArray(items) && items.length > 0) {
            const labels = items.map((i: any) => i.label || i).filter(Boolean);
            if (labels.length > 0) {
              setNatureDropdowns(prev => ({ ...prev, pnl_revenue: labels }));
            }
          }
        }
        // FS Line categories
        if (fsRes.ok) {
          const d = await fsRes.json();
          const cats: Record<string, string> = {};
          for (const fl of (d.fsLines || [])) {
            cats[fl.name] = fl.fsCategory || '';
          }
          setFsLineCategories(cats);
        }
      } catch {}
    }
    loadNatureConfig();
  }, []);

  const computedRows = useMemo(() => {
    const withRisks = rows.map(row => {
      const finalRisk = row.relevance === 'N' ? 'N/A' : lookupInherentRisk(row.likelihood, row.magnitude);
      const overallRisk = finalRisk && finalRisk !== 'N/A' ? lookupOverallRisk(finalRisk, row.controlRisk) : null;
      return { ...row, finalRiskAssessment: finalRisk, overallRisk };
    });
    // Partition PAR-sourced rows to the bottom so reviewers can see at a
    // glance which items came from preliminary analytical review. Order
    // within each group stays as the user arranged them (sortOrder).
    const par: typeof withRisks = [];
    const main: typeof withRisks = [];
    for (const r of withRisks) (r.source === 'par' ? par : main).push(r);
    return [...main, ...par];
  }, [rows]);

  // Index of the first PAR-sourced row within computedRows, or -1 if
  // none. Used to inject a section-header row before the group and to
  // apply the light shading on each PAR row in the tbody.
  const parGroupStartIndex = useMemo(() => computedRows.findIndex(r => r.source === 'par'), [computedRows]);

  // Get nature dropdown options for a given line item
  function getNatureOptions(lineItem: string): string[] | null {
    if (!lineItem) return null;
    const lc = lineItem.toLowerCase();
    const category = fsLineCategories[lineItem] || '';

    // Revenue lines get revenue recognition dropdown
    // Match by name containing revenue/turnover/sales/income/fees
    const isRevenue = lc.includes('revenue') || lc.includes('turnover') || lc.includes('sales') || lc.includes('income') || lc.includes('fees') || lc === 'revenue';
    if (isRevenue && natureDropdowns['pnl_revenue']?.length) {
      return natureDropdowns['pnl_revenue'];
    }

    // Future: add more category → dropdown mappings here
    // e.g. if (isProperty && natureDropdowns['property_valuation']) return ...
    return null;
  }

  const currentUserId = session?.user?.id;
  const userIsReviewer = currentUserId && teamMembers.some(m => m.role === 'Manager' && m.userId === currentUserId);
  const userIsPartner = currentUserId && teamMembers.some(m => m.role === 'RI' && m.userId === currentUserId);

  function makeEmptyRow(): RMMRow {
    return {
      id: '', lineItem: '', lineType: viewMode, category: null, rowCategory: null, riskIdentified: null, amount: null,
      assertions: [], relevance: null, complexityText: null, subjectivityText: null,
      changeText: null, uncertaintyText: null, susceptibilityText: null,
      inherentRiskLevel: null, aiSummary: null, isAiEdited: false,
      likelihood: null, magnitude: null, finalRiskAssessment: null,
      controlRisk: isControlsBased(auditType) ? null : 'Not Tested',
      overallRisk: null, isHidden: false, isMandatory: false, notes: null, sortOrder: 0,
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
    // Diagnostic — open DevTools console and watch this when you type
    // in any cell. Confirms the change is reaching React state. Only
    // logs the Nature column (riskIdentified) since that's the field
    // we're tracking; comment in or out as needed for other fields.
    if (field === 'riskIdentified' && typeof window !== 'undefined') {
      console.log(`[RMM updateRow] row=${index} field=riskIdentified value=${JSON.stringify(value)}`);
    }
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
      const addedInBatch = new Set<string>();

      const newRows: RMMRow[] = [];
      for (const tb of tbRows) {
        const lineItem = tb.description || tb.accountCode || '';
        const key = lineItem.toLowerCase().trim();
        if (!lineItem || existingLineItems.has(key) || addedInBatch.has(key)) continue;
        addedInBatch.add(key);
        newRows.push({
          ...makeEmptyRow(),
          lineItem,
          lineType: 'tb_account',
          category: tb.category || null,
          amount: tb.currentYear ?? null,
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
          <button onClick={viewMode === 'fs_line' ? populateData : importFromTB} disabled={importingTB || populating}
            className="text-xs px-3 py-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100 disabled:opacity-50">
            {(importingTB || populating) ? 'Importing...' : viewMode === 'fs_line' ? '📥 Import Data' : '📥 Import from TB'}
          </button>
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
          {/* Planning Letter actions — picks template, renders .docx,
              optionally emails Informed-Management portal contacts
              and uploads to the Client Portal Documents list. */}
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setPlanningLetterMode('send')}
              title="Send the Planning Letter to Informed Management contacts + post to the Client Portal"
              className="text-xs px-3 py-1 bg-white text-blue-600 rounded-md shadow-sm font-medium hover:bg-blue-50 flex items-center gap-1"
            >📮 Send Planning Letter</button>
            <button
              onClick={() => setPlanningLetterMode('download')}
              title="Generate and download the Planning Letter .docx for this engagement"
              className="text-xs px-3 py-1 text-slate-600 rounded-md hover:bg-white hover:text-slate-900 flex items-center gap-1"
            >⬇ Download Planning Letter</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && saveFailures.length === 0 && <span className="text-xs text-green-500">Saved</span>}
          {saveFailures.length > 0 && !saving && (
            <span
              className="text-xs text-red-600 cursor-help underline decoration-dotted"
              title={saveFailures.map(f => `Row "${f.lineItem || '(unknown)'}" (id=${f.id || 'new'}): ${f.error}`).join('\n')}
            >
              {saveFailures.length} row{saveFailures.length === 1 ? '' : 's'} failed to save — hover for detail
            </span>
          )}
          {error && <span className="text-xs text-red-500">{error}</span>}
          {/* Populate buttons — show when no non-mandatory rows exist */}
          {(rows || []).filter(r => !r.isMandatory).length === 0 && (
            <button onClick={populateData} disabled={populating}
              className="text-xs px-3 py-1 bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50 font-medium">
              {populating ? 'Populating...' : `Populate Data (${viewMode === 'fs_line' ? 'FS Lines' : 'TB'})`}
            </button>
          )}
          {hasPriorYear && (rows || []).filter(r => !r.isMandatory).length === 0 && (
            <button onClick={populateFromPrevious} disabled={populating}
              className="text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 font-medium">
              {populating ? 'Populating...' : 'Populate from Previous'}
            </button>
          )}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
        </div>
      </div>

      {/* Table — max height with frozen header. `tableLayout: fixed`
          makes the <colgroup> widths authoritative so drag-to-resize
          actually moves the column edge instead of fighting with
          auto-sizing from cell content. `width: max-content` lets the
          whole table grow wider than its container when the user
          drags columns out — horizontal scroll picks up the slack. */}
      <div className="border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-280px)]">
        <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 32 }} />
            {showCategory && <col style={{ width: columnWidths.category }} />}
            <col style={{ width: columnWidths.lineItem }} />
            <col style={{ width: columnWidths.nature }} />
            <col style={{ width: columnWidths.amount }} />
            <col style={{ width: columnWidths.assertions }} />
            <col style={{ width: columnWidths.relevance }} />
            <col style={{ width: columnWidths.inherentRisk }} />
            <col style={{ width: columnWidths.riskSummation }} />
            <col style={{ width: columnWidths.likelihood }} />
            <col style={{ width: columnWidths.magnitude }} />
            <col style={{ width: columnWidths.finalRisk }} />
            <col style={{ width: columnWidths.controlRisk }} />
            <col style={{ width: columnWidths.overall }} />
            <col style={{ width: columnWidths.sigRisk }} />
            <col style={{ width: columnWidths.notes }} />
            <col style={{ width: columnWidths.signOffs }} />
            <col style={{ width: 24 }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="px-1 py-2"></th>
              {showCategory && (
                <ResizableTh colKey="category" widths={columnWidths} onResizeStart={startColumnResize} align="left">
                  Category
                </ResizableTh>
              )}
              <ResizableTh colKey="lineItem" widths={columnWidths} onResizeStart={startColumnResize} align="left">
                {viewMode === 'fs_line' ? 'FS Line Item' : 'TB Account'}
              </ResizableTh>
              <ResizableTh colKey="nature" widths={columnWidths} onResizeStart={startColumnResize} align="left">Nature</ResizableTh>
              <ResizableTh colKey="amount" widths={columnWidths} onResizeStart={startColumnResize} align="right">Amount</ResizableTh>
              <ResizableTh colKey="assertions" widths={columnWidths} onResizeStart={startColumnResize} align="center">Assertions</ResizableTh>
              <ResizableTh colKey="relevance" widths={columnWidths} onResizeStart={startColumnResize} align="center" title="Relevant?">
                Rel. <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span>
              </ResizableTh>
              <ResizableTh colKey="inherentRisk" widths={columnWidths} onResizeStart={startColumnResize} align="center" title="Inherent Risk">
                IR <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span>
              </ResizableTh>
              <ResizableTh colKey="riskSummation" widths={columnWidths} onResizeStart={startColumnResize} align="left">Risk Summation</ResizableTh>
              <ResizableTh colKey="likelihood" widths={columnWidths} onResizeStart={startColumnResize} align="center">Likelihood</ResizableTh>
              <ResizableTh colKey="magnitude" widths={columnWidths} onResizeStart={startColumnResize} align="center">Magnitude</ResizableTh>
              <ResizableTh colKey="finalRisk" widths={columnWidths} onResizeStart={startColumnResize} align="center">Final Risk</ResizableTh>
              <ResizableTh colKey="controlRisk" widths={columnWidths} onResizeStart={startColumnResize} align="center">Control Risk</ResizableTh>
              <ResizableTh colKey="overall" widths={columnWidths} onResizeStart={startColumnResize} align="center">Overall</ResizableTh>
              <ResizableTh colKey="sigRisk" widths={columnWidths} onResizeStart={startColumnResize} align="center" title="Significant Risk">
                Sig.Risk <span className="inline-block w-3 h-3 text-[8px] rounded-full bg-slate-200 text-slate-500 leading-3 cursor-help">?</span>
              </ResizableTh>
              <ResizableTh colKey="notes" widths={columnWidths} onResizeStart={startColumnResize} align="left">Notes</ResizableTh>
              <ResizableTh colKey="signOffs" widths={columnWidths} onResizeStart={startColumnResize} align="center">
                <div className="flex gap-2 justify-center">
                  <span className="text-[7px]">Reviewer</span>
                  <span className="text-[7px]">Partner</span>
                </div>
              </ResizableTh>
              <th></th>
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
              const isPar = row.source === 'par';
              const isFirstPar = isPar && i === parGroupStartIndex;

              return (
                <Fragment key={rowKey}>
                  {isFirstPar && (
                    <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                      <td colSpan={30} className="px-3 py-1.5 text-[10px] font-semibold tracking-wide uppercase text-indigo-700">
                        From PAR — sent via Send to RMM ({computedRows.length - parGroupStartIndex})
                      </td>
                    </tr>
                  )}
                  <tr
                    data-scroll-anchor={row.id ? `rmm-${row.id}` : undefined}
                    className={`border-b border-slate-100 hover:bg-slate-50/50 ${row.isMandatory ? 'bg-amber-50/20' : ''} ${isPar ? 'bg-indigo-50/40' : ''} ${outline}`}
                  >
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
                      {(() => {
                        const options = row.lineItem ? getNatureOptions(row.lineItem) : null;
                        if (options && options.length > 0) {
                          return (
                            <select
                              value={row.riskIdentified || ''}
                              onChange={e => updateRow(i, 'riskIdentified', e.target.value)}
                              className="w-full border border-slate-200 bg-white text-xs rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                            >
                              <option value="">Select...</option>
                              {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              {/* Allow current value even if not in list */}
                              {row.riskIdentified && !options.includes(row.riskIdentified) && (
                                <option value={row.riskIdentified}>{row.riskIdentified}</option>
                              )}
                            </select>
                          );
                        }
                        return (
                          <AutoTextarea value={row.riskIdentified || ''} onChange={v => updateRow(i, 'riskIdentified', v)}
                            className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" />
                        );
                      })()}
                    </td>
                    {(() => {
                      // Shade the Amount cell grey when the row's
                      // absolute amount is below performance materiality
                      // — i.e. this FS line on its own wouldn't move
                      // the audit's materiality threshold. Helps the
                      // reviewer spot de-minimis items at a glance.
                      // Mandatory rows keep their own slate-100 shade
                      // (takes precedence); untouched rows (no amount
                      // OR PM not configured) render as normal.
                      const n = row.amount != null ? Number(row.amount) : NaN;
                      const belowPm = Number.isFinite(n)
                        && performanceMateriality > 0
                        && Math.abs(n) < performanceMateriality;
                      const bgClass = row.isMandatory
                        ? 'bg-slate-100'
                        : belowPm ? 'bg-slate-100/70' : '';
                      return (
                        <td
                          className={`px-2 py-1 align-top ${bgClass}`}
                          title={belowPm
                            ? `Below performance materiality (£${performanceMateriality.toLocaleString('en-GB', { minimumFractionDigits: 2 })})`
                            : undefined}
                        >
                          {row.isMandatory ? (
                            <span className="text-xs text-slate-300 px-1">—</span>
                          ) : (
                            <span className="text-xs text-right block px-1 py-0.5 text-slate-700">
                              {row.amount != null ? (() => { const nn = Number(row.amount); return isNaN(nn) ? '' : `£${Math.abs(nn).toLocaleString('en-GB', { minimumFractionDigits: 2 })}${nn < 0 ? ' Cr' : ' Dr'}`; })() : ''}
                            </span>
                          )}
                        </td>
                      );
                    })()}
                    <td className="px-2 py-1 align-top">
                      <div className="flex flex-wrap gap-0.5 justify-center">
                        {applicableAssertionsFor(row).map(a => {
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
                    {/* Risk Classification */}
                    <td className="px-1 py-1 text-center align-top">
                      {(() => {
                        if (!row.overallRisk) return null;
                        const classification = riskClassificationTable?.[row.overallRisk]
                          || (row.overallRisk === 'High' || row.overallRisk === 'Very High' ? 'Significant Risk'
                            : row.overallRisk === 'Medium' ? 'Area of Focus' : null);
                        if (classification === 'Significant Risk') return <span className="inline-block w-3 h-3 rounded-full bg-red-500 cursor-help" title="Significant Risk" />;
                        if (classification === 'Area of Focus') return <span className="inline-block w-3 h-3 rounded-full bg-orange-400 cursor-help" title="Area of Focus" />;
                        return null;
                      })()}
                    </td>
                    {/* Notes — free text */}
                    <td className="px-2 py-1 align-top">
                      <AutoTextarea value={(row as any).notes || ''} onChange={v => updateRow(i, 'notes' as any, v)}
                        className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" placeholder="Notes..." />
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
                        {/* Planning Letter category banner removed — the Sig.Risk dot column
                            already conveys this. rowCategory is still derived in state via
                            the auto-derive effect so the Planning Letter template still works. */}
                        <div className="grid grid-cols-5 gap-3">
                          {INHERENT_RISK_COMPONENTS.map(comp => {
                            const textKey = `${comp.key}Text` as keyof RMMRow;
                            const textVal = (row[textKey] as string) || '';
                            // Per-component IR level lives in irLevels (not on the row), so
                            // the 5 dropdowns are independent of each other and of the legacy
                            // single inherentRiskLevel field.
                            const compLevel = irLevels[row.id]?.[comp.key] || '';
                            return (
                              <div key={comp.key} className="space-y-1">
                                <label className="block text-[10px] font-medium text-slate-600">{comp.label}</label>
                                <textarea value={textVal} onChange={e => updateRow(i, textKey, e.target.value)}
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs min-h-[50px] resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder={`${comp.label} assessment...`} />
                                <select value={compLevel} onChange={e => updateIrLevel(row.id, comp.key, e.target.value)}
                                  className={`w-full border border-slate-200 rounded px-1 py-0.5 text-xs ${inherentRiskDropdownColor(compLevel)}`}>
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

      {/* Planning Letter modal — rendered at document root so it
          portals over the table without layout interference. */}
      {planningLetterMode && (
        <PlanningLetterModal
          mode={planningLetterMode}
          engagementId={engagementId}
          onClose={() => setPlanningLetterMode(null)}
        />
      )}
    </div>
  );
}
