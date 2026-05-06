'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send, MessageSquare, FileText, CheckCircle2 } from 'lucide-react';

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

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  role: string;
  message: string;
  createdAt: string;
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
  const [sending, setSending] = useState<string | null>(null);

  const baseQs = new URLSearchParams({ email, sig }).toString();
  const apiUrl = `/api/specialist-portal/${encodeURIComponent(engagementId)}/${encodeURIComponent(roleKey)}?${baseQs}`;

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

  async function sendMessage(itemId: string) {
    const message = drafts[itemId]?.trim();
    if (!message) return;
    setSending(itemId);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, message }),
      });
      if (res.ok) {
        setDrafts(prev => ({ ...prev, [itemId]: '' }));
        await load();
      } else {
        const e = await res.json().catch(() => ({}));
        setError(e?.error || `Send failed (${res.status})`);
      }
    } finally {
      setSending(null);
    }
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
                            <p className="text-slate-700 whitespace-pre-wrap break-words mt-0.5">{m.message}</p>
                          </div>
                        ))}
                      </div>
                      {item.status === 'open' ? (
                        <div className="flex gap-2">
                          <textarea
                            value={drafts[item.id] || ''}
                            onChange={e => setDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Type a message…"
                            rows={2}
                            className="flex-1 text-xs border border-slate-300 rounded px-2 py-1 resize-y"
                          />
                          <button
                            onClick={() => void sendMessage(item.id)}
                            disabled={sending === item.id || !drafts[item.id]?.trim()}
                            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1 self-start"
                          >
                            {sending === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            Send
                          </button>
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
