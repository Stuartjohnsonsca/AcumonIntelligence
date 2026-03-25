'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Upload, Link2, Check, X } from 'lucide-react';

interface TaxonomyConfig {
  taxonomySourceType: string | null;
  taxonomyEndpointUrl: string | null;
  chartOfAccountsFileName: string | null;
  chartOfAccountsUpdatedAt: string | null;
  accountCount: number;
}

interface Props {
  firmId: string;
  isFirmAdmin?: boolean;
}

export function FirmSettingsTab({ firmId }: Props) {
  const [loading, setLoading] = useState(true);

  // Taxonomy state
  const [taxonomyConfig, setTaxonomyConfig] = useState<TaxonomyConfig | null>(null);
  const [taxonomySourceType, setTaxonomySourceType] = useState<string>('');
  const [taxonomyUrl, setTaxonomyUrl] = useState('');
  const [taxonomyLocked, setTaxonomyLocked] = useState(false);
  const [taxonomySaving, setTaxonomySaving] = useState(false);
  const [taxonomySaved, setTaxonomySaved] = useState(false);
  const [taxonomyTesting, setTaxonomyTesting] = useState(false);
  const [taxonomyTestResult, setTaxonomyTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [taxonomyUploading, setTaxonomyUploading] = useState(false);

  const loadTaxonomy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/firm/taxonomy?firmId=${firmId}`);
      if (res.ok) {
        const data = await res.json();
        setTaxonomyConfig(data);
        if (data.taxonomySourceType) {
          setTaxonomySourceType(data.taxonomySourceType);
          setTaxonomyLocked(true);
        }
        if (data.taxonomyEndpointUrl) setTaxonomyUrl(data.taxonomyEndpointUrl);
      }
    } catch { /* use defaults */ }
    setLoading(false);
  }, [firmId]);

  useEffect(() => { loadTaxonomy(); }, [loadTaxonomy]);

  async function handleTaxonomySave() {
    setTaxonomySaving(true);
    try {
      const res = await fetch('/api/firm/taxonomy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, taxonomySourceType, taxonomyEndpointUrl: taxonomyUrl }),
      });
      if (res.ok) {
        setTaxonomySaved(true);
        setTaxonomyLocked(true);
        setTimeout(() => setTaxonomySaved(false), 3000);
        loadTaxonomy();
      }
    } catch { /* handle error */ }
    setTaxonomySaving(false);
  }

  async function handleTaxonomyTest() {
    setTaxonomyTesting(true);
    setTaxonomyTestResult(null);
    try {
      const res = await fetch(`/api/firm/taxonomy/test?firmId=${firmId}&url=${encodeURIComponent(taxonomyUrl)}`);
      const data = await res.json();
      setTaxonomyTestResult(data);
    } catch (err: unknown) {
      setTaxonomyTestResult({ success: false, message: (err as Error).message || 'Connection failed' });
    }
    setTaxonomyTesting(false);
  }

  async function handleTaxonomyFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTaxonomyUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('firmId', firmId);
      const res = await fetch('/api/firm/taxonomy/upload', { method: 'POST', body: formData });
      if (res.ok) {
        loadTaxonomy();
      }
    } catch { /* handle error */ }
    setTaxonomyUploading(false);
    e.target.value = '';
  }

  function handleTaxonomyReset() {
    if (!confirm('Reset taxonomy source? This will clear the current configuration.')) return;
    setTaxonomySourceType('');
    setTaxonomyUrl('');
    setTaxonomyLocked(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Firm Settings</h2>
        <p className="text-sm text-slate-500">
          Configure firm-wide settings. Sampling configuration has moved to{' '}
          <a href="/methodology-admin/firm-assumptions" className="text-blue-600 hover:text-blue-800 underline">
            Methodology Admin → Firm Assumptions
          </a>.
        </p>
      </div>

      {/* ─── Taxonomy / Chart of Accounts ───────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Taxonomy / Chart of Accounts</h3>
        <p className="text-xs text-slate-400 mb-4">
          Link the firm&apos;s Chart of Accounts for use across tools including Trial Balance, FS Assertions, and audit mapping.
        </p>

        {/* Source selection */}
        {!taxonomyLocked ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5 font-medium">Source Type</label>
              <div className="flex gap-3">
                {[
                  { value: 'xero', label: 'Xero', icon: <Link2 className="h-4 w-4" /> },
                  { value: 'api', label: 'API Endpoint', icon: <Link2 className="h-4 w-4" /> },
                  { value: 'upload', label: 'Upload File', icon: <Upload className="h-4 w-4" /> },
                ].map(opt => (
                  <button key={opt.value} onClick={() => setTaxonomySourceType(opt.value)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-all ${
                      taxonomySourceType === opt.value
                        ? 'bg-blue-50 border-blue-300 text-blue-700 ring-1 ring-blue-200'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* API/Xero endpoint URL */}
            {(taxonomySourceType === 'api' || taxonomySourceType === 'xero') && (
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Endpoint URL</label>
                <div className="flex gap-2">
                  <input type="url" value={taxonomyUrl} onChange={e => setTaxonomyUrl(e.target.value)}
                    placeholder={taxonomySourceType === 'xero' ? 'https://api.xero.com/...' : 'https://your-api.com/chart-of-accounts'}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={handleTaxonomyTest} disabled={!taxonomyUrl || taxonomyTesting}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
                    {taxonomyTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                  </button>
                </div>
                {taxonomyTestResult && (
                  <div className={`mt-2 flex items-center gap-1.5 text-xs ${taxonomyTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {taxonomyTestResult.success ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {taxonomyTestResult.message}
                  </div>
                )}
              </div>
            )}

            {/* File upload */}
            {taxonomySourceType === 'upload' && (
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Upload CSV or Excel file</label>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50">
                    <Upload className="h-4 w-4" />
                    {taxonomyUploading ? 'Uploading...' : 'Choose File'}
                    <input type="file" accept=".csv,.xlsx,.xls" onChange={handleTaxonomyFileUpload} className="hidden" />
                  </label>
                  {taxonomyConfig?.chartOfAccountsFileName && (
                    <span className="text-xs text-slate-500">{taxonomyConfig.chartOfAccountsFileName}</span>
                  )}
                </div>
              </div>
            )}

            {/* Save button */}
            {taxonomySourceType && (
              <button onClick={handleTaxonomySave} disabled={taxonomySaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                {taxonomySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Taxonomy Source
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Configured</span>
                <span className="text-sm text-slate-600 capitalize">{taxonomySourceType}</span>
                {taxonomyUrl && <span className="text-xs text-slate-400 font-mono truncate max-w-xs">{taxonomyUrl}</span>}
              </div>
              <button onClick={handleTaxonomyReset}
                className="text-xs text-red-500 hover:text-red-700 font-medium">
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Current status */}
        {taxonomyConfig && taxonomyConfig.accountCount > 0 && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
            <p>Accounts loaded: <span className="font-medium">{taxonomyConfig.accountCount}</span></p>
            {taxonomyConfig.chartOfAccountsUpdatedAt && (
              <p>Last updated: <span className="font-medium">{new Date(taxonomyConfig.chartOfAccountsUpdatedAt).toLocaleString()}</span></p>
            )}
          </div>
        )}
        {taxonomySaved && <span className="text-sm text-green-600 font-medium mt-2 block">Saved</span>}
      </div>
    </div>
  );
}
