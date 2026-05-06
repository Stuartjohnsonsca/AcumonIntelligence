'use client';

/**
 * VAT Reconciliation Panel
 *
 * Launched as a modal from the Revenue section of the Audit Plan.
 * This first commit covers:
 *   1. Permanent-tab gate (3 pop-up paths: unanswered / No / Yes)
 *   2. Setup pop-up — "Are VAT rates consistent across revenue codes?"
 *      (asked once, editable later via the toolbar Settings button)
 *   3. Revenue Code → VAT mapping (one row per Revenue TB account; Code,
 *      Description, Dr, Cr, VAT rate dropdown). Mappings persist as
 *      they're saved; orange dot per unmapped row, green when complete.
 *
 * The reconciliation grid (period rows, Verified-to-Bank, TB compare,
 * Net Revenue cross-check) and VAT-return upload / portal request are
 * built in subsequent commits — see lib/vat-reconciliation.ts.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Settings } from 'lucide-react';
import {
  EMPTY_VAT_REC,
  formatRateLabel,
  isRevenueFsLevel,
  readFirmVatConfig,
  readPerformanceMateriality,
  readVatAnchor,
  readVatRegistration,
  VAT_PERMANENT_QUESTION_LABEL,
  type FirmVatConfig,
  type FirmVatRate,
  type VatRecData,
  type VatRegistration,
  type VatRevenueMapping,
} from '@/lib/vat-reconciliation';
import { VatReconciliationGrid } from './VatReconciliationGrid';

interface TBRow {
  id: string;
  accountCode: string;
  description: string;
  fsLevel: string | null;
  fsStatement: string | null;
  currentYear: number | null;
}

interface Props {
  engagementId: string;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  onClose: () => void;
}

type Gate =
  | { kind: 'loading' }
  | { kind: 'unanswered' }
  | { kind: 'not_registered' }
  | { kind: 'ready' };

export function VatReconciliationPanel({ engagementId, periodStartDate, periodEndDate, onClose }: Props) {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [registration, setRegistration] = useState<VatRegistration | null>(null);
  const [clientName, setClientName] = useState('');
  const [data, setData] = useState<VatRecData>(EMPTY_VAT_REC);
  const [firmVat, setFirmVat] = useState<FirmVatConfig>({ rates: [], thresholds: [] });
  const [allTbRows, setAllTbRows] = useState<TBRow[]>([]);
  const [revenueRows, setRevenueRows] = useState<TBRow[]>([]);
  const [mappingRow, setMappingRow] = useState<TBRow | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [perfMateriality, setPerfMateriality] = useState(0);
  const [anchor, setAnchor] = useState<{ anchorIso: string; isPlaceholder: boolean }>(
    { anchorIso: periodEndDate || '', isPlaceholder: true }
  );

  // ── Load everything once on open ────────────────────────────────────
  const load = useCallback(async () => {
    const [recRes, reg, firmCfg, tbRes, pm, anc] = await Promise.all([
      fetch(`/api/engagements/${engagementId}/vat-reconciliation`).then(r => r.ok ? r.json() : { data: {}, clientName: '' }),
      readVatRegistration(engagementId),
      readFirmVatConfig(),
      fetch(`/api/engagements/${engagementId}/trial-balance`).then(r => r.ok ? r.json() : { rows: [] }),
      readPerformanceMateriality(engagementId),
      readVatAnchor(engagementId, periodEndDate || ''),
    ]);

    setRegistration(reg);
    setClientName(recRes.clientName || '');
    setFirmVat(firmCfg);
    setPerfMateriality(pm);
    setAnchor(anc);
    const merged: VatRecData = { ...EMPTY_VAT_REC, ...(recRes.data || {}) };
    setData(merged);

    const allRows: TBRow[] = tbRes.rows || [];
    setAllTbRows(allRows);
    const revenue = allRows.filter(r => isRevenueFsLevel(r.fsLevel));
    setRevenueRows(revenue);

    // Decide which screen to show.
    if (reg.status === 'unanswered') setGate({ kind: 'unanswered' });
    else if (reg.status === 'No') setGate({ kind: 'not_registered' });
    else {
      setGate({ kind: 'ready' });
      // First-time-through prompts the setup pop-up.
      if (merged.ratesConsistent === null || merged.ratesConsistent === undefined) {
        setShowSetup(true);
      }
    }
  }, [engagementId, periodEndDate]);

  useEffect(() => { load(); }, [load]);

  // ── Save helpers ────────────────────────────────────────────────────
  async function persist(patch: Partial<VatRecData>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/vat-reconciliation`, {
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
  }

  async function saveRatesConsistent(consistent: boolean) {
    await persist({ ratesConsistent: consistent });
    setShowSetup(false);
  }

  async function saveMapping(row: TBRow, mapping: Omit<VatRevenueMapping, 'savedAt' | 'savedBy'>) {
    const next = {
      ...data.revenueMappings,
      [row.accountCode]: {
        ...mapping,
        savedAt: new Date().toISOString(),
        savedBy: '', // server can fill from session in a later pass; for now leave blank
      },
    };
    await persist({ revenueMappings: next });
    setMappingRow(null);
  }

  // ── Derived ─────────────────────────────────────────────────────────
  const mappedCount = useMemo(
    () => revenueRows.filter(r => !!data.revenueMappings[r.accountCode]).length,
    [revenueRows, data.revenueMappings]
  );
  const allMapped = revenueRows.length > 0 && mappedCount === revenueRows.length;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <Modal onClose={onClose} title="VAT Reconciliation">
      {gate.kind === 'loading' && (
        <div className="py-12 text-center text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading…
        </div>
      )}

      {gate.kind === 'unanswered' && (
        <GatePopup
          message={
            <>Whether <strong>{clientName || 'the client'}</strong> is subject to VAT or not has not been set.
            Please answer the question <em>"{VAT_PERMANENT_QUESTION_LABEL}"</em> in the Permanent tab.</>
          }
          onClose={onClose}
        />
      )}

      {gate.kind === 'not_registered' && (
        <GatePopup
          tone={registration?.shouldRegister === 'aboveThreshold' ? 'red' : 'amber'}
          message={
            registration?.shouldRegister === 'aboveThreshold' ? (
              <>
                <strong>{clientName || 'The client'}</strong> is <strong>not registered</strong> for VAT but the
                Permanent tab indicates revenue is <strong>above the registration threshold</strong>.{' '}
                This is a potential compliance breach — refer to a tax specialist <strong>before</strong> signing off
                the audit.
              </>
            ) : (
              <>
                <strong>{clientName || 'The client'}</strong> is not registered for VAT.
                Please seek specialist tax advice if you believe <strong>{clientName || 'the client'}</strong> should be VAT registered.
              </>
            )
          }
          onClose={onClose}
        />
      )}

      {gate.kind === 'ready' && (
        <div className="space-y-4">
          {/* Toolbar — periodicity badge, setup re-open, status */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-[10px] uppercase tracking-wide text-indigo-700 font-semibold">Client:</span>
              <span className="font-semibold text-slate-800">{clientName || '—'}</span>
              <span className="text-slate-300">|</span>
              <span className="text-[10px] uppercase tracking-wide text-indigo-700 font-semibold">VAT Periodicity:</span>
              <span className="font-medium text-slate-700">{registration?.periodicity || <em className="text-amber-600">not set</em>}</span>
              <span className="text-slate-300">|</span>
              <span className="text-[10px] uppercase tracking-wide text-indigo-700 font-semibold">Rates consistent:</span>
              <span className="font-medium text-slate-700">{data.ratesConsistent === true ? 'Yes' : data.ratesConsistent === false ? 'No' : <em className="text-amber-600">not set</em>}</span>
            </div>
            <button
              onClick={() => setShowSetup(true)}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100"
              title="Re-open setup — change whether VAT rates are consistent across revenue codes"
            >
              <Settings className="h-3 w-3" />
              Setup
            </button>
          </div>

          {/* Firm VAT config not yet set warning */}
          {firmVat.rates.length === 0 && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                No VAT rates configured in Firm Wide Assumptions. Mapping is disabled until the methodology admin
                adds VAT rates (label, jurisdiction, rate %) under Firm Wide Assumptions → VAT.
              </span>
            </div>
          )}

          {/* Revenue mapping table */}
          <RevenueMappingTable
            rows={revenueRows}
            mappings={data.revenueMappings}
            ratesConsistent={data.ratesConsistent}
            firmRates={firmVat.rates}
            mappedCount={mappedCount}
            allMapped={allMapped}
            disabled={firmVat.rates.length === 0}
            onPick={setMappingRow}
          />

          {/* Reconciliation grid */}
          {periodStartDate && periodEndDate ? (
            <VatReconciliationGrid
              data={data}
              firmRates={firmVat.rates}
              periodicity={registration?.periodicity}
              anchorIso={anchor.anchorIso}
              anchorIsPlaceholder={anchor.isPlaceholder}
              periodStartIso={periodStartDate}
              periodEndIso={periodEndDate}
              jurisdiction={firmVat.rates[0]?.jurisdiction || 'UK'}
              performanceMateriality={perfMateriality}
              tbRows={allTbRows.map(r => ({ accountCode: r.accountCode, description: r.description, currentYear: r.currentYear }))}
              onPatch={persist}
            />
          ) : (
            <div className="px-3 py-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              Engagement period start / end not available — open this calculator from a fully configured engagement.
            </div>
          )}
        </div>
      )}

      {/* ── Setup pop-up (consistent VAT rates?) ─────────────────────── */}
      {showSetup && gate.kind === 'ready' && (
        <SetupPopup
          current={data.ratesConsistent ?? null}
          onCancel={() => setShowSetup(false)}
          onSave={saveRatesConsistent}
          saving={saving}
        />
      )}

      {/* ── Per-account mapping pop-up ────────────────────────────────── */}
      {mappingRow && (
        <MappingPopup
          row={mappingRow}
          firmRates={firmVat.rates}
          ratesConsistent={data.ratesConsistent === true}
          existing={data.revenueMappings[mappingRow.accountCode]}
          onCancel={() => setMappingRow(null)}
          onSave={(m) => saveMapping(mappingRow, m)}
          saving={saving}
        />
      )}
    </Modal>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-4xl my-8">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function GatePopup({ message, onClose, tone = 'amber' }: { message: React.ReactNode; onClose: () => void; tone?: 'amber' | 'red' }) {
  const iconClass = tone === 'red' ? 'text-red-500' : 'text-amber-500';
  const wrapClass = tone === 'red' ? 'py-6 px-4 bg-red-50/40 border border-red-200 rounded-lg' : 'py-6 px-4';
  return (
    <div className={wrapClass}>
      <div className="flex items-start gap-3 mb-4">
        <AlertCircle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${iconClass}`} />
        <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      </div>
      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium bg-slate-700 text-white rounded hover:bg-slate-800">
          Close
        </button>
      </div>
    </div>
  );
}

function SetupPopup({
  current, onCancel, onSave, saving,
}: { current: boolean | null; onCancel: () => void; onSave: (consistent: boolean) => void; saving: boolean }) {
  const [pick, setPick] = useState<boolean | null>(current);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">VAT rate setup</h3>
        <p className="text-xs text-slate-600 mb-4">
          Are VAT rates <strong>consistent</strong> across every revenue code? When yes, each revenue code gets one
          VAT rate selection. When no, each line accepts a per-revenue-code rate (or a custom % you enter).
        </p>
        <div className="space-y-2 mb-5">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="radio" checked={pick === true} onChange={() => setPick(true)} />
            <span>Yes — consistent across revenue codes</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="radio" checked={pick === false} onChange={() => setPick(false)} />
            <span>No — different rates apply across revenue codes</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => pick !== null && onSave(pick)}
            disabled={pick === null || saving}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RevenueMappingTable({
  rows, mappings, ratesConsistent, firmRates, mappedCount, allMapped, disabled, onPick,
}: {
  rows: TBRow[];
  mappings: Record<string, VatRevenueMapping>;
  ratesConsistent: boolean | null | undefined;
  firmRates: FirmVatRate[];
  mappedCount: number;
  allMapped: boolean;
  disabled: boolean;
  onPick: (row: TBRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded">
        No TB rows mapped to a Revenue FS Level. Classify revenue accounts in the Trial Balance first.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="text-xs font-semibold text-slate-700">Revenue Codes — VAT mapping</div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${allMapped ? 'bg-green-100 text-green-700' : mappedCount > 0 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
            {allMapped && <CheckCircle2 className="h-3 w-3" />}
            {mappedCount} / {rows.length} mapped
          </span>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-2 py-1 text-left font-semibold text-slate-600">Code</th>
            <th className="px-2 py-1 text-left font-semibold text-slate-600">Description</th>
            <th className="px-2 py-1 text-right font-semibold text-slate-600">Dr</th>
            <th className="px-2 py-1 text-right font-semibold text-slate-600">Cr</th>
            <th className="px-2 py-1 text-left font-semibold text-slate-600">VAT mapping</th>
            <th className="px-2 py-1 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const m = mappings[r.accountCode];
            const cy = Number(r.currentYear) || 0;
            const dr = cy > 0 ? cy : 0;
            const cr = cy < 0 ? -cy : 0;
            const rate = m ? firmRates.find(fr => fr.id === m.vatRateId) : null;
            const ratePct = m?.ratePercentOverride ?? rate?.ratePercent;
            return (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="px-2 py-1 font-mono text-slate-500">{r.accountCode}</td>
                <td className="px-2 py-1 text-slate-700">{r.description}</td>
                <td className="px-2 py-1 text-right tabular-nums">{dr ? dr.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                <td className="px-2 py-1 text-right tabular-nums">{cr ? cr.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                <td className="px-2 py-1">
                  {m ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Mapped" />
                      <span className="text-slate-700">
                        {rate ? formatRateLabel(rate) : <em className="text-red-500">rate removed</em>}
                        {ratesConsistent === false && ratePct !== undefined && rate && ratePct !== rate.ratePercent && (
                          <span className="ml-1 text-amber-600">(override {ratePct}%)</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" title="VAT calculator wording — incomplete" />
                      <span className="text-orange-700 italic">VAT calculator — not yet mapped</span>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    onClick={() => onPick(r)}
                    disabled={disabled}
                    className="text-[10px] font-medium px-2 py-0.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {m ? 'Edit' : 'Map'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MappingPopup({
  row, firmRates, ratesConsistent, existing, onCancel, onSave, saving,
}: {
  row: TBRow;
  firmRates: FirmVatRate[];
  ratesConsistent: boolean;
  existing: VatRevenueMapping | undefined;
  onCancel: () => void;
  onSave: (m: Omit<VatRevenueMapping, 'savedAt' | 'savedBy'>) => void;
  saving: boolean;
}) {
  const [vatRateId, setVatRateId] = useState(existing?.vatRateId || '');
  const [override, setOverride] = useState<string>(
    existing?.ratePercentOverride !== undefined ? String(existing.ratePercentOverride) : ''
  );

  const cy = Number(row.currentYear) || 0;
  const dr = cy > 0 ? cy : 0;
  const cr = cy < 0 ? -cy : 0;
  const selectedRate = firmRates.find(r => r.id === vatRateId);

  function submit() {
    if (!vatRateId) return;
    const m: Omit<VatRevenueMapping, 'savedAt' | 'savedBy'> = {
      vatRateId,
      dr,
      cr,
      description: row.description,
    };
    if (!ratesConsistent && override.trim() !== '') {
      const n = Number(override);
      if (!Number.isNaN(n)) m.ratePercentOverride = n;
    }
    onSave(m);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Map VAT rate — {row.accountCode}</h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100 text-slate-500" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <table className="w-full text-xs border border-slate-200 rounded overflow-hidden">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-2 py-1 text-left font-semibold text-slate-600">Code</th>
                <th className="px-2 py-1 text-left font-semibold text-slate-600">Description</th>
                <th className="px-2 py-1 text-right font-semibold text-slate-600">Dr Amount</th>
                <th className="px-2 py-1 text-right font-semibold text-slate-600">Cr Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-2 py-1 font-mono text-slate-500">{row.accountCode}</td>
                <td className="px-2 py-1 text-slate-700">{row.description}</td>
                <td className="px-2 py-1 text-right tabular-nums">{dr ? dr.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums">{cr ? cr.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}</td>
              </tr>
            </tbody>
          </table>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">VAT rate</label>
            <select
              value={vatRateId}
              onChange={(e) => setVatRateId(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
            >
              <option value="">— select a VAT rate —</option>
              {firmRates.map(r => (
                <option key={r.id} value={r.id}>{formatRateLabel(r)}</option>
              ))}
            </select>
          </div>

          {!ratesConsistent && selectedRate && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Override rate % for this revenue code <span className="text-slate-400">(optional — leave blank to use {selectedRate.ratePercent}%)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder={`${selectedRate.ratePercent}`}
                className="w-32 text-xs border border-slate-300 rounded px-2 py-1.5"
              />
            </div>
          )}

          <div className="text-[11px] text-slate-500 italic">
            Saving here marks the row mapped. You can re-open and edit at any time — changes are stored against the
            engagement so reviewers can audit the trail.
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!vatRateId || saving}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save mapping
          </button>
        </div>
      </div>
    </div>
  );
}
