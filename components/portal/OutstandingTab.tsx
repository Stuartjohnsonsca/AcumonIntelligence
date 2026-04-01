'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send, CheckCircle2 } from 'lucide-react';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url: string }[];
}

interface PortalRequestItem {
  id: string;
  section: string;
  question: string;
  response: string | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
  chatHistory?: ChatMessage[];
}

interface Props {
  clientId: string;
  token: string;
  onCountChange?: (count: number) => void;
}

const SECTIONS = [
  { key: 'questions', label: 'Questions & Answers' },
  { key: 'calculations', label: 'Financial Calculations' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'connections', label: 'Connections' },
];

// Clean question text: remove [Questionnaire / Group] prefix if present
function cleanQuestion(text: string): { question: string; source: string | null } {
  const match = text.match(/^\[(.+?)\]\s*(.+)$/);
  if (match) return { source: match[1], question: match[2] };
  return { source: null, question: text };
}

export function OutstandingTab({ clientId, token, onCountChange }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTIONS.map(s => s.key)));
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [responseFiles, setResponseFiles] = useState<Record<string, File[]>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadItems();
  }, [clientId]);

  async function loadItems() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/requests?clientId=${clientId}&status=outstanding`);
      if (res.ok) {
        const data = await res.json();
        const reqs = data.requests || [];
        setItems(reqs);
        onCountChange?.(reqs.length);
      }
    } catch {}
    setLoading(false);
  }

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getItemsBySection(sectionKey: string) {
    return items.filter(i => i.section === sectionKey && !successes.has(i.id));
  }

  async function handleSubmitItem(item: PortalRequestItem) {
    const response = responses[item.id]?.trim();
    const files = responseFiles[item.id] || [];
    if (!response && files.length === 0) return;

    setSubmitting(prev => ({ ...prev, [item.id]: true }));
    setErrors(prev => { const n = { ...prev }; delete n[item.id]; return n; });

    try {
      const fileNames = files.map(f => f.name);
      const fullResponse = fileNames.length > 0
        ? `${response || ''}${response ? '\n' : ''}[Attachments: ${fileNames.join(', ')}]`
        : (response || '');

      const res = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          response: fullResponse,
          respondedByName: 'Portal User',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [item.id]: data.error || 'Submission failed' }));
      } else {
        setSuccesses(prev => new Set(prev).add(item.id));
        setResponses(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        setResponseFiles(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        onCountChange?.(items.filter(i => !successes.has(i.id) && i.id !== item.id).length);
      }
    } catch {
      setErrors(prev => ({ ...prev, [item.id]: 'Network error' }));
    }
    setSubmitting(prev => ({ ...prev, [item.id]: false }));
  }

  function StatusDot({ count }: { count: number }) {
    return (
      <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold text-white ${
        count === 0 ? 'bg-green-500' : 'bg-red-500'
      }`}>
        {count}
      </span>
    );
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 font-medium">No outstanding items</p>
          <p className="text-xs text-slate-400 mt-1">All requests have been responded to.</p>
        </div>
      )}

      {SECTIONS.map(section => {
        const sectionItems = getItemsBySection(section.key);
        const isExpanded = expandedSections.has(section.key);

        return (
          <div key={section.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                <span className="text-sm font-semibold text-slate-800">{section.label}</span>
                <StatusDot count={sectionItems.length} />
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-slate-100">
                {sectionItems.length === 0 ? (
                  <div className="px-5 py-4 text-xs text-slate-400 italic">No outstanding items in this section.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {sectionItems.map((item) => {
                      const { question, source } = cleanQuestion(item.question);
                      return (
                        <div key={item.id} className="px-5 py-3">
                          <div className="mb-2">
                            <p className="text-sm text-slate-800 font-medium">{question}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {source && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{source}</span>
                              )}
                              <span className="text-[10px] text-slate-400">
                                Requested by {item.requestedByName} &middot; {new Date(item.requestedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                          </div>
                          {/* Chat history — show conversation thread */}
                          {item.chatHistory && item.chatHistory.length > 0 && (
                            <div className="mb-2 space-y-1.5 max-h-40 overflow-y-auto">
                              {item.chatHistory.map((msg, mi) => (
                                <div key={mi} className={`flex ${msg.from === 'client' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-xs ${
                                    msg.from === 'client' ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-800'
                                  }`}>
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="font-semibold text-[10px]">{msg.name}</span>
                                      <span className="text-[9px] text-slate-400">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <p>{msg.message}</p>
                                    {msg.attachments && msg.attachments.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {msg.attachments.map((a, ai) => (
                                          <span key={ai} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/50 rounded text-[9px] border">📎 {a.name}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <textarea
                                value={responses[item.id] || ''}
                                onChange={e => setResponses(prev => ({ ...prev, [item.id]: e.target.value }))}
                                placeholder={item.chatHistory?.length ? "Continue the conversation..." : "Enter your response..."}
                                rows={2}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                              />
                              {(responseFiles[item.id]?.length || 0) > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {responseFiles[item.id].map((f, fi) => (
                                    <span key={fi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
                                      📎 {f.name}
                                      <button onClick={() => setResponseFiles(prev => ({ ...prev, [item.id]: prev[item.id].filter((_, i) => i !== fi) }))} className="text-red-400 hover:text-red-600">×</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <label className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                                + Attach file
                                <input type="file" multiple className="hidden" onChange={e => {
                                  const files = Array.from(e.target.files || []);
                                  setResponseFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...files] }));
                                  e.target.value = '';
                                }} />
                              </label>
                            </div>
                            <button
                              onClick={() => handleSubmitItem(item)}
                              disabled={!responses[item.id]?.trim() || submitting[item.id]}
                              className="self-end px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                            >
                              {submitting[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Submit
                            </button>
                          </div>
                          {errors[item.id] && (
                            <p className="text-xs text-red-500 mt-1">{errors[item.id]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
