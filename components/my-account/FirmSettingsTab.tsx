'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Save, AlertTriangle, Upload, Download, Trash2, FileSpreadsheet } from 'lucide-react';

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

interface COAAccount {
  id: string;
  accountCode: string;
  accountName: string;
  categoryType: string;
  sortOrder: number;
}

interface Props {
  firmId: string;
  isFirmAdmin?: boolean;
}

export function FirmSettingsTab({ firmId, isFirmAdmin = true }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [pendingSave, setPendingSave] = useState(false);

  const [confidenceLevel, setConfidenceLevel] = useState(95);
  const [cfTable, setCfTable] = useState<ConfidenceFactorRow[]>(DEFAULT_CONFIDENCE_TABLE);
  const [riskMatrix, setRiskMatrix] = useState<number[][]>(DEFAULT_RISK_MATRIX);

  // Chart of Accounts state
  const [coaAccounts, setCoaAccounts] = useState<COAAccount[]>([]);
  const [coaFileName, setCoaFileName] = useState<string | null>(null);
  const [coaDownloadUrl, setCoaDownloadUrl] = useState<string | null>(null);
  const [coaUpdatedAt, setCoaUpdatedAt] = useState<string | null>(null);
  const [coaUploading, setCoaUploading] = useState(false);
  const [coaDeleting, setCoaDeleting] = useState(false);
  const [coaError, setCoaError] = useState('');
  const coaFileRef = useRef<HTMLInputElement>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, coaRes] = await Promise.all([
        fetch(`/api/firm/sampling-config?firmId=${firmId}`),
        fetch('/api/firm/chart-of-accounts'),
      ]);
      if (configRes.ok) {
        const data = await configRes.json();
        if (data.confidenceLevel) setConfidenceLevel(data.confidenceLevel);
        if (data.confidenceFactorTable?.length) setCfTable(data.confidenceFactorTable);
        if (data.riskMatrix?.length) setRiskMatrix(data.riskMatrix);
      }
      if (coaRes.ok) {
        const coaData = await coaRes.json();
        setCoaAccounts(coaData.accounts || []);
        setCoaFileName(coaData.fileName || null);
        setCoaDownloadUrl(coaData.downloadUrl || null);
        setCoaUpdatedAt(coaData.updatedAt || null);
      }
    } catch { /* use defaults */ }
    setLoading(false);
  }, [firmId]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

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

  async function handleCoaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoaUploading(true);
    setCoaError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/firm/chart-of-accounts', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setCoaError(data.error || 'Upload failed');
      } else {
        setCoaAccounts(data.accounts || []);
        setCoaFileName(file.name);
        setCoaUpdatedAt(new Date().toISOString());
        setCoaDownloadUrl(null); // Will be populated on next load
      }
    } catch {
      setCoaError('Upload failed');
    }
    setCoaUploading(false);
    if (coaFileRef.current) coaFileRef.current.value = '';
  }

  async function handleCoaDelete() {
    if (!confirm('Are you sure you want to delete the Chart of Accounts? This cannot be undone.')) return;
    setCoaDeleting(true);
    setCoaError('');
    try {
      const res = await fetch('/api/firm/chart-of-accounts', { method: 'DELETE' });
      if (res.ok) {
        setCoaAccounts([]);
        setCoaFileName(null);
        setCoaDownloadUrl(null);
        setCoaUpdatedAt(null);
      }
    } catch {
      setCoaError('Delete failed');
    }
    setCoaDeleting(false);
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
      {/* ─── Chart of Accounts ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Chart of Accounts</h2>
        <p className="text-sm text-slate-500">
          The default Chart of Accounts used for Financial Statements across the firm.
          {!isFirmAdmin && ' Only Firm Admins can upload or modify.'}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5">
        {/* Upload info and controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-slate-400" />
            {coaFileName ? (
              <div>
                <span className="text-sm font-medium text-slate-700">{coaFileName}</span>
                <span className="text-xs text-slate-400 ml-2">
                  ({coaAccounts.length} accounts)
                  {coaUpdatedAt && ` — Updated ${new Date(coaUpdatedAt).toLocaleDateString('en-GB')}`}
                </span>
              </div>
            ) : (
              <span className="text-sm text-slate-400">No Chart of Accounts uploaded</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {coaDownloadUrl && (
              <a
                href={coaDownloadUrl}
                download={coaFileName || 'chart-of-accounts.xlsx'}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            )}
            {isFirmAdmin && (
              <>
                <input
                  ref={coaFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleCoaUpload}
                  className="hidden"
                />
                <button
                  onClick={() => coaFileRef.current?.click()}
                  disabled={coaUploading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {coaUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {coaFileName ? 'Replace' : 'Upload'}
                </button>
                {coaFileName && (
                  <button
                    onClick={handleCoaDelete}
                    disabled={coaDeleting}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                  >
                    {coaDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {coaError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{coaError}</div>
        )}

        <p className="text-xs text-slate-400 mb-3">
          Upload a spreadsheet with columns: Account Code, Account Name, Category. Supported categories: Fixed Asset, Investment, Current Asset, Current Liability, Long-term Liability, Equity, Revenue, Direct Costs, Overheads, Other Income, Tax Charge, Distribution.
        </p>

        {/* Account list */}
        {coaAccounts.length > 0 && (
          <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-md">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Code</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Account Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coaAccounts.map(a => (
                  <tr key={a.id}>
                    <td className="px-3 py-1.5 font-mono text-slate-700">{a.accountCode}</td>
                    <td className="px-3 py-1.5 text-slate-700">{a.accountName}</td>
                    <td className="px-3 py-1.5 text-slate-500">{a.categoryType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Sampling Settings ──────────────────────────────────────────── */}
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
