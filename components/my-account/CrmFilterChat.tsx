'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2, Check, Sparkles } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface CompiledFilter {
  filter: string;
  description: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialDescription: string;
  onFilterConfirmed: (filter: string, description: string) => void;
}

export function CrmFilterChat({ isOpen, onClose, initialDescription, onFilterConfirmed }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [compiledFilter, setCompiledFilter] = useState<CompiledFilter | null>(null);
  const [confirming, setConfirming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-send the initial description on open
  useEffect(() => {
    if (isOpen && initialDescription.trim() && messages.length === 0) {
      sendMessage(initialDescription.trim());
    }
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && !loading) inputRef.current?.focus();
  }, [isOpen, loading, messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setCompiledFilter(null);

    try {
      const res = await fetch('/api/firm/power-apps/interpret-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error('Failed to interpret');

      const data = await res.json();
      const assistantMsg: Message = { role: 'assistant', content: data.reply };
      setMessages(prev => [...prev, assistantMsg]);

      if (data.compiledFilter) {
        setCompiledFilter(data.compiledFilter);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble processing that. Could you try again?' }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!compiledFilter) return;
    setConfirming(true);
    try {
      // Save the filter to the firm
      await fetch('/api/firm/power-apps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientFilter: compiledFilter.filter,
          clientFilterDesc: compiledFilter.description,
        }),
      });
      onFilterConfirmed(compiledFilter.filter, compiledFilter.description);
      onClose();
    } catch {}
    setConfirming(false);
  }

  if (!isOpen) return null;

  // Strip ```json blocks from display
  function formatMessage(content: string) {
    return content.replace(/```json\s*\n?[\s\S]*?\n?\s*```/g, '').trim();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <h3 className="text-sm font-semibold text-slate-800">Configure CRM Client Filter</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {messages.length === 0 && !loading && (
            <div className="text-center py-6">
              <Sparkles className="h-8 w-8 text-purple-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Describe which clients you want to import from Dynamics 365</p>
              <p className="text-xs text-slate-400 mt-1">e.g. &quot;All active accounts&quot; or &quot;Clients with audit jobs in London&quot;</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}>
                <p className="whitespace-pre-wrap">{formatMessage(msg.content)}</p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-100 rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            </div>
          )}
        </div>

        {/* Compiled filter confirmation */}
        {compiledFilter && (
          <div className="mx-4 mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-xs font-semibold text-green-800 mb-1">Generated Filter:</p>
            <code className="text-xs text-green-700 block bg-green-100 rounded px-2 py-1 font-mono break-all">{compiledFilter.filter}</code>
            <p className="text-xs text-green-600 mt-1">{compiledFilter.description}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={handleConfirm} disabled={confirming}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Use this filter
              </button>
              <button onClick={() => { setCompiledFilter(null); setInput('Actually, '); inputRef.current?.focus(); }}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">
                Refine
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-slate-100">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
              placeholder="Describe what clients to import..."
              disabled={loading}
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
            <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}
              className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
