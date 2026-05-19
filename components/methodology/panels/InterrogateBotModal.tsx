'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Loader2, Send, X, ShieldAlert, ThumbsUp, ThumbsDown, FileText, Sparkles } from 'lucide-react';
import { extractCitations, jsonPathToTab } from '@/lib/interrogate-citations';

interface Citation {
  type: 'json_path' | 'document';
  raw: string;
  path?: string;
  documentId?: string;
  page?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Set on assistant turns only — InterrogateInteraction.id we can rate. */
  interactionId?: string | null;
  /** Reviewer's rating (Phase 1 capture) */
  rating?: 'up' | 'down' | null;
  correction?: string;
  /** Citations parsed out of `content` for inline-link rendering. */
  citations?: Citation[];
}

interface Props {
  engagementId: string;
  onClose: () => void;
}

/**
 * InterrogateBot modal — strict file-only Q&A with thumbs/correction
 * capture (Phase 1). Citations in answers (e.g. "(materiality.overall)")
 * are rendered as clickable chips that deep-link to the engagement tab
 * owning that data; document citations ("(document:abc, page 3)") render
 * as preview links (Phase 3 lights these up; Phase 1 just renders).
 */
export function InterrogateBotModal({ engagementId, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setError(null);
    const next: Message[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/interrogate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        setMessages(messages);
        setInput(q);
        return;
      }
      const answer = String(data.answer || '').trim() || 'No response.';
      const citations: Citation[] = extractCitations(answer);
      setMessages([...next, {
        role: 'assistant',
        content: answer,
        interactionId: data.interactionId || null,
        rating: null,
        citations,
      }]);
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setMessages(messages);
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  async function rate(idx: number, rating: 'up' | 'down') {
    const m = messages[idx];
    if (!m.interactionId) return;
    // Optimistic update
    setMessages(prev => prev.map((mm, i) => i === idx ? { ...mm, rating } : mm));
    try {
      await fetch(`/api/engagements/${engagementId}/interrogate/${m.interactionId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, correction: m.correction || null }),
      });
    } catch { /* keep optimistic — best-effort */ }
  }

  async function saveCorrection(idx: number, correction: string) {
    const m = messages[idx];
    if (!m.interactionId) return;
    setMessages(prev => prev.map((mm, i) => i === idx ? { ...mm, correction } : mm));
    try {
      await fetch(`/api/engagements/${engagementId}/interrogate/${m.interactionId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: m.rating ?? 'down', correction }),
      });
    } catch { /* best-effort */ }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex flex-col" onClick={onClose}>
      <div
        className="m-auto bg-white rounded-lg shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">InterrogateBot</h3>
            <span className="text-[10px] text-slate-500 ml-1">Strictly from this audit file</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Strict-mode banner */}
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-[11px] text-amber-800">
          <ShieldAlert className="h-4 w-4 flex-none mt-0.5" />
          <span>
            This bot answers <strong>only</strong> from this engagement&rsquo;s audit-file content. It cites the JSON
            path it relied on, refuses questions it cannot answer from the file, and never imports outside knowledge.
            Use it to query what is recorded — not to ask for professional judgements that haven&rsquo;t been made yet.
          </span>
        </div>

        {/* Learning / feedback banner */}
        <div className="px-5 py-2 bg-indigo-50 border-b border-indigo-200 flex items-start gap-2 text-[11px] text-indigo-800">
          <Sparkles className="h-4 w-4 flex-none mt-0.5" />
          <span>
            <strong>This bot is learning.</strong> Please rate every answer with 👍 or 👎, and use
            &ldquo;Suggest improvement&rdquo; to tell it what a better answer would have been.
            High-rated answers and your corrections become reference examples for similar questions
            on future engagements — the more feedback you give, the more it sounds like your firm.
          </span>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-white">
          {messages.length === 0 && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>Ask anything about this engagement. The bot reads the entire file and answers with citations.</p>
              <p className="text-xs text-slate-400">Examples:</p>
              <ul className="text-xs text-slate-500 list-disc ml-5 space-y-0.5">
                <li>&ldquo;How was materiality determined?&rdquo;</li>
                <li>&ldquo;What significant risks have been identified?&rdquo;</li>
                <li>&ldquo;Who is on the engagement team?&rdquo;</li>
                <li>&ldquo;Show me the unadjusted errors and their total.&rdquo;</li>
                <li>&ldquo;What did the auditor say about non-audit services?&rdquo;</li>
              </ul>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end pl-12' : 'justify-start pr-12'}`}>
              <div className="max-w-[85%]">
                <div
                  className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-800 border border-slate-200'
                  }`}
                >
                  {m.role === 'assistant'
                    ? <RenderedAssistantMessage content={m.content} engagementId={engagementId} />
                    : m.content}
                </div>
                {m.role === 'assistant' && m.interactionId && (
                  <AssistantFooter
                    rating={m.rating}
                    correction={m.correction}
                    onRate={r => rate(i, r)}
                    onSaveCorrection={c => saveCorrection(i, c)}
                  />
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-500 border border-slate-200 text-sm flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading the audit file…
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700">{error}</div>
        )}

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask something — e.g. how was materiality determined?"
            className="flex-1 text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400 resize-none"
            disabled={busy}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </button>
        </div>
        <p className="text-[10px] text-slate-400 px-5 pb-2 -mt-1">Press ⌘/Ctrl + Enter to send. Plain Enter inserts a newline.</p>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

/** Render an assistant turn with citations replaced by clickable chips. */
function RenderedAssistantMessage({ content, engagementId }: { content: string; engagementId: string }) {
  const segments = useMemo(() => splitByCitations(content), [content]);
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') return <span key={i}>{seg.text}</span>;
        if (seg.kind === 'json_path' && seg.path) {
          const tab = jsonPathToTab(seg.path);
          if (!tab) {
            return <span key={i} className="text-slate-500 font-mono text-[12px]">{seg.text}</span>;
          }
          const url = `/portal/audit?engagementId=${encodeURIComponent(engagementId)}&tab=${encodeURIComponent(tab)}`;
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${tab} tab — sourced from ${seg.path}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 bg-blue-100 text-blue-700 rounded text-[11px] font-mono hover:bg-blue-200"
            >
              {seg.path}
            </a>
          );
        }
        if (seg.kind === 'document' && seg.documentId) {
          const url = `/api/documents/preview?docId=${encodeURIComponent(seg.documentId)}`;
          const label = seg.page ? `doc · p${seg.page}` : 'doc';
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open source document${seg.page ? `, page ${seg.page}` : ''}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 bg-emerald-100 text-emerald-700 rounded text-[11px] font-medium hover:bg-emerald-200"
            >
              <FileText className="h-2.5 w-2.5" />
              {label}
            </a>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </span>
  );
}

interface Segment {
  kind: 'text' | 'json_path' | 'document';
  text: string;
  path?: string;
  documentId?: string;
  page?: number;
}

function splitByCitations(content: string): Segment[] {
  const cites = extractCitations(content);
  if (cites.length === 0) return [{ kind: 'text', text: content }];
  const out: Segment[] = [];
  let cursor = 0;
  for (const c of cites) {
    if (c.start > cursor) out.push({ kind: 'text', text: content.slice(cursor, c.start) });
    if (c.type === 'json_path') out.push({ kind: 'json_path', text: c.raw, path: c.path });
    else out.push({ kind: 'document', text: c.raw, documentId: c.documentId, page: c.page });
    cursor = c.end;
  }
  if (cursor < content.length) out.push({ kind: 'text', text: content.slice(cursor) });
  return out;
}

function AssistantFooter({
  rating, correction, onRate, onSaveCorrection,
}: {
  rating: 'up' | 'down' | null | undefined;
  correction: string | undefined;
  onRate: (r: 'up' | 'down') => void;
  onSaveCorrection: (c: string) => void;
}) {
  const [showCorrection, setShowCorrection] = useState(false);
  const [draft, setDraft] = useState(correction || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try { await onSaveCorrection(draft); setShowCorrection(false); }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
      <button
        onClick={() => onRate('up')}
        title="Helpful"
        className={`p-1 rounded hover:bg-slate-100 ${rating === 'up' ? 'text-emerald-600' : 'text-slate-400'}`}
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        onClick={() => onRate('down')}
        title="Not helpful"
        className={`p-1 rounded hover:bg-slate-100 ${rating === 'down' ? 'text-red-600' : 'text-slate-400'}`}
      >
        <ThumbsDown className="h-3 w-3" />
      </button>
      <button
        onClick={() => setShowCorrection(prev => !prev)}
        className="text-[10px] text-slate-500 hover:text-slate-700 hover:underline ml-1"
      >
        {correction ? 'Edit correction' : 'Suggest improvement'}
      </button>
      {rating && (
        <span className="text-[9px] italic ml-auto">Thanks — feedback saved.</span>
      )}
      {showCorrection && (
        <div className="absolute mt-6 ml-12 z-10 bg-white border border-slate-300 rounded shadow-lg p-3 w-96">
          <p className="text-[11px] text-slate-600 mb-1.5">What should the answer have been? Future similar questions will use this as a reference.</p>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={4}
            placeholder="The answer should have…"
            className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setShowCorrection(false)}
              className="text-[11px] text-slate-500 hover:text-slate-700 px-2 py-1"
            >Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              className="text-[11px] bg-indigo-600 text-white rounded px-2 py-1 hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
