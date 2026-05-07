'use client';

import { useEffect, useState } from 'react';
import type { CloudConnectorConfig, CloudConnectorRecord } from '@/lib/import-options/types';

export function CloudAuditConnectorsAdmin() {
  const [connectors, setConnectors] = useState<CloudConnectorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftConfig, setDraftConfig] = useState<CloudConnectorConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/cloud-audit-connectors');
      if (res.ok) {
        const j = await res.json();
        setConnectors(j.connectors || []);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openEdit(c: CloudConnectorRecord) {
    setEditingId(c.id);
    setDraftLabel(c.label);
    setDraftConfig(JSON.parse(JSON.stringify(c.config)) as CloudConnectorConfig);
    setError(null);
  }

  async function saveEdit() {
    if (!editingId || !draftConfig) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cloud-audit-connectors/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: draftLabel, config: draftConfig }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteConnector(c: CloudConnectorRecord) {
    if (!confirm(c.isBuiltIn
      ? `Deactivate ${c.label}? Built-in connectors are kept on the firm but won't appear in the Import Options pop-up.`
      : `Delete ${c.label}? This cannot be undone.`)) return;
    const res = await fetch(`/api/cloud-audit-connectors/${c.id}`, { method: 'DELETE' });
    if (res.ok) await load();
  }

  if (loading) return <div className="text-sm text-slate-500 animate-pulse">Loading connectors...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

      <div className="space-y-2">
        {connectors.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No connectors yet. They will appear after the first engagement is opened.</p>
        ) : (
          connectors.map(c => (
            <div key={c.id} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center px-4 py-3 gap-3 bg-slate-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">{c.label}</h3>
                    {c.isBuiltIn && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Built-in</span>}
                    {!c.config.baseUrl && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Needs configuration</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{c.config.baseUrl || '(no base URL configured)'}</p>
                </div>
                <button onClick={() => openEdit(c)} className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50">Edit</button>
                <button onClick={() => deleteConnector(c)} className="text-xs px-3 py-1.5 text-red-600 hover:bg-red-50 rounded">
                  {c.isBuiltIn ? 'Deactivate' : 'Delete'}
                </button>
              </div>

              {editingId === c.id && draftConfig && (
                <div className="border-t border-slate-200 px-4 py-4 bg-white space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Label</label>
                    <input
                      type="text"
                      value={draftLabel}
                      onChange={e => setDraftLabel(e.target.value)}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Base URL</label>
                    <input
                      type="url"
                      value={draftConfig.baseUrl}
                      onChange={e => setDraftConfig({ ...draftConfig, baseUrl: e.target.value })}
                      placeholder="https://api.vendor.com/v1"
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Auth Scheme</label>
                    <select
                      value={draftConfig.authScheme}
                      onChange={e => setDraftConfig({ ...draftConfig, authScheme: e.target.value as CloudConnectorConfig['authScheme'] })}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="bearer">Bearer token</option>
                      <option value="api_key">API key (custom header)</option>
                      <option value="basic">Basic auth</option>
                      <option value="oauth2_client_credentials">OAuth2 client credentials</option>
                    </select>
                  </div>
                  {draftConfig.authScheme === 'api_key' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Header name</label>
                      <input
                        type="text"
                        value={draftConfig.authConfig?.headerName || ''}
                        onChange={e => setDraftConfig({ ...draftConfig, authConfig: { ...(draftConfig.authConfig || {}), headerName: e.target.value } })}
                        placeholder="X-API-Key"
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  )}
                  {draftConfig.authScheme === 'oauth2_client_credentials' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Token URL</label>
                        <input
                          type="url"
                          value={draftConfig.authConfig?.oauth2?.tokenUrl || ''}
                          onChange={e => setDraftConfig({
                            ...draftConfig,
                            authConfig: {
                              ...(draftConfig.authConfig || {}),
                              oauth2: { ...(draftConfig.authConfig?.oauth2 || { tokenUrl: '' }), tokenUrl: e.target.value },
                            },
                          })}
                          className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Scope (optional)</label>
                        <input
                          type="text"
                          value={draftConfig.authConfig?.oauth2?.scope || ''}
                          onChange={e => setDraftConfig({
                            ...draftConfig,
                            authConfig: {
                              ...(draftConfig.authConfig || {}),
                              oauth2: { ...(draftConfig.authConfig?.oauth2 || { tokenUrl: '' }), scope: e.target.value },
                            },
                          })}
                          className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                    </>
                  )}
                  <details className="border border-slate-200 rounded p-3 bg-slate-50">
                    <summary className="text-xs font-medium text-slate-600 cursor-pointer">Endpoint paths</summary>
                    <p className="text-[11px] text-slate-500 mt-2 mb-2">
                      Use <code>{'{clientName}'}</code> / <code>{'{periodEnd}'}</code> / <code>{'{engagementId}'}</code> as substitutions.
                    </p>
                    {(['fetchEngagement', 'downloadArchive'] as const).map(key => (
                      <div key={key} className="grid grid-cols-[120px_70px_1fr] gap-2 items-center mb-2">
                        <span className="text-[11px] text-slate-600">{key}</span>
                        <select
                          value={draftConfig.endpoints[key]?.method || 'GET'}
                          onChange={e => setDraftConfig({
                            ...draftConfig,
                            endpoints: {
                              ...draftConfig.endpoints,
                              [key]: { ...(draftConfig.endpoints[key] || { method: 'GET', path: '' }), method: e.target.value as 'GET' | 'POST' },
                            },
                          })}
                          className="border border-slate-200 rounded px-2 py-1 text-xs bg-white"
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                        <input
                          type="text"
                          value={draftConfig.endpoints[key]?.path || ''}
                          onChange={e => setDraftConfig({
                            ...draftConfig,
                            endpoints: {
                              ...draftConfig.endpoints,
                              [key]: { ...(draftConfig.endpoints[key] || { method: 'GET', path: '' }), path: e.target.value },
                            },
                          })}
                          className="border border-slate-200 rounded px-2 py-1 text-xs"
                        />
                      </div>
                    ))}
                  </details>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
                    <button
                      onClick={saveEdit}
                      disabled={saving || !draftLabel.trim() || !draftConfig.baseUrl.trim()}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-slate-500 italic">
        New connectors are usually registered from the Import Options pop-up&apos;s &ldquo;Other Cloud
        Audit Software&rdquo; flow at engagement start, then refined here.
      </p>
    </div>
  );
}
