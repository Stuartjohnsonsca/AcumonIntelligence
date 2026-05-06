'use client';

/**
 * Tax on Profits Panel — Corporation Tax verification tool.
 *
 * Lives under Completion → Taxation → Tax on Profits. Drives a 3-step
 * flow:
 *   1. Permanent-file gate. Reads the seeded "Is the entity subject
 *      to tax on its profits?" Y/N. Shows one of three popups
 *      (unanswered / No / Yes-proceed).
 *   2. Jurisdiction picker. Defaults UK 100%. Lets the auditor add
 *      jurisdictions from the firm-wide Tax on Profits config and
 *      set the percentage split (must total 100%).
 *   3. Computation grid. Columns = each jurisdiction + Disallowable +
 *      Total + "Select for audit testing". Rows = headings, profit-
 *      tax % sub-sub-heading, accounting profit × rate × % row, then
 *      auditor-added tax adjustments. Adjustments can be flagged for
 *      audit testing — the auditor then picks a test from the
 *      methodology test bank and one of three seeded actions
 *      (explanation / request evidence / request to tax specialist).
 *
 * The full data lives in lib/tax-on-profits.ts; the per-engagement
 * blob persists via /api/engagements/{id}/tax-on-profits. The shape
 * is loose because the panel evolves quickly — see TaxOnProfitsData.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Plus, X, Trash2, ClipboardCheck, FileQuestion, UserCheck, MessageSquare, CheckCircle2, Sparkles } from 'lucide-react';
import {
  EMPTY_TAX_ON_PROFITS,
  findRateForDate,
  readFirmTaxOnProfitsConfig,
  readSubjectToTax,
  TAX_ON_PROFITS_PERMANENT_QUESTION_LABEL,
  type FirmTaxOnProfitsRate,
  type SubjectToTaxStatus,
  type TaxOnProfitsAction,
  type TaxOnProfitsAdjustment,
  type TaxOnProfitsAuditTest,
  type TaxOnProfitsData,
  type TaxOnProfitsJurisdictionRow,
} from '@/lib/tax-on-profits';

interface Props {
  engagementId: string;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  userId?: string;
  userName?: string;
  userRole?: string;
}

interface TBRow {
  id: string;
  accountCode: string;
  description: string;
  fsLevel: string | null;
  fsStatement: string | null;
  currentYear: number | null;
}

type Gate =
  | { kind: 'loading' }
  | { kind: 'unanswered' }
  | { kind: 'not_subject' }
  | { kind: 'ready' };

const ZERO_DECIMALS = (n: number) => Math.round(n * 100) / 100;

export function TaxOnProfitsPanel({ engagementId, periodEndDate }: Props) {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [subjectStatus, setSubjectStatus] = useState<SubjectToTaxStatus>('unanswered');
  const [clientName, setClientName] = useState('');
  const [data, setData] = useState<TaxOnProfitsData>(EMPTY_TAX_ON_PROFITS);
  const [firmRates, setFirmRates] = useState<FirmTaxOnProfitsRate[]>([]);
  const [allTbRows, setAllTbRows] = useState<TBRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Pop-up state — the entry flow has two stages:
  //   showJurisdictionPicker = true on first ready load (or when
  //   reopened from the toolbar), and showComputation flips to the
  //   main grid pop-up once the auditor saves the picker. Both close
  //   on cancel without persisting.
  const [showJurisdictionPicker, setShowJurisdictionPicker] = useState(false);
  const [showComputation, setShowComputation] = useState(false);
  const [auditTestRow, setAuditTestRow] = useState<TaxOnProfitsAdjustment | null>(null);
  const [verifying, setVerifying] = useState(false);

  // ── Load everything once on open ────────────────────────────────────
  const load = useCallback(async () => {
    const [recRes, subj, firmCfg, tbRes] = await Promise.all([
      fetch(`/api/engagements/${engagementId}/tax-on-profits`).then(r => r.ok ? r.json() : { data: {}, clientName: '' }),
      readSubjectToTax(engagementId),
      readFirmTaxOnProfitsConfig(),
      fetch(`/api/engagements/${engagementId}/trial-balance`).then(r => r.ok ? r.json() : { rows: [] }),
    ]);

    setSubjectStatus(subj);
    setClientName(recRes.clientName || '');
    setFirmRates(firmCfg.rates || []);
    setAllTbRows(tbRes.rows || []);
    const merged: TaxOnProfitsData = { ...EMPTY_TAX_ON_PROFITS, ...(recRes.data || {}) };
    // Defensive defaults — saved blobs from earlier shape changes
    if (!Array.isArray(merged.jurisdictions) || merged.jurisdictions.length === 0) {
      merged.jurisdictions = [{ jurisdiction: 'UK', percent: 100 }];
    }
    if (!Array.isArray(merged.adjustments)) merged.adjustments = [];
    setData(merged);

    if (subj === 'unanswered') setGate({ kind: 'unanswered' });
    else if (subj === 'N') setGate({ kind: 'not_subject' });
    else {
      setGate({ kind: 'ready' });
      // First-time-through prompts the jurisdiction picker. Detect
      // by checking whether the saved blob has any saved jurisdictions
      // beyond the implicit UK 100% default — i.e. the auditor hasn't
      // confirmed even once.
      const sumPct = (merged.jurisdictions || []).reduce((s, j) => s + (j.percent || 0), 0);
      if (Math.abs(sumPct - 100) > 0.01 || merged.jurisdictions.length === 0) {
        setShowJurisdictionPicker(true);
      }
    }
  }, [engagementId]);

  useEffect(() => { void load(); }, [load]);

  // ── AI re-check on Permanent-tab Taxation change ───────────────────
  // Kicks off automatically once the gate is "ready". The endpoint
  // hashes the Taxation section content server-side and short-circuits
  // when nothing has changed since the last run, so this is safe to
  // call on every panel mount. A manual button forces a re-check
  // ignoring the hash via ?force=1.
  const runAiVerify = useCallback(async (force: boolean) => {
    setVerifying(true);
    try {
      const url = `/api/engagements/${engagementId}/tax-on-profits/verify${force ? '?force=1' : ''}`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) return;
      const json = await res.json();
      if (json.aiVerification) {
        setData(prev => ({
          ...prev,
          aiVerification: json.aiVerification,
          permanentTaxationHash: json.permanentTaxationHash,
        }));
      }
    } finally {
      setVerifying(false);
    }
  }, [engagementId]);

  useEffect(() => {
    if (gate.kind === 'ready') void runAiVerify(false);
  }, [gate.kind, runAiVerify]);

  // ── Save helper ─────────────────────────────────────────────────────
  const persist = useCallback(async (patch: Partial<TaxOnProfitsData>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/tax-on-profits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: patch }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) setData(prev => ({ ...prev, ...json.data }));
      }
    } finally {
      setSaving(false);
    }
  }, [engagementId]);

  // ── Derived ─────────────────────────────────────────────────────────
  const periodEndIso = periodEndDate || new Date().toISOString().slice(0, 10);

  // For each selected jurisdiction, look up the applicable rate from
  // the firm-wide config at the engagement's period end. Falls back
  // to the first rate row for that jurisdiction if no date covers the
  // period end (admin oversight — the panel surfaces a warning).
  const jurisdictionRates = useMemo(() => {
    return data.jurisdictions.map(j => {
      const exact = findRateForDate(firmRates, j.jurisdiction, periodEndIso);
      if (exact) return { jurisdiction: j.jurisdiction, percent: j.percent, rate: exact.ratePercent, label: exact.label };
      const fallback = firmRates.find(r => r.jurisdiction === j.jurisdiction);
      return { jurisdiction: j.jurisdiction, percent: j.percent, rate: fallback?.ratePercent ?? 0, label: fallback?.label || '—' };
    });
  }, [data.jurisdictions, firmRates, periodEndIso]);

  const minRate = useMemo(() => Math.min(...jurisdictionRates.map(r => r.rate)), [jurisdictionRates]);
  const maxRate = useMemo(() => Math.max(...jurisdictionRates.map(r => r.rate)), [jurisdictionRates]);
  const effectiveRate = data.rateMode === 'highest' ? maxRate : minRate;

  // ── Render ──────────────────────────────────────────────────────────
  if (gate.kind === 'loading') {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
        Loading tax on profits…
      </div>
    );
  }

  if (gate.kind === 'unanswered') {
    return (
      <GatePopup
        tone="amber"
        message={
          <>
            Whether <strong>{clientName || 'the client'}</strong> is subject to tax on its profits or not has not been set.
            Please answer the question <em>&ldquo;{TAX_ON_PROFITS_PERMANENT_QUESTION_LABEL}&rdquo;</em> in the Permanent tab.
          </>
        }
      />
    );
  }

  if (gate.kind === 'not_subject') {
    return (
      <GatePopup
        tone="amber"
        message={
          <>
            <strong>{clientName || 'The client'}</strong> is not subject to tax on its profits. Please seek specialist tax advice
            if you believe <strong>{clientName || 'the client'}</strong> should be.
          </>
        }
      />
    );
  }

  // gate.kind === 'ready'
  return (
    <div className="space-y-4">
      {/* Toolbar — selected jurisdictions summary, change picker, save status */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Client:</span>
          <span className="font-semibold text-slate-800">{clientName || '—'}</span>
          <span className="text-slate-300">|</span>
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Jurisdictions:</span>
          <span className="font-medium text-slate-700">
            {data.jurisdictions.map(j => `${j.jurisdiction} ${j.percent}%`).join(' · ') || <em className="text-amber-600">not set</em>}
          </span>
          {jurisdictionRates.length >= 2 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Rate range:</span>
              <span className="font-medium text-slate-700">{minRate}% to {maxRate}%</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
          <button
            onClick={() => setShowJurisdictionPicker(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100"
            title="Change jurisdictions / percentage split"
          >
            Jurisdictions
          </button>
          <button
            onClick={() => setShowComputation(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
            title="Open the tax adjustments computation grid"
          >
            <ClipboardCheck className="h-3 w-3" /> Open computation
          </button>
        </div>
      </div>

      {/* Firm rates not yet set warning */}
      {firmRates.length === 0 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            No Tax on Profits rates configured in Firm Wide Assumptions. The jurisdiction dropdown is disabled until the
            methodology admin adds rates (label, jurisdiction, applicability dates, rate %) under Firm Wide Assumptions
            → Tax on Profits.
          </span>
        </div>
      )}

      {/* Audit-team review summary — rolled-up audit test rows the
          auditor flagged for testing. This is the persistent surface
          a reviewer scans when they open Completion → Taxation → Tax
          on Profits between sessions. */}
      <AuditTestSummaryRows
        adjustments={data.adjustments}
        onOpen={(adj) => setAuditTestRow(adj)}
      />

      {/* AI verification banner — re-runs automatically when the
          Permanent-tab Taxation section content changes. The endpoint
          short-circuits when the section hasn't drifted, so the panel
          just calls it on mount. The manual button forces a re-check. */}
      <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-800">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            AI verification {data.aiVerification ? <>— confidence: <span className="font-bold">{data.aiVerification.confidence}</span></> : '— pending'}
          </div>
          <button
            onClick={() => void runAiVerify(true)}
            disabled={verifying}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            title="Force a fresh AI check ignoring the cached hash"
          >
            {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Re-check
          </button>
        </div>
        {data.aiVerification?.summary && (
          <p className="mt-1 leading-relaxed">{data.aiVerification.summary}</p>
        )}
        {data.aiVerification?.checkedAt && (
          <p className="mt-1 text-[10px] text-indigo-600">Last checked {new Date(data.aiVerification.checkedAt).toLocaleString('en-GB')}</p>
        )}
      </div>

      {/* Conclusion / sign-off */}
      <ConclusionEditor
        value={data.conclusion || ''}
        onSave={(c) => persist({ conclusion: c })}
      />

      {/* ── Jurisdiction picker pop-up ─────────────────────────────── */}
      {showJurisdictionPicker && (
        <JurisdictionPickerPopup
          firmRates={firmRates}
          existing={data.jurisdictions}
          onCancel={() => setShowJurisdictionPicker(false)}
          onSave={async (next, mode) => {
            await persist({ jurisdictions: next, rateMode: mode });
            setShowJurisdictionPicker(false);
            // First time through after picking jurisdictions: open the
            // computation pop-up automatically so the flow reads as
            // one continuous walkthrough.
            if (data.adjustments.length === 0) setShowComputation(true);
          }}
          saving={saving}
        />
      )}

      {/* ── Computation pop-up ────────────────────────────────────── */}
      {showComputation && (
        <ComputationPopup
          data={data}
          jurisdictionRates={jurisdictionRates}
          firmRates={firmRates}
          tbRows={allTbRows}
          effectiveRate={effectiveRate}
          minRate={minRate}
          maxRate={maxRate}
          onCancel={() => setShowComputation(false)}
          onSave={async (patch) => {
            await persist(patch);
            setShowComputation(false);
            // Any newly-flagged audit-test rows will be picked up by
            // the AuditTestSummaryRows component above.
          }}
          onPickAuditTest={(adj) => setAuditTestRow(adj)}
          saving={saving}
        />
      )}

      {/* ── Audit-test config pop-up (per-row workflow) ───────────── */}
      {auditTestRow && (
        <AuditTestPopup
          engagementId={engagementId}
          row={auditTestRow}
          onCancel={() => setAuditTestRow(null)}
          onSave={async (updatedTest) => {
            const next = data.adjustments.map(a =>
              a.id === auditTestRow.id ? { ...a, auditTest: updatedTest } : a,
            );
            await persist({ adjustments: next });
            setAuditTestRow(null);
          }}
          saving={saving}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function GatePopup({ message, tone = 'amber' }: { message: React.ReactNode; tone?: 'amber' | 'red' }) {
  const iconClass = tone === 'red' ? 'text-red-500' : 'text-amber-500';
  const wrapClass = tone === 'red' ? 'py-6 px-4 bg-red-50 border border-red-200 rounded-lg' : 'py-6 px-4 bg-amber-50 border border-amber-200 rounded-lg';
  return (
    <div className={wrapClass}>
      <div className="flex items-start gap-3">
        <AlertCircle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${iconClass}`} />
        <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// ── Jurisdiction picker ────────────────────────────────────────────────

function JurisdictionPickerPopup({
  firmRates, existing, onCancel, onSave, saving,
}: {
  firmRates: FirmTaxOnProfitsRate[];
  existing: TaxOnProfitsJurisdictionRow[];
  onCancel: () => void;
  onSave: (rows: TaxOnProfitsJurisdictionRow[], mode: 'highest' | 'lowest') => void;
  saving: boolean;
}) {
  const [rows, setRows] = useState<TaxOnProfitsJurisdictionRow[]>(
    existing.length > 0 ? existing : [{ jurisdiction: 'UK', percent: 100 }],
  );
  const [mode, setMode] = useState<'highest' | 'lowest'>('highest');

  const distinctJurisdictions = useMemo(
    () => Array.from(new Set(firmRates.map(r => r.jurisdiction).filter(Boolean))).sort(),
    [firmRates],
  );

  const total = rows.reduce((s, r) => s + (r.percent || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.01;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl my-8 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Jurisdictions of taxable profits</h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-600">
          Default is <strong>UK 100%</strong>. Add jurisdictions where profits are also taxed and adjust the percentage
          split — totals must equal 100%. Available jurisdictions are populated from Firm Wide Assumptions → Tax on Profits.
        </p>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs text-slate-500 uppercase">
                <th className="px-3 py-2 font-semibold">Jurisdiction</th>
                <th className="px-3 py-2 font-semibold w-32 text-right">% of profits</th>
                <th className="px-3 py-2 font-semibold w-32 text-right">Rate (period end)</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, idx) => {
                const rateRow = firmRates.find(fr => fr.jurisdiction === r.jurisdiction);
                return (
                  <tr key={idx}>
                    <td className="px-3 py-2">
                      <select
                        value={r.jurisdiction}
                        onChange={(e) => setRows(prev => prev.map((x, i) => i === idx ? { ...x, jurisdiction: e.target.value } : x))}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {!distinctJurisdictions.includes(r.jurisdiction) && (
                          <option value={r.jurisdiction}>{r.jurisdiction}</option>
                        )}
                        {distinctJurisdictions.map(j => <option key={j} value={j}>{j}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={r.percent}
                        onChange={(e) => setRows(prev => prev.map((x, i) => i === idx ? { ...x, percent: Number(e.target.value) || 0 } : x))}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-slate-600">{rateRow ? `${rateRow.ratePercent}% (${rateRow.label})` : '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}
                        disabled={rows.length === 1}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Remove jurisdiction"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={totalOk ? 'bg-slate-50' : 'bg-red-50'}>
                <td className="px-3 py-2 text-xs font-semibold text-slate-700">Total</td>
                <td className={`px-3 py-2 text-right text-xs font-semibold ${totalOk ? 'text-slate-700' : 'text-red-700'}`}>{total.toFixed(2)}%</td>
                <td colSpan={2} className="px-3 py-2 text-xs text-slate-500">
                  {!totalOk && 'Must total 100%'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <button
          onClick={() => setRows(prev => [
            ...prev,
            { jurisdiction: distinctJurisdictions.find(j => !prev.some(p => p.jurisdiction === j)) || 'UK', percent: 0 },
          ])}
          disabled={firmRates.length === 0}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Add jurisdiction
        </button>

        {rows.length > 1 && (
          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">Rate to use for the expected-tax row</div>
            <p className="text-[11px] text-slate-500 mb-2">
              When more than one jurisdiction applies, the computation grid shows the rate range. Pick which end of the
              range drives the expected-tax computation row.
            </p>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name="ratemode" checked={mode === 'highest'} onChange={() => setMode('highest')} />
                Highest rate
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name="ratemode" checked={mode === 'lowest'} onChange={() => setMode('lowest')} />
                Lowest rate
              </label>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 rounded hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSave(rows, mode)}
            disabled={!totalOk || saving}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Computation grid pop-up ────────────────────────────────────────────

function ComputationPopup({
  data, jurisdictionRates, firmRates, tbRows, effectiveRate, minRate, maxRate,
  onCancel, onSave, onPickAuditTest, saving,
}: {
  data: TaxOnProfitsData;
  jurisdictionRates: { jurisdiction: string; percent: number; rate: number; label: string }[];
  firmRates: FirmTaxOnProfitsRate[];
  tbRows: TBRow[];
  effectiveRate: number;
  minRate: number;
  maxRate: number;
  onCancel: () => void;
  onSave: (patch: Partial<TaxOnProfitsData>) => void;
  onPickAuditTest: (adj: TaxOnProfitsAdjustment) => void;
  saving: boolean;
}) {
  // Local working copy — auditors edit, then Save persists.
  const [accountingProfit, setAccountingProfit] = useState<number>(data.accountingProfit || 0);
  const [taxChargePerPL, setTaxChargePerPL] = useState<number>(data.taxChargePerPL || 0);
  const [adjustments, setAdjustments] = useState<TaxOnProfitsAdjustment[]>(data.adjustments);
  const [rateMode, setRateMode] = useState<'highest' | 'lowest'>(data.rateMode);

  const jurisdictionsCount = jurisdictionRates.length;

  function addAdjustment() {
    const seedJurisdictionMap: Record<string, number> = {};
    const editedMap: Record<string, boolean> = {};
    for (const j of jurisdictionRates) { seedJurisdictionMap[j.jurisdiction] = 0; editedMap[j.jurisdiction] = false; }
    setAdjustments(prev => [
      ...prev,
      {
        id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: '',
        accountCode: undefined,
        accountAmount: undefined,
        perJurisdiction: seedJurisdictionMap,
        perJurisdictionEdited: editedMap,
        disallowable: 0,
        selectedForAudit: false,
      },
    ]);
  }

  function removeAdjustment(id: string) {
    setAdjustments(prev => prev.filter(a => a.id !== id));
  }

  // When a TB row is picked, snap the description + accountAmount and
  // pro-rata-split the amount across the selected jurisdictions.
  function pickTbForRow(adjId: string, code: string) {
    const tb = tbRows.find(r => r.accountCode === code);
    if (!tb) return;
    const amount = tb.currentYear || 0;
    const newSplit: Record<string, number> = {};
    const newEdited: Record<string, boolean> = {};
    for (const j of jurisdictionRates) {
      newSplit[j.jurisdiction] = ZERO_DECIMALS(amount * (j.percent / 100));
      newEdited[j.jurisdiction] = false;
    }
    setAdjustments(prev => prev.map(a => a.id === adjId ? {
      ...a,
      description: tb.description,
      accountCode: tb.accountCode,
      accountAmount: amount,
      perJurisdiction: newSplit,
      perJurisdictionEdited: newEdited,
    } : a));
  }

  function setSplitCell(adjId: string, jurisdiction: string, value: number) {
    setAdjustments(prev => prev.map(a => {
      if (a.id !== adjId) return a;
      const nextSplit = { ...a.perJurisdiction, [jurisdiction]: value };
      const nextEdited = { ...a.perJurisdictionEdited, [jurisdiction]: true };
      return { ...a, perJurisdiction: nextSplit, perJurisdictionEdited: nextEdited };
    }));
  }

  function setDisallowable(adjId: string, value: number) {
    setAdjustments(prev => prev.map(a => a.id === adjId ? { ...a, disallowable: value } : a));
  }

  function toggleSelectedForAudit(adjId: string) {
    setAdjustments(prev => prev.map(a => a.id === adjId ? { ...a, selectedForAudit: !a.selectedForAudit } : a));
  }

  // Totals — sum each jurisdiction column + disallowable + grand total.
  const columnTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const j of jurisdictionRates) t[j.jurisdiction] = 0;
    let disallowable = 0;
    for (const a of adjustments) {
      for (const j of jurisdictionRates) t[j.jurisdiction] += a.perJurisdiction[j.jurisdiction] || 0;
      disallowable += a.disallowable || 0;
    }
    const grand = Object.values(t).reduce((s, v) => s + v, 0) + disallowable;
    return { perJurisdiction: t, disallowable, grand };
  }, [adjustments, jurisdictionRates]);

  // Expected tax = (accounting profit × rate × jurisdiction%) per
  // jurisdiction, summed. Shown per-jurisdiction in the rate row.
  const expectedTaxPerJurisdiction = useMemo(() => {
    const r: Record<string, number> = {};
    for (const j of jurisdictionRates) {
      r[j.jurisdiction] = ZERO_DECIMALS(accountingProfit * (j.rate / 100) * (j.percent / 100));
    }
    return r;
  }, [accountingProfit, jurisdictionRates]);
  const expectedTaxTotal = Object.values(expectedTaxPerJurisdiction).reduce((s, v) => s + v, 0);

  // Adjusted-profit tax — the sum of (jurisdiction-allocated profit ×
  // rate) plus any disallowable add-back at the effective rate.
  const adjustedProfitTax = useMemo(() => {
    let t = 0;
    for (const j of jurisdictionRates) {
      const adjustedProfit = accountingProfit * (j.percent / 100) + (columnTotals.perJurisdiction[j.jurisdiction] || 0);
      t += adjustedProfit * (j.rate / 100);
    }
    t += columnTotals.disallowable * (effectiveRate / 100);
    return ZERO_DECIMALS(t);
  }, [accountingProfit, jurisdictionRates, columnTotals, effectiveRate]);

  const variance = adjustedProfitTax - taxChargePerPL;
  const varianceMaterial = Math.abs(variance) > 1; // Auditor materiality consults are wider; 1 unit shows direction at minimum

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-6xl my-8 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Tax on Profits — computation</h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="h-4 w-4" /></button>
        </div>

        {/* Inputs row */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Accounting profit (PBT) £</label>
            <input
              type="number"
              step="0.01"
              value={accountingProfit}
              onChange={(e) => setAccountingProfit(Number(e.target.value) || 0)}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Tax charge per P&amp;L £</label>
            <input
              type="number"
              step="0.01"
              value={taxChargePerPL}
              onChange={(e) => setTaxChargePerPL(Number(e.target.value) || 0)}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {jurisdictionsCount > 1 && (
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Rate mode (high / low)</label>
              <select
                value={rateMode}
                onChange={(e) => setRateMode(e.target.value as 'highest' | 'lowest')}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="highest">Highest ({maxRate}%)</option>
                <option value="lowest">Lowest ({minRate}%)</option>
              </select>
            </div>
          )}
        </div>

        {/* Computation grid */}
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              {/* Headings row */}
              <tr className="text-left text-xs text-slate-600">
                <th className="px-3 py-2 font-semibold">Description</th>
                {jurisdictionRates.map(j => (
                  <th key={j.jurisdiction} className="px-3 py-2 font-semibold text-right">{j.jurisdiction}</th>
                ))}
                <th className="px-3 py-2 font-semibold text-right">Disallowable</th>
                <th className="px-3 py-2 font-semibold text-right">Total</th>
                <th className="px-3 py-2 font-semibold text-center w-32">Audit testing</th>
              </tr>
              {/* Sub-heading row — % per jurisdiction */}
              <tr className="text-left text-[10px] text-slate-500">
                <th className="px-3 py-1 italic font-normal">% of profits</th>
                {jurisdictionRates.map(j => (
                  <th key={j.jurisdiction} className="px-3 py-1 text-right italic font-normal">{j.percent}%</th>
                ))}
                <th className="px-3 py-1"></th>
                <th className="px-3 py-1 text-right italic font-normal">100%</th>
                <th className="px-3 py-1"></th>
              </tr>
              {/* Sub-sub-heading — tax rate per jurisdiction */}
              <tr className="text-left text-[10px] text-slate-500">
                <th className="px-3 py-1 italic font-normal">Tax rate</th>
                {jurisdictionRates.map(j => (
                  <th key={j.jurisdiction} className="px-3 py-1 text-right italic font-normal">{j.rate}%</th>
                ))}
                <th className="px-3 py-1"></th>
                <th className="px-3 py-1 text-right italic font-normal">
                  {jurisdictionsCount >= 2 ? `${minRate}% to ${maxRate}%` : `${jurisdictionRates[0]?.rate ?? 0}%`}
                </th>
                <th className="px-3 py-1"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Expected tax = profit × rate × jurisdiction% */}
              <tr className="bg-emerald-50/40">
                <td className="px-3 py-2 text-xs font-medium text-slate-700">Tax on accounting profit (profit × rate × jurisdiction%)</td>
                {jurisdictionRates.map(j => (
                  <td key={j.jurisdiction} className="px-3 py-2 text-right text-xs">£{expectedTaxPerJurisdiction[j.jurisdiction].toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                ))}
                <td className="px-3 py-2 text-right text-xs text-slate-400">—</td>
                <td className="px-3 py-2 text-right text-xs font-semibold">£{expectedTaxTotal.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2"></td>
              </tr>

              {/* Tax adjustments rows */}
              {adjustments.map(adj => {
                const rowSplitSum = jurisdictionRates.reduce((s, j) => s + (adj.perJurisdiction[j.jurisdiction] || 0), 0);
                const rowTotal = rowSplitSum + adj.disallowable;
                const splitMatchesAccount = adj.accountAmount === undefined || Math.abs(rowSplitSum - adj.accountAmount) < 0.01;
                return (
                  <tr key={adj.id}>
                    <td className="px-3 py-2 align-top w-72">
                      <TbCodePicker
                        tbRows={tbRows}
                        currentCode={adj.accountCode}
                        currentDescription={adj.description}
                        onPick={(code, description) => {
                          if (code) pickTbForRow(adj.id, code);
                          else setAdjustments(prev => prev.map(a => a.id === adj.id ? { ...a, description, accountCode: undefined, accountAmount: undefined } : a));
                        }}
                      />
                      {adj.accountCode && (
                        <div className="mt-1 text-[10px] text-slate-500">
                          {adj.accountCode} · TB amount £{(adj.accountAmount ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                        </div>
                      )}
                    </td>
                    {jurisdictionRates.map(j => {
                      const v = adj.perJurisdiction[j.jurisdiction] || 0;
                      const edited = adj.perJurisdictionEdited[j.jurisdiction];
                      return (
                        <td key={j.jurisdiction} className="px-1.5 py-2 align-top">
                          <input
                            type="number"
                            step="0.01"
                            value={v}
                            onChange={(e) => setSplitCell(adj.id, j.jurisdiction, Number(e.target.value) || 0)}
                            className={`w-full border rounded px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-1 ${
                              edited ? 'border-red-400 text-red-700 bg-red-50/40 focus:ring-red-300' : 'border-slate-200 focus:ring-blue-300'
                            }`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-1.5 py-2 align-top">
                      <input
                        type="number"
                        step="0.01"
                        value={adj.disallowable}
                        onChange={(e) => setDisallowable(adj.id, Number(e.target.value) || 0)}
                        className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
                      />
                    </td>
                    <td className={`px-3 py-2 align-top text-right text-xs font-medium ${
                      splitMatchesAccount ? '' : 'bg-red-600 text-white'
                    }`}>
                      £{rowTotal.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 align-top text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => toggleSelectedForAudit(adj.id)}
                          className={`w-3.5 h-3.5 rounded-full border ${
                            adj.selectedForAudit ? 'bg-orange-500 border-orange-600' : 'bg-white border-slate-300 hover:border-orange-400'
                          }`}
                          title={adj.selectedForAudit ? 'Selected for audit testing' : 'Select for audit testing'}
                          aria-pressed={adj.selectedForAudit}
                        />
                        {adj.selectedForAudit && (
                          <button
                            onClick={() => onPickAuditTest(adj)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200 hover:bg-orange-200"
                            title="Configure the audit test for this row"
                          >
                            Configure
                          </button>
                        )}
                        <button
                          onClick={() => removeAdjustment(adj.id)}
                          className="text-slate-400 hover:text-red-500"
                          title="Remove adjustment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Add row button */}
              <tr>
                <td colSpan={jurisdictionsCount + 4} className="px-3 py-2">
                  <button
                    onClick={addAdjustment}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    <Plus className="h-3 w-3" /> Add adjustment
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              {/* Column totals */}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-xs">Adjustments total</td>
                {jurisdictionRates.map(j => (
                  <td key={j.jurisdiction} className="px-3 py-2 text-right text-xs">£{(columnTotals.perJurisdiction[j.jurisdiction] || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                ))}
                <td className="px-3 py-2 text-right text-xs">£{columnTotals.disallowable.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 text-right text-xs">£{columnTotals.grand.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                <td></td>
              </tr>

              {/* Adjusted-profit tax computation row */}
              <tr className="bg-emerald-50">
                <td className="px-3 py-2 text-xs font-semibold text-slate-700">Computed tax on adjusted profits</td>
                <td colSpan={jurisdictionsCount + 1}></td>
                <td className="px-3 py-2 text-right text-xs font-semibold">£{adjustedProfitTax.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                <td></td>
              </tr>

              {/* P&L tax charge */}
              <tr>
                <td className="px-3 py-2 text-xs">Tax on profits per P&amp;L</td>
                <td colSpan={jurisdictionsCount + 1}></td>
                <td className="px-3 py-2 text-right text-xs">£{taxChargePerPL.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                <td></td>
              </tr>

              {/* Variance */}
              <tr className={varianceMaterial ? 'bg-red-50' : 'bg-green-50'}>
                <td className="px-3 py-2 text-xs font-semibold">Variance (computed − P&amp;L)</td>
                <td colSpan={jurisdictionsCount + 1}></td>
                <td className={`px-3 py-2 text-right text-xs font-semibold ${varianceMaterial ? 'text-red-700' : 'text-green-700'}`}>
                  £{variance.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-center">
                  {varianceMaterial && <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Variance flagged for review" />}
                  {!varianceMaterial && <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Variance immaterial" />}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 rounded hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSave({ accountingProfit, taxChargePerPL, adjustments, rateMode })}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Trial-balance code picker with intellisense ────────────────────────

function TbCodePicker({
  tbRows, currentCode, currentDescription, onPick,
}: {
  tbRows: TBRow[];
  currentCode?: string;
  currentDescription: string;
  onPick: (code: string | null, description: string) => void;
}) {
  const [query, setQuery] = useState(currentDescription || '');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    if (!query.trim()) return tbRows.slice(0, 20);
    const q = query.toLowerCase();
    return tbRows
      .filter(r => r.accountCode.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [tbRows, query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onPick(null, e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search TB code or description…"
        className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-60 overflow-y-auto">
          {matches.map(r => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(r.accountCode, r.description); setQuery(`${r.accountCode} — ${r.description}`); setOpen(false); }}
              className="w-full text-left px-2 py-1 text-[11px] hover:bg-blue-50 border-b border-slate-100 last:border-0"
            >
              <div className="font-mono text-slate-700">{r.accountCode}</div>
              <div className="text-slate-500 truncate">{r.description} · £{(r.currentYear ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audit test row summary (review surface) ────────────────────────────

function AuditTestSummaryRows({
  adjustments, onOpen,
}: {
  adjustments: TaxOnProfitsAdjustment[];
  onOpen: (adj: TaxOnProfitsAdjustment) => void;
}) {
  const flagged = adjustments.filter(a => a.selectedForAudit);
  if (flagged.length === 0) {
    return (
      <div className="px-3 py-3 bg-white border border-slate-200 rounded text-xs text-slate-500 italic">
        No adjustments flagged for audit testing yet. Open the computation grid and toggle the orange dot on any
        adjustment row to add it to the audit-test workflow.
      </div>
    );
  }
  return (
    <div className="border border-slate-200 rounded">
      <div className="px-3 py-1.5 bg-slate-50 text-[10px] uppercase font-semibold text-slate-500">Audit testing — flagged adjustments</div>
      <div className="divide-y divide-slate-100">
        {flagged.map(a => (
          <div key={a.id} className="px-3 py-2 flex items-center gap-3 text-xs">
            <div className="flex-1">
              <div className="font-medium text-slate-800">{a.description || '(no description)'}</div>
              <div className="text-[10px] text-slate-500">
                {a.auditTest?.testTypeName ? <>Test: <strong>{a.auditTest.testTypeName}</strong></> : <em>Test type not yet configured</em>}
                {a.auditTest?.action && <> · Action: <strong>{labelForAction(a.auditTest.action)}</strong></>}
                {a.auditTest?.evidenceStatus && <> · Status: <strong>{a.auditTest.evidenceStatus}</strong></>}
              </div>
            </div>
            <button
              onClick={() => onOpen(a)}
              className="text-[10px] px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200 hover:bg-orange-200"
            >
              {a.auditTest?.action ? 'Review' : 'Configure'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function labelForAction(action: TaxOnProfitsAction): string {
  if (action === 'explanation') return 'Add explanation';
  if (action === 'evidence') return 'Request evidence';
  return 'Request to Tax Specialist';
}

// ── Audit test config pop-up ───────────────────────────────────────────

function AuditTestPopup({
  engagementId, row, onCancel, onSave, saving,
}: {
  engagementId: string;
  row: TaxOnProfitsAdjustment;
  onCancel: () => void;
  onSave: (test: TaxOnProfitsAuditTest) => void;
  saving: boolean;
}) {
  const [testTypes, setTestTypes] = useState<{ id: string; name: string }[]>([]);
  const [test, setTest] = useState<TaxOnProfitsAuditTest>(row.auditTest || {});

  // Pull tax-on-profits test types from the methodology test bank.
  // Filter is loose — name contains "tax". Falls back to all types
  // when there's no match so the dropdown is never empty.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/methodology-admin/test-types`);
        if (!res.ok) return;
        const json = await res.json();
        const all: { id: string; name: string; code?: string }[] = json.types || [];
        const taxFiltered = all.filter(t => /tax|profit/i.test(t.name || ''));
        const final = (taxFiltered.length > 0 ? taxFiltered : all).map(t => ({ id: t.id, name: t.name }));
        setTestTypes(final);
      } catch { /* keep empty list */ }
    })();
  }, []);

  async function fireRequestEvidence() {
    // Send a document request via the existing engagement documents API.
    // The "batching" requirement is satisfied by the underlying portal
    // queue: multiple pending requests for the same client are sent
    // in one outgoing message — no extra plumbing needed here.
    const documentName = `Evidence — ${row.description}`;
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request',
          documentName,
          requestedFrom: 'client',
          mappedItems: [{ source: 'tax-on-profits', adjustmentId: row.id }],
          source: { kind: 'tax-on-profits', adjustmentId: row.id },
          usageLocation: 'completion.taxation.tax-on-profits',
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.document?.id || null) as string | null;
    } catch { return null; }
  }

  async function fireSpecialistRequest() {
    // Routes through the existing schedule-action specialist hand-off.
    // `consult_tax_technical` is the seeded action under
    // SCHEDULE_ACTIONS; the items endpoint resolves it, picks the
    // tax_technical role, and idempotency-tags the created chat with
    // the adjustment id so re-saving doesn't duplicate.
    try {
      const res = await fetch(`/api/engagements/${engagementId}/specialists/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleActionKey: 'consult_tax_technical',
          questionId: `tax_on_profits:${row.id}`,
          questionText: `Tax on profits adjustment — ${row.description}`,
          response: `Account code: ${row.accountCode || '—'}\nPer-jurisdiction split: ${JSON.stringify(row.perJurisdiction)}\nDisallowable: ${row.disallowable}`,
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.itemId || json.id || null) as string | null;
    } catch { return null; }
  }

  async function handleSave() {
    let next = { ...test };
    if (test.action === 'evidence' && !test.documentRequestId) {
      const reqId = await fireRequestEvidence();
      if (reqId) next.documentRequestId = reqId;
      next.evidenceStatus = 'pending';
    }
    if (test.action === 'specialist' && !test.specialistChatId) {
      const chatId = await fireSpecialistRequest();
      if (chatId) next.specialistChatId = chatId;
    }
    onSave(next);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl my-8 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Audit test for: {row.description || '(no description)'}</h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="h-4 w-4" /></button>
        </div>

        {/* Test type picker */}
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Audit test type</label>
          <select
            value={test.testTypeId || ''}
            onChange={(e) => {
              const t = testTypes.find(x => x.id === e.target.value);
              setTest(prev => ({ ...prev, testTypeId: t?.id, testTypeName: t?.name }));
            }}
            className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select test type…</option>
            {testTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Three seeded actions */}
        <div className="space-y-2">
          <label className="block text-[11px] font-medium text-slate-600">Action</label>
          <div className="grid grid-cols-3 gap-2">
            <ActionCard
              icon={<MessageSquare className="h-4 w-4" />}
              title="Add explanation"
              description="Free-text explanation kept on file for review."
              active={test.action === 'explanation'}
              onClick={() => setTest(prev => ({ ...prev, action: 'explanation' }))}
            />
            <ActionCard
              icon={<FileQuestion className="h-4 w-4" />}
              title="Request evidence"
              description="Send a document request via the client portal. AI compares the response to the booked amount."
              active={test.action === 'evidence'}
              onClick={() => setTest(prev => ({ ...prev, action: 'evidence' }))}
            />
            <ActionCard
              icon={<UserCheck className="h-4 w-4" />}
              title="Request to Tax Specialist"
              description="Spawn a chat with the firm's tax-technical specialist for review and comment."
              active={test.action === 'specialist'}
              onClick={() => setTest(prev => ({ ...prev, action: 'specialist' }))}
            />
          </div>
        </div>

        {/* Action-specific fields */}
        {test.action === 'explanation' && (
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Explanation</label>
            <textarea
              rows={4}
              value={test.explanation || ''}
              onChange={(e) => setTest(prev => ({ ...prev, explanation: e.target.value }))}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Document the audit team's view on this adjustment."
            />
          </div>
        )}

        {test.action === 'evidence' && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            On Save, a document request will be queued for the client portal. Existing pending requests for this client
            are batched into the same outgoing message — no additional client message is sent for new items if a batch
            is already pending.
            {test.documentRequestId && (
              <div className="mt-1 text-[11px] text-slate-600">
                Existing request id: <code className="bg-white px-1 rounded">{test.documentRequestId}</code>
                {test.evidenceStatus && <> · status <strong>{test.evidenceStatus}</strong></>}
              </div>
            )}
          </div>
        )}

        {test.action === 'specialist' && (
          <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-800">
            On Save, a tax-technical specialist chat will be opened with the row context. The specialist can review and
            post comments back to this row.
            {test.specialistChatId && (
              <div className="mt-1 text-[11px] text-slate-600">
                Existing chat id: <code className="bg-white px-1 rounded">{test.specialistChatId}</code>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Reviewer comments</label>
          <textarea
            rows={2}
            value={test.reviewComments || ''}
            onChange={(e) => setTest(prev => ({ ...prev, reviewComments: e.target.value }))}
            className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Optional review notes."
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 rounded hover:bg-slate-50">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !test.action}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  icon, title, description, active, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2 rounded border transition-colors ${
        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 mb-1">{icon}{title}</div>
      <div className="text-[10px] text-slate-500 leading-snug">{description}</div>
    </button>
  );
}

// ── Conclusion editor ─────────────────────────────────────────────────

function ConclusionEditor({ value, onSave }: { value: string; onSave: (s: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  return (
    <div className="border border-slate-200 rounded">
      <div className="px-3 py-1.5 bg-slate-50 text-[10px] uppercase font-semibold text-slate-500">Conclusion</div>
      <div className="p-3 space-y-2">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Audit team's conclusion on tax on profits — basis for the charge, key judgements, residual risks."
        />
        {dirty && (
          <div className="flex justify-end">
            <button
              onClick={() => { onSave(draft); setDirty(false); }}
              className="px-2 py-1 text-[11px] font-medium bg-slate-700 text-white rounded hover:bg-slate-800"
            >
              Save conclusion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
