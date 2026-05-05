'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, Eye, Download, X, MessageSquare } from 'lucide-react';
import { InterrogateBotModal } from './InterrogateBotModal';

interface ReportRow {
  id: string;
  fileName: string;
  generatedAt: string;
  generatedByName: string;
  fileSize: number;
  viewUrl: string;
  downloadUrl: string | null;
}

interface ListResponse {
  reports: ReportRow[];
  canGenerate: boolean;
}

/**
 * "Audit File PDF Report" panel — drops onto the engagement page so
 * methodology admins can generate snapshots and any user with engagement
 * read access can view them inline. Download is a methodology-admin-only
 * action; for everyone else the download icon is hidden and the
 * server-side download route additionally 403s.
 *
 * The viewer is a full-screen modal containing an `<iframe>` against
 * `/api/engagements/.../pdf-report/<id>/view` — that endpoint streams
 * with `Content-Disposition: inline` so the browser's PDF viewer takes
 * over. We strip our own download button from the modal toolbar; the
 * browser's built-in PDF toolbar can't be fully disabled, but
 * `Cache-Control: no-store` on the stream and routing through our own
 * URL means the binary isn't sittable on a public link.
 */
export function PdfReportPanel({ engagementId }: { engagementId: string }) {
  const [list, setList] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ReportRow | null>(null);
  const [interrogating, setInterrogating] = useState(false);

  async function refresh() {
    try {
      setLoading(true);
      const res = await fetch(`/api/engagements/${engagementId}/pdf-report`);
      if (!res.ok) throw new Error(`Failed to load reports (${res.status})`);
      const data: ListResponse = await res.json();
      setList(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [engagementId]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/pdf-report`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Generation failed (${res.status})`);
        return;
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" /> Audit File — PDF Snapshots
        </h3>
        <div className="flex items-center gap-2">
          {/* InterrogateBot — Q&A surface over the engagement's content.
              Available to anyone with read access (the bot itself is
              bounded to AUDIT_FILE so it can't expose new data). */}
          <button
            onClick={() => setInterrogating(true)}
            className="inline-flex items-center gap-1 text-xs px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            title="Ask questions about this audit file — answers are strictly from the file content"
          >
            <MessageSquare className="h-3 w-3" /> InterrogateBot
          </button>
          {list?.canGenerate && (
            <button
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-1 text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {generating ? 'Generating…' : 'Generate PDF Report'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{error}</div>
      )}

      {list && list.reports.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          {list.canGenerate
            ? 'No PDF reports generated yet. Click "Generate PDF Report" to create the first snapshot.'
            : 'No PDF reports available yet. A Methodology Administrator can generate one.'}
        </p>
      )}

      {list && list.reports.length > 0 && (
        <div className="space-y-1">
          {list.reports.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 px-2 bg-slate-50 rounded">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-800 truncate">{r.fileName}</div>
                <div className="text-[10px] text-slate-500">
                  {new Date(r.generatedAt).toLocaleString('en-GB')} · {r.generatedByName} · {(r.fileSize / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                onClick={() => setViewing(r)}
                title="View in PDF viewer"
                className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-slate-200 rounded hover:border-blue-400"
              >
                <Eye className="h-3 w-3" /> View
              </button>
              {/* Download is hidden when the server says the user
                  doesn't have download permission. Belt-and-braces:
                  the route itself also 403s non-admins, so a user who
                  forges the URL still can't get the binary. */}
              {r.downloadUrl && (
                <a
                  href={r.downloadUrl}
                  download={r.fileName}
                  title="Download — Methodology Administrator only"
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-slate-200 rounded hover:border-blue-400 text-slate-700"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Viewer modal — full-screen iframe pointed at the inline PDF
          stream. The browser's built-in PDF viewer takes over inside
          the iframe; we wrap it in our chrome with a single Close
          button (no Download button — that's gated separately). */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex flex-col" onClick={() => setViewing(null)}>
          <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-medium truncate">{viewing.fileName}</div>
            <button
              onClick={() => setViewing(null)}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
            >
              <X className="h-3 w-3" /> Close
            </button>
          </div>
          <iframe
            src={viewing.viewUrl}
            className="flex-1 w-full bg-white"
            title={viewing.fileName}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {interrogating && (
        <InterrogateBotModal engagementId={engagementId} onClose={() => setInterrogating(false)} />
      )}
    </div>
  );
}
