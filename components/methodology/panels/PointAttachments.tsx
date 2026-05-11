'use client';

/**
 * PointAttachments — links + file attachments for an AuditPoint.
 *
 * Shared across the Review Point, RI Matter, Management Letter Point,
 * and Representation Letter Point panels — all four sit on the same
 * AuditPoint model (prisma/schema.prisma) with an `attachments` JSON
 * column shaped as `{name, url, type?, size?}[]`.
 *
 * Why a separate component:
 *   - The four panels render different surrounding UI (tones, action
 *     bars, sign-offs) but they all need the same "add a link / drop
 *     a file / list what's attached" widget. Lifting it out keeps the
 *     panels light and makes future tweaks land in one place.
 *
 * How it persists:
 *   - The component is a controlled view: parent owns the array and
 *     `onChange` fires with the new array after every mutation
 *     (add link, upload, delete). The parent is responsible for
 *     POST'ing the new array via the audit-points PATCH ?action=update
 *     handler — usually as a debounced or immediate save.
 *
 * Uploads:
 *   - `POST /api/engagements/:id/audit-points/upload-attachment` puts
 *     the file in Azure Blob and returns a descriptor. We append it
 *     to the array via onChange — the parent persists.
 */

import { useRef, useState } from 'react';
import { Link as LinkIcon, Paperclip, X, ExternalLink, Loader2 } from 'lucide-react';

export interface Attachment {
  name: string;
  url: string;
  type?: string;
  size?: number;
  storagePath?: string;
}

interface Props {
  engagementId: string;
  /** Current attachment array — null/undefined treated as empty. */
  value?: Attachment[] | null;
  /** Fires with the new array after add / remove. */
  onChange: (next: Attachment[]) => void;
  /** When true, hides the add buttons (e.g. closed/committed points). */
  disabled?: boolean;
  /** Optional accent class for the section heading (matches panel tone). */
  accentClass?: string;
}

export function PointAttachments({ engagementId, value, onChange, disabled, accentClass = 'text-slate-500' }: Props) {
  const items: Attachment[] = Array.isArray(value) ? value : [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addLink() {
    // Plain prompts keep the widget dependency-free — the panels
    // around it are already heavy on modals so we avoid adding
    // another one. Empty / cancelled = no-op.
    const url = window.prompt('Paste a URL (https://…)');
    if (!url) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    // Light validation — we don't want to block paste-and-go for
    // edge cases (mailto:, internal paths) so we only refuse the
    // obviously broken. The server stores whatever we send.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('/')) {
      const ok = window.confirm('This doesn’t look like a full URL (e.g. https://example.com). Add it anyway?');
      if (!ok) return;
    }
    const label = (window.prompt('Optional label (leave blank to use the URL)', '') || '').trim();
    const next: Attachment = { name: label || trimmed, url: trimmed, type: 'link' };
    onChange([...items, next]);
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-picked after a
    // failed upload (the change event won't fire otherwise).
    if (e.target) e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/engagements/${engagementId}/audit-points/upload-attachment`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Upload failed (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      const att: Attachment | undefined = data?.attachment;
      if (!att?.url) {
        setError('Upload succeeded but the server returned an empty descriptor.');
        return;
      }
      onChange([...items, att]);
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function removeAt(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="border border-slate-200 rounded p-2.5 bg-slate-50/50 space-y-2">
      <div className="flex items-center justify-between">
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${accentClass}`}>
          Links &amp; attachments {items.length > 0 && <span className="text-slate-400 font-normal">({items.length})</span>}
        </span>
        {!disabled && (
          <div className="flex items-center gap-1">
            <button
              onClick={addLink}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              title="Paste a URL to attach as a link"
            >
              <LinkIcon className="h-3 w-3" /> Add link
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              title="Pick a file to upload and attach"
            >
              {uploading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Paperclip className="h-3 w-3" />}
              Attach file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={onFilePicked}
            />
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[10px] text-slate-400 italic">None yet — add a URL or upload a file.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a, idx) => (
            <li key={idx} className="flex items-center gap-2 bg-white border border-slate-100 rounded px-2 py-1">
              {a.type === 'link'
                ? <LinkIcon className="h-3 w-3 text-blue-500 flex-shrink-0" />
                : <Paperclip className="h-3 w-3 text-indigo-500 flex-shrink-0" />}
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-700 hover:underline truncate flex-1 min-w-0"
                title={a.name}
              >
                {a.name}
                {typeof a.size === 'number' && a.size > 0 && (
                  <span className="text-slate-400 ml-1.5 text-[10px]">({Math.max(1, Math.round(a.size / 1024))} KB)</span>
                )}
              </a>
              <ExternalLink className="h-3 w-3 text-slate-300 flex-shrink-0" />
              {!disabled && (
                <button
                  onClick={() => removeAt(idx)}
                  className="text-slate-400 hover:text-red-600"
                  title="Remove this attachment from the point"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
      )}
    </div>
  );
}
