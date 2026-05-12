'use client';

/**
 * Loan Calculator panel — receivables and liabilities.
 *
 * Lifecycle screens:
 *   1. Setup     — how many loans, max tranches, override side.
 *   2. Source    — pick where the loan documentation comes from
 *                  (Client portal, Upload, Prior period, User entry).
 *   3. Sheets    — tabbed spreadsheet view: Lead summary + one tab
 *                  per loan with header + schedule.
 *   4. Tests     — five tests with traffic-light dots + comments.
 *   5. Disclosure— maturity buckets (amounts + payments), penalties,
 *                  security checks.
 *   6. Branch    — liabilities → covenants; receivables → impairment + FMV.
 *
 * Persists the entire blob to /api/engagements/[id]/loan-calculator via
 * PUT (shallow merge). The first PUT happens on Step 1 Save so even a
 * partial-fill session lives across page reloads.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Loader2, X, Upload, Cloud, History, UserPlus, FileText, Plus, Trash2,
  AlertTriangle, ChevronRight, ChevronLeft, Calculator,
  Send, Sparkles, RefreshCw,
} from 'lucide-react';
import {
  emptyLoanCalc, emptyHeader, buildLoanLabel, fmtCcy,
  generateScheduleRows, aggregateLeadRow,
  type LoanCalcData, type LoanTab, type LoanHeader, type LoanScheduleRow,
  type LoanSide, type Periodicity, type DayCount, type DotStatus,
  type TestResult, type LoanCovenant, type LoanPenalty,
} from '@/lib/loan-calculator';

interface Props {
  engagementId: string;
  /** Auto-detected from the FS Level the button was clicked on. */
  initialSide: LoanSide;
  /** Engagement period — used for schedule generation + lead aggregation. */
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  /** Closing call from the modal host. */
  onClose: () => void;
}

type Screen = 'setup' | 'source' | 'sheets' | 'tests' | 'disclosure' | 'branch';

const PERIODICITY_OPTS: Periodicity[] = ['Monthly', 'Quarterly', 'Semi-annual', 'Annual'];
const DAYCOUNT_OPTS: DayCount[] = ['Actual/365', 'Actual/360', '30/360'];

export function LoanCalculatorPanel({ engagementId, initialSide, periodStartDate, periodEndDate, onClose }: Props) {
  const [data, setData] = useState<LoanCalcData>(() => emptyLoanCalc(initialSide));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [screen, setScreen] = useState<Screen>('setup');
  const [activeLoanId, setActiveLoanId] = useState<string>('__lead__');
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState<string>('');

  // ── Load on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/engagements/${engagementId}/loan-calculator`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        if (cancelled) return;
        const blob = j.data as Partial<LoanCalcData> | null;
        if (blob && (blob as any).side) {
          // Merge over defaults so newly-added keys still get sensible
          // empties when reading an older row.
          setData({ ...emptyLoanCalc((blob as any).side as LoanSide), ...(blob as LoanCalcData) });
          // If the loaded blob has at least one loan, jump straight to sheets.
          if (Array.isArray((blob as any).loans) && (blob as any).loans.length > 0) {
            setScreen('sheets');
            setActiveLoanId('__lead__');
          }
        } else {
          setData(emptyLoanCalc(initialSide));
        }
      } catch (err: any) {
        setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId, initialSide]);

  // ── Save (shallow merge) ───────────────────────────────────────────
  const save = async (patch: Partial<LoanCalcData>) => {
    setSaving(true);
    try {
      const next = { ...data, ...patch };
      setData(next);
      await fetch(`/api/engagements/${engagementId}/loan-calculator`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: patch }),
      });
    } finally {
      setSaving(false);
    }
  };

  // Lead summary — re-aggregated whenever loans change.
  const leadRow = useMemo(() => {
    if (!periodStartDate || !periodEndDate) return null;
    return aggregateLeadRow(data.loans, periodStartDate.slice(0, 10), periodEndDate.slice(0, 10));
  }, [data.loans, periodStartDate, periodEndDate]);

  const sideLabel = data.side === 'receivable' ? 'Loan Receivables' : 'Loan Liabilities';
  const lenderLabel = data.side === 'receivable' ? 'Borrower' : 'Lender';

  // ── Screen renderers ───────────────────────────────────────────────
  const renderSetup = () => (
    <div className="space-y-5">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Step 1 — Setup</div>
        <div className="text-sm text-slate-700 mb-4">
          Confirm the loan count and maximum number of tranches so we can size the schedule grid correctly.
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs font-semibold text-slate-700 mb-1">Side</div>
            <select
              value={data.side}
              onChange={e => save({ side: e.target.value as LoanSide })}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
            >
              <option value="receivable">Loan Receivables (assets)</option>
              <option value="liability">Loan Liabilities (creditors)</option>
            </select>
          </label>
          <div />

          <label className="block">
            <div className="text-xs font-semibold text-slate-700 mb-1">Number of loans</div>
            <input
              type="number" min={1} step={1}
              value={data.setup.loanCount}
              onChange={e => save({ setup: { ...data.setup, loanCount: Math.max(1, parseInt(e.target.value || '1', 10)) } })}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
            />
            <p className="text-[10px] text-slate-500 mt-1">More than one? Each loan gets its own sheet tab.</p>
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-slate-700 mb-1">Maximum tranches per loan</div>
            <input
              type="number" min={1} step={1}
              value={data.setup.maxTranches}
              onChange={e => save({ setup: { ...data.setup, maxTranches: Math.max(1, parseInt(e.target.value || '1', 10)) } })}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
            />
            <p className="text-[10px] text-slate-500 mt-1">The most a single loan has been drawn down in separate tranches.</p>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setScreen('source')}
          className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2"
        >
          Continue <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  // ── Source picker ──────────────────────────────────────────────────
  const renderSource = () => (
    <div className="space-y-5">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Step 2 — Loan documentation source</div>
        <div className="text-sm text-slate-700 mb-4">
          Pick where to pull the loan documentation from. We'll extract the loan header, schedule, covenants and penalties from whatever you supply.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SourceTile
            icon={<Cloud className="h-5 w-5" />}
            title="From client (Portal)"
            sub="Ask the client to upload their signed agreements + recent lender statements via the portal."
            onClick={() => requestFromClient('documents')}
            disabled={busy === 'request'}
          />
          <SourceTile
            icon={<Upload className="h-5 w-5" />}
            title="Upload"
            sub="Upload PDF / DOCX / XLSX you already have on file. We extract automatically."
            onClick={() => document.getElementById('loan-calc-upload-input')?.click()}
          />
          <SourceTile
            icon={<History className="h-5 w-5" />}
            title="From prior period"
            sub="Copy loan setup, lender names and covenants from the prior engagement. Period flows reset."
            onClick={copyFromPrior}
            disabled={busy === 'prior'}
          />
          <SourceTile
            icon={<UserPlus className="h-5 w-5" />}
            title="From user"
            sub="Enter loan details by hand. Name + timestamp captured automatically — fields stay editable."
            onClick={() => addLoanManual()}
          />
        </div>

        <input
          id="loan-calc-upload-input"
          type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.txt,.csv"
          className="hidden"
          onChange={onUpload}
        />
      </div>

      {data.loans.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <div className="text-xs font-semibold text-slate-700 mb-2">Loans captured so far</div>
          <ul className="text-xs text-slate-600 space-y-1">
            {data.loans.map((l, i) => (
              <li key={l.id} className="flex items-center justify-between">
                <span>{i + 1}. {l.label}</span>
                <button onClick={() => removeLoan(l.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <button onClick={() => setScreen('setup')} className="px-4 py-2 text-sm rounded border border-slate-300 inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Back</button>
        <button
          onClick={() => setScreen('sheets')}
          disabled={data.loans.length === 0}
          className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
        >
          Open sheets <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  // ── Helpers used by the source screen ──────────────────────────────
  const requestFromClient = async (kind: 'documents'|'covenants'|'impairment_evidence') => {
    setBusy('request');
    try {
      const labels = data.loans.map(l => l.label);
      const r = await fetch(`/api/engagements/${engagementId}/loan-calculator/request-from-client`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, loanLabels: labels }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      await save({ ...(kind === 'documents' ? { documentsRequest: { portalRequestId: j.id, sentAt: j.sentAt } } as any : {}) });
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy('');
    }
  };

  const copyFromPrior = async () => {
    setBusy('prior');
    try {
      const r = await fetch(`/api/engagements/${engagementId}/loan-calculator/copy-from-prior`, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setData({ ...emptyLoanCalc(j.data.side), ...j.data });
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy('');
    }
  };

  const addLoanManual = () => {
    const id = `loan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const header = emptyHeader();
    const newLoan: LoanTab = {
      id,
      label: buildLoanLabel(header, data.loans.length),
      header,
      schedule: [],
      documents: [{
        id: `manual_${Date.now()}`,
        source: 'manual',
        name: 'User-entered',
        capturedBy: 'current user',
        capturedAt: new Date().toISOString(),
        notes: '',
      }],
      covenants: [],
      penalties: [],
    };
    save({ loans: [...data.loans, newLoan] });
    setActiveLoanId(id);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBusy('upload');
    try {
      // Upload each file as an AuditDocument first, then call extract.
      const docIds: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('documentName', file.name);
        fd.append('documentType', 'Loan agreement');
        const up = await fetch(`/api/engagements/${engagementId}/loan-calculator/upload`, { method: 'POST', body: fd });
        if (up.ok) {
          const j = await up.json();
          if (j?.documentId) docIds.push(j.documentId);
        }
      }
      if (docIds.length === 0) throw new Error('Upload failed');
      // Now extract.
      const r = await fetch(`/api/engagements/${engagementId}/loan-calculator/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: docIds, side: data.side }),
      });
      const j = await r.json();
      if (j?.error) setError(j.error);
      ingestExtracted(j?.loans || [], docIds);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy('');
      e.target.value = '';
    }
  };

  const ingestExtracted = (loans: any[], docIds: string[]) => {
    if (loans.length === 0) return;
    const now = new Date().toISOString();
    const newLoans: LoanTab[] = loans.map((l, i) => {
      const header = { ...emptyHeader(), ...(l.header || {}) } as LoanHeader;
      const id = `loan_${Date.now()}_${i}`;
      return {
        id,
        label: buildLoanLabel(header, data.loans.length + i),
        header,
        schedule: Array.isArray(l.schedule) && l.schedule.length > 0
          ? l.schedule
          : (header.drawdownDate && periodEndDate
              ? generateScheduleRows(header.drawdownDate, periodEndDate.slice(0,10), header.loanPeriodicity)
              : []),
        documents: docIds.map(did => ({ id: did, source: 'upload', name: `Uploaded doc ${did.slice(0,6)}`, capturedBy: 'current user', capturedAt: now, notes: '' })),
        covenants: (l.covenants || []).map((c: any, idx: number): LoanCovenant => ({
          id: `cov_${Date.now()}_${idx}`,
          description: c.description || '',
          threshold: c.threshold || '',
          testFrequency: c.testFrequency || '',
          clientConfirmedViaPortal: false,
          metStatus: '',
          notes: '',
        })),
        penalties: (l.penalties || []).map((p: any, idx: number): LoanPenalty => ({
          id: `pen_${Date.now()}_${idx}`,
          description: p.description || '',
          amount: p.amount ?? null,
          trigger: p.trigger || '',
          requiresDisclosure: '',
          notes: '',
        })),
      };
    });
    save({ loans: [...data.loans, ...newLoans] });
    setActiveLoanId(newLoans[0].id);
  };

  const removeLoan = (id: string) => {
    save({ loans: data.loans.filter(l => l.id !== id) });
    if (activeLoanId === id) setActiveLoanId('__lead__');
  };

  // ── Sheets screen ──────────────────────────────────────────────────
  const renderSheets = () => {
    const tabs: Array<{ id: string; label: string }> = [
      { id: '__lead__', label: 'Lead summary' },
      ...data.loans.map(l => ({ id: l.id, label: l.label })),
    ];

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveLoanId(t.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-t border-b-2 transition-colors ${
                activeLoanId === t.id
                  ? 'border-emerald-600 text-emerald-700 bg-emerald-50'
                  : 'border-transparent text-slate-600 hover:bg-slate-50'
              }`}
            >{t.label}</button>
          ))}
          <button onClick={addLoanManual} className="text-xs font-semibold px-3 py-1.5 text-slate-500 hover:text-emerald-700 inline-flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add loan
          </button>
        </div>

        {activeLoanId === '__lead__' ? renderLeadSheet() : renderLoanSheet(data.loans.find(l => l.id === activeLoanId)!)}

        <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
          <button onClick={() => setScreen('source')} className="px-4 py-2 text-sm rounded border border-slate-300 inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Sources</button>
          <button onClick={() => setScreen('tests')} className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2">
            Tests <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderLeadSheet = () => (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="text-xs w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Period start</th>
            <th className="px-2 py-1.5 text-left font-semibold">Period end</th>
            <th className="px-2 py-1.5 text-right font-semibold">B/f</th>
            <th className="px-2 py-1.5 text-right font-semibold">Drawdown</th>
            <th className="px-2 py-1.5 text-right font-semibold">Lender fees</th>
            <th className="px-2 py-1.5 text-right font-semibold">Other fees</th>
            <th className="px-2 py-1.5 text-right font-semibold">Interest</th>
            <th className="px-2 py-1.5 text-right font-semibold">Payments</th>
            <th className="px-2 py-1.5 text-right font-semibold">C/f</th>
          </tr>
        </thead>
        <tbody>
          {leadRow ? (
            <tr className="border-t border-slate-200">
              <td className="px-2 py-1.5">{leadRow.fromDate}</td>
              <td className="px-2 py-1.5">{leadRow.toDate}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.bf)}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.drawdown)}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.lenderFees)}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.otherFees)}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.interestCharged)}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.payments)}</td>
              <td className="px-2 py-1.5 text-right">{fmtCcy(leadRow.cf)}</td>
            </tr>
          ) : (
            <tr><td colSpan={9} className="px-2 py-3 text-center text-slate-400 italic">Engagement period not set — lead summary needs period start + end dates.</td></tr>
          )}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-slate-500 bg-slate-50 border-t border-slate-200">
        Lead summary is aggregated automatically — straddling rows are pro-rated by overlap days so part-period loans only contribute their slice.
      </div>
    </div>
  );

  const renderLoanSheet = (loan: LoanTab) => {
    const updateHeader = (patch: Partial<LoanHeader>) => {
      const nextLoans = data.loans.map(l => l.id === loan.id ? { ...l, header: { ...l.header, ...patch }, label: buildLoanLabel({ ...l.header, ...patch }, data.loans.findIndex(x => x.id === loan.id)) } : l);
      save({ loans: nextLoans });
    };
    const updateRow = (idx: number, patch: Partial<LoanScheduleRow>) => {
      const nextSched = loan.schedule.map((r, i) => i === idx ? { ...r, ...patch } : r);
      const nextLoans = data.loans.map(l => l.id === loan.id ? { ...l, schedule: nextSched } : l);
      save({ loans: nextLoans });
    };
    const addRow = () => {
      const last = loan.schedule[loan.schedule.length - 1];
      const fromDate = last?.toDate || loan.header.drawdownDate || '';
      const nextSched = [...loan.schedule, { fromDate, toDate: '', bf: last?.cf || 0, drawdown: 0, lenderFees: 0, otherFees: 0, interestCharged: 0, payments: 0, cf: last?.cf || 0 }];
      save({ loans: data.loans.map(l => l.id === loan.id ? { ...l, schedule: nextSched } : l) });
    };
    const regenSchedule = () => {
      if (!loan.header.drawdownDate || !periodEndDate) return;
      const rows = generateScheduleRows(loan.header.drawdownDate, periodEndDate.slice(0,10), loan.header.loanPeriodicity);
      save({ loans: data.loans.map(l => l.id === loan.id ? { ...l, schedule: rows } : l) });
    };

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Loan header</div>
          <div className="grid grid-cols-3 gap-3">
            <HeaderField label={lenderLabel}>
              <input value={loan.header.lender} onChange={e => updateHeader({ lender: e.target.value })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Amount (principal)">
              <input type="number" value={loan.header.amount ?? ''} onChange={e => updateHeader({ amount: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Number of tranches">
              <input type="number" min={1} value={loan.header.numberOfTranches} onChange={e => updateHeader({ numberOfTranches: parseInt(e.target.value || '1', 10) })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Drawdown requirements" colSpan={2}>
              <textarea rows={2} value={loan.header.drawdownRequirements} onChange={e => updateHeader({ drawdownRequirements: e.target.value })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Interest base">
              <input value={loan.header.interestBase} onChange={e => updateHeader({ interestBase: e.target.value })} placeholder="SONIA / Fixed / BoE base" className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Interest margin (%)">
              <input type="number" step={0.01} value={loan.header.interestMargin ?? ''} onChange={e => updateHeader({ interestMargin: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Day count basis">
              <select value={loan.header.dayCountBasis} onChange={e => updateHeader({ dayCountBasis: e.target.value as DayCount })} className="w-full text-xs border rounded px-2 py-1">
                {DAYCOUNT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </HeaderField>
            <HeaderField label="Loan agreement date">
              <input type="date" value={loan.header.loanDate || ''} onChange={e => updateHeader({ loanDate: e.target.value || null })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="First drawdown date">
              <input type="date" value={loan.header.drawdownDate || ''} onChange={e => updateHeader({ drawdownDate: e.target.value || null })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Fees (arrangement)">
              <input type="number" value={loan.header.fees ?? ''} onChange={e => updateHeader({ fees: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
            <HeaderField label="Loan periodicity">
              <select value={loan.header.loanPeriodicity} onChange={e => updateHeader({ loanPeriodicity: e.target.value as Periodicity })} className="w-full text-xs border rounded px-2 py-1">
                {PERIODICITY_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </HeaderField>
            <HeaderField label="Maturity date">
              <input type="date" value={loan.header.maturityDate || ''} onChange={e => updateHeader({ maturityDate: e.target.value || null })} className="w-full text-xs border rounded px-2 py-1" />
            </HeaderField>
          </div>
        </div>

        {/* Schedule */}
        <div className="border border-slate-200 rounded-lg bg-white">
          <div className="flex items-center justify-between p-2 border-b border-slate-200">
            <div className="text-xs uppercase tracking-wide text-slate-500">Schedule</div>
            <div className="flex gap-2">
              <button onClick={regenSchedule} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:bg-slate-50" title="Generate empty rows from drawdown date + periodicity">
                <RefreshCw className="h-3 w-3" /> Generate rows
              </button>
              <button onClick={addRow} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">
                <Plus className="h-3 w-3" /> Add row
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">From</th>
                  <th className="px-2 py-1 text-left">To</th>
                  <th className="px-2 py-1 text-right">B/f</th>
                  <th className="px-2 py-1 text-right">Drawdown</th>
                  <th className="px-2 py-1 text-right">Lender fees</th>
                  <th className="px-2 py-1 text-right">Other fees</th>
                  <th className="px-2 py-1 text-right">Interest</th>
                  <th className="px-2 py-1 text-right">Payments</th>
                  <th className="px-2 py-1 text-right">C/f</th>
                </tr>
              </thead>
              <tbody>
                {loan.schedule.length === 0 ? (
                  <tr><td colSpan={9} className="px-2 py-3 text-center text-slate-400 italic">No rows yet — click <em>Generate rows</em> to seed from the loan dates, or <em>Add row</em> to enter manually.</td></tr>
                ) : (
                  loan.schedule.map((r, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-1 py-0.5"><input type="date" value={r.fromDate} onChange={e => updateRow(idx, { fromDate: e.target.value })} className="w-full text-xs border-0 bg-transparent" /></td>
                      <td className="px-1 py-0.5"><input type="date" value={r.toDate} onChange={e => updateRow(idx, { toDate: e.target.value })} className="w-full text-xs border-0 bg-transparent" /></td>
                      <NumCell value={r.bf} onChange={v => updateRow(idx, { bf: v })} />
                      <NumCell value={r.drawdown} onChange={v => updateRow(idx, { drawdown: v })} />
                      <NumCell value={r.lenderFees} onChange={v => updateRow(idx, { lenderFees: v })} />
                      <NumCell value={r.otherFees} onChange={v => updateRow(idx, { otherFees: v })} />
                      <NumCell value={r.interestCharged} onChange={v => updateRow(idx, { interestCharged: v })} />
                      <NumCell value={r.payments} onChange={v => updateRow(idx, { payments: v })} />
                      <NumCell value={r.cf} onChange={v => updateRow(idx, { cf: v })} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Documents */}
        {loan.documents.length > 0 && (
          <div className="border border-slate-200 rounded-lg p-2 bg-white">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Source documents</div>
            <ul className="text-[11px] text-slate-600 space-y-0.5">
              {loan.documents.map(d => (
                <li key={d.id} className="flex items-center gap-2">
                  <FileText className="h-3 w-3" /> <span className="font-medium">{d.name}</span>
                  <span className="text-slate-400">({d.source})</span>
                  <span className="text-slate-400">— {new Date(d.capturedAt).toLocaleString('en-GB')}</span>
                  <span className="text-slate-400">— {d.capturedBy}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  // ── Tests screen ───────────────────────────────────────────────────
  const renderTests = () => {
    const t = data.tests;
    const set = (patch: Partial<typeof t>) => save({ tests: { ...t, ...patch } });
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Tests</h3>

        <TestRow label="Does the effective interest rate appear reasonable?" controls={
          <div className="flex items-center gap-2">
            <select value={t.rateReasonable.answer} onChange={e => set({ rateReasonable: { ...t.rateReasonable, answer: e.target.value as 'Y'|'N'|'' } })} className="text-xs border rounded px-2 py-1">
              <option value="">—</option><option value="Y">Yes</option><option value="N">No</option>
            </select>
            <input value={t.rateReasonable.comment} onChange={e => set({ rateReasonable: { ...t.rateReasonable, comment: e.target.value } })} placeholder="Comment" className="flex-1 text-xs border rounded px-2 py-1" />
          </div>
        } />

        <DotTestRow
          label="Lead summary interest charge ties to TBCYvPY finance income/cost"
          result={t.interestVsTb}
          onChange={r => set({ interestVsTb: r })}
        />
        <DotTestRow
          label="Period start balance ties to prior period end balance in TBCYvPY (loan fees may be disclosed separately)"
          result={t.openingVsPriorTb}
          onChange={r => set({ openingVsPriorTb: r })}
        />
        <DotTestRow
          label="Period end balance ties to TBCYvPY closing (consider long-term + short-term split)"
          result={t.closingVsTb}
          onChange={r => set({ closingVsTb: r })}
        />
        <DotTestRow
          label="Within-12-month vs remainder split agrees to TBCYvPY balances"
          result={t.ltStSplit}
          onChange={r => set({ ltStSplit: r })}
        />

        <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
          <button onClick={() => setScreen('sheets')} className="px-4 py-2 text-sm rounded border border-slate-300 inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Sheets</button>
          <button onClick={() => setScreen('disclosure')} className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2">
            Disclosure <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  // ── Disclosure screen ──────────────────────────────────────────────
  const renderDisclosure = () => {
    const d = data.disclosure;
    const set = (patch: Partial<typeof d>) => save({ disclosure: { ...d, ...patch } });

    const updateBucket = (group: 'amountBuckets'|'paymentBuckets', idx: number, patch: Partial<typeof d.amountBuckets[0]>) => {
      const next = d[group].map((b, i) => i === idx ? { ...b, ...patch } : b);
      set({ [group]: next } as any);
    };

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Disclosure matters</h3>

        {/* Amount buckets */}
        <div className="border border-slate-200 rounded-lg bg-white">
          <div className="p-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            Amounts due under the loan agreements (incl. fees), bucketed by maturity
          </div>
          <table className="text-xs w-full">
            <thead className="bg-slate-50">
              <tr><th className="px-2 py-1 text-left">Bucket</th><th className="px-2 py-1 text-right">Amount</th></tr>
            </thead>
            <tbody>
              {d.amountBuckets.map((b, i) => (
                <tr key={b.label} className="border-t border-slate-100">
                  <td className="px-2 py-1">{b.label}</td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" value={b.amount ?? ''} onChange={e => updateBucket('amountBuckets', i, { amount: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-32 text-xs border rounded px-1 py-0.5 text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Payment buckets */}
        <div className="border border-slate-200 rounded-lg bg-white">
          <div className="p-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            Payments contractually due under the loan agreements (may differ from amounts above — e.g. PIK interest)
          </div>
          <table className="text-xs w-full">
            <thead className="bg-slate-50">
              <tr><th className="px-2 py-1 text-left">Bucket</th><th className="px-2 py-1 text-right">Payments</th></tr>
            </thead>
            <tbody>
              {d.paymentBuckets.map((b, i) => (
                <tr key={b.label} className="border-t border-slate-100">
                  <td className="px-2 py-1">{b.label}</td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" value={b.payments ?? ''} onChange={e => updateBucket('paymentBuckets', i, { payments: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-32 text-xs border rounded px-1 py-0.5 text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Penalties */}
        <div className="border border-slate-200 rounded-lg bg-white">
          <div className="p-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">Penalties + future liabilities — disclose? (Y/N per row)</div>
          <table className="text-xs w-full">
            <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Description</th><th className="px-2 py-1 text-right">Amount</th><th className="px-2 py-1 text-left">Trigger</th><th className="px-2 py-1 text-center">Disclose?</th></tr></thead>
            <tbody>
              {data.loans.flatMap(l => l.penalties.map(p => ({ loanId: l.id, loanLabel: l.label, p })))
                .map(({ loanId, p }, i) => (
                <tr key={`${loanId}-${p.id}`} className="border-t border-slate-100">
                  <td className="px-2 py-1">{p.description}</td>
                  <td className="px-2 py-1 text-right">{fmtCcy(p.amount)}</td>
                  <td className="px-2 py-1">{p.trigger}</td>
                  <td className="px-2 py-1 text-center">
                    <select
                      value={p.requiresDisclosure}
                      onChange={e => {
                        const nv = e.target.value as 'Y'|'N'|'';
                        const nextLoans = data.loans.map(l => l.id === loanId ? { ...l, penalties: l.penalties.map(x => x.id === p.id ? { ...x, requiresDisclosure: nv } : x) } : l);
                        save({ loans: nextLoans });
                      }}
                      className="text-xs border rounded px-1 py-0.5"
                    ><option value="">—</option><option value="Y">Yes</option><option value="N">No</option></select>
                  </td>
                </tr>
              ))}
              {data.loans.every(l => l.penalties.length === 0) && (
                <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-400 italic">No penalties recorded against any loan.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <DotTestRow label="Buckets total to TBCYvPY closing loan balances" result={d.totalsTie} onChange={r => set({ totalsTie: r })} />
        <DotTestRow label="Security against the loans is confirmed (incl. Companies House check)" result={d.securityConfirmed} onChange={r => set({ securityConfirmed: r })} />

        <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
          <button onClick={() => setScreen('tests')} className="px-4 py-2 text-sm rounded border border-slate-300 inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Tests</button>
          <button onClick={() => setScreen('branch')} className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2">
            {data.side === 'receivable' ? 'Impairment + FMV' : 'Covenants'} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  // ── Branch (covenants OR impairment + FMV) ─────────────────────────
  const renderBranch = () => {
    if (data.side === 'liability') return renderCovenants();
    return renderReceivableBranch();
  };

  const renderCovenants = () => {
    const cov = data.covenants;
    const set = (patch: Partial<typeof cov>) => save({ covenants: { ...cov, ...patch } });
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Covenants</h3>

        <div className="bg-slate-50 border border-slate-200 rounded p-3">
          <div className="text-xs font-semibold text-slate-700 mb-1">Test loan covenants this period?</div>
          <div className="flex items-center gap-2">
            <select value={cov.testThisPeriod} onChange={e => set({ testThisPeriod: e.target.value as 'Y'|'N'|'' })} className="text-xs border rounded px-2 py-1">
              <option value="">—</option><option value="Y">Yes</option><option value="N">No</option>
            </select>
            {cov.testThisPeriod === 'Y' && (
              <button onClick={() => requestFromClient('covenants')} disabled={busy === 'request'} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                <Send className="h-3 w-3" /> Request confirmation via Portal
              </button>
            )}
            {cov.portalSentAt && (
              <span className="text-[11px] text-slate-500">Sent {new Date(cov.portalSentAt).toLocaleString('en-GB')}</span>
            )}
          </div>
        </div>

        {/* Covenants list pulled from each loan */}
        <div className="border border-slate-200 rounded-lg bg-white">
          <div className="p-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">Extracted covenants</div>
          <table className="text-xs w-full">
            <thead className="bg-slate-50">
              <tr><th className="px-2 py-1 text-left">Loan</th><th className="px-2 py-1 text-left">Description</th><th className="px-2 py-1 text-left">Threshold</th><th className="px-2 py-1 text-left">Freq.</th><th className="px-2 py-1 text-center">Met?</th></tr>
            </thead>
            <tbody>
              {data.loans.flatMap(l => l.covenants.map(c => ({ loanId: l.id, loanLabel: l.label, c })))
                .map(({ loanId, loanLabel, c }) => (
                <tr key={`${loanId}-${c.id}`} className="border-t border-slate-100">
                  <td className="px-2 py-1">{loanLabel}</td>
                  <td className="px-2 py-1">{c.description}</td>
                  <td className="px-2 py-1">{c.threshold}</td>
                  <td className="px-2 py-1">{c.testFrequency}</td>
                  <td className="px-2 py-1 text-center">
                    <select
                      value={c.metStatus}
                      onChange={e => {
                        const nv = e.target.value as 'Y'|'N'|'NA'|'';
                        const nextLoans = data.loans.map(l => l.id === loanId ? { ...l, covenants: l.covenants.map(x => x.id === c.id ? { ...x, metStatus: nv } : x) } : l);
                        save({ loans: nextLoans });
                      }}
                      className="text-xs border rounded px-1 py-0.5"
                    ><option value="">—</option><option value="Y">Met</option><option value="N">Breached</option><option value="NA">N/A</option></select>
                  </td>
                </tr>
              ))}
              {data.loans.every(l => l.covenants.length === 0) && (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-400 italic">No covenants extracted — re-run AI extraction or add them manually per loan.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <DotTestRow label="Overall conclusion — all covenants met with evidence on file" result={cov.conclusion} onChange={r => set({ conclusion: r })} />

        <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
          <button onClick={() => setScreen('disclosure')} className="px-4 py-2 text-sm rounded border border-slate-300 inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Back</button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2">
            Close
          </button>
        </div>
      </div>
    );
  };

  const renderReceivableBranch = () => {
    const imp = data.impairment;
    const fmv = data.fmv;
    const setImp = (patch: Partial<typeof imp>) => save({ impairment: { ...imp, ...patch } });
    const setFmv = (patch: Partial<typeof fmv>) => save({ fmv: { ...fmv, ...patch } });

    const requestImpairment = () => requestFromClient('impairment_evidence');

    const researchRate = async () => {
      setBusy('fmv');
      try {
        const profile = {
          totalPrincipal: data.loans.reduce((s, l) => s + (l.header.amount || 0), 0),
          weightedMaturityYears: null,
          security: data.loans.map(l => l.header.securityDescription).filter(Boolean),
          interestBase: data.loans.map(l => l.header.interestBase).filter(Boolean),
          side: 'receivable',
        };
        const r = await fetch(`/api/engagements/${engagementId}/loan-calculator/fmv-rate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ side: 'receivable', loanProfile: profile }),
        });
        const j = await r.json();
        if (j?.error) setError(j.error);
        setFmv({
          discountRate: typeof j?.rate === 'number' ? j.rate : null,
          rateJustification: j?.justification || '',
          sources: Array.isArray(j?.sources) ? j.sources : [],
        });
      } catch (err: any) {
        setError(String(err?.message || err));
      } finally {
        setBusy('');
      }
    };

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Receivable branch — Impairment + FMV</h3>

        {/* Impairment */}
        <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-500">Impairment indication</div>
          <div className="flex items-center gap-2">
            <span className="text-xs">Any indication of impairment?</span>
            <select value={imp.anyIndication} onChange={e => setImp({ anyIndication: e.target.value as 'Y'|'N'|'' })} className="text-xs border rounded px-2 py-1">
              <option value="">—</option><option value="Y">Yes</option><option value="N">No</option>
            </select>
            {imp.anyIndication === 'Y' && (
              <button onClick={requestImpairment} disabled={busy === 'request'} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                <Send className="h-3 w-3" /> Request evidence via Portal
              </button>
            )}
            {imp.portalSentAt && (<span className="text-[11px] text-slate-500">Sent {new Date(imp.portalSentAt).toLocaleString('en-GB')}</span>)}
          </div>

          {imp.anyIndication === 'Y' && (
            <table className="text-xs w-full mt-2">
              <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Loan</th><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1 text-left">Assessment</th></tr></thead>
              <tbody>
                {data.loans.map(l => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-2 py-1">{l.label}</td>
                    <td className="px-2 py-1">
                      <select
                        value={imp.performingByLoan[l.id] || ''}
                        onChange={e => setImp({ performingByLoan: { ...imp.performingByLoan, [l.id]: e.target.value as 'performing'|'non_performing'|'' } })}
                        className="text-xs border rounded px-1 py-0.5"
                      ><option value="">—</option><option value="performing">Performing</option><option value="non_performing">Non-performing</option></select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={imp.assessmentByLoan[l.id] || ''}
                        onChange={e => setImp({ assessmentByLoan: { ...imp.assessmentByLoan, [l.id]: e.target.value } })}
                        placeholder="Impairment assessment narrative"
                        className="w-full text-xs border rounded px-1 py-0.5"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <DotTestRow label="Impairment conclusion" result={imp.conclusion} onChange={r => setImp({ conclusion: r })} />
        </div>

        {/* FMV */}
        <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-500">FMV revaluation</div>
          <div className="flex items-center gap-2">
            <span className="text-xs">Does the loan need revaluing to FMV?</span>
            <select value={fmv.required} onChange={e => setFmv({ required: e.target.value as 'Y'|'N'|'' })} className="text-xs border rounded px-2 py-1">
              <option value="">—</option><option value="Y">Yes</option><option value="N">No</option>
            </select>
            {fmv.required === 'Y' && (
              <button onClick={researchRate} disabled={busy === 'fmv'} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                {busy === 'fmv' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {busy === 'fmv' ? 'Researching…' : 'Research discount rate'}
              </button>
            )}
          </div>

          {fmv.required === 'Y' && (
            <div className="space-y-2 mt-2">
              <label className="block">
                <div className="text-[11px] font-semibold text-slate-700 mb-1">Discount rate (annual %)</div>
                <input type="number" step={0.01} value={fmv.discountRate ?? ''} onChange={e => setFmv({ discountRate: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-32 text-xs border rounded px-2 py-1" />
              </label>
              <label className="block">
                <div className="text-[11px] font-semibold text-slate-700 mb-1">Justification</div>
                <textarea rows={3} value={fmv.rateJustification} onChange={e => setFmv({ rateJustification: e.target.value })} className="w-full text-xs border rounded px-2 py-1" placeholder="Build-up: risk-free + credit spread + illiquidity premium…" />
              </label>
              {fmv.sources.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-700 mb-1">Sources cited by AI</div>
                  <ul className="text-[11px] text-slate-600 space-y-0.5">
                    {fmv.sources.map((s, i) => (
                      <li key={i}>
                        {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{s.title}</a> : <span>{s.title}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DotTestRow label="FMV conclusion" result={fmv.conclusion} onChange={r => setFmv({ conclusion: r })} />
        </div>

        <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
          <button onClick={() => setScreen('disclosure')} className="px-4 py-2 text-sm rounded border border-slate-300 inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> Back</button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2">
            Close
          </button>
        </div>
      </div>
    );
  };

  // ── Shell ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white rounded-lg p-8 inline-flex items-center gap-2 text-sm text-slate-600 shadow-lg">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading Loan Calculator…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            <div>
              <div className="text-sm font-semibold leading-tight">Loan Calculator — {sideLabel}</div>
              <div className="text-[11px] opacity-80">{stepLabel(screen)}{saving && <> · <Loader2 className="inline h-3 w-3 animate-spin ml-1" /> saving</>}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
            <button onClick={() => setError('')} className="ml-auto text-amber-700 hover:text-amber-900"><X className="h-3 w-3" /></button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {screen === 'setup' && renderSetup()}
          {screen === 'source' && renderSource()}
          {screen === 'sheets' && renderSheets()}
          {screen === 'tests' && renderTests()}
          {screen === 'disclosure' && renderDisclosure()}
          {screen === 'branch' && renderBranch()}
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────
function stepLabel(s: Screen): string {
  switch (s) {
    case 'setup': return 'Step 1 of 6 — Setup';
    case 'source': return 'Step 2 of 6 — Source';
    case 'sheets': return 'Step 3 of 6 — Sheets';
    case 'tests': return 'Step 4 of 6 — Tests';
    case 'disclosure': return 'Step 5 of 6 — Disclosure';
    case 'branch': return 'Step 6 of 6 — Branch';
  }
}

function SourceTile({ icon, title, sub, onClick, disabled }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-left border border-slate-200 rounded-lg p-3 hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors disabled:opacity-50"
    >
      <div className="flex items-center gap-2 mb-1 text-emerald-700">
        {icon} <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="text-[11px] text-slate-600 leading-snug">{sub}</div>
    </button>
  );
}

function HeaderField({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <label className={`block ${colSpan === 2 ? 'col-span-2' : ''}`}>
      <div className="text-[11px] font-semibold text-slate-600 mb-0.5">{label}</div>
      {children}
    </label>
  );
}

function NumCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState<string>(String(value || ''));
  useEffect(() => { setLocal(String(value || '')); }, [value]);
  return (
    <td className="px-1 py-0.5 text-right">
      <input
        type="text" inputMode="decimal" value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local.replace(/[,£$€\s]/g, ''));
          onChange(isFinite(n) ? n : 0);
        }}
        className="w-full text-xs border-0 bg-transparent text-right"
      />
    </td>
  );
}

function TestRow({ label, controls }: { label: string; controls: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="text-xs font-medium text-slate-800 mb-2">{label}</div>
      {controls}
    </div>
  );
}

function DotTestRow({ label, result, onChange }: { label: string; result: TestResult; onChange: (r: TestResult) => void }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs font-medium text-slate-800 flex-1">{label}</div>
        <DotPicker value={result.status} onChange={s => onChange({ ...result, status: s })} />
      </div>
      <input
        value={result.comment}
        onChange={e => onChange({ ...result, comment: e.target.value })}
        placeholder="Comment (mandatory if red/orange)"
        className="w-full text-xs border rounded px-2 py-1"
      />
    </div>
  );
}

function DotPicker({ value, onChange }: { value: DotStatus; onChange: (s: DotStatus) => void }) {
  const opts: DotStatus[] = ['green', 'orange', 'red', 'hollow'];
  const colour = (s: DotStatus) => {
    if (s === 'green') return 'bg-emerald-500';
    if (s === 'orange') return 'bg-amber-500';
    if (s === 'red') return 'bg-red-500';
    return 'bg-transparent border-2 border-slate-300';
  };
  return (
    <div className="flex items-center gap-1">
      {opts.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          title={o === 'hollow' ? 'Cannot perform test' : `${o[0].toUpperCase()}${o.slice(1)}`}
          className={`h-4 w-4 rounded-full transition-transform ${colour(o)} ${value === o ? 'scale-125 ring-2 ring-slate-400' : 'opacity-60 hover:opacity-100'}`}
        />
      ))}
    </div>
  );
}

export default LoanCalculatorPanel;
