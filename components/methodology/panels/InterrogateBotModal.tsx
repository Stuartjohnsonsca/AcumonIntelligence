'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Loader2, Send, X, ShieldAlert } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  engagementId: string;
  onClose: () => void;
}

/**
 * InterrogateBot modal — a chat surface that answers questions strictly
 * from the engagement's audit file content. Every user turn is sent to
 * `/api/engagements/:id/interrogate` along with the conversation
 * history so the bot can resolve follow-ups, but every answer is still
 * grounded against the same JSON snapshot of the file.
 *
 * Visual hierarchy mirrors the PDF Snapshot viewer (full-screen
 * overlay, dark chrome) so the two feel like related "audit-file" tools
 * rather than disjoint widgets.
 */
export function InterrogateBotModal({ engagementId, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the conversation pane to the latest message after every
  // new assistant or user turn — replicates the standard chat-UX.
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
          // Pass the prior turns so the bot can resolve follow-ups; the
          // server caps history length itself.
          history: messages,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        // Roll the user message back into the input so they can retry
        // without retyping. Trim the optimistic user-turn from messages
        // so the failed exchange isn't displayed.
        setMessages(messages);
        setInput(q);
        return;
      }
      const answer = String(data.answer || '').trim() || 'No response.';
      setMessages([...next, { role: 'assistant', content: answer }]);
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setMessages(messages);
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends; plain Enter inserts a newline so users can
    // compose multi-line questions without hijack.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
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
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600"
            title="Close"
          >
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
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-800 border border-slate-200'
                }`}
              >
                {m.content}
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

        {/* Error */}
        {error && (
          <div className="px-5 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700">{error}</div>
        )}

        {/* Composer */}
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
