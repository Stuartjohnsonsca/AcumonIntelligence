'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Props {
  engagementId: string;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
}

interface RunSummary {
  id: string;
  runId: string;
  status: string;
  totalJournals: number;
  totalSelected: number;
  selectionSummary: { layer1: number; layer2: number; layer3: number; notSelected: number };
  populationEvidence: any;
  config: any;
  runBy: string;
  createdAt: string;
}

interface JournalEntry {
  id: string;
  journalId: string;
  postedAt: string;
  period: string;
  isManual: boolean;
  preparedByUserId: string;
  approvedByUserId: string | null;
  amount: number;
  description: string | null;
  debitAccountId: string;
  creditAccountId: string;
  riskScore: number;
  riskBand: string;
  riskTags: string[];
  drivers: { ruleId: string; ruleName: string; severity: string; weightApplied: number; explanation: string }[];
  selected: boolean;
  selectionLayer: string;
  mandatory: boolean;
  rationale: string | null;
  testStatus: string;
  testNotes: string | null;
  testedAt: string | null;
}

function fmtDate(d: string) { try { return new Date(d).toLocaleDateString('en-GB'); } catch { return d; } }
function fmtNum(n: number) { return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const LAYER_LABELS: Record<string, string> = {
  layer1_mandatory_high_risk: 'Layer 1 - Mandatory',
  layer2_targeted_coverage: 'Layer 2 - Targeted',
  layer3_unpredictable: 'Layer 3 - Unpredictable',
  not_selected: 'Not Selected',
};

const BAND_COLOURS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-green-100 text-green-700',
};

const TEST_STATUSES = ['pending', 'tested', 'no_exception', 'exception'] as const;
const STATUS_LABELS: Record<string, string> = { pending: 'Pending', tested: 'Tested', no_exception: 'No Exception', exception: 'Exception' };
const STATUS_COLOURS: Record<string, string> = { pending: 'text-slate-400', tested: 'text-blue-600', no_exception: 'text-green-600', exception: 'text-red-600' };

export function JournalRiskPanel({ engagementId, periodStartDate, periodEndDate }: Props) {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload state
  const [journalsFile, setJournalsFile] = useState<File | null>(null);
  const [usersFile, setUsersFile] = useState<File | null>(null);
  const [accountsFile, setAccountsFile] = useState<File | null>(null);

  // Entries state
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [entriesPage, setEntriesPage] = useState(1);
  const [showSelectedOnly, setShowSelectedOnly] = useState(true);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Load existing run
  const loadRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`);
      if (res.ok) {
        const data = await res.json();
        setRun(data.run || null);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadRun(); }, [loadRun]);

  // Load entries when run exists
  const loadEntries = useCallback(async () => {
    if (!run) return;
    setEntriesLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(entriesPage),
        limit: '50',
        sort: 'riskScore',
        dir: 'desc',
      });
      if (showSelectedOnly) params.set('selected', 'true');
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk/entries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setEntriesTotal(data.total || 0);
      }
    } catch { /* ignore */ }
    finally { setEntriesLoading(false); }
  }, [engagementId, run, entriesPage, showSelectedOnly]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Run analysis
  async function handleRun() {
    if (!journalsFile || !usersFile || !accountsFile) return;
    setRunning(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('journals', journalsFile);
      formData.append('users', usersFile);
      formData.append('accounts', accountsFile);

      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed (${res.status})`);
        return;
      }

      const data = await res.json();
      setJournalsFile(null);
      setUsersFile(null);
      setAccountsFile(null);
      await loadRun();
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setRunning(false);
    }
  }

  // Update entry test status
  async function updateEntryStatus(entryId: string, testStatus: string, testNotes?: string) {
    await fetch(`/api/engagements/${engagementId}/journal-risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_entry', entryId, testStatus, testNotes }),
    });
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, testStatus, testNotes: testNotes ?? e.testNotes, testedAt: new Date().toISOString() } : e));
  }

  // Export
  async function handleExport(format: 'csv' | 'markdown') {
    const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: format === 'csv' ? 'export_csv' : 'export_markdown' }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'csv' ? `journal_risk.csv` : `journal_risk_summary.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading...</div>;

  // ── Upload View (no run exists) ──
  if (!run) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">ISA 240 — Journal Entry Risk Assessment</h3>
          <p className="text-xs text-slate-400">Upload journal data to run risk scoring and sample selection</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <FileDropZone label="Journals CSV" file={journalsFile} onFile={setJournalsFile} accept=".csv" required
            hint="journalId, postedAt, period, source, preparedByUserId, approvedByUserId, description, amount, debitAccountId, creditAccountId" />
          <FileDropZone label="Users CSV" file={usersFile} onFile={setUsersFile} accept=".csv" required
            hint="userId, displayName, roleTitle" />
          <FileDropZone label="Accounts CSV" file={accountsFile} onFile={setAccountsFile} accept=".csv" required
            hint="accountId, accountName, category, isJudgmental, materialityGroup" />
        </div>

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

        <div className="flex justify-center">
          <button
            onClick={handleRun}
            disabled={!journalsFile || !usersFile || !accountsFile || running}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? 'Running Analysis...' : 'Run Analysis'}
          </button>
        </div>
      </div>
    );
  }

  // ── Results View ──
  const ss = run.selectionSummary;
  const pop = run.populationEvidence;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Journal Risk Assessment</h3>
          <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleExport('csv')} className="text-[10px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Export CSV</button>
          <button onClick={() => handleExport('markdown')} className="text-[10px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Export Summary</button>
          <button onClick={() => { setRun(null); setEntries([]); }} className="text-[10px] px-2.5 py-1 bg-amber-50 text-amber-600 rounded hover:bg-amber-100">Re-run</button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-6 gap-2">
        <StatCard label="Population" value={run.totalJournals} />
        <StatCard label="Selected" value={run.totalSelected} accent />
        <StatCard label="Layer 1 (Mandatory)" value={ss.layer1} colour="red" />
        <StatCard label="Layer 2 (Targeted)" value={ss.layer2} colour="amber" />
        <StatCard label="Layer 3 (Random)" value={ss.layer3} colour="blue" />
        <StatCard label="Not Selected" value={ss.notSelected} colour="slate" />
      </div>

      {/* Population evidence */}
      {pop && (
        <div className="flex items-center gap-4 text-[10px] text-slate-500 bg-slate-50 rounded px-3 py-1.5">
          <span>Records: {pop.recordCount?.toLocaleString()}</span>
          {pop.hashTotals && <span>Debits: {fmtNum(pop.hashTotals.totalDebits)}</span>}
          {pop.hashTotals && <span>Credits: {fmtNum(pop.hashTotals.totalCredits)}</span>}
          {pop.coverage && <span>Coverage: {fmtDate(pop.coverage.fromDate)} to {fmtDate(pop.coverage.toDate)}</span>}
          <span className="ml-auto">Run by {run.runBy} on {fmtDate(run.createdAt)}</span>
        </div>
      )}

      {/* Filter toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setShowSelectedOnly(true); setEntriesPage(1); }}
          className={`text-xs px-3 py-1 rounded ${showSelectedOnly ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          Selected ({run.totalSelected})
        </button>
        <button
          onClick={() => { setShowSelectedOnly(false); setEntriesPage(1); }}
          className={`text-xs px-3 py-1 rounded ${!showSelectedOnly ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          All ({run.totalJournals})
        </button>
        <span className="text-[10px] text-slate-400 ml-auto">
          Showing {entries.length} of {entriesTotal}
        </span>
      </div>

      {/* Entries table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-medium text-slate-500">Journal ID</th>
              <th className="text-left px-2 py-2 font-medium text-slate-500">Posted</th>
              <th className="text-right px-2 py-2 font-medium text-slate-500">Amount</th>
              <th className="text-center px-2 py-2 font-medium text-slate-500">Score</th>
              <th className="text-center px-2 py-2 font-medium text-slate-500">Band</th>
              <th className="text-left px-2 py-2 font-medium text-slate-500">Layer</th>
              <th className="text-left px-2 py-2 font-medium text-slate-500">Tags</th>
              <th className="text-center px-2 py-2 font-medium text-slate-500">Test Status</th>
            </tr>
          </thead>
          <tbody>
            {entriesLoading ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-400 animate-pulse">Loading entries...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-400 italic">No entries found</td></tr>
            ) : entries.map(entry => (
              <EntryRow
                key={entry.id}
                entry={entry}
                isExpanded={expandedEntry === entry.id}
                onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                onUpdateStatus={updateEntryStatus}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {entriesTotal > 50 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setEntriesPage(p => Math.max(1, p - 1))} disabled={entriesPage <= 1}
            className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
          <span className="text-xs text-slate-500">Page {entriesPage} of {Math.ceil(entriesTotal / 50)}</span>
          <button onClick={() => setEntriesPage(p => p + 1)} disabled={entriesPage >= Math.ceil(entriesTotal / 50)}
            className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function FileDropZone({ label, file, onFile, accept, required, hint }: {
  label: string; file: File | null; onFile: (f: File | null) => void; accept: string; required?: boolean; hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
        file ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = '';
      }} />
      <p className="text-xs font-medium text-slate-700 mb-1">{label}{required && ' *'}</p>
      {file ? (
        <div>
          <p className="text-[10px] text-green-600 font-medium">{file.name}</p>
          <p className="text-[9px] text-slate-400">{(file.size / 1024).toFixed(0)} KB</p>
          <button onClick={e => { e.stopPropagation(); onFile(null); }} className="text-[9px] text-red-500 mt-1 hover:underline">Remove</button>
        </div>
      ) : (
        <div>
          <p className="text-[10px] text-slate-400">Click to upload</p>
          {hint && <p className="text-[8px] text-slate-300 mt-1">{hint}</p>}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, colour }: { label: string; value: number; accent?: boolean; colour?: string }) {
  const bg = accent ? 'bg-blue-50 border-blue-200' : colour ? `bg-${colour}-50 border-${colour}-200` : 'bg-white border-slate-200';
  const text = accent ? 'text-blue-700' : colour ? `text-${colour}-700` : 'text-slate-700';
  return (
    <div className={`border rounded-lg px-3 py-2 ${bg}`}>
      <p className={`text-lg font-bold ${text}`}>{value.toLocaleString()}</p>
      <p className="text-[9px] text-slate-500 font-medium">{label}</p>
    </div>
  );
}

function EntryRow({ entry, isExpanded, onToggle, onUpdateStatus }: {
  entry: JournalEntry; isExpanded: boolean; onToggle: () => void;
  onUpdateStatus: (id: string, status: string, notes?: string) => void;
}) {
  const [notes, setNotes] = useState(entry.testNotes || '');

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2 font-medium text-slate-700">{entry.journalId}</td>
        <td className="px-2 py-2 text-slate-500">{fmtDate(entry.postedAt)}</td>
        <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtNum(entry.amount)}</td>
        <td className="px-2 py-2 text-center">
          <span className={`inline-block min-w-[28px] px-1.5 py-0.5 rounded text-[10px] font-bold ${
            entry.riskScore >= 70 ? 'bg-red-100 text-red-700' : entry.riskScore >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
          }`}>{entry.riskScore}</span>
        </td>
        <td className="px-2 py-2 text-center">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${BAND_COLOURS[entry.riskBand] || 'bg-slate-100 text-slate-600'}`}>
            {entry.riskBand}
          </span>
        </td>
        <td className="px-2 py-2">
          <span className="text-[9px] text-slate-500">{LAYER_LABELS[entry.selectionLayer] || entry.selectionLayer}</span>
        </td>
        <td className="px-2 py-2">
          <div className="flex gap-0.5 flex-wrap">
            {(entry.riskTags || []).slice(0, 3).map((tag, i) => (
              <span key={i} className="text-[8px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded">{tag}</span>
            ))}
            {(entry.riskTags || []).length > 3 && <span className="text-[8px] text-slate-400">+{entry.riskTags.length - 3}</span>}
          </div>
        </td>
        <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
          <select
            value={entry.testStatus}
            onChange={e => onUpdateStatus(entry.id, e.target.value)}
            className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${STATUS_COLOURS[entry.testStatus] || ''}`}
          >
            {TEST_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-slate-200">
          <td colSpan={8} className="px-4 py-3 bg-slate-50/80">
            <div className="space-y-2">
              {/* Details */}
              <div className="grid grid-cols-4 gap-3 text-[10px]">
                <div><span className="text-slate-400">Period:</span> <span className="text-slate-600">{entry.period}</span></div>
                <div><span className="text-slate-400">Prepared by:</span> <span className="text-slate-600">{entry.preparedByUserId}</span></div>
                <div><span className="text-slate-400">Approved by:</span> <span className="text-slate-600">{entry.approvedByUserId || '—'}</span></div>
                <div><span className="text-slate-400">Accounts:</span> <span className="text-slate-600">{entry.debitAccountId} / {entry.creditAccountId}</span></div>
              </div>
              {entry.description && (
                <div className="text-[10px]"><span className="text-slate-400">Description:</span> <span className="text-slate-600">{entry.description}</span></div>
              )}

              {/* Risk drivers */}
              <div>
                <p className="text-[10px] font-medium text-slate-500 mb-1">Risk Drivers ({entry.drivers.length})</p>
                <div className="space-y-1">
                  {entry.drivers.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
                        d.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        d.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{d.ruleId}</span>
                      <span className="text-slate-600">{d.explanation}</span>
                      <span className="text-slate-400 ml-auto flex-shrink-0">(+{d.weightApplied})</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rationale */}
              {entry.rationale && (
                <div className="text-[10px] bg-blue-50 rounded px-2 py-1.5 text-blue-700 border border-blue-200">
                  {entry.rationale}
                </div>
              )}

              {/* Test notes */}
              {entry.selected && (
                <div className="flex items-start gap-2">
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    onBlur={() => { if (notes !== entry.testNotes) onUpdateStatus(entry.id, entry.testStatus, notes); }}
                    placeholder="Test notes..."
                    className="flex-1 text-[10px] border border-slate-200 rounded px-2 py-1.5 resize-none h-12 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
