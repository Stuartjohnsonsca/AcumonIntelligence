'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Save, Loader2, Plus, Trash2, Check, AlertTriangle, ChevronDown, ChevronRight, Calculator } from 'lucide-react';
import {
  calculatePeriodCharge,
  emptyDepreciationParams,
  chargeNoun,
  type DepreciationMethod,
  type DepreciationParams,
  type RoughAdjustment,
  type AssetClass,
} from '@/lib/depreciation-calc';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FarCategory {
  id: string;
  name: string;
  order: number;
  linkedTbRowIds: string[];
  /** Per-category depreciation / amortisation policy. Optional for
   *  back-compat with categories saved before the parameters section
   *  was added — the UI falls back to emptyDepreciationParams(). */
  depreciation?: DepreciationParams;
  /** Mid-period acquisitions / disposals captured for time-apportioned
   *  charge calculation. Empty array by default. */
  roughAdjustments?: RoughAdjustment[];
}

interface CategorySchedule {
  costOpening: number;
  costAdditions: number;
  costTransfers: number;
  costRevaluation: number;
  costDisposals: number;
  depOpening: number;
  depChargeForYear: number;
  depImpairment: number;
  depTransfers: number;
  depDisposals: number;
}

interface TBRow {
  id: string;
  accountCode: string;
  description: string;
  currentYear: number | null;
  priorYear: number | null;
  fsLevel: string | null;
  fsNoteLevel: string | null;
  fsStatement: string | null;
  farSchedule: any;
}

interface Props {
  engagementId: string;
  onClose: () => void;
  /** Which surface launched the popup:
   *    'tbcyvpy'   — Trial Balance launcher; hides the Calculated Value
   *                  comparison block but shows the new params + rough
   *                  adjustments so the data is still captured.
   *    'fieldwork' — Fieldwork tab launcher (calculator button on a
   *                  Tangible / Intangible FS-line drilldown); shows
   *                  everything including the calculated-vs-booked
   *                  variance check against the P&L charge.
   *  Default 'tbcyvpy' so existing call sites keep their old behaviour. */
  mode?: 'tbcyvpy' | 'fieldwork';
  /** When launched from Fieldwork, lock the popup to a single asset
   *  class so the vocabulary (Depreciation vs Amortisation) reads
   *  cleanly. Falls back to the engagement-saved scope (which can be
   *  'both') when omitted. */
  assetClass?: AssetClass;
  /** Period start/end ISO dates for time-apportionment of mid-period
   *  acquisitions/disposals. Caller normally has these in scope;
   *  defaults to today − 365 / today when missing, which is fine for
   *  a quick capture but the calculator works best with the real
   *  engagement dates. */
  periodStart?: string;
  periodEnd?: string;
}

const EMPTY_SCHEDULE: CategorySchedule = {
  costOpening: 0, costAdditions: 0, costTransfers: 0, costRevaluation: 0, costDisposals: 0,
  depOpening: 0, depChargeForYear: 0, depImpairment: 0, depTransfers: 0, depDisposals: 0,
};

const COST_ROWS = [
  { key: 'costOpening', label: 'Opening Balance', formula: false },
  { key: 'costAdditions', label: 'Additions', formula: false },
  { key: 'costTransfers', label: 'Transfers', formula: false },
  { key: 'costRevaluation', label: 'Revaluation', formula: false },
  { key: 'costDisposals', label: 'Disposals', formula: false },
  { key: 'costClosing', label: 'Closing Balance', formula: true },
] as const;

const DEP_ROWS = [
  { key: 'depOpening', label: 'Opening Balance', formula: false },
  { key: 'depChargeForYear', label: 'Charge for Year', formula: false },
  { key: 'depImpairment', label: 'Impairment', formula: false },
  { key: 'depTransfers', label: 'Transfers', formula: false },
  { key: 'depDisposals', label: 'Disposals', formula: false },
  { key: 'depClosing', label: 'Closing Balance', formula: true },
] as const;

let counter = 0;
function catId() { return `far_${Date.now()}_${++counter}`; }

function f(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function FixedAssetRegisterPopup({
  engagementId,
  onClose,
  mode = 'tbcyvpy',
  assetClass,
  periodStart,
  periodEnd,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetType, setAssetType] = useState<'cost' | 'valuation'>('cost');
  const [scope, setScope] = useState<'tangible' | 'intangible' | 'both'>(assetClass || 'both');
  const [categories, setCategories] = useState<FarCategory[]>([]);
  const [data, setData] = useState<Record<string, CategorySchedule>>({});
  const [allTbRows, setAllTbRows] = useState<TBRow[]>([]);
  const [assetTbRows, setAssetTbRows] = useState<TBRow[]>([]);
  const [linkingCatId, setLinkingCatId] = useState<string | null>(null);
  // Collapse state for the two new bottom sections.
  const [paramsOpen, setParamsOpen] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  // Auto-derived ISO period dates with sensible fallbacks. Used to pro-
  // rate mid-period rough adjustments — if the caller didn't supply
  // them we fall back to a rolling 365-day window ending today, which
  // produces sane numbers for quick captures.
  const effectivePeriodEnd = periodEnd || new Date().toISOString().slice(0, 10);
  const effectivePeriodStart = periodStart || new Date(Date.parse(effectivePeriodEnd) - 365 * 86_400_000).toISOString().slice(0, 10);
  // Vocabulary — "Depreciation" / "Amortisation" / joint label.
  // Reads from the SCOPE state (which the caller seeds via assetClass
  // on first load) so the auditor's manual override via the header
  // toggle actually takes effect — earlier the prop was hard-wired
  // here and the toggle was a no-op for fieldwork launches.
  const effectiveClass: AssetClass = scope;
  const noun = chargeNoun(effectiveClass);

  // Load FAR data
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/far`);
        if (!res.ok) { setLoading(false); return; }
        const json = await res.json();
        setAllTbRows(json.allRows || []);
        setAssetTbRows(json.assetRows || []);

        if (json.config?.farEnabled) {
          setAssetType(json.config.farAssetType || 'cost');
          // Caller-supplied assetClass wins over the persisted scope
          // (so a Fieldwork Tangible launch always reads as Tangible
          // regardless of how the engagement was saved historically).
          setScope(assetClass || json.config.farScope || 'both');
          const cats = (json.config.farCategories || []) as FarCategory[];
          // Defensive hydration: categories saved before the new
          // depreciation / roughAdjustments fields existed simply have
          // them undefined — fill in empties so every render path can
          // read them without null checks.
          setCategories(cats.map(c => ({
            ...c,
            depreciation: c.depreciation || emptyDepreciationParams(),
            roughAdjustments: Array.isArray(c.roughAdjustments) ? c.roughAdjustments : [],
          })));

          // Rebuild data from TB rows with farSchedule
          const d: Record<string, CategorySchedule> = {};
          for (const cat of cats) {
            // Find first TB row with farSchedule for this category
            const linked = (json.assetRows || []).find((r: TBRow) => r.farSchedule?.farCategoryId === cat.id);
            if (linked?.farSchedule) {
              const s = linked.farSchedule;
              d[cat.id] = {
                costOpening: s.costOpening || 0, costAdditions: s.costAdditions || 0,
                costTransfers: s.costTransfers || 0, costRevaluation: s.costRevaluation || 0,
                costDisposals: s.costDisposals || 0,
                depOpening: s.depOpening || 0, depChargeForYear: s.depChargeForYear || 0,
                depImpairment: s.depImpairment || 0, depTransfers: s.depTransfers || 0,
                depDisposals: s.depDisposals || 0,
              };
            } else {
              d[cat.id] = { ...EMPTY_SCHEDULE };
            }
          }
          setData(d);
        }
      } catch (err) {
        console.error('Failed to load FAR data:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [engagementId]);

  // ─── Computed Values ────────────────────────────────────────────────────

  const computeClosing = useCallback((s: CategorySchedule) => {
    const costClosing = s.costOpening + s.costAdditions + s.costTransfers + s.costRevaluation + s.costDisposals;
    const depClosing = s.depOpening + s.depChargeForYear + s.depImpairment + s.depTransfers + s.depDisposals;
    const nbv = costClosing + depClosing; // depClosing is negative
    return { costClosing, depClosing, nbv };
  }, []);

  const totals = useMemo(() => {
    const t = { ...EMPTY_SCHEDULE };
    for (const cat of categories) {
      const s = data[cat.id] || EMPTY_SCHEDULE;
      for (const k of Object.keys(EMPTY_SCHEDULE) as (keyof CategorySchedule)[]) {
        t[k] += s[k];
      }
    }
    return t;
  }, [categories, data]);

  const totalClosing = useMemo(() => computeClosing(totals), [totals, computeClosing]);

  // ─── Reconciliation ─────────────────────────────────────────────────────

  const reconciliation = useMemo(() => {
    return categories.map(cat => {
      const s = data[cat.id] || EMPTY_SCHEDULE;
      const { nbv } = computeClosing(s);
      const tbBalance = cat.linkedTbRowIds.reduce((sum, rowId) => {
        const row = allTbRows.find(r => r.id === rowId);
        return sum + (Number(row?.currentYear) || 0);
      }, 0);
      return { catId: cat.id, catName: cat.name, farNbv: nbv, tbBalance, variance: nbv - tbBalance };
    });
  }, [categories, data, allTbRows, computeClosing]);

  // ─── Calculated charge per category vs the booked depreciation /
  //     amortisation charge taken from the TB P&L. Drives the
  //     "Calculated Value" comparison block — Fieldwork mode only. ──
  const tbPnlChargeTotal = useMemo(() => {
    // Sum the absolute value of every TB row whose fsLevel /
    // fsNoteLevel hints at a depreciation or amortisation line. The
    // sign convention varies across firms (some carry positive, some
    // negative) so we abs() then attribute as a charge.
    let total = 0;
    const re = /depreciat|amortis/i;
    for (const r of allTbRows) {
      const tag = `${r.fsLevel || ''} ${r.fsNoteLevel || ''}`;
      if (!re.test(tag)) continue;
      const v = Number(r.currentYear);
      if (isFinite(v)) total += Math.abs(v);
    }
    return total;
  }, [allTbRows]);

  const calculatedCharges = useMemo(() => {
    return categories.map(cat => {
      const s = data[cat.id] || EMPTY_SCHEDULE;
      const params = cat.depreciation || emptyDepreciationParams();
      const adj = Array.isArray(cat.roughAdjustments) ? cat.roughAdjustments : [];
      const result = calculatePeriodCharge({
        params,
        costOpening: s.costOpening,
        costAdditionsAtPeriodEnd: s.costAdditions + s.costTransfers + s.costRevaluation,
        costDisposalsAtPeriodEnd: Math.abs(s.costDisposals),
        accumulatedDepreciationOpening: s.depOpening,
        roughAdjustments: adj,
        periodStart: effectivePeriodStart,
        periodEnd: effectivePeriodEnd,
      });
      // The booked charge for THIS category is the user-entered value
      // in the popup grid. Compared against the calculator expectation
      // for a "have you booked the right amount?" check, separate from
      // the TB-wide total which catches missed or duplicated charges.
      const bookedChargeForCategory = Math.abs(s.depChargeForYear);
      return {
        catId: cat.id,
        catName: cat.name,
        calculated: result.calculatedCharge,
        booked: bookedChargeForCategory,
        variance: bookedChargeForCategory - result.calculatedCharge,
        notes: result.notes,
      };
    });
  }, [categories, data, effectivePeriodStart, effectivePeriodEnd]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const addCategory = () => {
    const id = catId();
    setCategories(prev => [...prev, {
      id,
      name: 'New Category',
      order: prev.length,
      linkedTbRowIds: [],
      depreciation: emptyDepreciationParams(),
      roughAdjustments: [],
    }]);
    setData(prev => ({ ...prev, [id]: { ...EMPTY_SCHEDULE } }));
  };

  // ─── Depreciation / Amortisation parameter helpers ─────────────────────
  const updateDepreciation = (id: string, patch: Partial<DepreciationParams>) => {
    setCategories(prev => prev.map(c => {
      if (c.id !== id) return c;
      const current = c.depreciation || emptyDepreciationParams();
      return { ...c, depreciation: { ...current, ...patch } };
    }));
  };

  // ─── Rough adjustment helpers ──────────────────────────────────────────
  let adjCounter = 0;
  const newAdjId = () => `adj_${Date.now()}_${++adjCounter}`;
  const addAdjustment = (catId: string, kind: 'acquisition' | 'disposal' = 'acquisition') => {
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const list = Array.isArray(c.roughAdjustments) ? c.roughAdjustments : [];
      return { ...c, roughAdjustments: [...list, { id: newAdjId(), kind, amount: 0, date: effectivePeriodEnd }] };
    }));
  };
  const updateAdjustment = (catId: string, adjId: string, patch: Partial<RoughAdjustment>) => {
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const list = Array.isArray(c.roughAdjustments) ? c.roughAdjustments : [];
      return { ...c, roughAdjustments: list.map(a => a.id === adjId ? { ...a, ...patch } : a) };
    }));
  };
  const removeAdjustment = (catId: string, adjId: string) => {
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const list = Array.isArray(c.roughAdjustments) ? c.roughAdjustments : [];
      return { ...c, roughAdjustments: list.filter(a => a.id !== adjId) };
    }));
  };
  /** Paste handler — accepts tab/comma/newline-separated rows in the
   *  shape: kind\tamount\tdate\tnote (note optional). 'A' / '+' /
   *  'acquisition' map to acquisition; 'D' / '-' / 'disposal' to
   *  disposal. Invalid rows are silently skipped so a partial paste
   *  still imports the good rows. */
  const handleAdjustmentPaste = (catId: string, text: string) => {
    const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    if (rows.length === 0) return;
    const added: RoughAdjustment[] = [];
    for (const r of rows) {
      const cells = r.split(/\t|,/).map(c => c.trim());
      if (cells.length < 2) continue;
      // Heuristic: if first cell parses as a number, assume the row
      // omitted the kind and treat as acquisition. Otherwise first
      // cell is the kind marker.
      let kind: 'acquisition' | 'disposal' = 'acquisition';
      let amountIdx = 0;
      let dateIdx = 1;
      const firstAsNum = Number(cells[0].replace(/[£,\s]/g, ''));
      if (!isFinite(firstAsNum) || cells[0].match(/[a-zA-Z+\-]/)) {
        const k = cells[0].toLowerCase();
        if (k.startsWith('d') || k.startsWith('-')) kind = 'disposal';
        amountIdx = 1;
        dateIdx = 2;
      }
      const amount = Number((cells[amountIdx] || '').replace(/[£,\s]/g, ''));
      const rawDate = (cells[dateIdx] || '').trim();
      // Accept YYYY-MM-DD or DD/MM/YYYY.
      let iso = '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) iso = rawDate;
      else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(rawDate)) {
        const [d, m, y] = rawDate.split(/[\/\-]/);
        iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      if (!isFinite(amount) || amount === 0 || !iso) continue;
      const note = cells[dateIdx + 1] ? cells[dateIdx + 1] : undefined;
      added.push({ id: newAdjId(), kind, amount: Math.abs(amount), date: iso, note });
    }
    if (added.length === 0) return;
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const list = Array.isArray(c.roughAdjustments) ? c.roughAdjustments : [];
      return { ...c, roughAdjustments: [...list, ...added] };
    }));
  };

  const removeCategory = (id: string) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    setData(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const updateCategoryName = (id: string, name: string) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name } : c));
  };

  const updateCell = (catId: string, key: keyof CategorySchedule, value: number) => {
    setData(prev => ({
      ...prev,
      [catId]: { ...(prev[catId] || EMPTY_SCHEDULE), [key]: value },
    }));
  };

  const toggleTbRowLink = (catId: string, tbRowId: string) => {
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const linked = c.linkedTbRowIds.includes(tbRowId)
        ? c.linkedTbRowIds.filter(id => id !== tbRowId)
        : [...c.linkedTbRowIds, tbRowId];
      return { ...c, linkedTbRowIds: linked };
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/engagements/${engagementId}/far`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farEnabled: true,
          farAssetType: assetType,
          farScope: scope,
          farCategories: categories,
          categoryData: data,
        }),
      });
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 z-[70] bg-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    );
  }

  const costLabel = assetType === 'cost' ? 'COST' : 'VALUATION';
  const colCount = categories.length + 2; // description + categories + total

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-slate-50 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Fixed Asset Register</h2>
        </div>
        <div className="flex items-center gap-3">
          {/* Asset Type toggle */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-500 font-medium">Type:</span>
            <button onClick={() => setAssetType('cost')} className={`px-2 py-0.5 rounded-l border text-[10px] font-medium ${assetType === 'cost' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Cost</button>
            <button onClick={() => setAssetType('valuation')} className={`px-2 py-0.5 rounded-r border-t border-r border-b text-[10px] font-medium ${assetType === 'valuation' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Valuation</button>
          </div>

          {/* Scope toggle */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-500 font-medium">Scope:</span>
            {(['tangible', 'intangible', 'both'] as const).map(s => (
              <button key={s} onClick={() => setScope(s)} className={`px-2 py-0.5 text-[10px] font-medium border ${s === 'tangible' ? 'rounded-l' : s === 'both' ? 'rounded-r border-t border-r border-b' : 'border-t border-r border-b'} ${scope === s ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                {s === 'tangible' ? 'Tangible' : s === 'intangible' ? 'Intangible' : 'Both'}
              </button>
            ))}
          </div>

          <button onClick={addCategory} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 font-medium">
            <Plus className="h-3 w-3" /> Add Category
          </button>

          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {categories.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400 text-sm mb-3">No asset categories yet.</p>
            <button onClick={addCategory} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 font-medium">
              <Plus className="h-3.5 w-3.5" /> Add First Category
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              {/* Column Headers */}
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-left px-3 py-2 text-slate-600 font-semibold w-44 border border-slate-200">Description</th>
                  {categories.map(cat => {
                    const { nbv } = computeClosing(data[cat.id] || EMPTY_SCHEDULE);
                    const canDelete = nbv === 0;
                    return (
                      <th key={cat.id} className="px-2 py-1 border border-slate-200 min-w-[120px]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={cat.name}
                            onChange={e => updateCategoryName(cat.id, e.target.value)}
                            className="flex-1 text-center text-xs font-semibold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none px-1 py-0.5"
                          />
                          <button
                            onClick={() => canDelete && removeCategory(cat.id)}
                            disabled={!canDelete}
                            title={canDelete ? 'Delete category' : 'Cannot delete — NBV is not nil'}
                            className={`p-0.5 rounded ${canDelete ? 'text-red-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-200 cursor-not-allowed'}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-center text-slate-600 font-semibold border border-slate-200 min-w-[100px]">Total</th>
                </tr>
              </thead>
              <tbody>
                {/* ── COST / VALUATION section ── */}
                <tr className="bg-blue-50">
                  <td colSpan={colCount} className="px-3 py-1.5 text-[10px] font-bold text-blue-800 uppercase tracking-wider border border-slate-200">
                    {costLabel}
                  </td>
                </tr>
                {COST_ROWS.map(row => {
                  const isFormula = row.formula;
                  return (
                    <tr key={row.key} className={isFormula ? 'bg-blue-50/30' : 'bg-white'}>
                      <td className={`px-3 py-1 border border-slate-200 text-slate-600 ${isFormula ? 'font-bold' : ''}`}>{row.label}</td>
                      {categories.map(cat => {
                        const s = data[cat.id] || EMPTY_SCHEDULE;
                        const val = isFormula
                          ? computeClosing(s).costClosing
                          : s[row.key as keyof CategorySchedule];
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200 text-right">
                            {isFormula ? (
                              <span className="font-mono font-bold text-slate-800 px-2">{f(val)}</span>
                            ) : (
                              <input
                                type="number"
                                value={val || ''}
                                onChange={e => updateCell(cat.id, row.key as keyof CategorySchedule, Number(e.target.value) || 0)}
                                className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none"
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 border border-slate-200 text-right font-mono font-semibold text-slate-700">
                        {f(isFormula
                          ? totalClosing.costClosing
                          : categories.reduce((sum, cat) => sum + ((data[cat.id] || EMPTY_SCHEDULE)[row.key as keyof CategorySchedule] || 0), 0)
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* ── ACCUMULATED DEPRECIATION section ── */}
                <tr className="bg-amber-50">
                  <td colSpan={colCount} className="px-3 py-1.5 text-[10px] font-bold text-amber-800 uppercase tracking-wider border border-slate-200">
                    Accumulated Depreciation
                  </td>
                </tr>
                {DEP_ROWS.map(row => {
                  const isFormula = row.formula;
                  return (
                    <tr key={row.key} className={isFormula ? 'bg-amber-50/30' : 'bg-white'}>
                      <td className={`px-3 py-1 border border-slate-200 text-slate-600 ${isFormula ? 'font-bold' : ''}`}>{row.label}</td>
                      {categories.map(cat => {
                        const s = data[cat.id] || EMPTY_SCHEDULE;
                        const val = isFormula
                          ? computeClosing(s).depClosing
                          : s[row.key as keyof CategorySchedule];
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200 text-right">
                            {isFormula ? (
                              <span className="font-mono font-bold text-slate-800 px-2">{f(val)}</span>
                            ) : (
                              <input
                                type="number"
                                value={val || ''}
                                onChange={e => updateCell(cat.id, row.key as keyof CategorySchedule, Number(e.target.value) || 0)}
                                className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-amber-50 focus:outline-none"
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 border border-slate-200 text-right font-mono font-semibold text-slate-700">
                        {f(isFormula
                          ? totalClosing.depClosing
                          : categories.reduce((sum, cat) => sum + ((data[cat.id] || EMPTY_SCHEDULE)[row.key as keyof CategorySchedule] || 0), 0)
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* ── NET BOOK VALUE ── */}
                <tr className="bg-green-50 border-t-2 border-green-300">
                  <td className="px-3 py-2 border border-slate-200 font-bold text-green-800">Net Book Value</td>
                  {categories.map(cat => {
                    const { nbv } = computeClosing(data[cat.id] || EMPTY_SCHEDULE);
                    return (
                      <td key={cat.id} className="px-2 py-2 border border-slate-200 text-right font-mono font-bold text-green-800">
                        {f(nbv)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 border border-slate-200 text-right font-mono font-bold text-green-800">
                    {f(totalClosing.nbv)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Reconciliation to TB ── */}
        {categories.length > 0 && (
          <div className="mt-8">
            <h3 className="text-xs font-bold text-slate-700 mb-3">Reconciliation to Trial Balance</h3>

            {/* TB Row Linking */}
            <div className="mb-4 space-y-2">
              {categories.map(cat => (
                <div key={cat.id} className="flex items-start gap-3 text-[11px]">
                  <span className="w-32 shrink-0 font-medium text-slate-600 pt-1">{cat.name}</span>
                  <div className="flex-1">
                    <button
                      onClick={() => setLinkingCatId(linkingCatId === cat.id ? null : cat.id)}
                      className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                    >
                      {cat.linkedTbRowIds.length === 0 ? 'Link TB rows...' : `${cat.linkedTbRowIds.length} TB row(s) linked — edit`}
                    </button>
                    {linkingCatId === cat.id && (
                      <div className="mt-1 border rounded-lg bg-white max-h-48 overflow-y-auto">
                        {assetTbRows.map(row => {
                          const isLinked = cat.linkedTbRowIds.includes(row.id);
                          const linkedElsewhere = !isLinked && categories.some(c => c.id !== cat.id && c.linkedTbRowIds.includes(row.id));
                          return (
                            <label
                              key={row.id}
                              className={`flex items-center gap-2 px-2 py-1 border-b border-slate-50 cursor-pointer hover:bg-blue-50/50 ${linkedElsewhere ? 'opacity-40' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isLinked}
                                disabled={linkedElsewhere}
                                onChange={() => toggleTbRowLink(cat.id, row.id)}
                                className="w-3 h-3 rounded border-slate-300"
                              />
                              <span className="font-mono text-slate-400 w-16">{row.accountCode}</span>
                              <span className="flex-1 text-slate-600 truncate">{row.description}</span>
                              <span className="font-mono text-slate-500 w-20 text-right">{f(Number(row.currentYear) || 0)}</span>
                              {row.fsLevel && <span className="text-[9px] px-1 py-0 bg-slate-100 text-slate-400 rounded">{row.fsLevel}</span>}
                            </label>
                          );
                        })}
                        {assetTbRows.length === 0 && (
                          <div className="px-3 py-2 text-slate-400 text-[10px]">No fixed asset TB rows found. All TB rows available below.</div>
                        )}
                        {/* Show all rows if needed */}
                        {assetTbRows.length === 0 && allTbRows.filter(r => r.fsStatement === 'Balance Sheet').map(row => {
                          const isLinked = cat.linkedTbRowIds.includes(row.id);
                          const linkedElsewhere = !isLinked && categories.some(c => c.id !== cat.id && c.linkedTbRowIds.includes(row.id));
                          return (
                            <label
                              key={row.id}
                              className={`flex items-center gap-2 px-2 py-1 border-b border-slate-50 cursor-pointer hover:bg-blue-50/50 ${linkedElsewhere ? 'opacity-40' : ''}`}
                            >
                              <input type="checkbox" checked={isLinked} disabled={linkedElsewhere} onChange={() => toggleTbRowLink(cat.id, row.id)} className="w-3 h-3 rounded border-slate-300" />
                              <span className="font-mono text-slate-400 w-16">{row.accountCode}</span>
                              <span className="flex-1 text-slate-600 truncate">{row.description}</span>
                              <span className="font-mono text-slate-500 w-20 text-right">{f(Number(row.currentYear) || 0)}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Reconciliation Table */}
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-left px-3 py-1.5 border border-slate-200 text-slate-600">Category</th>
                  <th className="text-right px-3 py-1.5 border border-slate-200 text-slate-600 w-28">FAR NBV</th>
                  <th className="text-right px-3 py-1.5 border border-slate-200 text-slate-600 w-28">TB Balance</th>
                  <th className="text-right px-3 py-1.5 border border-slate-200 text-slate-600 w-28">Variance</th>
                  <th className="text-center px-3 py-1.5 border border-slate-200 text-slate-600 w-16">Status</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.map(r => (
                  <tr key={r.catId} className="bg-white">
                    <td className="px-3 py-1 border border-slate-200 text-slate-700">{r.catName}</td>
                    <td className="px-3 py-1 border border-slate-200 text-right font-mono">{f(r.farNbv)}</td>
                    <td className="px-3 py-1 border border-slate-200 text-right font-mono">{f(r.tbBalance)}</td>
                    <td className={`px-3 py-1 border border-slate-200 text-right font-mono font-semibold ${r.variance !== 0 ? 'text-red-600' : 'text-green-600'}`}>{f(r.variance)}</td>
                    <td className="px-3 py-1 border border-slate-200 text-center">
                      {r.variance === 0
                        ? <Check className="h-3.5 w-3.5 text-green-600 mx-auto" />
                        : <AlertTriangle className="h-3.5 w-3.5 text-red-500 mx-auto" />
                      }
                    </td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-1.5 border border-slate-200 text-slate-800">Total</td>
                  <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{f(reconciliation.reduce((s, r) => s + r.farNbv, 0))}</td>
                  <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{f(reconciliation.reduce((s, r) => s + r.tbBalance, 0))}</td>
                  {(() => {
                    const totalVar = reconciliation.reduce((s, r) => s + r.variance, 0);
                    return (
                      <>
                        <td className={`px-3 py-1.5 border border-slate-200 text-right font-mono ${totalVar !== 0 ? 'text-red-600' : 'text-green-600'}`}>{f(totalVar)}</td>
                        <td className="px-3 py-1.5 border border-slate-200 text-center">
                          {totalVar === 0 ? <Check className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                        </td>
                      </>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Depreciation / Amortisation parameters ── (per-category
            policy: method, residual, life / rate / units. Collapsible
            so the popup stays compact for firms that don't use the
            calculator yet.) */}
        {categories.length > 0 && (
          <div className="mt-8 border border-slate-200 rounded-lg bg-white">
            <button
              onClick={() => setParamsOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-t-lg"
            >
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                {paramsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {noun} Parameters
              </span>
              <span className="text-[10px] text-slate-400">{categories.length} categor{categories.length === 1 ? 'y' : 'ies'}</span>
            </button>
            {paramsOpen && (
              <div className="p-3 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="text-left px-3 py-1.5 border border-slate-200 text-slate-600 w-44">Parameter</th>
                      {categories.map(cat => (
                        <th key={cat.id} className="px-2 py-1.5 border border-slate-200 text-slate-600 min-w-[140px]">{cat.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Method */}
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">Method</td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <select
                              value={p.method}
                              onChange={e => updateDepreciation(cat.id, { method: e.target.value as DepreciationMethod })}
                              className="w-full text-[11px] border-0 bg-transparent focus:outline-none focus:bg-blue-50 px-2 py-0.5"
                            >
                              <option value="straight_line">Straight Line</option>
                              <option value="reducing_balance">Reducing Balance</option>
                              <option value="usage">Usage</option>
                              <option value="soyd">Sum-of-the-Years&apos;-Digits</option>
                              <option value="x_declining">X-Declining Balance</option>
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                    {/* Residual value */}
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">Residual Value</td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <input
                              type="number"
                              value={p.residualValue || ''}
                              onChange={e => updateDepreciation(cat.id, { residualValue: Number(e.target.value) || 0 })}
                              className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none"
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/* Useful Life — relevant for straight_line / soyd / x_declining; also a sensible default for reducing_balance */}
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">Useful Life (years)</td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <input
                              type="number"
                              value={p.usefulLifeYears ?? ''}
                              onChange={e => updateDepreciation(cat.id, { usefulLifeYears: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none"
                              disabled={p.method === 'usage'}
                              title={p.method === 'usage' ? 'Usage method uses Consumption Units / Total Units instead' : ''}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/* Annual rate — primarily for reducing_balance */}
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">Annual Rate (%) <span className="text-slate-400 text-[10px]">— optional for Reducing Balance</span></td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        const enabled = p.method === 'reducing_balance';
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <input
                              type="number"
                              value={p.annualRatePct ?? ''}
                              onChange={e => updateDepreciation(cat.id, { annualRatePct: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none disabled:opacity-40"
                              disabled={!enabled}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/* X declining factor */}
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">X Factor <span className="text-slate-400 text-[10px]">— 2 = double declining</span></td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        const enabled = p.method === 'x_declining';
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <input
                              type="number"
                              value={p.decliningFactorX ?? ''}
                              onChange={e => updateDepreciation(cat.id, { decliningFactorX: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none disabled:opacity-40"
                              disabled={!enabled}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/* Usage inputs */}
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">Consumption Units (period) <span className="text-slate-400 text-[10px]">— Usage method</span></td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        const enabled = p.method === 'usage';
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <input
                              type="number"
                              value={p.consumptionUnitsInPeriod ?? ''}
                              onChange={e => updateDepreciation(cat.id, { consumptionUnitsInPeriod: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none disabled:opacity-40"
                              disabled={!enabled}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-600">Total Units (life) <span className="text-slate-400 text-[10px]">— Usage method</span></td>
                      {categories.map(cat => {
                        const p = cat.depreciation || emptyDepreciationParams();
                        const enabled = p.method === 'usage';
                        return (
                          <td key={cat.id} className="px-1 py-0.5 border border-slate-200">
                            <input
                              type="number"
                              value={p.totalUnits ?? ''}
                              onChange={e => updateDepreciation(cat.id, { totalUnits: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full text-right text-xs font-mono px-2 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none disabled:opacity-40"
                              disabled={!enabled}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Rough adjustments — per-category list of mid-period
            acquisitions / disposals with dates. Paste-friendly: drop
            kind / amount / date tab- or comma-separated and the
            handler auto-creates rows. ── */}
        {categories.length > 0 && (
          <div className="mt-4 border border-slate-200 rounded-lg bg-white">
            <button
              onClick={() => setAdjustmentsOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-t-lg"
            >
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                {adjustmentsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Rough Adjustment for Acquisitions &amp; Disposals
              </span>
              <span className="text-[10px] text-slate-400">
                {categories.reduce((s, c) => s + (c.roughAdjustments?.length || 0), 0)} entries across all categories
              </span>
            </button>
            {adjustmentsOpen && (
              <div className="p-3 space-y-3">
                <p className="text-[10px] text-slate-500">
                  Capture acquisitions and disposals that did NOT happen on period end so the calculator can time-apportion the charge.
                  Paste rows in the format <code className="bg-slate-100 px-1 rounded">kind &middot; amount &middot; date</code> (tab or comma separated, one per line — kind = A/D or acquisition/disposal, date = YYYY-MM-DD or DD/MM/YYYY).
                </p>
                {categories.map(cat => {
                  const list = Array.isArray(cat.roughAdjustments) ? cat.roughAdjustments : [];
                  return (
                    <div key={cat.id} className="border border-slate-100 rounded p-2 bg-slate-50/40">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-700">{cat.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => addAdjustment(cat.id, 'acquisition')}
                            className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100"
                          >+ Acquisition</button>
                          <button
                            onClick={() => addAdjustment(cat.id, 'disposal')}
                            className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100"
                          >+ Disposal</button>
                        </div>
                      </div>
                      <table
                        className="w-full text-xs"
                        onPaste={e => {
                          // Only intercept when the paste contains a
                          // tab or a newline — otherwise let the focused
                          // input handle the value paste normally.
                          const text = e.clipboardData.getData('text');
                          if (!text.includes('\t') && !text.includes('\n')) return;
                          e.preventDefault();
                          handleAdjustmentPaste(cat.id, text);
                        }}
                      >
                        <thead>
                          <tr className="bg-slate-100">
                            <th className="text-left px-2 py-1 border border-slate-200 w-32">Type</th>
                            <th className="text-right px-2 py-1 border border-slate-200 w-28">Amount</th>
                            <th className="text-left px-2 py-1 border border-slate-200 w-32">Date</th>
                            <th className="text-left px-2 py-1 border border-slate-200">Note</th>
                            <th className="text-center px-2 py-1 border border-slate-200 w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.length === 0 && (
                            <tr><td colSpan={5} className="px-2 py-2 text-center text-[10px] text-slate-400 italic">No rough adjustments. Use the buttons above or paste rows.</td></tr>
                          )}
                          {list.map(adj => (
                            <tr key={adj.id} className="bg-white">
                              <td className="px-1 py-0.5 border border-slate-200">
                                <select
                                  value={adj.kind}
                                  onChange={e => updateAdjustment(cat.id, adj.id, { kind: e.target.value as 'acquisition' | 'disposal' })}
                                  className="w-full text-[11px] border-0 bg-transparent focus:outline-none px-1"
                                >
                                  <option value="acquisition">Acquisition</option>
                                  <option value="disposal">Disposal</option>
                                </select>
                              </td>
                              <td className="px-1 py-0.5 border border-slate-200">
                                <input
                                  type="number"
                                  value={adj.amount || ''}
                                  onChange={e => updateAdjustment(cat.id, adj.id, { amount: Number(e.target.value) || 0 })}
                                  className="w-full text-right text-xs font-mono px-1 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none"
                                />
                              </td>
                              <td className="px-1 py-0.5 border border-slate-200">
                                <input
                                  type="date"
                                  value={adj.date || ''}
                                  onChange={e => updateAdjustment(cat.id, adj.id, { date: e.target.value })}
                                  className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none"
                                />
                              </td>
                              <td className="px-1 py-0.5 border border-slate-200">
                                <input
                                  type="text"
                                  value={adj.note || ''}
                                  onChange={e => updateAdjustment(cat.id, adj.id, { note: e.target.value })}
                                  className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:bg-blue-50 focus:outline-none"
                                  placeholder="Optional note"
                                />
                              </td>
                              <td className="px-1 py-0.5 border border-slate-200 text-center">
                                <button
                                  onClick={() => removeAdjustment(cat.id, adj.id)}
                                  className="text-red-400 hover:text-red-600 p-0.5"
                                  title="Remove this row"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Calculated Value vs P&L — Fieldwork mode only ── */}
        {mode === 'fieldwork' && categories.length > 0 && (
          <div className="mt-4 border border-indigo-200 rounded-lg bg-indigo-50/30">
            <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 rounded-t-lg">
              <span className="text-xs font-semibold text-indigo-800 flex items-center gap-1.5">
                <Calculator className="h-3.5 w-3.5" />
                Calculated {noun} vs P&amp;L
              </span>
              <span className="text-[10px] text-indigo-500">
                P&amp;L total from TB: <span className="font-mono font-semibold">{f(tbPnlChargeTotal)}</span>
              </span>
            </div>
            <div className="p-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-white">
                    <th className="text-left px-3 py-1.5 border border-slate-200 text-slate-600">Category</th>
                    <th className="text-right px-3 py-1.5 border border-slate-200 text-slate-600 w-28">Calculated</th>
                    <th className="text-right px-3 py-1.5 border border-slate-200 text-slate-600 w-28">Booked (grid)</th>
                    <th className="text-right px-3 py-1.5 border border-slate-200 text-slate-600 w-28">Variance</th>
                    <th className="text-center px-3 py-1.5 border border-slate-200 text-slate-600 w-16">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatedCharges.map(r => (
                    <tr key={r.catId} className="bg-white">
                      <td className="px-3 py-1 border border-slate-200 text-slate-700">
                        {r.catName}
                        {r.notes.length > 0 && (
                          <span className="ml-1 text-[9px] text-amber-600" title={r.notes.join('\n')}>(notes)</span>
                        )}
                      </td>
                      <td className="px-3 py-1 border border-slate-200 text-right font-mono">{f(r.calculated)}</td>
                      <td className="px-3 py-1 border border-slate-200 text-right font-mono">{f(r.booked)}</td>
                      <td className={`px-3 py-1 border border-slate-200 text-right font-mono font-semibold ${Math.abs(r.variance) > 1 ? 'text-red-600' : 'text-green-600'}`}>{f(r.variance)}</td>
                      <td className="px-3 py-1 border border-slate-200 text-center">
                        {Math.abs(r.variance) <= 1
                          ? <Check className="h-3.5 w-3.5 text-green-600 mx-auto" />
                          : <AlertTriangle className="h-3.5 w-3.5 text-red-500 mx-auto" />
                        }
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-1.5 border border-slate-200 text-slate-800">Total — calculated vs booked (grid)</td>
                    {(() => {
                      const totalCalc = calculatedCharges.reduce((s, r) => s + r.calculated, 0);
                      const totalBooked = calculatedCharges.reduce((s, r) => s + r.booked, 0);
                      const variance = totalBooked - totalCalc;
                      return (
                        <>
                          <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{f(totalCalc)}</td>
                          <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{f(totalBooked)}</td>
                          <td className={`px-3 py-1.5 border border-slate-200 text-right font-mono ${Math.abs(variance) > 1 ? 'text-red-600' : 'text-green-600'}`}>{f(variance)}</td>
                          <td className="px-3 py-1.5 border border-slate-200 text-center">
                            {Math.abs(variance) <= 1 ? <Check className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                          </td>
                        </>
                      );
                    })()}
                  </tr>
                  {/* TB P&L comparison row */}
                  {(() => {
                    const totalCalc = calculatedCharges.reduce((s, r) => s + r.calculated, 0);
                    const tbVariance = tbPnlChargeTotal - totalCalc;
                    return (
                      <tr className="bg-indigo-50/60 font-semibold border-t-2 border-indigo-200">
                        <td className="px-3 py-1.5 border border-slate-200 text-indigo-800">Total — calculated vs TB P&amp;L charge</td>
                        <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{f(totalCalc)}</td>
                        <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{f(tbPnlChargeTotal)}</td>
                        <td className={`px-3 py-1.5 border border-slate-200 text-right font-mono ${Math.abs(tbVariance) > 1 ? 'text-red-600' : 'text-green-600'}`}>{f(tbVariance)}</td>
                        <td className="px-3 py-1.5 border border-slate-200 text-center">
                          {Math.abs(tbVariance) <= 1 ? <Check className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-500 mt-2">
                Variances above the rounding threshold should be investigated as potential errors. The TB P&amp;L total above is the sum of every TB row whose FS Level or Note Level mentions {noun.toLowerCase()}.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
