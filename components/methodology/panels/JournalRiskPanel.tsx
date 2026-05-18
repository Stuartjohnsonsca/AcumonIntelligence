'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { expandZipFile } from '@/lib/client-unzip';

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
  conclusion?: string;
  conclusionAt?: string | null;
  aiFlaggedCount?: number;
  exceptionCount?: number;
  errorScheduleCount?: number;
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
  aiInsight?: string | null;
  aiFlag?: boolean | null;
  aiProcessedAt?: string | null;
  errorScheduleId?: string | null;
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

  // Data-source state — populated from /journal-risk?sources=1 so the panel
  // can show the right input option (Xero / portal request / CSV upload).
  const [xeroConnected, setXeroConnected] = useState<{ connected: boolean; orgName?: string | null } | null>(null);
  const [requestSent, setRequestSent] = useState<string | null>(null); // ISO timestamp
  const [requesting, setRequesting] = useState(false);
  const [pickedSource, setPickedSource] = useState<'xero' | 'request' | 'csv' | null>(null);

  // Upload state (CSV path)
  const [journalsFile, setJournalsFile] = useState<File | null>(null);
  const [usersFile, setUsersFile] = useState<File | null>(null);
  const [accountsFile, setAccountsFile] = useState<File | null>(null);

  // Xero pull mode — manual is the safer default (includes posting user
  // names); full pulls every system-generated journal too.
  const [xeroMode, setXeroMode] = useState<'manual' | 'full'>('manual');

  // AI augmentation state + conclusion text
  const [aiRunning, setAiRunning] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [conclusionDraft, setConclusionDraft] = useState('');
  const [conclusionSaving, setConclusionSaving] = useState(false);
  const [conclusionSavedAt, setConclusionSavedAt] = useState<string | null>(null);

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
        if (data.run?.conclusion) setConclusionDraft(data.run.conclusion);
        else setConclusionDraft('');
        if (data.run?.conclusionAt) setConclusionSavedAt(data.run.conclusionAt);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadRun(); }, [loadRun]);

  // Load connection status so we know which input option to surface.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/journal-risk?sources=1`);
        if (res.ok) {
          const data = await res.json();
          setXeroConnected(data.xero || { connected: false });
        }
      } catch { /* ignore */ }
    })();
  }, [engagementId]);

  // Pull from Xero
  async function handlePullFromXero() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull_xero', mode: xeroMode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Xero pull failed (${res.status})`);
        return;
      }
      await loadRun();
    } catch (err: any) {
      setError(err.message || 'Xero pull failed');
    } finally {
      setRunning(false);
    }
  }

  // AI augmentation — analyses descriptions of the selected sample (or all
  // suspicious entries) and stores commentary alongside each entry. Does
  // NOT alter the deterministic risk score.
  async function handleRunAi(scope: 'selected' | 'suspicious') {
    setAiRunning(true);
    setAiMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_ai_augmentation', scope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `AI augmentation failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setAiMessage(`AI commentary added to ${data.processed} of ${data.total} ${scope === 'suspicious' ? 'suspicious' : 'selected'} journals.`);
      await loadRun();
      await loadEntries();
    } catch (err: any) {
      setError(err.message || 'AI augmentation failed');
    } finally {
      setAiRunning(false);
    }
  }

  // Save the auditor's overall conclusion text on the run. Feeds the
  // Audit Summary Memo via /journal-risk?memoSummary=1.
  async function handleSaveConclusion() {
    setConclusionSaving(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_conclusion', conclusion: conclusionDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
      } else {
        setConclusionSavedAt(new Date().toISOString());
      }
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setConclusionSaving(false);
    }
  }

  // Raise a journal as an error onto the engagement's error schedule.
  async function handleRaiseAsError(entry: JournalEntry) {
    if (entry.errorScheduleId) return;
    if (!confirm(`Raise journal ${entry.journalId} as an error on the engagement error schedule?\n\nAmount: ${fmtNum(entry.amount)}\nDescription: ${entry.description || '(none)'}\n\nThis can be reviewed and edited on the Error Schedule tab.`)) return;
    try {
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raise_as_error', entryId: entry.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Raise failed (${res.status})`);
        return;
      }
      await loadEntries();
      await loadRun();
    } catch (err: any) {
      setError(err.message || 'Raise failed');
    }
  }

  // Send a portal request asking the client to upload a journal export
  async function handleRequestFromClient() {
    setRequesting(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/journal-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_from_client' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setRequestSent(data.sentAt || new Date().toISOString());
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setRequesting(false);
    }
  }

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

  // ── Input View (no run exists) ──
  if (!run) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">ISA 240 — Journal Entry Risk Assessment</h3>
          <p className="text-xs text-slate-400">Where would you like the journal data to come from?</p>
        </div>

        {/* Source picker — three tiles. Xero tile is enabled only when a
            live connection exists; the other two are always available. */}
        {!pickedSource && (
          <div className="grid grid-cols-3 gap-3">
            <div className={`border rounded-lg p-4 transition-colors ${
                xeroConnected?.connected
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-slate-200 bg-slate-50 opacity-60'
              }`}
            >
              <p className="text-xs font-semibold text-slate-700 mb-1">Pull from accounting system</p>
              <p className="text-[10px] text-slate-500 mb-2">
                {xeroConnected?.connected
                  ? `Xero connected${xeroConnected.orgName ? ` — ${xeroConnected.orgName}` : ''}.`
                  : 'No active Xero connection for this client.'}
              </p>
              {xeroConnected?.connected && (
                <>
                  <div className="flex gap-1 bg-white rounded p-0.5 mb-2 text-[10px]">
                    <button
                      onClick={(e) => { e.stopPropagation(); setXeroMode('manual'); }}
                      className={`flex-1 px-2 py-1 rounded ${xeroMode === 'manual' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      title="Only manual journals. Posting user names are preserved."
                    >Manual only</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setXeroMode('full'); }}
                      className={`flex-1 px-2 py-1 rounded ${xeroMode === 'full' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      title="Full journal feed including system-posted entries. Posting user not exposed by Xero on this endpoint."
                    >Full feed</button>
                  </div>
                  <button
                    onClick={() => handlePullFromXero()}
                    disabled={running}
                    className="w-full px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {running ? 'Pulling…' : `Pull ${xeroMode === 'manual' ? 'manual journals' : 'full journal feed'}`}
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => handleRequestFromClient()}
              disabled={requesting}
              className="border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg p-4 text-left transition-colors disabled:opacity-60"
            >
              <p className="text-xs font-semibold text-slate-700 mb-1">Request from client</p>
              <p className="text-[10px] text-slate-500">
                {requestSent
                  ? `Request sent ${new Date(requestSent).toLocaleString('en-GB')} — waiting for the client to upload via the portal.`
                  : 'Sends a portal request asking the client to upload a journal export.'}
              </p>
              {requesting && (
                <p className="text-[10px] text-amber-700 mt-2 animate-pulse">Sending request…</p>
              )}
            </button>

            <button
              onClick={() => setPickedSource('csv')}
              className="border border-slate-200 bg-white hover:bg-slate-50 rounded-lg p-4 text-left transition-colors"
            >
              <p className="text-xs font-semibold text-slate-700 mb-1">Upload CSV manually</p>
              <p className="text-[10px] text-slate-500">Use this if you already have a journal extract from another accounting system or a prior client response.</p>
            </button>
          </div>
        )}

        {/* CSV upload path — surfaces the three drop zones */}
        {pickedSource === 'csv' && (
          <>
            <div className="flex items-center justify-between">
              <button onClick={() => setPickedSource(null)} className="text-[10px] text-blue-600 hover:underline">← Back to source picker</button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FileDropZone label="Journals CSV" file={journalsFile} onFile={setJournalsFile} accept=".csv" required
                hint="journalId, postedAt, period, source, preparedByUserId, approvedByUserId, description, amount, debitAccountId, creditAccountId" />
              <FileDropZone label="Users CSV" file={usersFile} onFile={setUsersFile} accept=".csv" required
                hint="userId, displayName, roleTitle" />
              <FileDropZone label="Accounts CSV" file={accountsFile} onFile={setAccountsFile} accept=".csv" required
                hint="accountId, accountName, category, isJudgmental, materialityGroup" />
            </div>
            <div className="flex justify-center">
              <button
                onClick={handleRun}
                disabled={!journalsFile || !usersFile || !accountsFile || running}
                className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {running ? 'Running Analysis...' : 'Run Analysis'}
              </button>
            </div>
          </>
        )}

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
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
          {(run.exceptionCount ?? 0) > 0 && (
            <span className="text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium" title="Exceptions identified during testing">
              {run.exceptionCount} exception{run.exceptionCount === 1 ? '' : 's'}
            </span>
          )}
          {(run.errorScheduleCount ?? 0) > 0 && (
            <span className="text-[9px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium" title="Raised to the engagement error schedule">
              {run.errorScheduleCount} on error schedule
            </span>
          )}
          {(run.aiFlaggedCount ?? 0) > 0 && (
            <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium" title="AI commentary flagged the description">
              AI flagged {run.aiFlaggedCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRunAi('selected')}
            disabled={aiRunning}
            className="text-[10px] px-2.5 py-1 bg-purple-50 text-purple-700 rounded hover:bg-purple-100 disabled:opacity-50"
            title="Adds linguistic commentary to each selected journal description. Does not change the deterministic risk score."
          >
            {aiRunning ? 'Running AI…' : 'AI augment selected'}
          </button>
          <button onClick={() => handleExport('csv')} className="text-[10px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Export CSV</button>
          <button onClick={() => handleExport('markdown')} className="text-[10px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Export Summary</button>
          <button onClick={() => { setRun(null); setEntries([]); }} className="text-[10px] px-2.5 py-1 bg-amber-50 text-amber-600 rounded hover:bg-amber-100">Re-run</button>
        </div>
      </div>
      {aiMessage && (
        <div className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-3 py-1.5">
          {aiMessage} <span className="text-purple-500">— shown as a purple ‘AI’ tag and tooltip in the table below.</span>
        </div>
      )}

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
          {pop.sourceSystem && (
            <span className="font-medium text-slate-600">
              Source: {pop.sourceSystem === 'xero' ? 'Xero (live pull)' : pop.sourceSystem === 'csv' ? 'CSV upload' : pop.sourceSystem}
            </span>
          )}
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
                onRaiseAsError={() => handleRaiseAsError(entry)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Conclusion text — feeds the Audit Summary Memo */}
      <div className="border border-slate-200 rounded-lg p-3 bg-white">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-slate-700">Auditor's conclusion on management override</p>
          <span className="text-[9px] text-slate-400">
            Feeds the Audit Summary Memo → Significant Risks → Management Override of controls
            {conclusionSavedAt && <> · saved {new Date(conclusionSavedAt).toLocaleString('en-GB')}</>}
          </span>
        </div>
        <textarea
          value={conclusionDraft}
          onChange={e => setConclusionDraft(e.target.value)}
          placeholder="e.g. Tested 25 selected journals; no evidence of management override identified. Two adjusting entries by the Finance Director were corroborated to supporting evidence and approved by the CFO."
          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleSaveConclusion}
            disabled={conclusionSaving}
            className="text-[10px] px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {conclusionSaving ? 'Saving…' : 'Save conclusion'}
          </button>
        </div>
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
      <input ref={inputRef} type="file" accept={accept ? `${accept},.zip` : '.zip'} className="hidden" onChange={async e => {
        const f = await expandZipFile(e.target.files?.[0]);
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

function EntryRow({ entry, isExpanded, onToggle, onUpdateStatus, onRaiseAsError }: {
  entry: JournalEntry; isExpanded: boolean; onToggle: () => void;
  onUpdateStatus: (id: string, status: string, notes?: string) => void;
  onRaiseAsError: () => void;
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
          <div className="flex gap-0.5 flex-wrap items-center">
            {(entry.riskTags || []).slice(0, 3).map((tag, i) => (
              <span key={i} className="text-[8px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded">{tag}</span>
            ))}
            {(entry.riskTags || []).length > 3 && <span className="text-[8px] text-slate-400">+{entry.riskTags.length - 3}</span>}
            {entry.aiFlag && (
              <span className="text-[8px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-bold" title={entry.aiInsight || 'AI flagged'}>AI</span>
            )}
            {entry.errorScheduleId && (
              <span className="text-[8px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-bold" title="Raised to the error schedule">ERR</span>
            )}
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

              {/* AI insight — non-binding linguistic commentary. Shown
                  with a clear "AI" prefix and a tone that distinguishes
                  it from the deterministic rule drivers above. */}
              {entry.aiInsight && (
                <div className={`text-[10px] rounded px-2 py-1.5 border ${
                  entry.aiFlag
                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  <span className="font-semibold">AI commentary{entry.aiFlag ? ' (flagged)' : ''}:</span> {entry.aiInsight}
                </div>
              )}

              {/* Test notes + Raise-as-error */}
              {entry.selected && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      onBlur={() => { if (notes !== entry.testNotes) onUpdateStatus(entry.id, entry.testStatus, notes); }}
                      placeholder="Test notes..."
                      className="flex-1 text-[10px] border border-slate-200 rounded px-2 py-1.5 resize-none h-12 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </div>
                  <div className="flex justify-end">
                    {entry.errorScheduleId ? (
                      <span className="text-[10px] text-orange-700 italic">Raised to the engagement error schedule.</span>
                    ) : (
                      <button
                        onClick={onRaiseAsError}
                        className="text-[10px] px-2.5 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded hover:bg-orange-100"
                      >
                        Raise as error
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
