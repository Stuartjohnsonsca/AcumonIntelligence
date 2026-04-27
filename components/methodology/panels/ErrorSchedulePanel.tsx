'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Download, AlertOctagon, CheckCircle2, ExternalLink, Plus, Trash2, X, Save, AlertTriangle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  encodeNavReference, decodeNavReference, getCurrentLocation, navigateTo,
} from '@/lib/engagement-nav';

/**
 * Error Schedule — per spec:
 *
 *   Three radio views (Combined default / Adjusted only / Unadjusted only).
 *   Adjusted = resolution === 'in_tb'; Unadjusted = anything else.
 *
 *   Table columns:
 *     # | Account/FS Line + Description | Amount Dr | Amount Cr |
 *     [Balance Sheet Dr | Balance Sheet Cr | P&L Dr | P&L Cr] |
 *     Source link | Sign-off dots (P / R / RI)
 *
 *   The four BS / P&L Dr/Cr columns only render in Combined and
 *   Unadjusted views — Adjusted view doesn't need them because by
 *   definition the entry has already moved into the TB.
 *
 *   Per-error reason text box sits inline under each row (the
 *   AuditErrorSchedule.explanation column, written via the
 *   set_reason action). A future iteration with journal grouping
 *   would float this to the bottom of each multi-line journal.
 *
 *   Per-error sign-off: 3 dots (Preparer / Reviewer / RI). Dots
 *   are click-to-toggle and persist in the AuditPermanentFile
 *   `error_schedule_meta` blob (no schema migration). Tab-level
 *   overall + 2 dots aggregate from the per-error sign-offs.
 *
 *   Totals: a column-totals strip sits at the very top of the
 *   panel showing Amount Dr / Amount Cr / BS Dr / BS Cr / P&L Dr /
 *   P&L Cr summed across the visible rows. Save validation
 *   highlights the totals red when Dr ≠ Cr.
 *
 *   "Add new" form opens inline above the table — captures fsLine,
 *   account code, description, Dr/Cr amount, type, plus the
 *   current engagement-nav location (back-link).
 */

interface ErrorEntry {
  id: string;
  fsLine: string;
  accountCode: string | null;
  description: string;
  errorAmount: number;       // signed: positive = Dr, negative = Cr
  errorType: string;
  explanation: string | null;
  isFraud: boolean;
  resolution: string | null; // 'in_tb' = adjusted; null/'error' = unadjusted
  committedByName: string | null;
  committedAt: string | null;
}

interface SignOff { userId: string; userName: string; at: string; }
interface ErrorMetaEntry { signOffs?: { preparer?: SignOff; reviewer?: SignOff; ri?: SignOff }; sourceLocation?: string | null; journalGroupId?: string }
type ErrorMeta = Record<string, ErrorMetaEntry>;

interface JournalLineDraft {
  uid: string;       // local-only key for React reconciliation
  fsLine: string;
  accountCode: string;
  description: string;
  amount: string;
  drCr: 'Dr' | 'Cr';
}

interface FsLineLite { id: string; name: string; fsCategory: string; }

interface Props {
  engagementId: string;
  materiality?: number;
  performanceMateriality?: number;
  clearlyTrivial?: number;
  /** Caller-supplied user role — drives which sign-off button is enabled. */
  userRole?: string;
  onClose?: () => void;
}

type View = 'combined' | 'adjusted' | 'unadjusted';

function fmt(n: number): string {
  if (!n) return '';
  const abs = Math.abs(n);
  return abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Map FS Line name (lowercased) → category. Used to decide whether an
// error row's amount lands in the BS or P&L column. Categories
// produced by the methodology FS Lines admin: 'pnl' | 'balance_sheet'
// | 'cashflow' | 'notes'. Anything we can't categorise falls back to
// the BS columns so the row is still visible.
function isPnL(category: string | undefined): boolean {
  return (category || '').toLowerCase() === 'pnl' || (category || '').toLowerCase().includes('p&l') || (category || '').toLowerCase().includes('profit');
}

export function ErrorSchedulePanel({ engagementId, materiality = 0, performanceMateriality = 0, clearlyTrivial = 0, userRole, onClose }: Props) {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [meta, setMeta] = useState<ErrorMeta>({});
  const [fsLines, setFsLines] = useState<FsLineLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('combined');
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Multi-line journal form. Independent from the single-line Add
  // form so each can be open without trampling the other's draft.
  const [showJournal, setShowJournal] = useState(false);
  const [jLines, setJLines] = useState<JournalLineDraft[]>([]);
  const [jReason, setJReason] = useState('');
  const [jError, setJError] = useState<string | null>(null);
  const [jSaving, setJSaving] = useState(false);
  // Send-to-client modal: lets the auditor pick a subset of unadjusted
  // errors and post them to the client portal as a single approval
  // request. The client receives a checkbox list; whichever they tick
  // becomes resolution='in_tb' (= adjusted) on submission.
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendChecked, setSendChecked] = useState<Set<string>>(new Set());
  const [sendMessage, setSendMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Add-form state
  const [aFsLineId, setAFsLineId] = useState('');
  const [aFsLineName, setAFsLineName] = useState('');
  const [aAccountCode, setAAccountCode] = useState('');
  const [aDescription, setADescription] = useState('');
  const [aAmount, setAAmount] = useState('');
  const [aDrCr, setADrCr] = useState<'Dr' | 'Cr'>('Dr');
  const [aType, setAType] = useState<'factual' | 'judgemental' | 'projected'>('factual');
  const [aIsFraud, setAIsFraud] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/error-schedule`);
      if (res.ok) {
        const data = await res.json();
        setErrors(Array.isArray(data?.errors) ? data.errors : []);
        setMeta(data?.meta && typeof data.meta === 'object' ? data.meta : {});
      }
    } finally { setLoading(false); }
  }

  // Load FS Lines so we can categorise each error as BS vs P&L.
  // Falls back gracefully if the endpoint isn't available — the BS
  // columns still render, just everything ends up there.
  async function loadFsLines() {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-allocations`);
      if (!res.ok) return;
      const data = await res.json();
      const lines = Array.isArray(data?.fsLines) ? data.fsLines : [];
      setFsLines(lines.map((l: any) => ({ id: l.id, name: l.name, fsCategory: l.fsCategory || '' })));
    } catch { /* informational */ }
  }

  useEffect(() => { void load(); void loadFsLines(); }, [engagementId]);

  const fsCategoryByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of fsLines) m.set(l.name.toLowerCase().trim(), l.fsCategory);
    return m;
  }, [fsLines]);

  // Filter errors by current view.
  const visibleErrors = useMemo(() => {
    if (view === 'combined') return errors;
    if (view === 'adjusted') return errors.filter(e => e.resolution === 'in_tb');
    return errors.filter(e => e.resolution !== 'in_tb');
  }, [errors, view]);

  // Decide where each row's amount lands in the BS / P&L columns.
  function rowSplit(e: ErrorEntry): { isPL: boolean; amount: number; isDr: boolean } {
    const cat = fsCategoryByName.get((e.fsLine || '').toLowerCase().trim());
    const isPL = isPnL(cat);
    const isDr = e.errorAmount >= 0;
    return { isPL, amount: Math.abs(e.errorAmount), isDr };
  }

  // Column totals across the *visible* rows. The Save check + the
  // top-of-tab strip both read from these.
  const totals = useMemo(() => {
    let drA = 0, crA = 0, drBS = 0, crBS = 0, drPL = 0, crPL = 0;
    for (const e of visibleErrors) {
      const { isPL, amount, isDr } = rowSplit(e);
      if (isDr) drA += amount; else crA += amount;
      if (isPL) {
        if (isDr) drPL += amount; else crPL += amount;
      } else {
        if (isDr) drBS += amount; else crBS += amount;
      }
    }
    return { drA, crA, drBS, crBS, drPL, crPL, balanced: Math.abs(drA - crA) < 0.005 };
  }, [visibleErrors, fsCategoryByName]);

  // Show the BS / P&L Dr/Cr columns only in Combined and Unadjusted
  // views. Adjusted view drops them per spec.
  const showSplit = view !== 'adjusted';

  // Tab-level aggregate sign-off — overall (all 3 roles signed on
  // every error) plus per-role rollups for the 2 dots on the tab.
  const tabAgg = useMemo(() => {
    const total = errors.length;
    if (total === 0) return { allP: 0, allR: 0, allRI: 0, total: 0 };
    let p = 0, r = 0, ri = 0;
    for (const e of errors) {
      const m = meta[e.id]?.signOffs || {};
      if (m.preparer) p++;
      if (m.reviewer) r++;
      if (m.ri) ri++;
    }
    return { allP: p, allR: r, allRI: ri, total };
  }, [errors, meta]);

  async function toggleSignOff(errorId: string, role: 'preparer' | 'reviewer' | 'ri') {
    setBusy(errorId);
    const current = meta[errorId]?.signOffs?.[role];
    try {
      await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: current ? 'unsignoff' : 'signoff', errorId, role }),
      });
      await load();
    } finally { setBusy(null); }
  }

  async function setReason(errorId: string, reason: string) {
    setBusy(errorId);
    try {
      // Propagate the new reason to every line in the same journal.
      // The reason text-box only renders once per journal (on the
      // last visible row), but it acts as the journal-level
      // narrative — every line stores the same explanation so the
      // reason is visible from any vantage point.
      const journalGroupId = meta[errorId]?.journalGroupId;
      const targetIds = journalGroupId
        ? Object.entries(meta).filter(([, m]) => m.journalGroupId === journalGroupId).map(([id]) => id)
        : [errorId];
      await Promise.all(targetIds.map(id => fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_reason', errorId: id, reason }),
      })));
      // Optimistic update — keeps the textarea responsive without
      // waiting for the round-trip to repopulate state.
      setErrors(prev => prev.map(e => targetIds.includes(e.id) ? { ...e, explanation: reason } : e));
    } finally { setBusy(null); }
  }

  async function setResolution(errorId: string, next: 'in_tb' | null) {
    setBusy(errorId);
    try {
      await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_resolution', errorId, resolution: next }),
      });
      await load();
    } finally { setBusy(null); }
  }

  async function deleteError(errorId: string) {
    if (!confirm('Remove this error from the schedule?')) return;
    setBusy(errorId);
    try {
      await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: errorId }),
      });
      await load();
    } finally { setBusy(null); }
  }

  function resetAddForm() {
    setShowAdd(false); setAddError(null);
    setAFsLineId(''); setAFsLineName(''); setAAccountCode(''); setADescription('');
    setAAmount(''); setADrCr('Dr'); setAType('factual'); setAIsFraud(false);
  }

  // Journal-form helpers. Each line gets a stable uid for React, and
  // the form auto-seeds a Dr + Cr pair when first opened so the user
  // doesn't immediately have to click "Add line".
  function blankJournalLine(drCr: 'Dr' | 'Cr' = 'Dr'): JournalLineDraft {
    return { uid: `l_${Math.random().toString(36).slice(2, 9)}`, fsLine: '', accountCode: '', description: '', amount: '', drCr };
  }
  function openJournalForm() {
    setJLines([blankJournalLine('Dr'), blankJournalLine('Cr')]);
    setJReason('');
    setJError(null);
    setShowJournal(true);
  }
  function closeJournalForm() {
    setShowJournal(false); setJLines([]); setJReason(''); setJError(null);
  }
  function updateJLine(uid: string, patch: Partial<JournalLineDraft>) {
    setJLines(prev => prev.map(l => l.uid === uid ? { ...l, ...patch } : l));
  }
  function addJLine() { setJLines(prev => [...prev, blankJournalLine('Dr')]); }
  function removeJLine(uid: string) { setJLines(prev => prev.filter(l => l.uid !== uid)); }

  // Live Dr/Cr totals + balance flag for the journal form. Used by
  // the running-total strip and the disabled state on the Save
  // button.
  const jTotals = useMemo(() => {
    let dr = 0, cr = 0;
    for (const l of jLines) {
      const amt = Math.abs(Number(l.amount) || 0);
      if (l.drCr === 'Dr') dr += amt; else cr += amt;
    }
    return { dr, cr, balanced: jLines.length >= 2 && Math.abs(dr - cr) < 0.005 && dr > 0 };
  }, [jLines]);

  async function saveJournal() {
    setJError(null);
    if (jLines.length < 2) { setJError('A journal needs at least two lines'); return; }
    if (!jTotals.balanced) {
      setJError(`Journal does not balance — Dr ${jTotals.dr.toFixed(2)} vs Cr ${jTotals.cr.toFixed(2)}. Save is blocked until totals match exactly.`);
      return;
    }
    for (const l of jLines) {
      if (!l.fsLine.trim()) { setJError('Every line needs an FS Line'); return; }
      if (!l.description.trim()) { setJError('Every line needs a description'); return; }
      if (!Number.isFinite(Number(l.amount)) || Number(l.amount) <= 0) { setJError('Every line needs a positive amount'); return; }
    }
    setJSaving(true);
    try {
      const navLoc = getCurrentLocation();
      const url = typeof window !== 'undefined' ? window.location.href : undefined;
      const sourceLocation = navLoc ? encodeNavReference(navLoc, url) : (url ?? null);
      const res = await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_journal',
          reason: jReason.trim() || null,
          sourceLocation,
          lines: jLines.map(l => ({
            fsLine: l.fsLine.trim(),
            accountCode: l.accountCode.trim() || null,
            description: l.description.trim(),
            amount: Number(l.amount),
            drCr: l.drCr,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setJError(data?.error || 'Save failed');
        return;
      }
      await load();
      closeJournalForm();
    } finally { setJSaving(false); }
  }

  async function createError() {
    const amount = Number(aAmount);
    if (!aFsLineName.trim() && !aFsLineId) { setAddError('FS Line is required'); return; }
    if (!aDescription.trim()) { setAddError('Description is required'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setAddError('Amount must be a positive number'); return; }

    setBusy('__add__');
    setAddError(null);
    try {
      // Source location captured from the engagement-nav registry so a
      // reviewer can jump back to the tab where the error was raised.
      const navLoc = getCurrentLocation();
      const url = typeof window !== 'undefined' ? window.location.href : undefined;
      const sourceLocation = navLoc ? encodeNavReference(navLoc, url) : (url ?? null);
      const res = await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fsLine: aFsLineName.trim() || (fsLines.find(l => l.id === aFsLineId)?.name || ''),
          accountCode: aAccountCode.trim() || null,
          description: aDescription.trim(),
          errorAmount: aDrCr === 'Cr' ? -amount : amount,
          errorType: aType,
          isFraud: aIsFraud,
          sourceLocation,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddError(data?.error || 'Create failed');
        return;
      }
      await load();
      resetAddForm();
    } finally { setBusy(null); }
  }

  // Open the Send-to-Client modal pre-checked with every currently-
  // unadjusted error (the common case is "send all unadjusted"; the
  // user can untick anything they want to hold back).
  function openSendModal() {
    const unadjusted = errors.filter(e => e.resolution !== 'in_tb');
    setSendChecked(new Set(unadjusted.map(e => e.id)));
    setSendMessage('Please review the following misstatements and tick those you accept and have adjusted in your records.');
    setSendError(null);
    setShowSendModal(true);
  }

  async function sendForApproval() {
    const ids = Array.from(sendChecked);
    if (ids.length === 0) { setSendError('Pick at least one error to send'); return; }
    setSending(true); setSendError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_for_approval', errorIds: ids, message: sendMessage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSendError(data?.error || 'Send failed');
        return;
      }
      setShowSendModal(false);
      setSendChecked(new Set());
      setSendMessage('');
      // Reload so any side effects (e.g. flagged in-progress)
      // reflect immediately.
      await load();
    } finally { setSending(false); }
  }

  function downloadCsv() {
    const headers = ['#', 'Account Code', 'FS Line', 'Description', 'Amount Dr', 'Amount Cr', 'BS Dr', 'BS Cr', 'P&L Dr', 'P&L Cr', 'Type', 'Resolution', 'Reason', 'Preparer', 'Reviewer', 'RI'];
    const csvRows = visibleErrors.map((e, i) => {
      const { isPL, amount, isDr } = rowSplit(e);
      const so = meta[e.id]?.signOffs || {};
      return [
        i + 1, e.accountCode || '', e.fsLine, e.description,
        isDr ? amount.toFixed(2) : '', !isDr ? amount.toFixed(2) : '',
        !isPL && isDr ? amount.toFixed(2) : '',
        !isPL && !isDr ? amount.toFixed(2) : '',
        isPL && isDr ? amount.toFixed(2) : '',
        isPL && !isDr ? amount.toFixed(2) : '',
        e.errorType, e.resolution || '', e.explanation || '',
        so.preparer?.userName || '', so.reviewer?.userName || '', so.ri?.userName || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'error_schedule.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-blue-500 mx-auto" /></div>;

  return (
    <div className="space-y-3">
      {/* Top strip: view radios + tab-level overall sign-off + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2 text-[11px]">
          <span className="text-slate-500 font-semibold uppercase tracking-wide">View</span>
          {(['combined', 'adjusted', 'unadjusted'] as View[]).map(v => (
            <label key={v} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border cursor-pointer ${view === v ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              <input
                type="radio"
                name="error-schedule-view"
                checked={view === v}
                onChange={() => setView(v)}
                className="h-3 w-3"
              />
              {v === 'combined' ? 'Combined' : v === 'adjusted' ? 'Approved & Adjusted' : 'Unadjusted'}
            </label>
          ))}
        </div>

        {/* Tab-level overall sign-off dot + per-role 2 dots */}
        {tabAgg.total > 0 && (
          <div className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 ml-2">
            <span className="font-semibold uppercase tracking-wide">Schedule sign-off</span>
            <SignOffPill label="P" count={tabAgg.allP} total={tabAgg.total} />
            <SignOffPill label="R" count={tabAgg.allR} total={tabAgg.total} />
            <SignOffPill label="RI" count={tabAgg.allRI} total={tabAgg.total} />
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button onClick={() => setShowAdd(s => !s)} size="sm" variant="outline" className="h-7 text-[10px]">
            <Plus className="h-3 w-3 mr-1" /> Add new
          </Button>
          <Button onClick={openJournalForm} size="sm" variant="outline" className="h-7 text-[10px]" title="Add a multi-line balanced journal">
            <Plus className="h-3 w-3 mr-1" /> Add journal
          </Button>
          {/* Send to client — only enabled when there's at least one
              unadjusted error to ask about. Disabled state explains
              itself via the title attribute. */}
          <Button
            onClick={openSendModal}
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            disabled={errors.filter(e => e.resolution !== 'in_tb').length === 0}
            title={errors.filter(e => e.resolution !== 'in_tb').length === 0 ? 'No unadjusted errors to send' : 'Send unadjusted errors to client for approval'}
          >
            <Send className="h-3 w-3 mr-1" /> Send to client
          </Button>
          <Button onClick={downloadCsv} size="sm" variant="outline" className="h-7 text-[10px]">
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          )}
        </div>
      </div>

      {/* Column totals strip — pinned at the top per spec.
          Highlights when Dr ≠ Cr so the imbalance is visible before
          the user attempts to save. */}
      <div className={`flex items-center gap-3 px-3 py-2 rounded border ${totals.balanced ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-300'}`}>
        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Totals</span>
        <TotalCell label="Dr" value={totals.drA} />
        <TotalCell label="Cr" value={totals.crA} />
        {showSplit && (
          <>
            <span className="w-px h-5 bg-slate-300" />
            <TotalCell label="BS Dr" value={totals.drBS} muted />
            <TotalCell label="BS Cr" value={totals.crBS} muted />
            <TotalCell label="P&L Dr" value={totals.drPL} muted />
            <TotalCell label="P&L Cr" value={totals.crPL} muted />
          </>
        )}
        <span className="ml-auto text-[10px]">
          {totals.balanced ? (
            <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Balanced</span>
          ) : (
            <span className="text-red-700 font-semibold inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Out by {fmt(Math.abs(totals.drA - totals.crA))}</span>
          )}
        </span>
      </div>

      {/* Add-new form */}
      {showAdd && (
        <div className="border border-blue-200 bg-blue-50/40 rounded p-3 space-y-2">
          <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Add new error</div>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-5">
              <label className="text-[10px] text-slate-500 font-medium block mb-0.5">FS Line</label>
              <input
                list="error-schedule-fs-lines"
                value={aFsLineName}
                onChange={e => {
                  setAFsLineName(e.target.value);
                  const found = fsLines.find(l => l.name === e.target.value);
                  if (found) setAFsLineId(found.id);
                }}
                placeholder="Type or pick an FS Line"
                className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
              />
              <datalist id="error-schedule-fs-lines">
                {fsLines.map(l => <option key={l.id} value={l.name} />)}
              </datalist>
            </div>
            <div className="col-span-3">
              <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Account Code</label>
              <input
                value={aAccountCode}
                onChange={e => setAAccountCode(e.target.value)}
                className="w-full text-xs px-2 py-1 border border-slate-300 rounded font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Amount</label>
              <input
                type="number"
                step="0.01"
                value={aAmount}
                onChange={e => setAAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-xs px-2 py-1 border border-slate-300 rounded text-right tabular-nums"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Dr / Cr</label>
              <select value={aDrCr} onChange={e => setADrCr(e.target.value as 'Dr' | 'Cr')} className="w-full text-xs px-2 py-1 border border-slate-300 rounded">
                <option value="Dr">Dr</option>
                <option value="Cr">Cr</option>
              </select>
            </div>
            <div className="col-span-12">
              <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Description</label>
              <input
                value={aDescription}
                onChange={e => setADescription(e.target.value)}
                placeholder="Brief description of the error"
                className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
              />
            </div>
            <div className="col-span-6 flex items-center gap-3 text-[10px] text-slate-600">
              <label className="inline-flex items-center gap-1">
                <span className="font-medium">Type:</span>
                <select value={aType} onChange={e => setAType(e.target.value as any)} className="text-xs px-1.5 py-0.5 border border-slate-300 rounded">
                  <option value="factual">Factual</option>
                  <option value="judgemental">Judgemental</option>
                  <option value="projected">Projected</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={aIsFraud} onChange={e => setAIsFraud(e.target.checked)} className="h-3 w-3" />
                <span>Fraud-related</span>
              </label>
            </div>
            <div className="col-span-6 flex items-center justify-end gap-2">
              {addError && <span className="text-[10px] text-red-700">{addError}</span>}
              <Button size="sm" variant="outline" onClick={resetAddForm} disabled={busy === '__add__'}>Cancel</Button>
              <Button size="sm" onClick={() => void createError()} disabled={busy === '__add__'}>
                {busy === '__add__' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Materiality reference */}
      <div className="text-[10px] text-slate-400">
        CT {fmt(clearlyTrivial) || '0.00'} · PM {fmt(performanceMateriality) || '0.00'} · Materiality {fmt(materiality) || '0.00'}
      </div>

      {/* Multi-line journal modal — Save is gated on the totals
          balancing exactly (per spec). The running totals strip at
          the bottom of the modal mirrors the top-of-tab strip so the
          user sees imbalance the moment they enter unbalanced
          numbers. */}
      {showJournal && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => !jSaving && closeJournalForm()}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Add error journal</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Two or more lines that share a reason and a balance check (Dr = Cr).</p>
              </div>
              <button onClick={closeJournalForm} disabled={jSaving} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 space-y-2 overflow-y-auto">
              <div className="grid grid-cols-12 gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 font-semibold px-1">
                <div className="col-span-3">FS Line</div>
                <div className="col-span-2">Account</div>
                <div className="col-span-3">Description</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-1 text-center">Dr/Cr</div>
                <div className="col-span-1"></div>
              </div>
              {jLines.map(l => (
                <div key={l.uid} className="grid grid-cols-12 gap-1.5 items-center">
                  <input
                    list="error-schedule-fs-lines"
                    value={l.fsLine}
                    onChange={e => updateJLine(l.uid, { fsLine: e.target.value })}
                    placeholder="FS Line"
                    className="col-span-3 text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <input
                    value={l.accountCode}
                    onChange={e => updateJLine(l.uid, { accountCode: e.target.value })}
                    placeholder="Code"
                    className="col-span-2 text-xs px-2 py-1 border border-slate-300 rounded font-mono"
                  />
                  <input
                    value={l.description}
                    onChange={e => updateJLine(l.uid, { description: e.target.value })}
                    placeholder="Line description"
                    className="col-span-3 text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={l.amount}
                    onChange={e => updateJLine(l.uid, { amount: e.target.value })}
                    placeholder="0.00"
                    className="col-span-2 text-xs px-2 py-1 border border-slate-300 rounded text-right tabular-nums"
                  />
                  <select
                    value={l.drCr}
                    onChange={e => updateJLine(l.uid, { drCr: e.target.value as 'Dr' | 'Cr' })}
                    className="col-span-1 text-xs px-1.5 py-1 border border-slate-300 rounded"
                  >
                    <option value="Dr">Dr</option>
                    <option value="Cr">Cr</option>
                  </select>
                  <button
                    onClick={() => removeJLine(l.uid)}
                    disabled={jLines.length <= 1}
                    className="col-span-1 text-red-400 hover:text-red-600 disabled:opacity-30 flex justify-center"
                    title="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <Button onClick={addJLine} size="sm" variant="outline" className="h-7 text-[10px]">
                  <Plus className="h-3 w-3 mr-1" /> Add line
                </Button>
                <div className={`text-[11px] inline-flex items-center gap-3 px-3 py-1 rounded border ${jTotals.balanced ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                  <span className="font-mono tabular-nums">Dr <strong>{fmt(jTotals.dr) || '0.00'}</strong></span>
                  <span className="font-mono tabular-nums">Cr <strong>{fmt(jTotals.cr) || '0.00'}</strong></span>
                  {jTotals.balanced
                    ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Balanced</span>
                    : <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Out by {fmt(Math.abs(jTotals.dr - jTotals.cr)) || '0.00'}</span>}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Reason for journal</label>
                <textarea
                  value={jReason}
                  onChange={e => setJReason(e.target.value)}
                  rows={2}
                  placeholder="Why was this misstatement booked? (shown to all reviewers)"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                />
              </div>
              {jError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{jError}</div>}
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeJournalForm} disabled={jSaving}>Cancel</Button>
              <Button size="sm" onClick={() => void saveJournal()} disabled={jSaving || !jTotals.balanced}>
                {jSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Save journal
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Send-to-client modal */}
      {showSendModal && (() => {
        const unadjusted = errors.filter(e => e.resolution !== 'in_tb');
        return (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => !sending && setShowSendModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Send unadjusted errors to client for approval</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Tick the errors to include. Whichever the client accepts becomes &ldquo;Approved &amp; Adjusted&rdquo; on submission.</p>
              </div>
              <button onClick={() => !sending && setShowSendModal(false)} disabled={sending} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Covering message to client</label>
                <textarea
                  value={sendMessage}
                  onChange={e => setSendMessage(e.target.value)}
                  rows={3}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-slate-600">Errors ({sendChecked.size}/{unadjusted.length} selected)</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSendChecked(new Set(unadjusted.map(e => e.id)))}
                      className="text-[10px] text-blue-600 hover:underline"
                    >Select all</button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => setSendChecked(new Set())}
                      className="text-[10px] text-slate-500 hover:underline"
                    >Clear</button>
                  </div>
                </div>
                <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
                  {unadjusted.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-slate-400 italic text-center">No unadjusted errors to send.</div>
                  ) : unadjusted.map(e => {
                    const checked = sendChecked.has(e.id);
                    const isDr = e.errorAmount >= 0;
                    return (
                      <label key={e.id} className={`flex items-start gap-2 px-3 py-2 cursor-pointer ${checked ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSendChecked(prev => {
                            const next = new Set(prev);
                            if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                            return next;
                          })}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-slate-700 truncate">
                            <span className="font-medium">{e.fsLine}</span>
                            {e.accountCode && <span className="text-slate-400 font-mono ml-1">· {e.accountCode}</span>}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">{e.description}</div>
                        </div>
                        <div className="text-right text-[11px] font-mono tabular-nums">
                          {isDr
                            ? <span className="text-slate-700">Dr {fmt(Math.abs(e.errorAmount))}</span>
                            : <span className="text-slate-700">Cr {fmt(Math.abs(e.errorAmount))}</span>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              {sendError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{sendError}</div>}
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSendModal(false)} disabled={sending}>Cancel</Button>
              <Button size="sm" onClick={() => void sendForApproval()} disabled={sending || sendChecked.size === 0}>
                {sending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                Send to client ({sendChecked.size})
              </Button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Error table */}
      {visibleErrors.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border rounded-lg">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-300" />
          {view === 'adjusted' ? 'No adjusted errors' : view === 'unadjusted' ? 'No unadjusted errors' : 'No errors on the schedule'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-[10px]">
            <thead className="bg-slate-100">
              {showSplit && (
                <tr className="border-b border-slate-200">
                  <th colSpan={4}></th>
                  <th colSpan={2} className="text-center px-2 py-1 font-semibold text-slate-600 border-l border-r border-slate-200">Amount</th>
                  <th colSpan={2} className="text-center px-2 py-1 font-semibold text-slate-600 border-r border-slate-200">Balance Sheet</th>
                  <th colSpan={2} className="text-center px-2 py-1 font-semibold text-slate-600 border-r border-slate-200">P&amp;L</th>
                  <th colSpan={3}></th>
                </tr>
              )}
              <tr className="border-b border-slate-200">
                <th className="text-left px-2 py-1 font-semibold text-slate-600 w-8">#</th>
                <th className="text-left px-2 py-1 font-semibold text-slate-600 w-40">{view === 'adjusted' ? 'Account Code' : view === 'unadjusted' ? 'FS Line' : 'Account / FS Line'}</th>
                <th className="text-left px-2 py-1 font-semibold text-slate-600">Description</th>
                <th className="text-center px-2 py-1 font-semibold text-slate-600 w-16">Type</th>
                <th className="text-right px-2 py-1 font-semibold text-slate-600 w-20 border-l border-slate-200">Dr</th>
                <th className="text-right px-2 py-1 font-semibold text-slate-600 w-20 border-r border-slate-200">Cr</th>
                {showSplit && (
                  <>
                    <th className="text-right px-2 py-1 font-semibold text-slate-600 w-20">Dr</th>
                    <th className="text-right px-2 py-1 font-semibold text-slate-600 w-20 border-r border-slate-200">Cr</th>
                    <th className="text-right px-2 py-1 font-semibold text-slate-600 w-20">Dr</th>
                    <th className="text-right px-2 py-1 font-semibold text-slate-600 w-20 border-r border-slate-200">Cr</th>
                  </>
                )}
                <th className="text-center px-2 py-1 font-semibold text-slate-600 w-16">Source</th>
                <th className="text-center px-2 py-1 font-semibold text-slate-600 w-24" title="Preparer / Reviewer / RI sign-off">P&nbsp;R&nbsp;RI</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // For each journal in the visible list, mark the LAST
                // visible row as the one that hosts the shared reason
                // text-box (per spec: "text box underneath… after
                // several rows of errors"). Non-journal rows always
                // host their own reason. Iterate in reverse so the
                // first row hit per journal is the last in display
                // order.
                const journalLastRowIds = new Set<string>();
                const seenJournals = new Set<string>();
                for (let i = visibleErrors.length - 1; i >= 0; i--) {
                  const e = visibleErrors[i];
                  const j = meta[e.id]?.journalGroupId;
                  if (!j) continue;
                  if (seenJournals.has(j)) continue;
                  seenJournals.add(j);
                  journalLastRowIds.add(e.id);
                }
                return visibleErrors.map((e, idx) => {
                  const { isPL, amount, isDr } = rowSplit(e);
                  const isAdjusted = e.resolution === 'in_tb';
                  const so = meta[e.id]?.signOffs || {};
                  const sourceDecoded = decodeNavReference(meta[e.id]?.sourceLocation || null);
                  const codeOrLine = view === 'adjusted'
                    ? (e.accountCode || e.fsLine)
                    : view === 'unadjusted'
                      ? e.fsLine
                      : (e.accountCode ? `${e.accountCode} · ${e.fsLine}` : e.fsLine);
                  const journalGroupId = meta[e.id]?.journalGroupId || null;
                  // Single-row error: always host reason. Journal row:
                  // only the last row of the journal hosts it, so the
                  // reason renders once below the cluster.
                  const showReasonBox = !journalGroupId || journalLastRowIds.has(e.id);
                  return (
                    <RowFragment
                      key={e.id}
                      err={e}
                      idx={idx}
                      codeOrLine={codeOrLine}
                      isFraud={e.isFraud}
                      isAdjusted={isAdjusted}
                      showSplit={showSplit}
                      isPL={isPL}
                      isDr={isDr}
                      amount={amount}
                      so={so}
                      sourceDecoded={sourceDecoded}
                      journalGroupId={journalGroupId}
                      showReasonBox={showReasonBox}
                      busy={busy === e.id}
                      onSignOff={(role) => void toggleSignOff(e.id, role)}
                      onSetReason={(r) => void setReason(e.id, r)}
                      onSetResolution={(next) => void setResolution(e.id, next)}
                      onDelete={() => void deleteError(e.id)}
                    />
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────

function TotalCell({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="inline-flex items-baseline gap-1">
      <span className={`text-[9px] uppercase tracking-wide ${muted ? 'text-slate-400' : 'text-slate-500'} font-semibold`}>{label}</span>
      <span className={`font-mono tabular-nums text-[11px] font-semibold ${muted ? 'text-slate-600' : 'text-slate-800'}`}>{value > 0 ? fmt(value) : '—'}</span>
    </div>
  );
}

function SignOffPill({ label, count, total }: { label: string; count: number; total: number }) {
  const all = count === total && total > 0;
  return (
    <span className={`inline-flex items-center justify-center min-w-[28px] h-[16px] px-1 rounded-full text-[9px] font-bold leading-none ${
      all ? 'bg-green-600 text-white' : count > 0 ? 'bg-amber-400 text-amber-900' : 'bg-slate-200 text-slate-500'
    }`}>
      {label}&nbsp;{count}/{total}
    </span>
  );
}

function SignOffDot({ signed, by, role, onClick, disabled }: {
  signed: boolean; by: string | null; role: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={signed ? `${role} sign-off by ${by}${signed ? ' — click to unsign' : ''}` : `Sign off as ${role}`}
      className={`w-4 h-4 rounded-full border text-[7px] font-bold flex items-center justify-center transition-colors ${
        signed ? 'bg-green-500 border-green-500 text-white hover:bg-green-600' : 'bg-white border-slate-300 text-slate-400 hover:bg-slate-50'
      }`}
    >
      {signed ? '✓' : role}
    </button>
  );
}

interface RowFragmentProps {
  err: ErrorEntry;
  idx: number;
  codeOrLine: string;
  isFraud: boolean;
  isAdjusted: boolean;
  showSplit: boolean;
  isPL: boolean;
  isDr: boolean;
  amount: number;
  so: { preparer?: SignOff; reviewer?: SignOff; ri?: SignOff };
  sourceDecoded: { loc: { tab: string; subTab?: string; label?: string }; url: string | null } | null;
  journalGroupId: string | null;
  /** True for non-journal rows and for the LAST row of each journal —
   *  these host the reason text-box. Other journal lines stay quiet
   *  so the reason renders once below the cluster, per spec. */
  showReasonBox: boolean;
  busy: boolean;
  onSignOff: (role: 'preparer' | 'reviewer' | 'ri') => void;
  onSetReason: (reason: string) => void;
  onSetResolution: (next: 'in_tb' | null) => void;
  onDelete: () => void;
}

function RowFragment({ err, idx, codeOrLine, isFraud, isAdjusted, showSplit, isPL, isDr, amount, so, sourceDecoded, journalGroupId, showReasonBox, busy, onSignOff, onSetReason, onSetResolution, onDelete }: RowFragmentProps) {
  const [reasonDraft, setReasonDraft] = useState(err.explanation || '');
  // Sync local draft whenever the underlying explanation changes
  // server-side (e.g. another user edited).
  useEffect(() => { setReasonDraft(err.explanation || ''); }, [err.explanation]);

  return (
    <>
      <tr className={`border-b border-slate-50 ${isFraud ? 'bg-red-50/30' : ''} ${isAdjusted ? 'opacity-90' : ''}`}>
        <td className="px-2 py-1.5 text-slate-400 font-mono">{idx + 1}</td>
        <td className="px-2 py-1.5">
          <div className="text-slate-700 font-medium truncate" title={codeOrLine}>{codeOrLine}</div>
          {/* Adjusted toggle — sets resolution='in_tb' so the row
              moves into the Adjusted view. */}
          <button
            onClick={() => onSetResolution(isAdjusted ? null : 'in_tb')}
            className={`text-[9px] mt-0.5 px-1 py-0 rounded ${isAdjusted ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            title={isAdjusted ? 'Marked adjusted (booked into TB) — click to mark unadjusted' : 'Mark as adjusted (booked into TB)'}
            disabled={busy}
          >
            {isAdjusted ? '✓ Adjusted' : 'Mark adjusted'}
          </button>
        </td>
        <td className="px-2 py-1.5 text-slate-700 max-w-[260px]">
          <div className="truncate" title={err.description}>{err.description}</div>
          <div className="flex items-center gap-1 mt-0.5">
            {isFraud && <span className="text-[9px] text-red-600 font-semibold inline-flex items-center gap-0.5"><AlertOctagon className="h-2.5 w-2.5" />Fraud</span>}
            {/* Journal badge — visible when this row is part of a
                multi-line error journal. The same id appears on every
                line in the journal so a reviewer can spot which rows
                offset each other. Truncated for compactness. */}
            {journalGroupId && (
              <span
                className="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1 py-0 rounded font-mono"
                title={`Part of journal ${journalGroupId}`}
              >
                Journal · {journalGroupId.slice(2, 7)}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5 text-center">
          <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
            err.errorType === 'factual' ? 'bg-blue-100 text-blue-700' :
            err.errorType === 'judgemental' ? 'bg-purple-100 text-purple-700' :
            'bg-amber-100 text-amber-700'
          }`}>{err.errorType}</span>
        </td>
        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-800 border-l border-slate-200">{isDr ? fmt(amount) : ''}</td>
        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-200">{!isDr ? fmt(amount) : ''}</td>
        {showSplit && (
          <>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700">{!isPL && isDr ? fmt(amount) : ''}</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-200">{!isPL && !isDr ? fmt(amount) : ''}</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700">{isPL && isDr ? fmt(amount) : ''}</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-200">{isPL && !isDr ? fmt(amount) : ''}</td>
          </>
        )}
        <td className="px-2 py-1.5 text-center">
          {sourceDecoded ? (
            <button
              onClick={() => navigateTo(sourceDecoded.loc)}
              className="inline-flex items-center gap-0.5 text-[10px] text-blue-700 hover:text-blue-900 hover:underline"
              title={`Jump to where this error was raised: ${sourceDecoded.loc.label || sourceDecoded.loc.tab}`}
            >
              <ExternalLink className="h-2.5 w-2.5" />
              <span className="truncate max-w-[80px]">{sourceDecoded.loc.label || sourceDecoded.loc.tab}</span>
            </button>
          ) : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2 py-1.5">
          <div className="inline-flex items-center gap-1">
            <SignOffDot signed={!!so.preparer} by={so.preparer?.userName || null} role="P"  onClick={() => onSignOff('preparer')} disabled={busy} />
            <SignOffDot signed={!!so.reviewer} by={so.reviewer?.userName || null} role="R"  onClick={() => onSignOff('reviewer')} disabled={busy} />
            <SignOffDot signed={!!so.ri}       by={so.ri?.userName || null}       role="RI" onClick={() => onSignOff('ri')}       disabled={busy} />
          </div>
        </td>
        <td className="text-center">
          <button onClick={onDelete} disabled={busy} className="text-red-400 hover:text-red-600 disabled:opacity-50" title="Remove">
            <Trash2 className="h-3 w-3" />
          </button>
        </td>
      </tr>
      {/* Reason text box — sits below each single-line error or
          below the last line of a multi-line journal (per spec:
          "text box underneath… after several rows of errors").
          Hidden on intermediate journal lines so the reason renders
          once per journal, not once per line. */}
      {showReasonBox && (
        <tr className="border-b border-slate-100/70">
          <td></td>
          <td colSpan={showSplit ? 12 : 8} className="px-2 pb-2 pt-0">
            <textarea
              value={reasonDraft}
              onChange={e => setReasonDraft(e.target.value)}
              onBlur={e => {
                if (e.target.value !== (err.explanation || '')) onSetReason(e.target.value);
              }}
              placeholder={journalGroupId ? 'Reason for the journal — applied to every line in this journal' : 'Reason for the error…'}
              className="w-full text-[10px] border border-slate-200 rounded px-2 py-1 min-h-[28px] bg-slate-50/40 focus:bg-white"
              rows={1}
            />
          </td>
        </tr>
      )}
    </>
  );
}
