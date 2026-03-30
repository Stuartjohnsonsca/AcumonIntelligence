'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send, CheckCircle2 } from 'lucide-react';

interface PortalRequestItem {
  id: string;
  section: string;
  question: string;
  response: string | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
}

interface Props {
  clientId: string;
  token: string;
}

const SECTIONS = [
  { key: 'questions', label: 'Questions & Answers' },
  { key: 'calculations', label: 'Financial Calculations' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'connections', label: 'Connections' },
];

export function OutstandingTab({ clientId, token }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTIONS.map(s => s.key)));
  const [responses, setResponses] = useState<Record<string, string>>({});
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
        setItems(data.requests || []);
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

  function totalOutstanding() {
    return items.filter(i => !successes.has(i.id)).length;
  }

  async function handleSubmit(sectionKey: string) {
    const sectionItems = getItemsBySection(sectionKey);
    const toSubmit = sectionItems.filter(i => responses[i.id]?.trim());
    if (toSubmit.length === 0) return;

    for (const item of toSubmit) {
      setSubmitting(prev => ({ ...prev, [item.id]: true }));
      setErrors(prev => { const n = { ...prev }; delete n[item.id]; return n; });

      try {
        const res = await fetch('/api/portal/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: item.id,
            response: responses[item.id],
            respondedByName: 'Portal User', // TODO: get from auth
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrors(prev => ({ ...prev, [item.id]: data.error || 'Submission failed' }));
        } else {
          setSuccesses(prev => new Set(prev).add(item.id));
          setResponses(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        }
      } catch {
        setErrors(prev => ({ ...prev, [item.id]: 'Network error' }));
      }
      setSubmitting(prev => ({ ...prev, [item.id]: false }));
    }
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
        const hasResponses = sectionItems.some(i => responses[i.id]?.trim());

        return (
          <div key={section.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Section header */}
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

            {/* Section content */}
            {isExpanded && (
              <div className="border-t border-slate-100">
                {sectionItems.length === 0 ? (
                  <div className="px-5 py-4 text-xs text-slate-400 italic">No outstanding items in this section.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {sectionItems.map((item) => (
                      <div key={item.id} className="px-5 py-3">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div className="flex-1">
                            <p className="text-sm text-slate-800">{item.question}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Requested by {item.requestedByName} &middot; {new Date(item.requestedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                        </div>
                        <textarea
                          value={responses[item.id] || ''}
                          onChange={e => setResponses(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Enter your response..."
                          rows={2}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                        {errors[item.id] && (
                          <p className="text-xs text-red-500 mt-1">{errors[item.id]}</p>
                        )}
                        {submitting[item.id] && (
                          <p className="text-xs text-blue-500 mt-1 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Submitting...</p>
                        )}
                      </div>
                    ))}

                    {/* Submit button */}
                    <div className="px-5 py-3 bg-slate-50 flex justify-end">
                      <button
                        onClick={() => handleSubmit(section.key)}
                        disabled={!hasResponses || Object.values(submitting).some(Boolean)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                      >
                        <Send className="h-3.5 w-3.5" /> Submit Responses
                      </button>
                    </div>
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
