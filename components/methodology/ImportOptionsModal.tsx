'use client';

import { useEffect, useState } from 'react';
import { expandZipFile } from '@/lib/client-unzip';
import type {
  ImportOptionsState,
  ImportSelection,
  ImportSourceType,
  CloudConnectorRecord,
  CloudConnectorConfig,
} from '@/lib/import-options/types';
import { emptyMyWorkpapersConfig } from '@/lib/import-options/types';

interface Props {
  engagementId: string;
  clientName: string;
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

type Step = 'select' | 'expand' | 'busy' | 'connect_credentials' | 'register_connector';

export function ImportOptionsModal({ engagementId, clientName, onComplete, onClose }: Props) {
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
                  <p className="text-xs text-slate-500 mt-1">Register a new connector. The recipe is saved firm-wide.</p>
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

              {(sourceType === 'cloud' || sourceType === 'cloud_other') && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cloud Audit Software</label>
                  {connectorsLoading ? (
                    <p className="text-xs text-slate-400">Loading connectors...</p>
                  ) : (
                    <select
                      value={chosenConnectorId}
                      onChange={e => setChosenConnectorId(e.target.value)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">— Select connector —</option>
                      {connectors.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.label}{!c.config.baseUrl ? ' (not configured)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {sourceType === 'cloud_other' && (
                    <button
                      onClick={() => {
                        setNewConnLabel('');
                        setNewConnConfig({ baseUrl: '', authScheme: 'bearer', authConfig: {}, endpoints: {} });
                        setStep('register_connector');
                      }}
                      className="mt-3 text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                    >
                      ＋ Register a new connector
                    </button>
                  )}
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
                    onClick={() => setStep('connect_credentials')}
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
