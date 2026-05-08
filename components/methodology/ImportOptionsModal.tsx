'use client';

// Import Options pop-up — shown when an engagement is first opened (or
// re-summoned later from the Prior Period tab). Three source paths:
//
//   1. Upload — user picks a local file. Synchronous, no orchestrator.
//   2. Connect to Cloud Audit Software — server-driven. Acumon spins up
//      a headless browser via the orchestrator, AI navigates the
//      vendor's site, the user is prompted inline for credentials / MFA /
//      confirmations as needed.
//   3. Other Cloud Audit Software — same as (2), with a free-text vendor
//      name.
//
// During (2) and (3) the modal polls /handoff/status every 1.5s. The
// response carries a progressStage (drives the progress bar), an optional
// pendingPrompt (if set, we render an inline credentials / MFA / confirm /
// select form), and on submit_archive flips status='submitted' so we can
// hand off to the Review pop-up.

import { useEffect, useMemo, useState } from 'react';
import { expandZipFile } from '@/lib/client-unzip';
import type {
  ImportOptionsState,
  ImportSelection,
  ImportSourceType,
  CloudConnectorRecord,
} from '@/lib/import-options/types';

// ─── Stage / prompt types (mirror server) ────────────────────────────

type HandoffStage =
  | 'created'
  | 'launching_browser'
  | 'logging_in'
  | 'navigating'
  | 'downloading'
  | 'awaiting_input'
  | 'discovered'
  | 'context_loaded'
  | 'uploading'
  | 'extracting'
  | 'submitted';

interface StageMeta { key: HandoffStage; label: string; }
const HANDOFF_STAGES: StageMeta[] = [
  { key: 'created',           label: 'Session ready' },
  { key: 'launching_browser', label: 'Browser launched' },
  { key: 'logging_in',        label: 'Logging in' },
  { key: 'navigating',        label: 'Finding prior period' },
  { key: 'downloading',       label: 'Downloading archive' },
  { key: 'extracting',        label: 'AI extracting' },
  { key: 'submitted',         label: 'Ready for review' },
];

// Map old/legacy stages onto the user-facing 7 above so the bar still
// makes sense if the orchestrator emits granular progress.
const STAGE_ALIAS: Record<string, HandoffStage> = {
  discovered: 'launching_browser',
  context_loaded: 'launching_browser',
  uploading: 'downloading',
  awaiting_input: 'logging_in', // most prompts happen during login
};
function normaliseStage(s: string | null | undefined): HandoffStage {
  if (!s) return 'created';
  if (HANDOFF_STAGES.some(x => x.key === s)) return s as HandoffStage;
  return STAGE_ALIAS[s] || 'created';
}
function stageIndex(stage: HandoffStage): number {
  const i = HANDOFF_STAGES.findIndex(s => s.key === stage);
  return i < 0 ? 0 : i;
}

interface PendingPrompt {
  id: string;
  type: 'credentials' | 'mfa' | 'confirm' | 'select' | 'text';
  message: string;
  options?: {
    fields?: Array<{ name: string; label: string; secret?: boolean }>;
    options?: Array<{ value: string; label: string }>;
    placeholder?: string;
  };
}

// ─── Modal props + selection options ─────────────────────────────────

interface Props {
  engagementId: string;
  clientName: string;
  periodEnd?: string;
  auditTypeLabel?: string;
  onComplete: (state: ImportOptionsState, opts: { extractionId?: string }) => void;
  onClose?: () => void;
}

const CHECKBOX_OPTIONS: { key: ImportSelection; label: string }[] = [
  { key: 'import_data',         label: 'Import data from another audit file' },
  { key: 'copy_documents',      label: 'Copy documents from another audit file' },
  { key: 'ai_populate_current', label: 'Use AI to populate current year' },
];

type Step = 'select' | 'expand' | 'upload' | 'busy' | 'handoff';

// ─── Component ───────────────────────────────────────────────────────

export function ImportOptionsModal({ engagementId, clientName, periodEnd, auditTypeLabel, onComplete, onClose }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [selected, setSelected] = useState<Set<ImportSelection>>(new Set());
  const [sourceType, setSourceType] = useState<ImportSourceType | null>(null);
  const [busyMessage, setBusyMessage] = useState('Working…');
  const [error, setError] = useState<string | null>(null);

  // Cloud connector picker
  const [connectors, setConnectors] = useState<CloudConnectorRecord[]>([]);
  const [chosenConnectorId, setChosenConnectorId] = useState('');
  const [otherVendorName, setOtherVendorName] = useState('MyWorkPapers');

  // Upload (manual file picker)
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Handoff session state (server-driven)
  const [handoffSessionId, setHandoffSessionId] = useState<string | null>(null);
  const [handoffStatus, setHandoffStatus] = useState<'pending' | 'submitted' | 'expired' | 'cancelled' | 'failed'>('pending');
  const [handoffStage, setHandoffStage] = useState<HandoffStage>('created');
  const [handoffMessage, setHandoffMessage] = useState<string>('Session created. Starting browser…');
  const [handoffFailureMessage, setHandoffFailureMessage] = useState<string | null>(null);
  const [orchestratorConfigured, setOrchestratorConfigured] = useState<boolean | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);

  // Load connectors when entering the cloud step
  useEffect(() => {
    if (sourceType !== 'cloud') return;
    fetch('/api/cloud-audit-connectors')
      .then(r => r.ok ? r.json() : { connectors: [] })
      .then(j => setConnectors(j.connectors || []))
      .catch(() => setConnectors([]));
  }, [sourceType]);

  // Polling — drive the progress bar and pick up pending prompts
  useEffect(() => {
    if (step !== 'handoff' || !handoffSessionId) return;
    if (handoffStatus !== 'pending') return;
    let cancelled = false;
    const url = `/api/engagements/${engagementId}/import-options/handoff/status?sessionId=${encodeURIComponent(handoffSessionId)}`;
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json() as {
          status: string;
          extractionId?: string | null;
          progressStage?: string;
          progressMessage?: string | null;
          failureMessage?: string | null;
          pendingPrompt?: PendingPrompt | null;
        };
        if (cancelled) return;
        if (json.progressStage) setHandoffStage(normaliseStage(json.progressStage));
        if (json.progressMessage) setHandoffMessage(json.progressMessage);
        setPendingPrompt(json.pendingPrompt || null);
        if (json.failureMessage) setHandoffFailureMessage(json.failureMessage);
        if (json.status === 'submitted' && json.extractionId) {
          setHandoffStatus('submitted');
          await fetch(`/api/engagements/${engagementId}/import-options/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selections: Array.from(selected),
              source: { type: 'cloud', vendorLabel: vendorLabelForHandoff() },
              status: 'extracted',
            }),
          });
          onComplete({
            prompted: true,
            selections: Array.from(selected),
            source: { type: 'cloud', vendorLabel: vendorLabelForHandoff() },
            status: 'extracted',
            extractionId: json.extractionId,
          }, { extractionId: json.extractionId });
        } else if (json.status === 'expired' || json.status === 'cancelled' || json.status === 'failed') {
          setHandoffStatus(json.status as 'expired' | 'cancelled' | 'failed');
        }
      } catch { /* keep polling */ }
    };
    const id = setInterval(tick, 1500);
    void tick();
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, handoffSessionId, handoffStatus, engagementId]);

  function vendorLabelForHandoff(): string {
    if (sourceType === 'cloud') return connectors.find(c => c.id === chosenConnectorId)?.label || 'Cloud Audit Software';
    if (sourceType === 'cloud_other') return otherVendorName.trim() || 'Cloud Audit Software';
    return 'Cloud Audit Software';
  }

  function toggle(key: ImportSelection) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  }

  // ─── Step transitions ──────────────────────────────────────────────

  async function saveSelectionsAndFinish(opts: { selections: ImportSelection[]; cancelled?: boolean }) {
    setStep('busy');
    setBusyMessage(opts.cancelled ? 'Cancelling…' : 'Saving…');
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: opts.selections,
          status: opts.cancelled ? 'cancelled' : 'pending',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      const json = await res.json();
      onComplete(json.importOptions as ImportOptionsState, {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStep('select');
    }
  }

  async function handleProceedFromSelect() {
    setError(null);
    const sel = Array.from(selected);
    if (!sel.includes('import_data')) {
      await saveSelectionsAndFinish({ selections: sel });
      return;
    }
    setStep('expand');
  }

  async function handleUploadProceed() {
    if (!uploadFile) { setError('Please choose a file'); return; }
    setStep('busy');
    setBusyMessage('Uploading prior audit file…');
    setError(null);
    try {
      const file = await expandZipFile(uploadFile) || uploadFile;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('originalName', uploadFile.name);
      formData.append('selections', JSON.stringify(Array.from(selected)));
      const res = await fetch(`/api/engagements/${engagementId}/import-options/upload`, {
        method: 'POST', body: formData,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Upload failed (${res.status})`);
      }
      const json = await res.json();
      onComplete(json.importOptions as ImportOptionsState, { extractionId: json.extractionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStep('upload');
    }
  }

  async function startHandoff(vendorLabel: string) {
    setStep('busy');
    setBusyMessage('Connecting to vendor…');
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/handoff/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed to start (${res.status})`);
      }
      const json = await res.json() as { sessionId: string; orchestratorConfigured: boolean };
      setHandoffSessionId(json.sessionId);
      setHandoffStatus('pending');
      setHandoffStage('created');
      setHandoffMessage('Session created. Starting browser…');
      setHandoffFailureMessage(null);
      setOrchestratorConfigured(json.orchestratorConfigured);
      setStep('handoff');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setStep('expand');
    }
  }

  async function cancelHandoff() {
    if (!handoffSessionId) return;
    try {
      await fetch(`/api/engagements/${engagementId}/import-options/handoff/status?sessionId=${encodeURIComponent(handoffSessionId)}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    setHandoffStatus('cancelled');
    setStep('expand');
  }

  function handleClose() {
    void saveSelectionsAndFinish({ selections: [], cancelled: true });
    onClose?.();
  }

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Start New Audit — Import Options</h2>
            <p className="text-xs text-slate-500 mt-0.5">{clientName}</p>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}

          {step === 'select' && (
            <SelectStep selected={selected} onToggle={toggle} />
          )}

          {step === 'expand' && (
            <ExpandStep
              sourceType={sourceType}
              setSourceType={setSourceType}
              connectors={connectors}
              chosenConnectorId={chosenConnectorId}
              setChosenConnectorId={setChosenConnectorId}
              otherVendorName={otherVendorName}
              setOtherVendorName={setOtherVendorName}
            />
          )}

          {step === 'upload' && (
            <UploadStep uploadFile={uploadFile} setUploadFile={setUploadFile} />
          )}

          {step === 'busy' && (
            <BusyView message={busyMessage} />
          )}

          {step === 'handoff' && handoffSessionId && (
            <HandoffStep
              vendor={vendorLabelForHandoff()}
              status={handoffStatus}
              stage={handoffStage}
              message={handoffMessage}
              failureMessage={handoffFailureMessage}
              pendingPrompt={pendingPrompt}
              orchestratorConfigured={orchestratorConfigured}
              periodEnd={periodEnd}
              auditTypeLabel={auditTypeLabel}
              onAnswerPrompt={async (promptId, answer) => {
                await fetch(`/api/engagements/${engagementId}/import-options/handoff/answer`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: handoffSessionId, promptId, answer }),
                });
                setPendingPrompt(null);
              }}
            />
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          {step === 'select' && (
            <>
              <button onClick={handleClose} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                onClick={handleProceedFromSelect}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >Proceed</button>
            </>
          )}
          {step === 'expand' && (
            <>
              <button onClick={() => setStep('select')} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Back</button>
              <div className="flex gap-2">
                <button onClick={handleClose} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
                {sourceType === 'upload' && (
                  <button onClick={() => setStep('upload')} className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">Continue</button>
                )}
                {sourceType === 'cloud' && (
                  <button
                    disabled={!chosenConnectorId}
                    onClick={() => {
                      const conn = connectors.find(c => c.id === chosenConnectorId);
                      if (conn) void startHandoff(conn.label);
                    }}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >Continue</button>
                )}
                {sourceType === 'cloud_other' && (
                  <button
                    disabled={!otherVendorName.trim()}
                    onClick={() => void startHandoff(otherVendorName.trim())}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >Continue</button>
                )}
              </div>
            </>
          )}
          {step === 'upload' && (
            <>
              <button onClick={() => setStep('expand')} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Back</button>
              <div className="flex gap-2">
                <button onClick={handleClose} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
                <button
                  disabled={!uploadFile}
                  onClick={handleUploadProceed}
                  className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                >Upload &amp; Continue</button>
              </div>
            </>
          )}
          {step === 'handoff' && (
            <>
              <button onClick={cancelHandoff} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Cancel session</button>
              <button onClick={handleClose} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Skip import</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-views ───────────────────────────────────────────────────────

function SelectStep({ selected, onToggle }: { selected: Set<ImportSelection>; onToggle: (key: ImportSelection) => void }) {
  return (
    <>
      <p className="text-sm text-slate-700 mb-3">Please select any import options:</p>
      <div className="space-y-2 mb-6">
        {CHECKBOX_OPTIONS.map(opt => (
          <label key={opt.key} className="flex items-center gap-3 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(opt.key)}
              onChange={() => onToggle(opt.key)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700">{opt.label}</span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 italic">
        Cancelling skips all imports — you can populate the engagement manually.
      </p>
    </>
  );
}

function ExpandStep({
  sourceType, setSourceType, connectors, chosenConnectorId, setChosenConnectorId, otherVendorName, setOtherVendorName,
}: {
  sourceType: ImportSourceType | null;
  setSourceType: (t: ImportSourceType) => void;
  connectors: CloudConnectorRecord[];
  chosenConnectorId: string;
  setChosenConnectorId: (s: string) => void;
  otherVendorName: string;
  setOtherVendorName: (s: string) => void;
}) {
  return (
    <>
      <p className="text-sm text-slate-700 mb-3">Where is the source audit file?</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <button
          onClick={() => setSourceType('upload')}
          className={`text-left p-3 border-2 rounded-lg ${sourceType === 'upload' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <div className="text-sm font-semibold text-slate-800">📤 Upload</div>
          <p className="text-xs text-slate-500 mt-1">Browse for a local file (zip or PDF).</p>
        </button>
        <button
          onClick={() => setSourceType('cloud')}
          className={`text-left p-3 border-2 rounded-lg ${sourceType === 'cloud' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <div className="text-sm font-semibold text-slate-800">☁ Connect to Cloud Audit Software</div>
          <p className="text-xs text-slate-500 mt-1">Acumon logs in for you and downloads the prior file.</p>
        </button>
        <button
          onClick={() => setSourceType('cloud_other')}
          className={`text-left p-3 border-2 rounded-lg ${sourceType === 'cloud_other' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <div className="text-sm font-semibold text-slate-800">＋ Other Cloud Audit Software</div>
          <p className="text-xs text-slate-500 mt-1">Type any vendor — Acumon will figure it out.</p>
        </button>
      </div>

      {sourceType === 'cloud' && (
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
          <label className="block text-xs font-medium text-slate-600 mb-1">Cloud Audit Software</label>
          <select
            value={chosenConnectorId}
            onChange={e => setChosenConnectorId(e.target.value)}
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">— Select vendor —</option>
            {connectors.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      )}

      {sourceType === 'cloud_other' && (
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
          <label className="block text-xs font-medium text-slate-600 mb-1">Vendor name</label>
          <input
            type="text"
            value={otherVendorName}
            onChange={e => setOtherVendorName(e.target.value)}
            placeholder="e.g. CaseWare Cloud, Inflo, AuditBoard"
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      )}
    </>
  );
}

function UploadStep({ uploadFile, setUploadFile }: { uploadFile: File | null; setUploadFile: (f: File | null) => void }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
      <label className="block text-xs font-medium text-slate-600 mb-2">Audit file (.zip or .pdf)</label>
      <input
        type="file"
        accept=".zip,.pdf"
        onChange={e => setUploadFile(e.target.files?.[0] || null)}
        className="block text-sm"
      />
      {uploadFile && (
        <p className="text-[11px] text-slate-500 mt-2">
          Selected: <span className="font-medium">{uploadFile.name}</span> ({(uploadFile.size / 1024).toFixed(0)} KB)
        </p>
      )}
    </div>
  );
}

function BusyView({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  );
}

function HandoffStep({
  vendor, status, stage, message, failureMessage, pendingPrompt,
  orchestratorConfigured, periodEnd, auditTypeLabel, onAnswerPrompt,
}: {
  vendor: string;
  status: 'pending' | 'submitted' | 'expired' | 'cancelled' | 'failed';
  stage: HandoffStage;
  message: string;
  failureMessage: string | null;
  pendingPrompt: PendingPrompt | null;
  orchestratorConfigured: boolean | null;
  periodEnd?: string;
  auditTypeLabel?: string;
  onAnswerPrompt: (promptId: string, answer: unknown) => void | Promise<void>;
}) {
  const idx = stageIndex(stage);
  const percent = Math.round((idx / (HANDOFF_STAGES.length - 1)) * 100);
  return (
    <div className="py-2">
      <p className="text-sm text-slate-800 font-medium text-center mb-1">
        {status === 'submitted' ? 'Import complete' : `Importing from ${vendor}`}
      </p>
      <p className="text-xs text-slate-500 text-center mb-5">{message}</p>

      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full transition-all duration-500 ${stage === 'submitted' ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="grid grid-cols-7 gap-1 mb-5">
        {HANDOFF_STAGES.map((s, i) => {
          const done = i < idx || stage === 'submitted';
          const active = i === idx && stage !== 'submitted';
          return (
            <li key={s.key} className="flex flex-col items-center text-center gap-1">
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium ${done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                {done ? '✓' : active ? <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" /> : i + 1}
              </span>
              <span className={`text-[9px] leading-tight ${active ? 'text-blue-700 font-medium' : done ? 'text-slate-700' : 'text-slate-400'}`}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {pendingPrompt && status === 'pending' && (
        <PromptForm prompt={pendingPrompt} onAnswer={onAnswerPrompt} />
      )}

      {status === 'failed' && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-3">
          <p className="font-medium mb-1">Import failed</p>
          <p>{failureMessage || 'The orchestrator reported an unrecoverable error.'}</p>
        </div>
      )}
      {status === 'expired' && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 text-center">
          Session expired (30-minute window). Cancel and start again.
        </p>
      )}
      {status === 'cancelled' && (
        <p className="text-xs text-slate-500 italic text-center">Session cancelled.</p>
      )}

      {orchestratorConfigured === false && status === 'pending' && stage === 'created' && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
          The Acumon orchestrator service is not configured for this environment yet — your firm admin needs to deploy it.
          Until then please use Upload mode (←&nbsp;Cancel session and pick Upload).
        </div>
      )}

      {periodEnd || auditTypeLabel ? (
        <p className="text-[10px] text-slate-400 text-center mt-4">
          {auditTypeLabel}{auditTypeLabel && periodEnd ? ' · ' : ''}{periodEnd ? `period ending ${periodEnd}` : ''}
        </p>
      ) : null}
    </div>
  );
}

function PromptForm({ prompt, onAnswer }: { prompt: PendingPrompt; onAnswer: (id: string, answer: unknown) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [selectValue, setSelectValue] = useState('');

  const fields = useMemo(() => prompt.options?.fields || [], [prompt.options]);
  const options = useMemo(() => prompt.options?.options || [], [prompt.options]);

  async function submit(answer: unknown) {
    setBusy(true);
    try { await onAnswer(prompt.id, answer); }
    finally {
      setBusy(false);
      setTextValue('');
      setCredentialValues({});
      setSelectValue('');
    }
  }

  return (
    <div className="border-2 border-blue-300 bg-blue-50/40 rounded-lg p-4 mb-3">
      <p className="text-sm font-medium text-slate-800 mb-3">{prompt.message}</p>

      {prompt.type === 'credentials' && (
        <div className="space-y-2">
          {fields.map(f => (
            <div key={f.name}>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={credentialValues[f.name] || ''}
                onChange={e => setCredentialValues({ ...credentialValues, [f.name]: e.target.value })}
                autoComplete={f.secret ? 'current-password' : 'username'}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button
              disabled={busy || fields.some(f => !credentialValues[f.name])}
              onClick={() => void submit(credentialValues)}
              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >Send</button>
          </div>
          <p className="text-[10px] text-slate-500 italic">
            Streamed to the live browser session only — never stored on Acumon.
          </p>
        </div>
      )}

      {prompt.type === 'mfa' && (
        <div className="space-y-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            placeholder="6-digit code"
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex justify-end">
            <button
              disabled={busy || !textValue.trim()}
              onClick={() => void submit({ code: textValue.trim() })}
              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >Send</button>
          </div>
        </div>
      )}

      {prompt.type === 'confirm' && (
        <div className="flex justify-end gap-2">
          <button disabled={busy} onClick={() => void submit({ confirmed: false })} className="text-sm px-3 py-1.5 text-slate-600 hover:text-slate-800">No</button>
          <button disabled={busy} onClick={() => void submit({ confirmed: true })} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">Yes</button>
        </div>
      )}

      {prompt.type === 'select' && (
        <div className="space-y-2">
          <select
            value={selectValue}
            onChange={e => setSelectValue(e.target.value)}
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">— Choose —</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex justify-end">
            <button
              disabled={busy || !selectValue}
              onClick={() => void submit({ value: selectValue })}
              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >Send</button>
          </div>
        </div>
      )}

      {prompt.type === 'text' && (
        <div className="space-y-2">
          <input
            type="text"
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            placeholder={prompt.options?.placeholder}
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex justify-end">
            <button
              disabled={busy || !textValue.trim()}
              onClick={() => void submit({ text: textValue.trim() })}
              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
