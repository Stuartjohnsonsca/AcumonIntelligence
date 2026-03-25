'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Upload, Link2, Check, X, Search, ChevronRight, BookOpen } from 'lucide-react';

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

  // XBRL framework mapping state
  const [xbrlFrameworks, setXbrlFrameworks] = useState<Array<{ code: string; taxonomies: Array<{ id: number; name: string; year: string }>; primaryTaxonomyId: number }>>([]);
  const [xbrlMappings, setXbrlMappings] = useState<Record<string, number>>({});
  const [xbrlLoading, setXbrlLoading] = useState(false);
  const [xbrlSearchQuery, setXbrlSearchQuery] = useState('');
  const [xbrlSearchResults, setXbrlSearchResults] = useState<Array<{ id: number; name: string; label: string }>>([]);
  const [xbrlSearching, setXbrlSearching] = useState(false);
  const [selectedXbrlFramework, setSelectedXbrlFramework] = useState<string>('');

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

  const loadXbrlFrameworks = useCallback(async () => {
    setXbrlLoading(true);
    try {
      const res = await fetch('/api/firm/taxonomy/xbrl?action=list-frameworks');
      if (res.ok) {
        const data = await res.json();
        setXbrlFrameworks(data.frameworks || []);
      }
    } catch { /* non-fatal */ }
    setXbrlLoading(false);
  }, []);

  async function searchXbrlConcepts() {
    if (!xbrlSearchQuery.trim() || !selectedXbrlFramework) return;
    setXbrlSearching(true);
    try {
      const fw = xbrlFrameworks.find(f => f.code === selectedXbrlFramework);
      const taxonomyId = xbrlMappings[selectedXbrlFramework] || fw?.primaryTaxonomyId;
      if (!taxonomyId) return;
      const res = await fetch(`/api/firm/taxonomy/xbrl?action=search&taxonomyId=${taxonomyId}&q=${encodeURIComponent(xbrlSearchQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setXbrlSearchResults(data.concepts || []);
      }
    } catch { /* non-fatal */ }
    setXbrlSearching(false);
  }

  async function saveXbrlMapping(framework: string, taxonomyId: number) {
    setXbrlMappings(prev => ({ ...prev, [framework]: taxonomyId }));
    await fetch('/api/firm/taxonomy/xbrl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ framework, taxonomyId }),
    });
  }

  useEffect(() => { loadTaxonomy(); loadXbrlFrameworks(); }, [loadTaxonomy, loadXbrlFrameworks]);

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

      {/* ─── XBRL Taxonomy per Accounting Framework ─────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-700">XBRL Taxonomy per Accounting Framework</h3>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Each accounting framework maps to a different XBRL taxonomy for financial statement tagging and validation.
          Select the appropriate taxonomy version for each framework used by your firm.
        </p>

        {xbrlLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading frameworks...
          </div>
        ) : xbrlFrameworks.length === 0 ? (
          <p className="text-xs text-slate-400">No XBRL taxonomies available from the API.</p>
        ) : (
          <div className="space-y-4">
            {/* Framework → Taxonomy mapping table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600 w-32">Framework</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Taxonomy</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600 w-20">Year</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {xbrlFrameworks.map(fw => {
                    const selectedId = xbrlMappings[fw.code] || fw.primaryTaxonomyId;
                    const selectedTax = fw.taxonomies.find(t => t.id === selectedId) || fw.taxonomies[0];
                    return (
                      <tr key={fw.code} className="border-b border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{fw.code}</td>
                        <td className="px-4 py-2.5">
                          <select
                            value={selectedId}
                            onChange={e => saveXbrlMapping(fw.code, parseInt(e.target.value))}
                            className="border border-slate-200 rounded px-2 py-1 text-sm bg-white w-full max-w-xs"
                          >
                            {fw.taxonomies.map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.year})</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{selectedTax?.year || '-'}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => setSelectedXbrlFramework(fw.code)}
                            className={`text-xs px-2 py-1 rounded ${selectedXbrlFramework === fw.code ? 'bg-blue-100 text-blue-700' : 'text-blue-500 hover:bg-blue-50'}`}>
                            Browse
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Concept search within selected framework */}
            {selectedXbrlFramework && (
              <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-4">
                <h4 className="text-xs font-semibold text-blue-800 mb-2">
                  Browse {selectedXbrlFramework} Taxonomy
                </h4>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={xbrlSearchQuery}
                    onChange={e => setXbrlSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchXbrlConcepts()}
                    placeholder="Search concepts (e.g. Revenue, Trade Debtors)..."
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  <button onClick={searchXbrlConcepts} disabled={xbrlSearching || !xbrlSearchQuery.trim()}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                    {xbrlSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    Search
                  </button>
                  <button onClick={() => { setSelectedXbrlFramework(''); setXbrlSearchResults([]); setXbrlSearchQuery(''); }}
                    className="px-2 py-2 text-slate-400 hover:text-slate-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {xbrlSearchResults.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border border-slate-200 rounded bg-white">
                    {xbrlSearchResults.map(c => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-b border-slate-50 hover:bg-slate-50 text-xs">
                        <ChevronRight className="h-3 w-3 text-slate-300 flex-shrink-0" />
                        <span className="font-medium text-slate-700">{c.label || c.name}</span>
                        <span className="text-slate-400 font-mono text-[10px] truncate">{c.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {xbrlSearchResults.length === 0 && xbrlSearchQuery && !xbrlSearching && (
                  <p className="text-xs text-slate-400 italic">No results. Try a different search term.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
