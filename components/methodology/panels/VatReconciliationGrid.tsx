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

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Send, CheckCircle2, Loader2 } from 'lucide-react';
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
  /** Engagement id — used by the "Request VAT returns via portal"
   *  button to spawn a single PortalRequest listing every period the
   *  client needs to upload. Optional so callers that haven't wired
   *  this through (e.g. preview / read-only contexts) just hide the
   *  button instead of erroring. */
  engagementId?: string;
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
  performanceMateriality, tbRows, onPatch, engagementId,
}: Props) {
  // Portal-request UI state. `requesting` is the inflight flag so the
  // button shows a spinner; `requestError` surfaces a backend message
  // inline if the POST fails. The "already sent" state is derived
  // from data.vatReturnsRequest so a refresh after sending shows the
  // sent timestamp immediately.
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Per-file report from the most recent extract-from-portal run.
  // Used to surface which uploads landed in a row vs which failed +
  // why. Cleared when the auditor closes the report or kicks off
  // another extract.
  const [extractReport, setExtractReport] = useState<Array<{ fileName: string; matchedRowDate: string | null; reason: string }> | null>(null);

  // Source detection — the firm may have an accounting connector
  // (Xero today; Sage / QuickBooks later) on the client that surfaces
  // VAT returns directly. When that's the case, the panel skips the
  // portal route and pulls the data straight from the connector. We
  // load this once on mount to drive the button label and target
  // endpoint; falls back to portal mode if the lookup errors.
  type Source =
    | { kind: 'portal'; hint?: string; connector?: { system: string; label: string; orgName: string | null } }
    | { kind: 'accounting'; connector: { system: string; label: string; orgName: string | null } };
  const [source, setSource] = useState<Source>({ kind: 'portal' });
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/vat-reconciliation/source`);
        if (!cancelled && res.ok) {
          const j = await res.json();
          if (j && (j.kind === 'portal' || j.kind === 'accounting')) setSource(j);
        }
      } catch { /* tolerant — stays portal */ }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Resolve the working set of period rows ──────────────────────────
  //
  // The Permanent tab feeds us the VAT-period anchor + periodicity.
  // When either changes (e.g. auditor flips from quarterly to monthly,
  // or moves the period-end anchor by a month), the saved periodRows
  // need to track. The previous behaviour ("saved rows always win")
  // meant anchor changes silently failed to propagate, AND the
  // extractor's ±45-day matcher couldn't land uploads on the right
  // rows because the rows were stuck on the old schedule.
  //
  // Strategy: build a fresh schedule from the current anchor /
  // periodicity / engagement period, then merge auditor-entered
  // values from saved rows whose period-ending matches a new row
  // within 15 days. Values on saved rows whose period no longer
  // exists in the new schedule are dropped — acceptable cost of a
  // deliberate anchor change.
  const generated = useMemo(() => {
    if (!periodicity || !anchorIso || !periodStartIso || !periodEndIso) return [];
    return generateVatPeriodRows(anchorIso, periodicity, periodStartIso, periodEndIso);
  }, [periodicity, anchorIso, periodStartIso, periodEndIso]);

  const dataRows: VatPeriodRow[] = useMemo(() => {
    const savedRows = data.periodRows || [];
    const savedOpening = savedRows.find(r => r.isOpening);

    // Build the canonical "what the schedule should look like" set
    // first — opening + one row per generated VAT period.
    const opening: VatPeriodRow = savedOpening
      ? { ...savedOpening, periodEnding: periodStartIso, jurisdiction: savedOpening.jurisdiction || jurisdiction }
      : {
        id: 'opening',
        periodEnding: periodStartIso,
        jurisdiction,
        isOpening: true,
        daysInPeriod: 0,
        daysOverlap: 0,
        netRevenue: null, netPurchases: null, salesVat: null, purchaseVat: null,
        hmrcAmount: null,
      };

    const newRest: VatPeriodRow[] = generated.map((g, i) => ({
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

    // If we have no saved rows, return the fresh schedule as-is.
    if (savedRows.length === 0) return [opening, ...newRest];

    // Detect schedule drift — compare sorted period-ending sets.
    // We only check the non-opening rows; opening always tracks
    // periodStartIso.
    const savedKeys = savedRows.filter(r => !r.isOpening).map(r => r.periodEnding).sort().join('|');
    const newKeys = newRest.map(r => r.periodEnding).sort().join('|');

    // No drift — return the saved rows untouched so auditor edits
    // survive every render. The fast-path; matches the old
    // behaviour for the common case of no anchor change.
    if (savedKeys === newKeys && newKeys.length > 0) return savedRows;

    // Drift detected. Rebuild using the new schedule but merge
    // entered values from any saved row whose period-ending falls
    // within 15 days of a new row — same-month / minor-shift edits
    // don't lose data, but a deliberate periodicity flip rebuilds
    // cleanly.
    const TOLERANCE_MS = 15 * 86_400_000;
    const mergedRest: VatPeriodRow[] = newRest.map(newRow => {
      const newTs = new Date(newRow.periodEnding).getTime();
      const match = savedRows.find(s => {
        if (s.isOpening) return false;
        const sTs = new Date(s.periodEnding).getTime();
        return Number.isFinite(sTs) && Math.abs(sTs - newTs) <= TOLERANCE_MS;
      });
      if (!match) return newRow;
      return {
        ...newRow,
        netRevenue: match.netRevenue ?? newRow.netRevenue,
        netPurchases: match.netPurchases ?? newRow.netPurchases,
        salesVat: match.salesVat ?? newRow.salesVat,
        purchaseVat: match.purchaseVat ?? newRow.purchaseVat,
        hmrcAmount: match.hmrcAmount ?? newRow.hmrcAmount,
        hmrcOpeningText: match.hmrcOpeningText ?? newRow.hmrcOpeningText,
      };
    });

    return [opening, ...mergedRest];
  }, [data.periodRows, generated, jurisdiction, periodStartIso]);

  // After rendering with a drift-merged schedule, persist the new
  // shape so subsequent loads + the API-driven extractor see the
  // updated periodRows immediately. Skips the persist when nothing
  // changed (compares JSON shape rather than reference). Without
  // this the user would see the rows update visually but a refresh
  // would revert to the stale saved set.
  useEffect(() => {
    const saved = data.periodRows || [];
    if (saved.length === dataRows.length) {
      const sameKeys = saved
        .filter(r => !r.isOpening).map(r => r.periodEnding).sort().join('|')
        === dataRows.filter(r => !r.isOpening).map(r => r.periodEnding).sort().join('|');
      if (sameKeys) return;
    }
    // Schedule drift detected — push the new shape to the server.
    onPatch({ periodRows: dataRows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRows]);

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
        // Free-text opening field takes precedence — auditor may have
        // typed "£8,500 per HMRC online portal" or similar. The first
        // signed number embedded in that string drives the running
        // balance; if there's no parseable number we fall back to the
        // legacy hmrcAmount column.
        const fromText = parseLeadingNumber(r.hmrcOpeningText);
        const opening = fromText ?? r.hmrcAmount ?? 0;
        return {
          row: r,
          adjNetRevenue: 0, adjNetPurchases: 0, adjSalesVat: 0, adjPurchaseVat: 0, adjNetVat: 0,
          hmrcClosing: opening,
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

      {/* VAT returns source — single banner that auto-routes between
          'pull straight from the connected accounting system' and
          'ask the client via the portal'. The label reflects what's
          actually available for this client, so the auditor never
          bothers the portal user when the data is already on the
          firm's side. Once a request has been sent (or once an
          extract has populated the rows), the button flips to a
          confirmation badge. */}
      {engagementId && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded">
          <div className="text-[11px] text-blue-900">
            {source.kind === 'accounting' ? (
              <>
                <strong>VAT returns:</strong> {source.connector.label} is connected for this client — fetch the filed returns directly so the figures populate the grid rows below without going to the portal.
              </>
            ) : (
              <>
                <strong>VAT returns:</strong> request the client to upload their filed VAT returns directly to the portal — the figures will populate the grid rows below once submitted, no rekeying needed.
                {source.hint && (
                  <span className="block text-[10px] text-blue-700 italic mt-0.5">{source.hint}</span>
                )}
              </>
            )}
          </div>
          {data.vatReturnsRequest?.portalRequestId ? (
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 whitespace-nowrap">
                <CheckCircle2 className="h-3 w-3" />
                Requested {data.vatReturnsRequest.sentAt
                  ? new Date(data.vatReturnsRequest.sentAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                  : 'recently'}
              </span>
              {/* Manual extract-from-portal recovery button. The
                  commit-time auto-extract (added in 7392127) only
                  fires when the auditor clicks "Commit" on the
                  client's response in the firm-side ClientPortalTab.
                  If commit hasn't happened yet, or the auto-extract
                  silently failed, the figures don't land in the
                  grid. This button re-runs extraction on demand.
                  Source PDFs are kept after extraction so the
                  auditor can re-pull at any time — re-running
                  overwrites the period rows in place. */}
              {engagementId && (
                <button
                  type="button"
                  disabled={requesting}
                  onClick={async () => {
                    if (requesting) return;
                    setRequesting(true);
                    setRequestError(null);
                    setExtractReport(null);
                    try {
                      const res = await fetch(`/api/engagements/${engagementId}/vat-reconciliation/extract-from-portal`, {
                        method: 'POST',
                      });
                      const j = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(j?.error || `Extract failed (${res.status})`);
                      if (Array.isArray(j.periodRows)) {
                        // Patch the period rows in place. We keep
                        // `vatReturnsRequest` set so the green
                        // "Requested" badge remains as provenance —
                        // the data is now in the grid and the source
                        // PDFs are gone, but the audit trail of when
                        // the request was sent is still useful.
                        onPatch({ periodRows: j.periodRows });
                      }
                      // Surface the per-file report so the auditor
                      // can see which uploads landed in a row vs
                      // which fell out (no period date, no row
                      // within tolerance, AI parse empty, etc.).
                      if (Array.isArray(j.report)) {
                        setExtractReport(j.report);
                      }
                    } catch (err: any) {
                      setRequestError(err?.message || 'Could not pull from portal uploads');
                    } finally {
                      setRequesting(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                  title="Extract figures from the client's uploaded VAT returns and populate the period rows. Source PDFs are kept so you can re-pull at any time — re-running overwrites the period values in place."
                >
                  {requesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Pull from uploads
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (!engagementId || requesting) return;
                setRequesting(true);
                setRequestError(null);
                try {
                  const periodEndings = dataRows
                    .filter(r => !r.isOpening)
                    .map(r => r.periodEnding);
                  // Endpoint choice mirrors the detected source. The
                  // /extract path will eventually wire to the
                  // connector and populate periodRows server-side; for
                  // now it's wired only when source.kind === 'accounting'
                  // and the connector reports support — which today
                  // means Xero with VAT scopes (not yet enabled).
                  const url = source.kind === 'accounting'
                    ? `/api/engagements/${engagementId}/vat-reconciliation/extract`
                    : `/api/engagements/${engagementId}/vat-reconciliation/request-returns`;
                  const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ periodEndings }),
                  });
                  if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j.error || `Request failed (${res.status})`);
                  }
                  const j = await res.json();
                  // Two response shapes:
                  //   • portal:    { id, sentAt }
                  //   • extract:   { periodRows, sourceLabel } (overlays into the grid directly)
                  if (Array.isArray(j.periodRows)) {
                    onPatch({ periodRows: j.periodRows });
                  } else if (j.id && j.sentAt) {
                    onPatch({ vatReturnsRequest: { portalRequestId: j.id, sentAt: j.sentAt } });
                  }
                } catch (err: any) {
                  setRequestError(err?.message || 'Could not complete request');
                } finally {
                  setRequesting(false);
                }
              }}
              disabled={requesting}
              className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {requesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {source.kind === 'accounting'
                ? `Fetch VAT returns from ${source.connector.label}`
                : 'Request VAT returns via portal'}
            </button>
          )}
        </div>
      )}
      {requestError && (
        <div className="px-3 py-1.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700">
          {requestError}
        </div>
      )}

      {/* Extraction report — surfaces per-file outcomes from the
          most recent "Pull from uploads" run. Lets the auditor see
          which of N uploaded VAT returns matched a period row vs
          which fell out (no period date in the PDF, no row within
          ±45 days, AI returned empty). Each row links to a
          period-end target where matched. */}
      {extractReport && extractReport.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold">
              Extraction report — {extractReport.filter(r => r.reason === 'merged').length} of {extractReport.length} file{extractReport.length === 1 ? '' : 's'} merged
            </span>
            <button
              type="button"
              onClick={() => setExtractReport(null)}
              className="text-amber-700 hover:text-amber-900 text-[11px]"
              title="Dismiss this report"
            >
              ✕
            </button>
          </div>
          <ul className="space-y-0.5">
            {extractReport.map((r, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono text-[10px] mt-0.5">
                  {r.reason === 'merged' ? '✓' : '✗'}
                </span>
                <span className="flex-1">
                  <span className="font-medium">{r.fileName}</span>
                  {' — '}
                  {r.reason === 'merged'
                    ? <>merged into period ending {r.matchedRowDate ? fmtDate(r.matchedRowDate) : '?'}</>
                    : <span className="italic text-amber-700">{r.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
          {extractReport.some(r => r.reason !== 'merged') && (
            <p className="mt-1.5 text-[10px] text-amber-700 italic">
              Files that didn&rsquo;t merge: the AI either couldn&rsquo;t read a period-end date from the PDF, or the date sits more than 45 days from any row in the schedule. If you&rsquo;ve recently changed the VAT-period anchor on the Permanent tab, the rows should now refresh — retry Pull from uploads.
            </p>
          )}
        </div>
      )}

      {/* Main spreadsheet — 14 columns wide. Width-management lives
          on the parent VatReconciliationPanel so this table, the
          toolbar above, and the reconciliation blocks below all
          share the same content width. `overflow-x-auto` is the
          narrow-viewport fallback. */}
      <div className="border border-slate-200 rounded overflow-hidden overflow-x-auto">
        <table className="w-full text-[11px]">
            {/* Hover-over titles spell each abbreviated header out
                in full so the auditor can see what the column means
                without us spending the horizontal space on long
                labels. `cursor-help` is the visual cue that the
                header is interactive. */}
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th
                  className="px-1 py-1 text-left font-semibold text-slate-600 whitespace-nowrap cursor-help"
                  title="Period ending — the VAT-return period end date. Cut-off rows mark periods that straddle the engagement start or end."
                >Period ending</th>
                <th
                  className="px-1 py-1 text-left font-semibold text-slate-600 cursor-help"
                  title="Jurisdiction — the tax authority for this period (e.g. UK / HMRC). Editable when a client files in more than one country."
                >Juris.</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 cursor-help"
                  title="Net Revenue (per VAT return) — net-of-VAT revenue as filed for the WHOLE VAT period. The Adj column to the right pro-rates this to the engagement window."
                >Net Rev</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 cursor-help"
                  title="Net Purchases (per VAT return) — net-of-VAT purchases as filed for the WHOLE VAT period."
                >Net Purch</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 cursor-help"
                  title="Sales VAT (per VAT return) — output VAT collected on sales for the WHOLE period."
                >Sales VAT</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 cursor-help"
                  title="Purchase VAT (per VAT return) — input VAT recovered on purchases for the WHOLE period."
                >Purch VAT</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50 cursor-help"
                  title="Adjusted Net Revenue — Net Revenue × overlap days ÷ days in period. Each row contributes only the slice that falls inside the engagement window."
                >Adj Net Rev</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50 cursor-help"
                  title="Adjusted Net Purchases — Net Purchases pro-rated by overlap days ÷ days in period."
                >Adj Net Purch</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50 cursor-help"
                  title="Adjusted Sales VAT — Sales VAT pro-rated by overlap days ÷ days in period. Reconciled below against expected Sales VAT (per-rate revenue × applicable %)."
                >Adj Sales VAT</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50 cursor-help"
                  title="Adjusted Purchase VAT — Purchase VAT pro-rated by overlap days ÷ days in period."
                >Adj Purch VAT</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 bg-indigo-50/50 cursor-help"
                  title="Adjusted Net VAT — Adj Sales VAT minus Adj Purchase VAT. Drives the running HMRC liability column to the right."
                >Adj Net VAT</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 cursor-help"
                  title="HMRC — running gross VAT liability per workings. Opening row = prior-period HMRC balance brought forward (free-text, supports e.g. '£8,500 per HMRC portal'); subsequent rows accumulate Adj Net VAT. Payments are NOT subtracted here — the reconciliation block below does the netting."
                >HMRC</th>
                <th
                  className="px-1 py-1 text-left font-semibold text-slate-600 bg-emerald-50/50 cursor-help"
                  title="Verified Date — bank-statement date for a payment to HMRC (or refund received). Sits in the row of the period the payment relates to; multiple payments per period split into additional sub-rows."
                >Verified Date</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-slate-600 bg-emerald-50/50 cursor-help"
                  title="Verified Amount — bank-statement amount for the matching payment. Positive = paid to HMRC, negative = refund received from HMRC. Subtracted (× -1) from the HMRC total in the reconciliation block to get expected closing VAT liability."
                >Verified Amount</th>
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
                    <td className="px-1 py-1 whitespace-nowrap">
                      {fmtDate(r.periodEnding)}
                      {r.isOpening && <span className="ml-1 text-[9px] uppercase text-slate-500">opening</span>}
                      {(r.isCutoffStart || r.isCutoffEnd) && <span className="ml-1 text-[9px] uppercase text-amber-700">cut-off</span>}
                    </td>
                    <td className="px-1 py-1">
                      <BufferedInput
                        value={r.jurisdiction}
                        onCommit={(v) => patchRow(r.id, { jurisdiction: v })}
                        className="w-14 text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded"
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
                    <td className="px-1 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjNetRevenue)}</td>
                    <td className="px-1 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjNetPurchases)}</td>
                    <td className="px-1 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjSalesVat)}</td>
                    <td className="px-1 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjPurchaseVat)}</td>
                    <td className="px-1 py-1 text-right tabular-nums bg-indigo-50/30">{r.isOpening ? '' : fmtMoney(c.adjNetVat)}</td>
                    <td className="px-1 py-1 text-right tabular-nums">
                      {r.isOpening ? (
                        // Free-text opening cell — accepts any string
                        // ("£8,500 per HMRC portal at period start"
                        // works just as well as "8500"). The maths
                        // pulls the first signed number out via
                        // parseLeadingNumber; both the verbatim text
                        // and the parsed amount round-trip.
                        <BufferedInput
                          value={r.hmrcOpeningText ?? (r.hmrcAmount == null ? '' : String(r.hmrcAmount))}
                          onCommit={(text) => {
                            patchRow(r.id, { hmrcOpeningText: text, hmrcAmount: parseLeadingNumber(text) });
                          }}
                          placeholder="e.g. £8,500 per HMRC portal"
                          className="w-44 text-right text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded"
                        />
                      ) : (
                        fmtMoney(c.hmrcClosing)
                      )}
                    </td>
                    <td className="px-1 py-1 bg-emerald-50/30">
                      {verifiedFirst && (
                        <BufferedInput
                          type="date"
                          value={verifiedFirst.date.slice(0, 10)}
                          onCommit={(v) => patchBankRow(verifiedFirst.id, { date: v })}
                          className="text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 rounded"
                        />
                      )}
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums bg-emerald-50/30">
                      {verifiedFirst && (
                        <NumCell
                          value={verifiedFirst.amount}
                          onChange={(n) => patchBankRow(verifiedFirst.id, { amount: n ?? 0 })}
                          bare
                        />
                      )}
                    </td>
                  </tr>
                  {/* Split-payment rows for this period (rows 2..N within the period) */}
                  {bankRowsForPeriod.slice(1).map(b => (
                    <tr key={b.id} className="border-b border-slate-50 bg-emerald-50/10">
                      <td colSpan={12} className="px-1 py-0.5 text-right text-[10px] italic text-slate-400">— additional payment —</td>
                      <td className="px-1 py-0.5 bg-emerald-50/30">
                        <BufferedInput
                          type="date"
                          value={b.date.slice(0, 10)}
                          onCommit={(v) => patchBankRow(b.id, { date: v })}
                          className="text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 rounded"
                        />
                      </td>
                      <td className="px-1 py-0.5 text-right bg-emerald-50/30">
                        <div className="flex items-center justify-end gap-1">
                          <NumCell value={b.amount} onChange={(n) => patchBankRow(b.id, { amount: n ?? 0 })} bare />
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
              <td colSpan={6} className="px-1 py-1 text-right text-slate-700">Totals</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(totals.adjNetRevenue)}</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(totals.adjNetPurchases)}</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(totals.adjSalesVat)}</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(totals.adjPurchaseVat)}</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(totals.adjNetVat)}</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(totals.hmrc)}</td>
              <td className="px-1 py-1 text-right text-slate-700">Verified Total</td>
              <td className="px-1 py-1 text-right tabular-nums">{fmtMoney(verifiedTotal)}</td>
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
                  <NumCell value={r.amount} onChange={(n) => patchTbVatRow(idx, { amount: n ?? 0 })} bare />
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

/**
 * Pull the first signed decimal number out of an arbitrary string.
 * Tolerates leading currency symbols, commas, spaces and trailing
 * commentary — e.g. "£8,500.00 per HMRC online portal" → 8500. Returns
 * null when no number is present, which is the cue for the maths
 * downstream to fall back to the legacy hmrcAmount column.
 */
function parseLeadingNumber(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null;
  const stripped = text.replace(/[,£$€\s]/g, '');
  const m = /-?\d+(\.\d+)?/.exec(stripped);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Numeric cell used across the grid. Implemented as a TEXT input
 * (rather than `type="number"`) so the auditor can:
 *   • Type comma-grouped numbers naturally (`1,234,567.89`)
 *   • Paste values copied from spreadsheets / VAT returns that include
 *     `£`, spaces or commas — the parser strips presentation chars
 *     and stores the raw number
 *   • Enter very large balances without a fixed-width number spinner
 *     clipping the digits
 *
 * Storage is unchanged — `value` round-trips as a `number | null`. The
 * formatted display is shown when the cell isn't focused; on focus we
 * swap to the raw editable string so the user can edit any digit
 * without fighting locale formatting.
 *
 * Save-on-blur: keystrokes update only the local draft. The upstream
 * `onChange(n)` fires once when the cell loses focus or the user
 * presses Enter — so the parent's persistence call (which reaches the
 * audit_vat_reconciliations save endpoint) doesn't spam one HTTP
 * request per keystroke.
 */
function NumCell({ value, onChange, bare = false }: { value: number | null; onChange: (n: number | null) => void; bare?: boolean }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const formatted = value == null ? '' : value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const display = focused ? draft : formatted;
  function commit() {
    const cleaned = draft.replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') {
      onChange(null);
      return;
    }
    const n = Number(cleaned);
    if (Number.isFinite(n)) onChange(n);
  }
  return (
    <td className={bare ? '' : 'px-1 py-1 text-right'}>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={() => { setDraft(value == null ? '' : String(value)); setFocused(true); }}
        onBlur={() => { commit(); setFocused(false); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Commit + drop focus so the next Tab moves cleanly to the
            // next cell instead of leaving the unsaved draft behind.
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-24 text-right text-[11px] px-1 py-0.5 border border-transparent hover:border-slate-200 focus:border-indigo-300 rounded tabular-nums"
      />
    </td>
  );
}

/**
 * Buffered text input — same save-on-blur pattern as NumCell but for
 * free-text and date cells (jurisdiction, HMRC opening narrative,
 * verified-payment dates). Without this every keystroke hit the
 * persistence layer; on a slow network the cell ended up fighting the
 * user's typing as the parent re-rendered with the in-flight value.
 */
function BufferedInput({
  value,
  onCommit,
  className,
  type = 'text',
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  type?: 'text' | 'date';
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const display = focused ? draft : value;
  return (
    <input
      type={type}
      value={display}
      placeholder={placeholder}
      onFocus={() => { setDraft(value); setFocused(true); }}
      onBlur={() => { setFocused(false); if (draft !== value) onCommit(draft); }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className}
    />
  );
}
