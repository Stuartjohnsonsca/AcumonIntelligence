'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, FileText, Trash2, Star, StarOff, Download, Loader2, AlertTriangle } from 'lucide-react';

/**
 * Firm Document Skeleton manager — the left panel of the Documents
 * page. Lists the firm's uploaded brand skeletons and lets an admin
 * upload / set-default / soft-delete / download.
 *
 * A "skeleton" is the .docx file that carries the firm's header,
 * footer, page setup and any fixed preamble/closing. It MUST contain
 * the literal `{@body}` placeholder where rendered body content will
 * be injected. The upload endpoint validates that before accepting
 * the file.
 */

export interface Skeleton {
  id: string;
  firmId: string;
  name: string;
  description: string | null;
  auditType: string;
  storagePath: string;
  originalFileName: string;
  fileSize: number | null;
  isDefault: boolean;
  isActive: boolean;
  uploadedByName: string | null;
  createdAt: string;
}

const AUDIT_TYPES = [
  { value: 'ALL', label: 'All types' },
  { value: 'SME', label: 'Statutory (SME)' },
  { value: 'PIE', label: 'PIE' },
  { value: 'SME_CONTROLS', label: 'Statutory + Controls' },
  { value: 'PIE_CONTROLS', label: 'PIE + Controls' },
];

export function FirmSkeletonManager({ onChange }: { onChange?: (skeletons: Skeleton[]) => void }) {
  const [skeletons, setSkeletons] = useState<Skeleton[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', auditType: 'ALL', isDefault: false });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/methodology-admin/firm-document-skeletons');
      if (res.ok) {
        const data = await res.json();
        setSkeletons(data.skeletons || []);
        onChange?.(data.skeletons || []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function doUpload() {
    if (!file || !form.name.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('name', form.name.trim());
      body.append('description', form.description.trim());
      body.append('auditType', form.auditType);
      body.append('isDefault', String(form.isDefault));
      const res = await fetch('/api/methodology-admin/firm-document-skeletons', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
        return;
      }
      setShowUpload(false);
      setFile(null);
      setForm({ name: '', description: '', auditType: 'ALL', isDefault: false });
      if (inputRef.current) inputRef.current.value = '';
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function setDefault(s: Skeleton) {
    await fetch(`/api/methodology-admin/firm-document-skeletons/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: !s.isDefault }),
    });
    await load();
  }

  async function remove(s: Skeleton) {
    if (!confirm(`Delete "${s.name}"? Existing templates linked to this skeleton will fall back to the firm default. The .docx file is retained for audit.`)) return;
    await fetch(`/api/methodology-admin/firm-document-skeletons/${s.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Firm skeletons</h3>
          <p className="text-[11px] text-slate-500">Word files containing the firm's header, footer and page setup. Required tag inside: <code className="px-1 bg-slate-200 rounded">{'{@body}'}</code></p>
        </div>
        <button
          onClick={() => { setShowUpload(true); setError(null); }}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100"
        >
          <Upload className="h-3 w-3" /> Upload
        </button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="border-b bg-indigo-50/30 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text" placeholder="Skeleton name (e.g. Johnsons LLP letterhead)"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="text-[11px] border border-slate-300 rounded px-2 py-1.5"
            />
            <select
              value={form.auditType}
              onChange={e => setForm(f => ({ ...f, auditType: e.target.value }))}
              className="text-[11px] border border-slate-300 rounded px-2 py-1.5"
            >
              {AUDIT_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <input
              type="text" placeholder="Description (optional)"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="text-[11px] border border-slate-300 rounded px-2 py-1.5 md:col-span-2"
            />
            <label className="flex items-center gap-2 text-[11px] md:col-span-2">
              <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
              Set as default skeleton for this audit type
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file" accept=".docx"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="text-[11px]"
            />
            {file && <span className="text-[11px] text-slate-500">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
          </div>
          {error && (
            <div className="flex items-start gap-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowUpload(false); setError(null); }} className="text-[11px] px-3 py-1 text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              onClick={doUpload}
              disabled={!file || !form.name.trim() || uploading}
              className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-indigo-600 text-white rounded disabled:opacity-50"
            >
              {uploading && <Loader2 className="h-3 w-3 animate-spin" />} Upload
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-6 text-center text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
      ) : skeletons.length === 0 ? (
        <div className="p-6 text-center text-[11px] text-slate-400 italic">No skeletons uploaded yet.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {skeletons.map(s => (
            <li key={s.id} className="px-4 py-2 flex items-center gap-3">
              <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-slate-800 truncate">{s.name}</span>
                  {s.isDefault && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Default</span>}
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{AUDIT_TYPES.find(a => a.value === s.auditType)?.label || s.auditType}</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">{s.originalFileName}{s.description ? ` — ${s.description}` : ''}</div>
              </div>
              <a
                href={`/api/methodology-admin/firm-document-skeletons/${s.id}?download=1`}
                title="Download"
                className="text-slate-400 hover:text-slate-700"
              ><Download className="h-3.5 w-3.5" /></a>
              <button
                onClick={() => setDefault(s)}
                title={s.isDefault ? 'Unset default' : 'Set as default'}
                className="text-slate-400 hover:text-amber-600"
              >{s.isDefault ? <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /> : <StarOff className="h-3.5 w-3.5" />}</button>
              <button
                onClick={() => remove(s)}
                title="Delete"
                className="text-slate-400 hover:text-red-600"
              ><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
