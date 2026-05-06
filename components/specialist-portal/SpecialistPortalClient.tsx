'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, MessageSquare, FileText, CheckCircle2, Paperclip, Phone, X } from 'lucide-react';

/**
 * External Specialist Portal — client component.
 *
 * Polls the scoped /api/specialist-portal endpoint on mount, renders
 * the engagement header (client name + period end) and the list of
 * chat items the firm has opened against the specialist's role.
 *
 * Each chat exposes a message composer; reports / conclusions are
 * read-only. The specialist's submitted messages tag with their
 * email so the firm-side SpecialistsTab shows them as
 * "External Specialist" entries.
 *
 * On any 403 the client renders a friendly "link no longer valid"
 * panel — usually means the firm rotated SPECIALIST_PORTAL_SECRET
 * or the URL was edited.
 */

interface ChatAttachment {
  id: string;
  name: string;
  blobName?: string;
  mimeType?: string | null;
  size?: number;
}
interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  role: string;
  message: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  callLink?: { label?: string; url: string };
}

interface SpecialistItem {
  id: string;
  kind: 'chat' | 'report' | 'conclusion';
  title: string;
  createdAt: string;
  createdByName: string;
  body: string;
  messages: ChatMessage[];
  status: 'open' | 'completed';
}

interface PortalData {
  engagement: { id: string; auditType: string; clientName: string; periodEnd: string | null };
  roleKey: string;
  email: string;
  items: SpecialistItem[];
}

interface Props {
  engagementId: string;
  roleKey: string;
  email: string;
  sig: string;
}

export function SpecialistPortalClient({ engagementId, roleKey, email, sig }: Props) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingAttachments, setPendingAttachments] = useState<Record<string, ChatAttachment[]>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const baseQs = new URLSearchParams({ email, sig }).toString();
  const apiUrl = `/api/specialist-portal/${encodeURIComponent(engagementId)}/${encodeURIComponent(roleKey)}?${baseQs}`;
  // Attachments use the engagement-side endpoint with the same
  // (email, sig) auth — that route validates the HMAC against the
  // role + engagement so the firm's own session isn't required.
  const attachmentsUrl = `/api/engagements/${encodeURIComponent(engagementId)}/specialists/attachments?roleKey=${encodeURIComponent(roleKey)}&${baseQs}`;

  async function handleFiles(itemId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingFor(itemId);
    try {
      const uploaded: ChatAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fd = new FormData();
        fd.append('file', file);
        fd.append('roleKey', roleKey);
        const res = await fetch(attachmentsUrl, { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err?.error || `Upload failed (${res.status})`);
          break;
        }
        const data = await res.json();
        uploaded.push({
          id: data.id,
          name: data.name,
          blobName: data.blobName,
          mimeType: data.mimeType ?? null,
          size: data.size,
        });
      }
      if (uploaded.length > 0) {
        setPendingAttachments(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), ...uploaded] }));
      }
    } finally {
      setUploadingFor(null);
      const inp = fileInputs.current[itemId];
      if (inp) inp.value = '';
    }
  }

  function removePending(itemId: string, attId: string) {
    setPendingAttachments(prev => ({
      ...prev,
      [itemId]: (prev[itemId] || []).filter(a => a.id !== attId),
    }));
  }

  function attachmentDownloadUrl(att: ChatAttachment): string {
    return `/api/engagements/${encodeURIComponent(engagementId)}/specialists/attachments?blob=${encodeURIComponent(att.blobName || att.id)}&roleKey=${encodeURIComponent(roleKey)}&${baseQs}`;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' });
      if (res.status === 403) {
        setError('This link is no longer valid. Ask the firm to send you a fresh invitation.');
        return;
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e?.error || `Failed to load (${res.status})`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [engagementId, roleKey, email, sig]);

  async function sendMessage(itemId: string, callLink?: { url: string; label?: string }) {
    const message = (drafts[itemId] || '').trim();
    const atts = pendingAttachments[itemId] || [];
    if (!message && atts.length === 0 && !callLink) return;
    setSending(itemId);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          message: message || (callLink ? 'Joining a call:' : ''),
          attachments: atts.length > 0 ? atts : undefined,
          callLink,
        }),
      });
      if (res.ok) {
        setDrafts(prev => ({ ...prev, [itemId]: '' }));
        setPendingAttachments(prev => ({ ...prev, [itemId]: [] }));
        await load();
      } else {
        const e = await res.json().catch(() => ({}));
        setError(e?.error || `Send failed (${res.status})`);
      }
    } finally {
      setSending(null);
    }
  }

  function shareCallLink(itemId: string) {
    const url = window.prompt('Paste a Teams / Zoom / Google Meet link to share:');
    if (!url) return;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      alert('Please paste a full URL beginning with https://.');
      return;
    }
    void sendMessage(itemId, { url: trimmed });
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-10 text-center">
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Specialist Portal</h1>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const periodEnd = data.engagement.periodEnd
    ? new Date(data.engagement.periodEnd).toLocaleDateString('en-GB')
    : null;

  return (
    <div className="space-y-4">
      {/* Engagement header — minimal info so the specialist can
          confirm they're looking at the right file without seeing
          anything else about the audit. */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h1 className="text-lg font-semibold text-slate-800">Specialist Portal</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          {data.engagement.clientName}
          {periodEnd ? <span className="text-slate-400"> · period ending {periodEnd}</span> : null}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          You're signed in as <span className="font-mono">{data.email}</span> for the{' '}
          <span className="font-semibold">{data.roleKey.replace(/_/g, ' ')}</span> role.
        </p>
      </div>

      {/* Items */}
      {data.items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg py-10 text-center text-sm text-slate-500">
          Nothing has been opened for you yet.
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map(item => {
            const Icon = item.kind === 'chat' ? MessageSquare : item.kind === 'report' ? FileText : CheckCircle2;
            return (
              <div key={item.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-blue-500" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-800 truncate">{item.title}</h3>
                    <p className="text-[11px] text-slate-500">
                      {item.kind} · opened {new Date(item.createdAt).toLocaleDateString('en-GB')} by {item.createdByName}
                    </p>
                  </div>
                  {item.status === 'completed' && (
                    <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded">Completed</span>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  {item.body && (
                    <div className="text-xs text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded p-3">
                      {item.body}
                    </div>
                  )}
                  {item.kind === 'chat' && (
                    <div className="space-y-2">
                      <div className="border border-slate-200 rounded p-2 max-h-[300px] overflow-auto bg-white space-y-2">
                        {item.messages.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic text-center py-2">No messages yet.</p>
                        ) : item.messages.map(m => (
                          <div key={m.id} className="text-xs">
                            <div className="flex items-baseline gap-2">
                              <span className="font-medium text-slate-700">{m.userName}</span>
                              <span className="text-[10px] text-slate-400">{m.role}</span>
                              <span className="text-[10px] text-slate-400 ml-auto">{new Date(m.createdAt).toLocaleString('en-GB')}</span>
                            </div>
                            {m.message && <p className="text-slate-700 whitespace-pre-wrap break-words mt-0.5">{m.message}</p>}
                            {m.callLink && (
                              <a
                                href={m.callLink.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                <Phone className="h-3 w-3" /> {m.callLink.label || 'Join call'}
                              </a>
                            )}
                            {m.attachments && m.attachments.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {m.attachments.map(a => (
                                  <li key={a.id}>
                                    <a
                                      href={attachmentDownloadUrl(a)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                                    >
                                      <Paperclip className="h-3 w-3" /> {a.name}
                                      {typeof a.size === 'number' && <span className="text-slate-400">({Math.round(a.size / 1024)} KB)</span>}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                      {item.status === 'open' ? (
                        <div className="space-y-2">
                          {pendingAttachments[item.id]?.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              {pendingAttachments[item.id].map(a => (
                                <span key={a.id} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">
                                  <Paperclip className="h-3 w-3 text-slate-500" />
                                  {a.name}
                                  <button
                                    onClick={() => removePending(item.id, a.id)}
                                    className="text-slate-400 hover:text-red-600"
                                    title="Remove from this message"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <textarea
                              value={drafts[item.id] || ''}
                              onChange={e => setDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                              placeholder="Type a message…"
                              rows={2}
                              className="flex-1 text-xs border border-slate-300 rounded px-2 py-1 resize-y"
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => fileInputs.current[item.id]?.click()}
                                disabled={uploadingFor === item.id}
                                className="text-[10px] px-2 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1"
                                title="Attach a file"
                              >
                                {uploadingFor === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                                Attach
                              </button>
                              <button
                                onClick={() => shareCallLink(item.id)}
                                className="text-[10px] px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 inline-flex items-center gap-1"
                                title="Share a Teams / Zoom / Google Meet link"
                              >
                                <Phone className="h-3 w-3" /> Call
                              </button>
                              <button
                                onClick={() => void sendMessage(item.id)}
                                disabled={sending === item.id || (!drafts[item.id]?.trim() && (pendingAttachments[item.id]?.length || 0) === 0)}
                                className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                {sending === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                Send
                              </button>
                            </div>
                            <input
                              ref={el => { fileInputs.current[item.id] = el; }}
                              type="file"
                              multiple
                              className="hidden"
                              onChange={e => handleFiles(item.id, e.target.files)}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic">This conversation has been closed by the audit team.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
