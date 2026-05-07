'use client';

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, FolderOpen, Copy, Loader2, FileText, X, Download } from 'lucide-react';
import { ImportOptionsModal } from '@/components/methodology/ImportOptionsModal';
import { ImportReviewModal } from '@/components/methodology/ImportReviewModal';

/**
 * Per-tab document attachments — appears as a footer at the bottom of
 * every engagement tab so each tab carries its own evidence trail
 * (uploaded files, files reused from the engagement's Documents tab,
 * and files copied forward from the prior period).
 *
 * Three attach-paths:
 *   1. Upload — file picker writes a fresh AuditDocument tagged with
 *      utilisedTab.
 *   2. Allocate — pick an existing AuditDocument (already in the
 *      engagement's Documents tab) and tag it with this tab. The
 *      allocation persists so the same document can be reached from
 *      both surfaces.
 *   3. Copy from prior period — re-uses prior-period documents tagged
 *      with the same tab; blob bytes are duplicated so deleting the
 *      prior period doesn't break the current copy.
 *
 * Click any document name to open it via a short-lived SAS link.
 */

interface TabDocument {
  id: string;
  documentName: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  hasContent: boolean;
  viewUrl: string | null;
}

interface AvailableDocument {
  id: string;
  documentName: string;
  utilisedTab: string | null;
  storagePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
}

interface PriorDocument {
  id: string;
  documentName: string;
  fileSize: number | null;
}

interface Props {
  engagementId: string;
  /** Stable tab key — must match the value the API filters on. */
  tab: string;
  /** Friendly label for the section ("Ethics", "Materiality", …). Optional;
   *  defaults to a humanised tab key. */
  tabLabel?: string;
  /** Engagement context — only consumed when this footer renders the
   *  "Import External Audit File" button on the Prior Period tab. */
  clientName?: string;
  periodEnd?: string;
  auditTypeLabel?: string;
}

export function TabDocumentsFooter({ engagementId, tab, tabLabel, clientName, periodEnd, auditTypeLabel }: Props) {
  const [docs, setDocs] = useState<TabDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllocate, setShowAllocate] = useState(false);
  const [allocateOptions, setAllocateOptions] = useState<AvailableDocument[]>([]);
  const [showCopyPrior, setShowCopyPrior] = useState(false);
  const [priorOptions, setPriorOptions] = useState<PriorDocument[] | null>(null);
  const [priorChecked, setPriorChecked] = useState<Record<string, boolean>>({});
  const [hasPriorPeriod, setHasPriorPeriod] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-runnable Import Options flow — surfaced only on the Prior Period
  // tab as a "Import External Audit File" button. Reuses the same modal
  // that fires automatically when the engagement is first opened. Setting
  // re-import state to a fresh extraction id flips us into the Review
  // modal once upload + AI extraction completes.
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [importExtractionId, setImportExtractionId] = useState<string | null>(null);

  const niceLabel = tabLabel || humanise(tab);
  const isPriorPeriodTab = tab === 'prior-period';

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/tab-documents?tab=${encodeURIComponent(tab)}`);
      if (res.ok) {
        const data = await res.json();
        setDocs(Array.isArray(data.documents) ? data.documents : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Failed to load (${res.status})`);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  // Reload when the tab changes — the same component instance is reused
  // when the user switches tabs because the wrapper re-renders.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, tab]);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('tab', tab);
      fd.append('file', file);
      const res = await fetch(`/api/engagements/${engagementId}/tab-documents`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Upload failed (${res.status})`);
        return;
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function openAllocate() {
    setShowAllocate(true);
    setShowCopyPrior(false);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`);
      if (!res.ok) throw new Error(`Could not load documents (${res.status})`);
      const data = await res.json();
      // Show only documents that aren't already on this tab and have file content.
      const all: AvailableDocument[] = (data.documents || []).map((d: any) => ({
        id: d.id,
        documentName: d.documentName,
        utilisedTab: d.utilisedTab,
        storagePath: d.storagePath,
        fileSize: d.fileSize,
        mimeType: d.mimeType,
        createdAt: d.createdAt,
      }));
      setAllocateOptions(all.filter(d => d.utilisedTab !== tab && d.storagePath));
    } catch (err: any) {
      setError(err?.message || 'Failed to load Documents');
      setShowAllocate(false);
    }
  }

  async function allocate(documentId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/tab-documents/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, tab }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Allocate failed (${res.status})`);
        return;
      }
      setShowAllocate(false);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Allocate failed');
    } finally {
      setBusy(false);
    }
  }

  async function openCopyPrior() {
    setShowCopyPrior(true);
    setShowAllocate(false);
    setError(null);
    setPriorChecked({});
    setPriorOptions(null);
    try {
      // The copy-prior endpoint will surface the right error if there's
      // no prior engagement linked. We probe by attempting a list-only
      // fetch via a dry-run query against the engagement record.
      const engRes = await fetch(`/api/engagements/${engagementId}`);
      if (engRes.ok) {
        const engData = await engRes.json();
        setHasPriorPeriod(Boolean(engData.engagement?.priorPeriodEngagementId));
      }
      // To get the candidate list we hit the prior engagement's
      // tab-documents endpoint indirectly: re-use the GET on this
      // engagement's prior period via a server proxy. Simpler: ask
      // the copy-prior endpoint with a `dryRun` flag — but we
      // haven't wired that. Instead, the modal lets the user pick "all"
      // if they don't want to cherry-pick, and we just rely on the
      // server to filter to the right tab.
      // For cherry-pick we issue a GET on the prior engagement's
      // tab-documents listing.
      const engagement = await (await fetch(`/api/engagements/${engagementId}`)).json();
      const priorId = engagement?.engagement?.priorPeriodEngagementId;
      if (!priorId) {
        setHasPriorPeriod(false);
        setPriorOptions([]);
        return;
      }
      setHasPriorPeriod(true);
      const res = await fetch(`/api/engagements/${priorId}/tab-documents?tab=${encodeURIComponent(tab)}`);
      if (res.ok) {
        const data = await res.json();
        setPriorOptions((data.documents || []).map((d: any) => ({
          id: d.id,
          documentName: d.documentName,
          fileSize: d.fileSize,
        })));
      } else {
        // Fallback: rely on server to copy everything if listing fails.
        setPriorOptions([]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load prior-period documents');
    }
  }

  async function runCopyPrior(documentIds: string[] | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/tab-documents/copy-prior`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab, ...(documentIds ? { documentIds } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Copy failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setShowCopyPrior(false);
      if (data.copied === 0) {
        setError(data.message || 'No prior-period documents copied.');
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Copy failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <Paperclip className="h-4 w-4 text-slate-500" />
          Attached Documents — {niceLabel}
          <span className="text-[10px] font-normal text-slate-400">{docs.length}</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onFilePicked}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title="Upload a file directly to this tab"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload
          </button>
          <button
            onClick={openAllocate}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
            title="Pick a file from the engagement Documents tab"
          >
            <FolderOpen className="h-3 w-3" />
            From Documents
          </button>
          <button
            onClick={openCopyPrior}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-50"
            title="Copy the same tab's documents from the prior period engagement that's already linked in the system"
          >
            <Copy className="h-3 w-3" />
            From Linked Prior Period
          </button>
          {isPriorPeriodTab && (
            <button
              onClick={() => setShowImportOptions(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-purple-700 text-white rounded hover:bg-purple-800 disabled:opacity-50"
              title="Import data from an external prior audit file — the same flow that runs when an engagement is first opened"
            >
              <Download className="h-3 w-3" />
              Import External Audit File
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-slate-400 italic flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="text-xs text-slate-400 italic">No documents attached to this tab yet.</div>
      ) : (
        <ul className="space-y-1">
          {docs.map(d => (
            <li
              key={d.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs"
            >
              <FileText className="h-3.5 w-3.5 text-slate-500 flex-none" />
              {d.viewUrl ? (
                <a
                  href={d.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-blue-700 hover:text-blue-900 hover:underline truncate"
                  title={d.documentName}
                >
                  {d.documentName}
                </a>
              ) : (
                <span className="flex-1 text-slate-700 truncate" title={d.documentName}>
                  {d.documentName} <span className="text-slate-400">(no file uploaded)</span>
                </span>
              )}
              <span className="text-[10px] text-slate-400">{formatSize(d.fileSize)}</span>
              <span className="text-[10px] text-slate-400">{formatDate(d.uploadedAt)}</span>
              {d.uploadedByName && (
                <span className="text-[10px] text-slate-400" title={`Uploaded by ${d.uploadedByName}`}>
                  · {d.uploadedByName}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Allocate-from-Documents picker */}
      {showAllocate && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center" onClick={() => setShowAllocate(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="text-sm font-semibold">Pick a document from the engagement</h4>
              <button onClick={() => setShowAllocate(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {allocateOptions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">
                  No other uploaded documents on this engagement. Upload one in the Documents tab first.
                </p>
              ) : (
                <ul className="space-y-1">
                  {allocateOptions.map(opt => (
                    <li
                      key={opt.id}
                      className="flex items-center gap-2 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs hover:border-blue-300"
                    >
                      <FileText className="h-3.5 w-3.5 text-slate-500" />
                      <span className="flex-1 truncate" title={opt.documentName}>{opt.documentName}</span>
                      {opt.utilisedTab && (
                        <span className="text-[10px] text-slate-400">currently on: {humanise(opt.utilisedTab)}</span>
                      )}
                      <button
                        onClick={() => allocate(opt.id)}
                        disabled={busy}
                        className="text-[11px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Allocate
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Copy-from-Prior-Period picker */}
      {showCopyPrior && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center" onClick={() => setShowCopyPrior(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="text-sm font-semibold">Copy from prior period — {niceLabel}</h4>
              <button onClick={() => setShowCopyPrior(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {hasPriorPeriod === false ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  This engagement is not linked to a prior-period engagement. Set the prior period on the Opening tab first.
                </p>
              ) : priorOptions === null ? (
                <p className="text-xs text-slate-400 italic flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading prior period…
                </p>
              ) : priorOptions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">
                  The prior period has no documents tagged for this tab.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Tick the documents to copy. The blob bytes are duplicated so the new copy is independent of the prior period.
                  </p>
                  <ul className="space-y-1 mb-3">
                    {priorOptions.map(p => (
                      <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs">
                        <input
                          type="checkbox"
                          checked={!!priorChecked[p.id]}
                          onChange={e => setPriorChecked(prev => ({ ...prev, [p.id]: e.target.checked }))}
                        />
                        <FileText className="h-3.5 w-3.5 text-slate-500" />
                        <span className="flex-1 truncate" title={p.documentName}>{p.documentName}</span>
                        <span className="text-[10px] text-slate-400">{formatSize(p.fileSize)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => runCopyPrior(null)}
                      disabled={busy}
                      className="text-[11px] px-3 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded hover:bg-slate-200 disabled:opacity-50"
                    >
                      Copy all ({priorOptions.length})
                    </button>
                    <button
                      onClick={() => runCopyPrior(Object.keys(priorChecked).filter(k => priorChecked[k]))}
                      disabled={busy || Object.values(priorChecked).every(v => !v)}
                      className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
                      Copy selected
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Re-runnable Import Options modal — same flow as the
          first-time-open pop-up. Reaches AI extraction → Review → Apply
          and tags __fieldmeta with prior_period_ai provenance, putting
          the orange dashed surround on every populated field. */}
      {showImportOptions && isPriorPeriodTab && clientName && (
        <ImportOptionsModal
          engagementId={engagementId}
          clientName={clientName}
          periodEnd={periodEnd}
          auditTypeLabel={auditTypeLabel}
          onComplete={(_state, opts) => {
            setShowImportOptions(false);
            if (opts.extractionId) setImportExtractionId(opts.extractionId);
          }}
          onClose={() => setShowImportOptions(false)}
        />
      )}

      {importExtractionId && (
        <ImportReviewModal
          engagementId={engagementId}
          extractionId={importExtractionId}
          onApplied={() => {
            setImportExtractionId(null);
            // Refresh the document list so any newly-attached prior-period
            // archive shows up in this tab's footer.
            void load();
          }}
          onCancelled={() => setImportExtractionId(null)}
        />
      )}
    </div>
  );
}

function humanise(key: string): string {
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB'); } catch { return iso; }
}
