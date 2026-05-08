'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Paperclip, Download, Trash2, Upload, Loader2, FileIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
  downloadUrl: string;
}

interface AttachmentPanelProps {
  meetingId: string;
  agendaItemId?: string;
  readOnly?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPanel({ meetingId, agendaItemId, readOnly }: AttachmentPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agendaItemId) params.set('agendaItemId', agendaItemId);
      const res = await fetch(`/api/board/meetings/${meetingId}/attachments?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load attachments');
      const data = await res.json();
      setAttachments(data.attachments || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load attachments');
    } finally {
      setLoading(false);
    }
  }, [meetingId, agendaItemId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('file', files[i]);
        if (agendaItemId) formData.append('agendaItemId', agendaItemId);

        const res = await fetch(`/api/board/meetings/${meetingId}/attachments`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to upload ${files[i].name}`);
        }
      }
      await fetchAttachments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(attachmentId: string) {
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete attachment');
      await fetchAttachments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1">
          <Paperclip className="h-4 w-4" />
          Attachments
          {attachments.length > 0 && (
            <span className="text-xs text-slate-400 ml-1">({attachments.length})</span>
          )}
        </h4>
        {!readOnly && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1" />
              )}
              Upload
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center text-sm text-slate-400 py-2">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading...
        </div>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">No attachments.</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50 group text-sm"
            >
              <FileIcon className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <span className="flex-1 truncate text-slate-700">{att.filename}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(att.size)}</span>
              <a
                href={att.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              {!readOnly && (
                <button
                  onClick={() => handleDelete(att.id)}
                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
