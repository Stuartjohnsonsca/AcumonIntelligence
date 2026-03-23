'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, AlertTriangle, Upload, Link2, Check, X, UserPlus, Trash2 } from 'lucide-react';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ConfidenceFactorRow {
  inherentRisk: string;
  specificRisk: string;
  overallRMM: string;
  riskOfIncorrectAcceptance: string;
  confidenceFactorMin: number;
  confidenceFactorMax: number;
}

interface FirmConfig {
  confidenceLevel: number;
  confidenceFactorTable: ConfidenceFactorRow[];
  riskMatrix: number[][]; // 3x3 grid: [inherent][specific] = k value
}

const DEFAULT_CONFIDENCE_TABLE: ConfidenceFactorRow[] = [
  { inherentRisk: 'Low', specificRisk: 'Low', overallRMM: 'Low', riskOfIncorrectAcceptance: '~10%', confidenceFactorMin: 2.3, confidenceFactorMax: 2.5 },
  { inherentRisk: 'Moderate', specificRisk: 'Low', overallRMM: 'Moderate', riskOfIncorrectAcceptance: '~5%', confidenceFactorMin: 3.0, confidenceFactorMax: 3.0 },
  { inherentRisk: 'Moderate', specificRisk: 'High', overallRMM: 'High', riskOfIncorrectAcceptance: '~2-3%', confidenceFactorMin: 3.4, confidenceFactorMax: 3.6 },
  { inherentRisk: 'High / Significant', specificRisk: 'High', overallRMM: 'High', riskOfIncorrectAcceptance: '~1-2%', confidenceFactorMin: 3.8, confidenceFactorMax: 4.0 },
];

const DEFAULT_RISK_MATRIX: number[][] = [
  // Specific Risk →   Low   Med   High
  /* Inherent Low */  [5,    17,   25],
  /* Inherent Med */  [10,   20,   45],
  /* Inherent High */ [30,   40,   50],
];

const RISK_LABELS = ['Low', 'Medium', 'High'];

// ─── Normal ranges for validation ────────────────────────────────────────────

const NORMAL_RANGES = {
  confidenceLevel: { min: 80, max: 99 },
  confidenceFactor: { min: 1.5, max: 5.0 },
  riskMatrixValue: { min: 1, max: 60 },
};

// ─── Component ───────────────────────────────────────────────────────────────

interface FeedbackUser {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  isActive: boolean;
}

interface TaxonomyConfig {
  taxonomySourceType: string | null;
  taxonomyEndpointUrl: string | null;
  chartOfAccountsFileName: string | null;
  chartOfAccountsUpdatedAt: string | null;
  accountCount: number;
}

interface Props {
  firmId: string;
}

export function FirmSettingsTab({ firmId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [pendingSave, setPendingSave] = useState(false);

  const [confidenceLevel, setConfidenceLevel] = useState(95);
  const [cfTable, setCfTable] = useState<ConfidenceFactorRow[]>(DEFAULT_CONFIDENCE_TABLE);
  const [riskMatrix, setRiskMatrix] = useState<number[][]>(DEFAULT_RISK_MATRIX);

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

  // Feedback Users state
  const [feedbackUsers, setFeedbackUsers] = useState<FeedbackUser[]>([]);
  const [feedbackUsersLoading, setFeedbackUsersLoading] = useState(false);
  const [newFeedbackEmail, setNewFeedbackEmail] = useState('');
  const [feedbackAddError, setFeedbackAddError] = useState('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/firm/sampling-config?firmId=${firmId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.confidenceLevel) setConfidenceLevel(data.confidenceLevel);
        if (data.confidenceFactorTable?.length) setCfTable(data.confidenceFactorTable);
        if (data.riskMatrix?.length) setRiskMatrix(data.riskMatrix);
      }
    } catch { /* use defaults */ }
    setLoading(false);
  }, [firmId]);

  const loadTaxonomy = useCallback(async () => {
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
    } catch { /* ignore */ }
  }, [firmId]);

  const loadFeedbackUsers = useCallback(async () => {
    setFeedbackUsersLoading(true);
    try {
      const res = await fetch(`/api/firm/feedback-users?firmId=${firmId}`);
      if (res.ok) {
        const data = await res.json();
        setFeedbackUsers(data.users || []);
      }
    } catch { /* ignore */ }
    setFeedbackUsersLoading(false);
  }, [firmId]);

  useEffect(() => { loadConfig(); loadTaxonomy(); loadFeedbackUsers(); }, [loadConfig, loadTaxonomy, loadFeedbackUsers]);

  function validateAndSave() {
    const warnings: string[] = [];

    if (confidenceLevel < NORMAL_RANGES.confidenceLevel.min || confidenceLevel > NORMAL_RANGES.confidenceLevel.max) {
      warnings.push(`Confidence level ${confidenceLevel}% is outside the normal range (${NORMAL_RANGES.confidenceLevel.min}–${NORMAL_RANGES.confidenceLevel.max}%).`);
    }

    for (const row of cfTable) {
      if (row.confidenceFactorMin < NORMAL_RANGES.confidenceFactor.min || row.confidenceFactorMax > NORMAL_RANGES.confidenceFactor.max) {
        warnings.push(`Confidence factor range ${row.confidenceFactorMin}–${row.confidenceFactorMax} for ${row.inherentRisk}/${row.specificRisk} risk is outside normal bounds.`);
      }
    }

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const v = riskMatrix[i][j];
        if (v < NORMAL_RANGES.riskMatrixValue.min || v > NORMAL_RANGES.riskMatrixValue.max) {
          warnings.push(`Risk matrix value ${v}% for ${RISK_LABELS[i]}/${RISK_LABELS[j]} is outside normal range.`);
        }
      }
    }

    if (warnings.length > 0) {
      setWarningMessage(warnings.join('\n'));
      setShowWarning(true);
      setPendingSave(true);
    } else {
      doSave();
    }
  }

  async function doSave() {
    setShowWarning(false);
    setPendingSave(false);
    setSaving(true);
    try {
      const res = await fetch('/api/firm/sampling-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmId,
          confidenceLevel,
          confidenceFactorTable: cfTable,
          riskMatrix,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* silent */ }
    setSaving(false);
  }

  function updateCfRow(idx: number, field: keyof ConfidenceFactorRow, value: string | number) {
    setCfTable(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }

  function updateRiskMatrix(row: number, col: number, value: number) {
    setRiskMatrix(prev => prev.map((r, i) => i === row ? r.map((c, j) => j === col ? value : c) : r));
  }

  // ─── Taxonomy handlers ──────────────────────────────────────────────────

  async function saveTaxonomyConfig() {
    setTaxonomySaving(true);
    try {
      const res = await fetch('/api/firm/taxonomy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, sourceType: taxonomySourceType, endpointUrl: taxonomyUrl }),
      });
      if (res.ok) {
        setTaxonomyLocked(true);
        setTaxonomySaved(true);
        setTimeout(() => setTaxonomySaved(false), 2000);
        loadTaxonomy();
      }
    } catch { /* silent */ }
    setTaxonomySaving(false);
  }

  async function testTaxonomyUrl() {
    setTaxonomyTesting(true);
    setTaxonomyTestResult(null);
    try {
      const res = await fetch('/api/firm/taxonomy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: taxonomyUrl }),
      });
      const data = await res.json();
      setTaxonomyTestResult({
        success: data.success,
        message: data.success ? `Connected — ${data.accountCount} accounts found` : (data.error || 'Connection failed'),
      });
    } catch {
      setTaxonomyTestResult({ success: false, message: 'Network error' });
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
        const data = await res.json();
        setTaxonomyLocked(true);
        setTaxonomySaved(true);
        setTimeout(() => setTaxonomySaved(false), 2000);
        loadTaxonomy();
        alert(`Taxonomy uploaded: ${data.created} created, ${data.updated} updated`);
      } else {
        const err = await res.json();
        alert(err.error || 'Upload failed');
      }
    } catch { alert('Upload error'); }
    setTaxonomyUploading(false);
    e.target.value = '';
  }

  function unlockTaxonomy() {
    setTaxonomyLocked(false);
  }

  // ─── Feedback user handlers ────────────────────────────────────────────────

  async function addFeedbackUser() {
    if (!newFeedbackEmail.trim()) return;
    setFeedbackAddError('');
    try {
      const res = await fetch('/api/firm/feedback-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, email: newFeedbackEmail.trim() }),
      });
      if (res.ok) {
        setNewFeedbackEmail('');
        loadFeedbackUsers();
      } else {
        const data = await res.json();
        setFeedbackAddError(data.error || 'Failed to add user');
      }
    } catch {
      setFeedbackAddError('Network error');
    }
  }

  async function removeFeedbackUser(userId: string) {
    try {
      await fetch('/api/firm/feedback-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, userId }),
      });
      loadFeedbackUsers();
    } catch { /* silent */ }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading firm settings...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Firm Sampling Settings</h2>
        <p className="text-sm text-slate-500">
          Configure firm-wide audit sampling parameters. Only Firm Admins can make changes.
        </p>
      </div>

      {/* ─── Confidence Level ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Audit Sampling Confidence Level</h3>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={50}
            max={99.9}
            step={0.1}
            value={confidenceLevel}
            onChange={(e) => setConfidenceLevel(parseFloat(e.target.value) || 95)}
            className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-500">%</span>
        </div>
      </div>

      {/* ─── Confidence Factor Table ───────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Confidence Factor Table</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Inherent Risk</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Specific Risk</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Overall RMM</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Risk of Incorrect Acceptance</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase">Factor Min</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase">Factor Max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cfTable.map((row, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-slate-700">{row.inherentRisk}</td>
                  <td className="px-3 py-2 text-slate-700">{row.specificRisk}</td>
                  <td className="px-3 py-2 text-slate-700">{row.overallRMM}</td>
                  <td className="px-3 py-2 text-slate-700">{row.riskOfIncorrectAcceptance}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={row.confidenceFactorMin}
                      onChange={(e) => updateCfRow(idx, 'confidenceFactorMin', parseFloat(e.target.value) || 0)}
                      className="w-16 px-2 py-1 text-sm text-center border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={row.confidenceFactorMax}
                      onChange={(e) => updateCfRow(idx, 'confidenceFactorMax', parseFloat(e.target.value) || 0)}
                      className="w-16 px-2 py-1 text-sm text-center border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Risk Matrix (k values) ────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Risk Matrix (k values %)</h3>
        <p className="text-xs text-slate-400 mb-3">
          Values represent k (%) by Inherent Risk (rows) and Specific Risk (columns).
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600"></th>
                {RISK_LABELS.map(label => (
                  <th key={label} className="px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RISK_LABELS.map((rowLabel, i) => (
                <tr key={rowLabel}>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600 uppercase">{rowLabel}</td>
                  {RISK_LABELS.map((_, j) => (
                    <td key={j} className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={riskMatrix[i][j]}
                        onChange={(e) => updateRiskMatrix(i, j, parseInt(e.target.value) || 0)}
                        className="w-16 px-2 py-1 text-sm text-center border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Save button ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={validateAndSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
      </div>

      {/* ─── Taxonomy / Chart of Accounts ───────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Taxonomy / Chart of Accounts</h3>
        <p className="text-xs text-slate-400 mb-4">
          Configure where the firm&apos;s chart of accounts (taxonomy) is sourced from. This is used by the Bank to TB tool for transaction categorisation.
        </p>

        {/* Source type selector */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-slate-600 font-medium">Source:</label>
          <select
            value={taxonomySourceType}
            onChange={(e) => setTaxonomySourceType(e.target.value)}
            disabled={taxonomyLocked}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">Select source type...</option>
            <option value="url">URL / API Endpoint</option>
            <option value="file">File Upload</option>
          </select>
          {taxonomyLocked && (
            <button
              onClick={unlockTaxonomy}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Change
            </button>
          )}
        </div>

        {/* URL input */}
        {taxonomySourceType === 'url' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <input
                type="url"
                value={taxonomyUrl}
                onChange={(e) => setTaxonomyUrl(e.target.value)}
                placeholder="https://api.example.com/chart-of-accounts"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={testTaxonomyUrl}
                disabled={!taxonomyUrl || taxonomyTesting}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 transition-colors"
              >
                {taxonomyTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
              </button>
            </div>
            {taxonomyTestResult && (
              <div className={`flex items-center gap-2 text-xs ${taxonomyTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {taxonomyTestResult.success ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {taxonomyTestResult.message}
              </div>
            )}
            <button
              onClick={saveTaxonomyConfig}
              disabled={!taxonomyUrl || taxonomySaving}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {taxonomySaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save & Fetch Taxonomy
            </button>
          </div>
        )}

        {/* File upload */}
        {taxonomySourceType === 'file' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition-colors">
                <Upload className="h-4 w-4" />
                {taxonomyUploading ? 'Uploading...' : 'Upload File'}
                <input
                  type="file"
                  accept=".csv,.json,.xlsx"
                  onChange={handleTaxonomyFileUpload}
                  className="hidden"
                  disabled={taxonomyUploading}
                />
              </label>
              <span className="text-xs text-slate-400">Accepts CSV, JSON, or XLSX</span>
            </div>
          </div>
        )}

        {/* Current status */}
        {taxonomyConfig && (taxonomyConfig.chartOfAccountsFileName || taxonomyConfig.accountCount > 0) && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
            {taxonomyConfig.chartOfAccountsFileName && (
              <p>File: <span className="font-medium">{taxonomyConfig.chartOfAccountsFileName}</span></p>
            )}
            {taxonomyConfig.taxonomyEndpointUrl && (
              <p>Endpoint: <span className="font-medium">{taxonomyConfig.taxonomyEndpointUrl}</span></p>
            )}
            <p>Accounts loaded: <span className="font-medium">{taxonomyConfig.accountCount}</span></p>
            {taxonomyConfig.chartOfAccountsUpdatedAt && (
              <p>Last updated: <span className="font-medium">{new Date(taxonomyConfig.chartOfAccountsUpdatedAt).toLocaleString()}</span></p>
            )}
          </div>
        )}
        {taxonomySaved && <span className="text-sm text-green-600 font-medium mt-2 block">Saved</span>}
      </div>

      {/* ─── IA Feedback Users ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">IA Feedback Users</h3>
        <p className="text-xs text-slate-400 mb-4">
          Designated users who can provide feedback on AI responses in the Assurance tools. Their feedback helps improve the AI over time.
        </p>

        {/* Add user */}
        <div className="flex items-center gap-2 mb-4">
          <input
            type="email"
            value={newFeedbackEmail}
            onChange={(e) => { setNewFeedbackEmail(e.target.value); setFeedbackAddError(''); }}
            placeholder="Enter user email to add..."
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && addFeedbackUser()}
          />
          <button
            onClick={addFeedbackUser}
            disabled={!newFeedbackEmail.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        {feedbackAddError && (
          <p className="text-xs text-red-600 mb-3">{feedbackAddError}</p>
        )}

        {/* User list */}
        {feedbackUsersLoading ? (
          <div className="flex items-center gap-2 py-4 text-slate-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : feedbackUsers.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">No feedback users configured yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {feedbackUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">{user.userName}</p>
                  <p className="text-xs text-slate-400">{user.userEmail}</p>
                </div>
                <button
                  onClick={() => removeFeedbackUser(user.userId)}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors"
                  title="Remove feedback user"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Warning modal ─────────────────────────────────────────────────── */}
      {showWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md mx-4">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-semibold text-slate-900">Values Outside Normal Ranges</h3>
            </div>
            <div className="px-5 py-4">
              <div className="text-sm text-slate-700 whitespace-pre-line">{warningMessage}</div>
              <p className="text-sm text-slate-500 mt-3">
                Do you want to save these values anyway?
              </p>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowWarning(false); setPendingSave(false); }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doSave}
                className="px-4 py-1.5 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                Save Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
