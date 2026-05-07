'use client';

import { useEffect, useMemo, useState } from 'react';
import { expandZipFile } from '@/lib/client-unzip';
import type {
  ImportOptionsState,
  ImportSelection,
  ImportSourceType,
  CloudConnectorRecord,
  CloudConnectorConfig,
} from '@/lib/import-options/types';
import { emptyMyWorkpapersConfig } from '@/lib/import-options/types';
import { buildCoworkPrompt } from '@/lib/import-options/cowork-prompt';

interface Props {
  engagementId: string;
  clientName: string;
  /** Optional — passed to the Claude Cowork prompt so Claude knows which period to find. */
  periodEnd?: string;
  auditTypeLabel?: string;
  /** Called once the user clicks Proceed (selections committed) OR Cancel (selections=[]). */
  onComplete: (state: ImportOptionsState, opts: { extractionId?: string }) => void;
  /** Called when the user dismisses the modal without proceeding. */
  onClose?: () => void;
}

interface CheckboxOption {
  key: ImportSelection;
  label: string;
}

const CHECKBOX_OPTIONS: CheckboxOption[] = [
  { key: 'import_data', label: 'Import data from Another audit file' },
  { key: 'copy_documents', label: 'Copy documents from Another Audit file' },
  { key: 'ai_populate_current', label: 'Use AI to populate current year' },
];

type Step =
  | 'select'
  | 'expand'
  | 'busy'
  | 'connect_credentials'
  | 'register_connector'
  | 'handoff'   // connected mode — uses Acumon's MCP server (preferred)
  | 'cowork';   // manual fallback — user copy-pastes the prompt

export function ImportOptionsModal({ engagementId, clientName, periodEnd, auditTypeLabel, onComplete, onClose }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [selected, setSelected] = useState<Set<ImportSelection>>(new Set());
  const [sourceType, setSourceType] = useState<ImportSourceType | null>(null);
  const [busyMessage, setBusyMessage] = useState('Working...');
  const [error, setError] = useState<string | null>(null);

  // Connector picker
  const [connectors, setConnectors] = useState<CloudConnectorRecord[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [chosenConnectorId, setChosenConnectorId] = useState('');

  // Credential entry — never persisted; held only for the in-flight call
  const [credToken, setCredToken] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credClientId, setCredClientId] = useState('');
  const [credClientSecret, setCredClientSecret] = useState('');

  // New-connector registration form
  const [newConnLabel, setNewConnLabel] = useState('');
  const [newConnConfig, setNewConnConfig] = useState<CloudConnectorConfig>({
    baseUrl: '',
    authScheme: 'bearer',
    authConfig: {},
    endpoints: {},
  });

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Connected mode (handoff) — generates a one-time bearer token for the
  // Acumon MCP server. The user's AI assistant calls submit_archive on
  // the MCP and the modal auto-advances to the Review screen.
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  const [handoffMcpEndpoint, setHandoffMcpEndpoint] = useState<string | null>(null);
  const [handoffStatus, setHandoffStatus] = useState<'pending' | 'submitted' | 'expired' | 'cancelled'>('pending');
  const [handoffExpiresAt, setHandoffExpiresAt] = useState<string | null>(null);
  const [handoffTokenCopied, setHandoffTokenCopied] = useState(false);

  // Manual / cowork fallback — user copy-pastes a prompt into their
  // assistant and drops the result back here.
  const [coworkVendorLabel, setCoworkVendorLabel] = useState('MyWorkPapers');
  const [coworkFile, setCoworkFile] = useState<File | null>(null);
  const [coworkPromptCopied, setCoworkPromptCopied] = useState(false);
  const coworkPrompt = useMemo(() => buildCoworkPrompt({
    vendorLabel: coworkVendorLabel || 'the cloud audit software',
    clientName,
    periodEnd,
    auditTypeLabel,
  }), [coworkVendorLabel, clientName, periodEnd, auditTypeLabel]);

  function copyCoworkPrompt() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(coworkPrompt).then(
        () => { setCoworkPromptCopied(true); setTimeout(() => setCoworkPromptCopied(false), 2000); },
        () => { /* clipboard may be unavailable in non-https; fallback is the visible textarea */ },
      );
    }
  }

  function copyHandoffToken() {
    if (typeof navigator !== 'undefined' && navigator.clipboard && handoffToken) {
      navigator.clipboard.writeText(handoffToken).then(
        () => { setHandoffTokenCopied(true); setTimeout(() => setHandoffTokenCopied(false), 2000); },
        () => { /* ignore */ },
      );
    }
  }

  // Start a connected-mode handoff session (generates the bearer token,
  // posts /handoff/start, opens the polling step). Called when the user
  // picks "Connect to Cloud Audit Software" with no API recipe configured,
  // or "Other Cloud Audit Software".
  async function startHandoffSession(vendorLabel: string) {
    setStep('busy');
    setBusyMessage('Starting connected session...');
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/handoff/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed to start session (${res.status})`);
      }
      const json = await res.json();
      setHandoffToken(json.sessionToken);
      setHandoffMcpEndpoint(json.mcpEndpoint);
      setHandoffExpiresAt(json.expiresAt);
      setHandoffStatus('pending');
      setCoworkVendorLabel(vendorLabel);
      setStep('handoff');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
      setStep('expand');
    }
  }

  // Poll the handoff status while we're waiting for the assistant to
  // call submit_archive on the MCP endpoint. Stops on submitted /
  // expired / cancelled.
  useEffect(() => {
    if (step !== 'handoff' || !handoffToken || handoffStatus !== 'pending') return;
    const url = `/api/engagements/${engagementId}/import-options/handoff/status?token=${encodeURIComponent(handoffToken)}`;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json() as { status: string; extractionId?: string | null };
        if (cancelled) return;
        if (json.status === 'submitted' && json.extractionId) {
          setHandoffStatus('submitted');
          // Persist selections + close out the modal — the parent will
          // open the Review pop-up against this extraction id.
          await fetch(`/api/engagements/${engagementId}/import-options/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selections: Array.from(selected),
              source: { type: 'cloud', vendorLabel: coworkVendorLabel },
              status: 'extracted',
            }),
          });
          onComplete({
            prompted: true,
            selections: Array.from(selected),
            source: { type: 'cloud', vendorLabel: coworkVendorLabel },
            status: 'extracted',
            extractionId: json.extractionId,
          }, { extractionId: json.extractionId });
        } else if (json.status === 'expired' || json.status === 'cancelled') {
          setHandoffStatus(json.status as 'expired' | 'cancelled');
        }
      } catch {
        /* keep polling on transient errors */
      }
    };
    const id = setInterval(tick, 2500);
    void tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [step, handoffToken, handoffStatus, engagementId, selected, coworkVendorLabel, onComplete]);

  async function cancelHandoff() {
    if (!handoffToken) return;
    try {
      await fetch(`/api/engagements/${engagementId}/import-options/handoff/status?token=${encodeURIComponent(handoffToken)}`, {
        method: 'DELETE',
      });
    } catch { /* ignore */ }
    setHandoffStatus('cancelled');
    setStep('expand');
  }

  useEffect(() => {
    if (step !== 'expand') return;
    if (sourceType !== 'cloud' && sourceType !== 'cloud_other') return;
    setConnectorsLoading(true);
    fetch('/api/cloud-audit-connectors')
      .then(r => r.ok ? r.json() : { connectors: [] })
      .then(j => setConnectors(j.connectors || []))
      .catch(() => setConnectors([]))
      .finally(() => setConnectorsLoading(false));
  }, [step, sourceType]);

  function toggle(key: ImportSelection) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  }

  async function handleProceed() {
    setError(null);
    const sel = Array.from(selected);
    // If no "import_data" selected, just save selections and finish.
    if (!sel.includes('import_data')) {
      await saveAndFinish({ selections: sel });
      return;
    }
    // Otherwise expand — ask user for the source.
    setStep('expand');
  }

  async function handleCancel() {
    await saveAndFinish({ selections: [], cancelled: true });
    onClose?.();
  }

  async function saveAndFinish(args: { selections: ImportSelection[]; source?: ImportOptionsState['source']; cancelled?: boolean }) {
    setStep('busy');
    setBusyMessage(args.cancelled ? 'Cancelling...' : 'Saving selections...');
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: args.selections,
          source: args.source,
          status: args.cancelled ? 'cancelled' : 'pending',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      const json = await res.json();
      onComplete(json.importOptions as ImportOptionsState, { extractionId: json.extractionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save selections');
      setStep('select');
    }
  }

  async function handleUploadProceed() {
    if (!uploadFile) { setError('Please choose a file'); return; }
    setStep('busy');
    setBusyMessage('Uploading prior audit file...');
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
      setStep('expand');
    }
  }

  // Claude Cowork: file the user drags back in after Claude downloads it
  // gets uploaded to the same endpoint as the regular Upload path, but with
  // sourceType=claude_cowork and the vendor label so the audit-trail history
  // records what produced the file.
  async function handleCoworkUploadProceed() {
    if (!coworkFile) { setError('Drop the file Claude downloaded'); return; }
    setStep('busy');
    setBusyMessage('Uploading file from Claude Cowork...');
    setError(null);
    try {
      const file = await expandZipFile(coworkFile) || coworkFile;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('originalName', coworkFile.name);
      formData.append('selections', JSON.stringify(Array.from(selected)));
      formData.append('sourceType', 'claude_cowork');
      formData.append('vendorLabel', coworkVendorLabel);

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
      setStep('cowork');
    }
  }

  async function handleCloudFetchProceed() {
    if (!chosenConnectorId) { setError('Pick a connector'); return; }
    setStep('busy');
    setBusyMessage('Connecting to cloud audit software...');
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/cloud-fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectorId: chosenConnectorId,
          credentials: {
            token: credToken || undefined,
            username: credUsername || undefined,
            password: credPassword || undefined,
            clientId: credClientId || undefined,
            clientSecret: credClientSecret || undefined,
          },
          selections: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Cloud fetch failed (${res.status})`);
      }
      const json = await res.json();
      onComplete(json.importOptions as ImportOptionsState, { extractionId: json.extractionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cloud fetch failed');
      setStep('connect_credentials');
    }
  }

  async function handleRegisterNewConnector() {
    if (!newConnLabel.trim() || !newConnConfig.baseUrl.trim()) {
      setError('Label and Base URL are required');
      return;
    }
    setStep('busy');
    setBusyMessage('Registering connector...');
    setError(null);
    try {
      const res = await fetch('/api/cloud-audit-connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newConnLabel.trim(), config: newConnConfig }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Register failed (${res.status})`);
      }
      const json = await res.json();
      const updated: CloudConnectorRecord[] = await fetch('/api/cloud-audit-connectors')
        .then(r => r.ok ? r.json() : { connectors: [] })
        .then(j => j.connectors || []);
      setConnectors(updated);
      setChosenConnectorId(json.connector?.id || '');
      setSourceType('cloud');
      setStep('connect_credentials');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Register failed');
      setStep('register_connector');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Start New Audit — Import Options</h2>
            <p className="text-xs text-slate-500 mt-0.5">{clientName}</p>
          </div>
          <button onClick={handleCancel} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
          )}

          {step === 'select' && (
            <>
              <p className="text-sm text-slate-700 mb-3">Please select any import options:</p>
              <div className="space-y-2 mb-6">
                {CHECKBOX_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-3 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(opt.key)}
                      onChange={() => toggle(opt.key)}
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
          )}

          {step === 'expand' && (
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
                  <p className="text-xs text-slate-500 mt-1">Fetch from MyWorkPapers or another configured vendor.</p>
                </button>
                <button
                  onClick={() => setSourceType('cloud_other')}
                  className={`text-left p-3 border-2 rounded-lg ${sourceType === 'cloud_other' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="text-sm font-semibold text-slate-800">＋ Other Cloud Audit Software</div>
                  <p className="text-xs text-slate-500 mt-1">Use any other vendor — type its name and we&apos;ll guide you through the rest.</p>
                </button>
              </div>

              {sourceType === 'upload' && (
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
              )}

              {sourceType === 'cloud' && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cloud Audit Software</label>
                  {connectorsLoading ? (
                    <p className="text-xs text-slate-400">Loading...</p>
                  ) : (
                    <select
                      value={chosenConnectorId}
                      onChange={e => setChosenConnectorId(e.target.value)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">— Select vendor —</option>
                      {connectors.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {sourceType === 'cloud_other' && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vendor name</label>
                  <input
                    type="text"
                    value={coworkVendorLabel}
                    onChange={e => setCoworkVendorLabel(e.target.value)}
                    placeholder="e.g. CaseWare Cloud, Inflo, AuditBoard"
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <p className="text-[10px] text-slate-400 italic mt-1">
                    Type the vendor&apos;s name — we&apos;ll guide your AI assistant through the rest.
                  </p>
                </div>
              )}
            </>
          )}

          {step === 'register_connector' && (
            <>
              <p className="text-sm text-slate-700 mb-3">
                Register a new Cloud Audit Software connector. The connection recipe is stored
                firm-wide; user credentials are entered separately each time and never saved.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vendor Label</label>
                  <input
                    type="text"
                    value={newConnLabel}
                    onChange={e => setNewConnLabel(e.target.value)}
                    placeholder="e.g. CaseWare Cloud"
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">API Base URL</label>
                  <input
                    type="url"
                    value={newConnConfig.baseUrl}
                    onChange={e => setNewConnConfig({ ...newConnConfig, baseUrl: e.target.value })}
                    placeholder="https://api.vendor.com/v1"
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Auth Scheme</label>
                  <select
                    value={newConnConfig.authScheme}
                    onChange={e => setNewConnConfig({ ...newConnConfig, authScheme: e.target.value as CloudConnectorConfig['authScheme'] })}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="bearer">Bearer token</option>
                    <option value="api_key">API key (custom header)</option>
                    <option value="basic">Basic auth (user / password)</option>
                    <option value="oauth2_client_credentials">OAuth2 client credentials</option>
                  </select>
                </div>
                {newConnConfig.authScheme === 'api_key' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">API Key Header Name</label>
                    <input
                      type="text"
                      value={newConnConfig.authConfig?.headerName || ''}
                      onChange={e => setNewConnConfig({ ...newConnConfig, authConfig: { ...(newConnConfig.authConfig || {}), headerName: e.target.value } })}
                      placeholder="X-API-Key"
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                )}
                {newConnConfig.authScheme === 'oauth2_client_credentials' && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">OAuth2 Token URL</label>
                      <input
                        type="url"
                        value={newConnConfig.authConfig?.oauth2?.tokenUrl || ''}
                        onChange={e => setNewConnConfig({
                          ...newConnConfig,
                          authConfig: {
                            ...(newConnConfig.authConfig || {}),
                            oauth2: { ...(newConnConfig.authConfig?.oauth2 || { tokenUrl: '' }), tokenUrl: e.target.value },
                          },
                        })}
                        placeholder="https://api.vendor.com/oauth/token"
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">OAuth2 Scope (optional)</label>
                      <input
                        type="text"
                        value={newConnConfig.authConfig?.oauth2?.scope || ''}
                        onChange={e => setNewConnConfig({
                          ...newConnConfig,
                          authConfig: {
                            ...(newConnConfig.authConfig || {}),
                            oauth2: { ...(newConnConfig.authConfig?.oauth2 || { tokenUrl: '' }), scope: e.target.value },
                          },
                        })}
                        placeholder="audit.read"
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                )}
                <details className="border border-slate-200 rounded p-3 bg-slate-50">
                  <summary className="text-xs font-medium text-slate-600 cursor-pointer">Endpoint paths</summary>
                  <p className="text-[11px] text-slate-500 mt-2 mb-3">
                    Provide vendor-specific paths. Use <code>{'{clientName}'}</code> / <code>{'{periodEnd}'}</code> as substitutions.
                    Either Download Archive (preferred — returns the audit file) or Fetch Engagement (returns JSON we parse with AI).
                  </p>
                  {(['fetchEngagement', 'downloadArchive'] as const).map(key => (
                    <div key={key} className="grid grid-cols-[110px_70px_1fr] gap-2 items-center mb-2">
                      <span className="text-[11px] text-slate-600">{key}</span>
                      <select
                        value={newConnConfig.endpoints[key]?.method || 'GET'}
                        onChange={e => setNewConnConfig({
                          ...newConnConfig,
                          endpoints: {
                            ...newConnConfig.endpoints,
                            [key]: { ...(newConnConfig.endpoints[key] || { method: 'GET', path: '' }), method: e.target.value as 'GET' | 'POST' },
                          },
                        })}
                        className="border border-slate-200 rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                      </select>
                      <input
                        type="text"
                        value={newConnConfig.endpoints[key]?.path || ''}
                        onChange={e => setNewConnConfig({
                          ...newConnConfig,
                          endpoints: {
                            ...newConnConfig.endpoints,
                            [key]: { ...(newConnConfig.endpoints[key] || { method: 'GET', path: '' }), path: e.target.value },
                          },
                        })}
                        placeholder={key === 'downloadArchive' ? '/clients/{clientName}/audits/{periodEnd}/archive.zip' : '/clients/{clientName}/audits/{periodEnd}'}
                        className="border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                </details>
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  We do not invent vendor APIs. The values you enter here come from the vendor&apos;s own
                  API documentation; if any are wrong the connector will return a clear error and store nothing.
                </p>
              </div>
            </>
          )}

          {step === 'handoff' && handoffToken && (
            <>
              <p className="text-sm text-slate-700 mb-3">
                Open your AI browser assistant and ask it to run the import session for{' '}
                <strong>{coworkVendorLabel || 'the cloud audit software'}</strong>. It will read
                the engagement context from acumon, navigate the vendor&apos;s site for you, and
                upload the prior audit file straight back here.
              </p>

              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-4 space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-blue-700 uppercase tracking-wide">Session Token</span>
                    <button
                      onClick={copyHandoffToken}
                      className="text-[11px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                    >
                      {handoffTokenCopied ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <code className="block w-full bg-white border border-blue-200 rounded px-2 py-1.5 text-[11px] font-mono text-slate-700 break-all">
                    {handoffToken}
                  </code>
                </div>
                {handoffMcpEndpoint && (
                  <p className="text-[10px] text-blue-700">
                    MCP endpoint: <code className="bg-white px-1 py-0.5 rounded">{handoffMcpEndpoint}</code>
                  </p>
                )}
                <p className="text-[10px] text-blue-700">
                  Ask the assistant: <em>&ldquo;Run the Acumon import session. Token: {handoffToken.slice(0, 12)}…&rdquo;</em>
                </p>
              </div>

              <div className="flex items-center gap-2 mb-4">
                {handoffStatus === 'pending' && (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-slate-600">Waiting for your assistant to submit the file…</p>
                  </>
                )}
                {handoffStatus === 'expired' && (
                  <p className="text-xs text-amber-700">Session expired. Cancel and start again, or switch to manual mode.</p>
                )}
                {handoffStatus === 'cancelled' && (
                  <p className="text-xs text-slate-500 italic">Session cancelled.</p>
                )}
              </div>

              <p className="text-[11px] text-slate-500 italic">
                First time? <a href="/methodology-admin/cloud-audit-connectors/mcp-setup" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">How to add the Acumon MCP server to your assistant ↗</a>
              </p>
              <p className="text-[11px] text-slate-500 italic mt-1">
                Don&apos;t have an MCP-capable assistant set up?{' '}
                <button
                  onClick={() => { setCoworkVendorLabel(coworkVendorLabel || 'MyWorkPapers'); setStep('cowork'); }}
                  className="text-blue-600 hover:underline"
                >
                  Switch to manual mode
                </button>{' '}
                — copy a prompt and drag the file back yourself.
              </p>
            </>
          )}

          {step === 'cowork' && (
            <>
              <p className="text-sm text-slate-700 mb-3">
                Your AI browser assistant will drive <em>your</em> {coworkVendorLabel || 'cloud audit software'} tab —
                your credentials never leave your machine and acumon never connects to the vendor directly.
              </p>

              <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside mb-4">
                <li>Open {coworkVendorLabel || 'the cloud audit software'} in a new tab and log in (with MFA if you use it).</li>
                <li>Open your AI browser assistant and paste the prompt below.</li>
                <li>The assistant will navigate the tab, find the prior period, and download the audit archive to your Downloads folder.</li>
                <li>Drop the downloaded file here — acumon will extract proposals and you&apos;ll review them on the next screen.</li>
              </ol>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
                  <input
                    type="text"
                    value={coworkVendorLabel}
                    onChange={e => setCoworkVendorLabel(e.target.value)}
                    placeholder="e.g. MyWorkPapers, CaseWare Cloud"
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                  <p className="text-[10px] text-slate-400 italic mt-1">Used in the prompt below — change this if you&apos;re using a different vendor.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-600">Prompt for your assistant</label>
                    <button
                      onClick={copyCoworkPrompt}
                      className="text-[11px] px-2 py-0.5 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium"
                    >
                      {coworkPromptCopied ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <textarea
                    value={coworkPrompt}
                    readOnly
                    rows={8}
                    className="w-full border border-purple-200 rounded px-3 py-2 text-[11px] font-mono bg-purple-50/30 focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">File the assistant downloaded (.zip or .pdf)</label>
                  <input
                    type="file"
                    accept=".zip,.pdf"
                    onChange={e => setCoworkFile(e.target.files?.[0] || null)}
                    className="block text-sm"
                  />
                  {coworkFile && (
                    <p className="text-[11px] text-slate-500 mt-2">
                      Selected: <span className="font-medium">{coworkFile.name}</span> ({(coworkFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                </div>
              </div>

              <div className="border border-amber-200 bg-amber-50 rounded p-3 text-[11px] text-amber-800">
                <strong>Reminder:</strong> The prompt explicitly tells the assistant not to enter passwords, MFA codes, or
                click destructive buttons. Read what it&apos;s about to do before approving its actions —
                anything other than read-only navigation + the download click is suspicious.
              </div>
            </>
          )}

          {step === 'connect_credentials' && (
            <>
              <p className="text-sm text-slate-700 mb-3">Enter your credentials for this connection. Credentials are sent only for this fetch and are not stored.</p>
              {(() => {
                const conn = connectors.find(c => c.id === chosenConnectorId);
                const scheme = conn?.config.authScheme || 'bearer';
                if (scheme === 'bearer' || scheme === 'api_key') {
                  return (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">{scheme === 'bearer' ? 'Bearer token' : 'API key'}</label>
                      <input type="password" value={credToken} onChange={e => setCredToken(e.target.value)} className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                  );
                }
                if (scheme === 'basic') {
                  return (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Username</label>
                        <input type="text" value={credUsername} onChange={e => setCredUsername(e.target.value)} className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
                        <input type="password" value={credPassword} onChange={e => setCredPassword(e.target.value)} className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                    </div>
                  );
                }
                if (scheme === 'oauth2_client_credentials') {
                  return (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Client ID</label>
                        <input type="text" value={credClientId} onChange={e => setCredClientId(e.target.value)} className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Client Secret</label>
                        <input type="password" value={credClientSecret} onChange={e => setCredClientSecret(e.target.value)} className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </>
          )}

          {step === 'busy' && (
            <div className="py-8 text-center">
              <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="text-sm text-slate-600">{busyMessage}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          {step === 'select' && (
            <>
              <button onClick={handleCancel} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                onClick={handleProceed}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                Proceed
              </button>
            </>
          )}
          {step === 'expand' && (
            <>
              <button onClick={() => setStep('select')} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Back</button>
              <div className="flex gap-2">
                <button onClick={handleCancel} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
                {sourceType === 'upload' && (
                  <button
                    disabled={!uploadFile}
                    onClick={handleUploadProceed}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >
                    Upload &amp; Continue
                  </button>
                )}
                {sourceType === 'cloud' && (
                  <button
                    disabled={!chosenConnectorId}
                    onClick={() => {
                      const conn = connectors.find(c => c.id === chosenConnectorId);
                      // If the connector has a fully-configured API recipe, use
                      // the API path (existing flow). Otherwise start a connected
                      // session against Acumon's MCP server — the user's AI
                      // assistant drives the vendor's site for them.
                      if (conn && conn.config.baseUrl) {
                        setStep('connect_credentials');
                      } else if (conn) {
                        void startHandoffSession(conn.label);
                      }
                    }}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >
                    Continue
                  </button>
                )}
                {sourceType === 'cloud_other' && (
                  <button
                    disabled={!coworkVendorLabel.trim()}
                    onClick={() => void startHandoffSession(coworkVendorLabel.trim())}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >
                    Continue
                  </button>
                )}
              </div>
            </>
          )}
          {step === 'register_connector' && (
            <>
              <button onClick={() => setStep('expand')} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Back</button>
              <button
                onClick={handleRegisterNewConnector}
                disabled={!newConnLabel.trim() || !newConnConfig.baseUrl.trim()}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                Register &amp; Continue
              </button>
            </>
          )}
          {step === 'handoff' && (
            <>
              <button onClick={cancelHandoff} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Cancel session</button>
              <button onClick={handleCancel} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Skip import</button>
            </>
          )}
          {step === 'cowork' && (
            <>
              <button onClick={() => setStep('expand')} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Back</button>
              <div className="flex gap-2">
                <button onClick={handleCancel} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">Cancel</button>
                <button
                  disabled={!coworkFile}
                  onClick={handleCoworkUploadProceed}
                  className="text-sm px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 font-medium"
                >
                  Upload &amp; Continue
                </button>
              </div>
            </>
          )}

          {step === 'connect_credentials' && (
            <>
              <button onClick={() => setStep('expand')} className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800">← Back</button>
              <button
                onClick={handleCloudFetchProceed}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                Connect &amp; Continue
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper for callers to short-circuit MyWorkPapers' empty config
export function isMyWorkpapersStub(config: CloudConnectorConfig): boolean {
  return JSON.stringify(config) === JSON.stringify(emptyMyWorkpapersConfig());
}
