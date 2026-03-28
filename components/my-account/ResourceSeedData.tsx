'use client';

import { useState, useRef } from 'react';
import { Download, Upload, FileText, CheckCircle, AlertCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SeedType = 'jobs' | 'allocations';

interface SeedResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const TEMPLATES: Record<SeedType, { label: string; description: string; headers: string[] }> = {
  jobs: {
    label: 'Jobs',
    description: 'Jobs — one row per audit/assurance engagement. Existing jobs are included so you can review, complete or delete rows before re-uploading.',
    headers: [
      'Client Name',
      'Audit Type',
      'Period End',
      'Target Completion',
      'Budget Hours Specialist',
      'Budget Hours RI',
      'Budget Hours Reviewer',
      'Budget Hours Preparer',
      'Scheduling Status',
    ],
  },
  allocations: {
    label: 'Allocations',
    description: 'Allocations — who is assigned to each job, in what role and for which dates. Existing allocations are included so you can review, complete or delete rows before re-uploading.',
    headers: [
      'Client Name',
      'Audit Type',
      'Period End',
      'Staff Name',
      'Role',
      'Start Date',
      'End Date',
      'Hours Per Day',
      'Notes',
    ],
  },
};

async function downloadExport(type: SeedType) {
  const res = await fetch(`/api/resource-planning/seed?type=${type}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resource-seed-${type}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResourceSeedData() {
  const [seedType, setSeedType] = useState<SeedType>('allocations');
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<SeedType | null>(null);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleDownload(type: SeedType) {
    setDownloading(type);
    setDownloadError(null);
    try {
      await downloadExport(type);
    } catch (e: any) {
      setDownloadError(e?.message ?? 'Download failed — please try again');
    } finally {
      setDownloading(null);
    }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('type', seedType);
      formData.append('file', file);
      const res = await fetch('/api/resource-planning/seed', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setResult({ created: 0, skipped: 0, errors: [{ row: 0, message: data.error ?? 'Upload failed' }] });
      }
    } catch {
      setResult({ created: 0, skipped: 0, errors: [{ row: 0, message: 'Network error — please try again' }] });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">

      {/* Download */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-0.5">Download Seed Data</h3>
        <p className="text-xs text-slate-500 mb-4">
          Download a CSV containing all current data. Edit the file — add new rows, update existing ones, or delete
          rows you don&apos;t want to re-import — then upload below. Column headers must match exactly.
          Date columns use <span className="font-mono bg-slate-100 px-1 rounded">YYYY-MM-DD</span> format.
        </p>

        {downloadError && (
          <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
            {downloadError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(Object.entries(TEMPLATES) as [SeedType, typeof TEMPLATES[SeedType]][]).map(([type, t]) => (
            <div key={type} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-slate-700">Seed Data — {t.label}</span>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">{t.description}</p>
              <div className="text-[10px] text-slate-400 font-mono leading-relaxed mb-3 space-y-0.5">
                {t.headers.map((h) => (
                  <div key={h} className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full flex-shrink-0" />
                    {h}
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 w-full bg-white"
                onClick={() => handleDownload(type)}
                disabled={downloading !== null}
              >
                {downloading === type ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                {downloading === type ? 'Downloading…' : `Download ${t.label}`}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Upload */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-0.5">Upload Seed Data</h3>
        <p className="text-xs text-slate-500 mb-4">
          Select the data type, choose your populated CSV file, then click Upload.
          Existing records matched by key fields will be skipped without error.
        </p>

        <div className="border border-slate-200 rounded-lg p-4 space-y-4 bg-white">
          <div className="flex items-center gap-4">
            <label className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">Data Type</label>
            <select
              value={seedType}
              onChange={(e) => { setSeedType(e.target.value as SeedType); setResult(null); }}
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="jobs">Seed Data — Jobs</option>
              <option value="allocations">Seed Data — Allocations</option>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">CSV File</label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="text-xs text-slate-600
                file:mr-3 file:text-xs file:border file:border-slate-200 file:rounded-md
                file:px-3 file:py-1 file:bg-white file:text-slate-700 file:cursor-pointer
                hover:file:bg-slate-50 file:transition-colors"
            />
          </div>

          <div className="text-[10px] text-slate-400 bg-slate-50 rounded p-2">
            Required columns for <strong>{TEMPLATES[seedType].label}</strong>:{' '}
            {TEMPLATES[seedType].headers.join(', ')}
          </div>

          <Button
            size="sm"
            onClick={handleUpload}
            disabled={uploading}
            className="text-xs h-8"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            {uploading ? 'Uploading…' : 'Upload Seed Data'}
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="mt-4 border border-slate-200 rounded-lg p-4 bg-white space-y-3">
            <div className="flex items-center gap-5 text-sm font-medium">
              <span className="flex items-center gap-1.5 text-green-700">
                <CheckCircle className="h-4 w-4" />
                {result.created} record{result.created !== 1 ? 's' : ''} created
              </span>
              <span className="flex items-center gap-1.5 text-slate-500">
                <AlertCircle className="h-4 w-4" />
                {result.skipped} skipped (already exist)
              </span>
              {result.errors.length > 0 && (
                <span className="flex items-center gap-1.5 text-red-600">
                  <XCircle className="h-4 w-4" />
                  {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {result.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2.5 py-1.5">
                    {e.row > 0 ? <span className="font-semibold">Row {e.row}: </span> : null}
                    {e.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
