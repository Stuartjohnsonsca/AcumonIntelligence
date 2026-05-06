'use client';

/**
 * VAT Reconciliation grid.
 *
 * Owns the spreadsheet rendering + maths described in the spec:
 *   - Row 0 = opening balance (prior-period HMRC b/f, manual entry).
 *   - Rows 1..N = one per VAT period overlapping the engagement
 *                 period, with cut-off flags at start/end.
 *   - Adjusted columns time-prorate raw VAT-return values.
 *   - HMRC column is the running closing balance per row.
 *   - Verified-to-Bank columns capture each payment/refund (Date,
 *     Amount). Multiple rows per period for split payments.
 *   - Bottom block reconciles HMRC + (Verified to Bank × -1) against
 *     "VAT Balance per TB" and assesses material error vs PM.
 *   - Net Revenue cross-check sets out per-VAT-rate revenue × % to
 *     derive expected Adjusted Sales VAT and assesses error vs PM.
 *
 * All grid state (raw VAT-return values, opening HMRC, TB rows, bank
 * verifications) round-trips via the parent's `onPatch` so a single
 * audit_vat_reconciliations.data blob holds the lot.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  generateVatPeriodRows,
  proRata,
  formatRateLabel,
  type FirmVatRate,
  type VatPeriodicity,
  type VatPeriodRow,
  type VatRecData,
  type VatBankVerification,
  type VatTbRow,
} from '@/lib/vat-reconciliation';

interface Props {
  data: VatRecData;
  firmRates: FirmVatRate[];
  periodicity: VatPeriodicity | undefined;
  anchorIso: string;
  anchorIsPlaceholder: boolean;
  periodStartIso: string;
  periodEndIso: string;
  jurisdiction: string;
  performanceMateriality: number;
  tbRows: Array<{ accountCode: string; description: string; currentYear: number | null }>;
  onPatch: (patch: Partial<VatRecData>) => void;
}

const fmtMoney = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function VatReconciliationGrid({
  data, firmRates, periodicity, anchorIso, anchorIsPlaceholder,
  periodStartIso, periodEndIso, jurisdiction,
  performanceMateriality, tbRows, onPatch,
}: Props) {

  // ── Resolve the working set of period rows ──────────────────────────
  //
  // Rows persisted on the engagement take precedence over freshly
  // generated rows, so reviewer edits survive periodicity/anchor
  // changes upstream. We re-generate whenever the saved set is empty
  // or when the periodicity / anchor / engagement period changed.
  const generated = useMemo(() => {
    if (!periodicity || !anchorIso || !periodStartIso || !periodEndIso) return [];
    return generateVatPeriodRows(anchorIso, periodicity, periodStartIso, periodEndIso);
  }, [periodicity, anchorIso, periodStartIso, periodEndIso]);

  const dataRows: VatPeriodRow[] = useMemo(() => {
    if (data.periodRows && data.periodRows.length > 0) return data.periodRows;
    // Build the initial row set: opening + generated, blank values.
    const opening: VatPeriodRow = {
      id: 'opening',
      periodEnding: periodStartIso,
      jurisdiction,
      isOpening: true,
      daysInPeriod: 0,
      daysOverlap: 0,
      netRevenue: null, netPurchases: null, salesVat: null, purchaseVat: null,
      hmrcAmount: null,
    };
    const rest: VatPeriodRow[] = generated.map((g, i) => ({
      id: `vp-${i}-${g.periodEnd}`,
      periodEnding: g.periodEnd,
      jurisdiction,
      isCutoffStart: g.isCutoffStart,
      isCutoffEnd: g.isCutoffEnd,
      daysInPeriod: g.daysInPeriod,
      daysOverlap: g.daysOverlap,
      netRevenue: null, netPurchases: null, salesVat: null, purchaseVat: null,
      hmrcAmount: null,
    }));
    return [opening, ...rest];
  }, [data.periodRows, generated, jurisdiction, periodStartIso]);

  function patchRow(rowId: string, patch: Partial<VatPeriodRow>) {
    const next = dataRows.map(r => r.id === rowId ? { ...r, ...patch } : r);
    onPatch({ periodRows: next });
  }

  // ── Adjusted-column maths + HMRC column ───────────────────────────
  //
  // Sign convention: bank verifications are stored as POSITIVE numbers
  // for payments out to HMRC (the spec's "Verified to Bank" — the
  // bank-statement amount the client paid). Refunds received from
  // HMRC are entered as NEGATIVE.
  //
  // HMRC column shows gross liability accruals — opening b/f for the
  // first row, then prior-row closing + this period's Adj Net VAT.
  // It does NOT subtract payments. The reconciliation block below
  // does the netting (HMRC total − Verified Total) so the spec's
  // "two totals under HMRC column" stays visible to reviewers.
  const computed = useMemo(() => {
    const adj = (raw: number | null, r: VatPeriodRow) => proRata(raw, r.daysOverlap, r.daysInPeriod);
    const out = dataRows.map(r => {
      if (r.isOpening) {
        return {
          row: r,
          adjNetRevenue: 0, adjNetPurchases: 0, adjSalesVat: 0, adjPurchaseVat: 0, adjNetVat: 0,
          hmrcClosing: r.hmrcAmount ?? 0,
        };
      }
      const adjNetRevenue = adj(r.netRevenue, r);
      const adjNetPurchases = adj(r.netPurchases, r);
      const adjSalesVat = adj(r.salesVat, r);
      const adjPurchaseVat = adj(r.purchaseVat, r);
      const adjNetVat = adjSalesVat - adjPurchaseVat;
      return { row: r, adjNetRevenue, adjNetPurchases, adjSalesVat, adjPurchaseVat, adjNetVat, hmrcClosing: 0 };
    });
    // HMRC running closing — gross of payments (no subtraction).
    let running = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i].row.isOpening) {
        running = out[i].hmrcClosing;
        continue;
      }
      running = running + out[i].adjNetVat;
      out[i].hmrcClosing = running;
    }
    return out;
  }, [dataRows]);

  // ── Column totals ───────────────────────────────────────────────────
  const totals = useMemo(() => {
    const t = { adjNetRevenue: 0, adjNetPurchases: 0, adjSalesVat: 0, adjPurchaseVat: 0, adjNetVat: 0, hmrc: 0 };
    for (const c of computed) {
      if (c.row.isOpening) { t.hmrc = c.hmrcClosing; continue; }
      t.adjNetRevenue += c.adjNetRevenue;
      t.adjNetPurchases += c.adjNetPurchases;
      t.adjSalesVat += c.adjSalesVat;
      t.adjPurchaseVat += c.adjPurchaseVat;
      t.adjNetVat += c.adjNetVat;
    }
    // HMRC column total = the final closing balance.
    const last = computed[computed.length - 1];
    if (last) t.hmrc = last.hmrcClosing;
    return t;
  }, [computed]);

  const verifiedTotal = useMemo(
    () => (data.bankVerifications || []).reduce((s, b) => s + b.amount, 0),
    [data.bankVerifications]
  );
  const tbVatTotal = useMemo(
    () => (data.tbVatRows || []).reduce((s, r) => s + r.amount, 0),
    [data.tbVatRows]
  );
  // Per spec: "add the total of the amounts Verified to Bank
  // multiplied by -1" then sum with HMRC total. Net of those two is
  // the expected closing VAT balance per workings, compared to the
  // VAT Balance per TB to assess for material error.
  const verifiedNeg = -verifiedTotal;
  const hmrcExpectedClosing = totals.hmrc + verifiedNeg;
  const tbVsExpected = tbVatTotal - hmrcExpectedClosing;
  const tbMaterial = performanceMateriality > 0 && Math.abs(tbVsExpected) > performanceMateriality;

  // ── Net Revenue cross-check (per VAT rate × % vs Adjusted Sales VAT) ──
  const netRevCrossCheck = useMemo(() => {
    type Bucket = { rateId: string; rateLabel: string; pct: number; netRevenue: number; expectedSalesVat: number };
    const buckets = new Map<string, Bucket>();
    // Per-account-code mapping points at one firm rate (and possibly
    // an override %). We aggregate the raw Net Revenue from the
    // *mapped* TB code's Cr (revenue typically sits Cr) — Dr/Cr
    // already snapshotted on the mapping. The grid however
    // reconciles against ADJUSTED Net Revenue from the period rows.
    // Per spec: "set out the revenue for each VAT heading … Net
    // Revenue and the applicable %"  → revenue is the value from the
    // mapping (account-level), then time-adjusted via the same factor
    // as the Adj Net Revenue total. Easiest stable maths: scale each
    // bucket by (totals.adjNetRevenue / sum of mapped revenues).
    let mappedRevenueSum = 0;
    for (const [code, m] of Object.entries(data.revenueMappings || {})) {
      const rate = firmRates.find(r => r.id === m.vatRateId);
      if (!rate) continue;
      const pct = m.ratePercentOverride ?? rate.ratePercent;
      const rev = m.cr - m.dr; // net revenue: Cr less any Dr offsets
      mappedRevenueSum += rev;
      const key = `${rate.id}::${pct}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.netRevenue += rev;
      } else {
        buckets.set(key, { rateId: rate.id, rateLabel: formatRateLabel(rate), pct, netRevenue: rev, expectedSalesVat: 0 });
      }
      void code;
    }
    // Scale each bucket so the sum equals totals.adjNetRevenue.
    const scale = mappedRevenueSum > 0 ? (totals.adjNetRevenue / mappedRevenueSum) : 0;
    let expectedSum = 0;
    const out = Array.from(buckets.values()).map(b => {
      const scaledNet = b.netRevenue * scale;
      const expected = scaledNet * (b.pct / 100);
      expectedSum += expected;
      return { ...b, netRevenue: scaledNet, expectedSalesVat: expected };
    });
    const diff = totals.adjSalesVat - expectedSum;
    const material = performanceMateriality > 0 && Math.abs(diff) > performanceMateriality;
    return { rows: out, expectedSum, diff, material };
  }, [data.revenueMappings, firmRates, totals.adjNetRevenue, totals.adjSalesVat, performanceMateriality]);

  // ── Verified-to-Bank handlers ──────────────────────────────────────
  function addBankRow() {
    const next: VatBankVerification[] = [
      ...(data.bankVerifications || []),
      { id: `bv-${Date.now()}`, date: periodEndIso, amount: 0, source: 'manual' },
    ];
    onPatch({ bankVerifications: next });
  }
  function patchBankRow(id: string, patch: Partial<VatBankVerification>) {
    const next = (data.bankVerifications || []).map(b => b.id === id ? { ...b, ...patch } : b);
    onPatch({ bankVerifications: next });
  }
  function removeBankRow(id: string) {
    onPatch({ bankVerifications: (data.bankVerifications || []).filter(b => b.id !== id) });
  }

  // ── TB-VAT-row handlers ────────────────────────────────────────────
  function addTbVatRow() {
    const next: VatTbRow[] = [...(data.tbVatRows || []), { tbAccountCode: '', amount: 0 }];
    onPatch({ tbVatRows: next });
  }
  function patchTbVatRow(idx: number, patch: Partial<VatTbRow>) {
    const next = (data.tbVatRows || []).map((r, i) => i === idx ? { ...r, ...patch } : r);
    onPatch({ tbVatRows: next });
  }
  function removeTbVatRow(idx: number) {
    onPatch({ tbVatRows: (data.tbVatRows || []).filter((_, i) => i !== idx) });
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (!periodicity) {
    return (
      <div className="px-3 py-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
        VAT periodicity not set. Add <code>vat_periodicity</code> (Monthly / Quarterly / Annual) to the Permanent
        tab so the reconciliation grid can build the correct period rows.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {anchorIsPlaceholder && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800">
          Using engagement period end as a provisional VAT-period anchor — set <code>vat_period_end_anchor</code> in
          the Permanent tab to lock the actual VAT-return schedule.
        </div>
      )}

      {/* Main spreadsheet */}
      <div className="border border-slate-200 rounded overflow-hidden overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-2 py-1 text-left font-semibold text-slate-600 whitespace-nowrap">Period ending</th>
              <th className="px-2 py-1 text-left font-semibold text-slate-600">Jurisdiction</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600">Net Revenue</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600">Net Purchases</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600">Sales VAT</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600">Purchase VAT</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50">Adj Net Revenue</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50">Adj Net Purchases</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50">Adj Sales VAT</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50">Adj Purchase VAT</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50">Adj Net VAT</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600">HMRC</th>
              <th className="px-2 py-1 text-left font-semibold text-slate-600 bg-emerald-50/50">Verified Date</th>
              <th className="px-2 py-1 text-right font-semibold text-slate-600 bg-emerald-50/50">Verified Amount</th>
            </tr>
          </thead>
          <tbody>
            {computed.map((c, i) => {
              const r = c.row;
              const cutoff = r.isCutoffStart || r.isCutoffEnd;
              const bankRowsForPeriod = (data.bankVerifications || []).filter(b =>
                !r.isOpening && b.date && b.date <= r.periodEnding && (
                  i === 0 || b.date > computed[i - 1].row.periodEnding
                ));
              const verifiedFirst = bankRowsForPeriod[0];
              return (
                <>
                  <tr key={r.id} className={`border-b border-slate-100 ${cutoff ? 'bg-amber-50/30' : ''} ${r.isOpening ? 'bg-slate-50' : ''}`}>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {fmtDate(r.periodEnding)}
                      {r.isOpening && <span className="ml-1 text-[9px] uppercase text-slate-500">opening</span>}
                      {(r.isCutoffStart || r.isCutoffEnd) && <span className="ml-1 text-[9px] uppercase text-amber-700">cut-off</span>}
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={r.jurisdiction}
                        onChange={(e) => patchRow(r.id, { jurisdiction: e.target.value })}
                        className="w-20 text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded"
                      />
                    </td>
                    {r.isOpening ? (
                      <td colSpan={4} className="px-2 py-1 text-right text-[10px] italic text-slate-400">prior-period HMRC b/f →</td>
                    ) : (
                      <>
                        <NumCell value={r.netRevenue} onChange={v => patchRow(r.id, { netRevenue: v })} />
                        <NumCell value={r.netPurchases} onChange={v => patchRow(r.id, { netPurchases: v })} />
                        <NumCell value={r.salesVat} onChange={v => patchRow(r.id, { salesVat: v })} />
                        <NumCell value={r.purchaseVat} onChange={v => patchRow(r.id, { purchaseVat: v })} />
                      </>
                    )}
                    <td className="px-2 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjNetRevenue)}</td>
                    <td className="px-2 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjNetPurchases)}</td>
                    <td className="px-2 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjSalesVat)}</td>
                    <td className="px-2 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjPurchaseVat)}</td>
                    <td className="px-2 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjNetVat)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {r.isOpening ? (
                        <NumCell value={r.hmrcAmount} onChange={v => patchRow(r.id, { hmrcAmount: v })} bare />
                      ) : (
                        fmtMoney(c.hmrcClosing)
                      )}
                    </td>
                    <td className="px-2 py-1 bg-emerald-50/30">
                      {verifiedFirst && (
                        <input
                          type="date"
                          value={verifiedFirst.date.slice(0, 10)}
                          onChange={(e) => patchBankRow(verifiedFirst.id, { date: e.target.value })}
                          className="text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 rounded"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums bg-emerald-50/30">
                      {verifiedFirst && (
                        <input
                          type="number"
                          step="0.01"
                          value={verifiedFirst.amount}
                          onChange={(e) => patchBankRow(verifiedFirst.id, { amount: Number(e.target.value) || 0 })}
                          className="w-24 text-right text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 rounded tabular-nums"
                        />
                      )}
                    </td>
                  </tr>
                  {/* Split-payment rows for this period (rows 2..N within the period) */}
                  {bankRowsForPeriod.slice(1).map(b => (
                    <tr key={b.id} className="border-b border-slate-50 bg-emerald-50/10">
                      <td colSpan={12} className="px-2 py-0.5 text-right text-[10px] italic text-slate-400">— additional payment —</td>
                      <td className="px-2 py-0.5 bg-emerald-50/30">
                        <input type="date" value={b.date.slice(0, 10)} onChange={(e) => patchBankRow(b.id, { date: e.target.value })}
                          className="text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 rounded" />
                      </td>
                      <td className="px-2 py-0.5 text-right bg-emerald-50/30">
                        <div className="flex items-center justify-end gap-1">
                          <input type="number" step="0.01" value={b.amount} onChange={(e) => patchBankRow(b.id, { amount: Number(e.target.value) || 0 })}
                            className="w-24 text-right text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 rounded tabular-nums" />
                          <button onClick={() => removeBankRow(b.id)} className="text-slate-400 hover:text-red-500" title="Remove payment">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              );
            })}

            {/* Totals */}
            <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
              <td colSpan={6} className="px-2 py-1 text-right text-slate-700">Totals</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totals.adjNetRevenue)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totals.adjNetPurchases)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totals.adjSalesVat)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totals.adjPurchaseVat)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totals.adjNetVat)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(totals.hmrc)}</td>
              <td className="px-2 py-1 text-right text-slate-700">Verified Total</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(verifiedTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          onClick={addBankRow}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        >
          <Plus className="h-3 w-3" />
          Add Verified-to-Bank entry
        </button>
      </div>

      {/* HMRC reconciliation block */}
      <div className="border border-slate-200 rounded overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
          HMRC reconciliation
        </div>
        <table className="w-full text-[11px]">
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1 text-slate-700">Total HMRC (per workings)</td>
              <td className="px-3 py-1 text-right tabular-nums w-40">{fmtMoney(totals.hmrc)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1 text-slate-700">Total Verified to Bank × −1</td>
              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(verifiedNeg)}</td>
            </tr>
            <tr className="border-b border-slate-100 bg-slate-50">
              <td className="px-3 py-1 font-semibold text-slate-700">Expected closing VAT liability per workings</td>
              <td className="px-3 py-1 text-right tabular-nums font-semibold">{fmtMoney(hmrcExpectedClosing)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1 text-slate-700">VAT Balance per TB</td>
              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(tbVatTotal)}</td>
            </tr>
            {(data.tbVatRows || []).map((r, idx) => (
              <tr key={`tb-${idx}`} className="border-b border-slate-50 bg-slate-50/50">
                <td className="px-3 py-0.5 pl-8 text-slate-500">
                  <div className="flex items-center gap-2">
                    <select
                      value={r.tbAccountCode}
                      onChange={(e) => {
                        const tb = tbRows.find(t => t.accountCode === e.target.value);
                        patchTbVatRow(idx, {
                          tbAccountCode: e.target.value,
                          amount: tb ? (Number(tb.currentYear) || 0) : r.amount,
                        });
                      }}
                      className="text-[11px] border border-slate-300 rounded px-1 py-0.5 max-w-[260px]"
                    >
                      <option value="">— pick TB code —</option>
                      {tbRows.map(t => (
                        <option key={t.accountCode} value={t.accountCode}>{t.accountCode} — {t.description}</option>
                      ))}
                    </select>
                    <button onClick={() => removeTbVatRow(idx)} className="text-slate-400 hover:text-red-500" title="Remove">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
                <td className="px-3 py-0.5 text-right tabular-nums">
                  <input
                    type="number" step="0.01" value={r.amount}
                    onChange={(e) => patchTbVatRow(idx, { amount: Number(e.target.value) || 0 })}
                    className="w-32 text-right text-[11px] px-1 py-0.5 border border-slate-200 rounded tabular-nums"
                  />
                </td>
              </tr>
            ))}
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1 pl-8" colSpan={2}>
                <button onClick={addTbVatRow}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700">
                  <Plus className="h-3 w-3" /> Add TB code
                </button>
              </td>
            </tr>
            <tr className={`${tbMaterial ? 'bg-red-50' : 'bg-emerald-50/40'} font-semibold`}>
              <td className="px-3 py-1.5 text-slate-700">
                Difference (TB − expected)
                {performanceMateriality > 0 && (
                  <span className={`ml-2 text-[10px] font-normal ${tbMaterial ? 'text-red-700' : 'text-emerald-700'}`}>
                    {tbMaterial ? `Material — exceeds PM (${fmtMoney(performanceMateriality)})` : `Within PM (${fmtMoney(performanceMateriality)})`}
                  </span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(tbVsExpected)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Net Revenue cross-check */}
      <div className="border border-slate-200 rounded overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
          Net Revenue cross-check (per VAT heading × % vs Adjusted Sales VAT)
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-1 text-left font-semibold text-slate-600">VAT heading</th>
              <th className="px-3 py-1 text-right font-semibold text-slate-600">Net Revenue (scaled)</th>
              <th className="px-3 py-1 text-right font-semibold text-slate-600">Applicable %</th>
              <th className="px-3 py-1 text-right font-semibold text-slate-600">Expected Sales VAT</th>
            </tr>
          </thead>
          <tbody>
            {netRevCrossCheck.rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-2 text-center text-[11px] italic text-slate-400">
                Map at least one revenue code to a VAT rate to populate this cross-check.
              </td></tr>
            ) : netRevCrossCheck.rows.map(r => (
              <tr key={r.rateId + r.pct} className="border-b border-slate-100">
                <td className="px-3 py-0.5 text-slate-700">{r.rateLabel}</td>
                <td className="px-3 py-0.5 text-right tabular-nums">{fmtMoney(r.netRevenue)}</td>
                <td className="px-3 py-0.5 text-right tabular-nums">{r.pct}%</td>
                <td className="px-3 py-0.5 text-right tabular-nums">{fmtMoney(r.expectedSalesVat)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-100 font-semibold">
              <td className="px-3 py-1 text-right text-slate-700">Total expected Sales VAT</td>
              <td colSpan={2}></td>
              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(netRevCrossCheck.expectedSum)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1 text-slate-700">Adjusted Sales VAT (per workings)</td>
              <td colSpan={2}></td>
              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(totals.adjSalesVat)}</td>
            </tr>
            <tr className={`${netRevCrossCheck.material ? 'bg-red-50' : 'bg-emerald-50/40'} font-semibold`}>
              <td className="px-3 py-1.5 text-slate-700">
                Difference
                {performanceMateriality > 0 && (
                  <span className={`ml-2 text-[10px] font-normal ${netRevCrossCheck.material ? 'text-red-700' : 'text-emerald-700'}`}>
                    {netRevCrossCheck.material ? `Material — exceeds PM (${fmtMoney(performanceMateriality)})` : `Within PM (${fmtMoney(performanceMateriality)})`}
                  </span>
                )}
              </td>
              <td colSpan={2}></td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(netRevCrossCheck.diff)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Editable numeric cell ────────────────────────────────────────────

function NumCell({ value, onChange, bare = false }: { value: number | null; onChange: (n: number | null) => void; bare?: boolean }) {
  return (
    <td className={bare ? '' : 'px-2 py-1 text-right'}>
      <input
        type="number"
        step="0.01"
        value={value == null ? '' : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') onChange(null);
          else {
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
        className="w-24 text-right text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded tabular-nums"
      />
    </td>
  );
}
