'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Save, Loader2, Plus, Trash2, Check, AlertTriangle } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FarCategory {
  id: string;
  name: string;
  order: number;
  linkedTbRowIds: string[];
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

export function FixedAssetRegisterPopup({ engagementId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetType, setAssetType] = useState<'cost' | 'valuation'>('cost');
  const [scope, setScope] = useState<'tangible' | 'intangible' | 'both'>('both');
  const [categories, setCategories] = useState<FarCategory[]>([]);
  const [data, setData] = useState<Record<string, CategorySchedule>>({});
  const [allTbRows, setAllTbRows] = useState<TBRow[]>([]);
  const [assetTbRows, setAssetTbRows] = useState<TBRow[]>([]);
  const [linkingCatId, setLinkingCatId] = useState<string | null>(null);

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
          setScope(json.config.farScope || 'both');
          const cats = (json.config.farCategories || []) as FarCategory[];
          setCategories(cats);

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

  // ─── Handlers ───────────────────────────────────────────────────────────

  const addCategory = () => {
    const id = catId();
    setCategories(prev => [...prev, { id, name: 'New Category', order: prev.length, linkedTbRowIds: [] }]);
    setData(prev => ({ ...prev, [id]: { ...EMPTY_SCHEDULE } }));
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
      </div>
    </div>
  );
}
