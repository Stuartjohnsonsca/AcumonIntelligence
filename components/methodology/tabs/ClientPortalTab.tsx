'use client';

import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, Clock, Eye } from 'lucide-react';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url: string }[];
}

interface PortalRequest {
  id: string;
  section: string;
  question: string;
  response: string | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
  respondedByName?: string;
  respondedAt?: string;
  chatHistory?: ChatMessage[];
}

interface Props {
  engagementId: string;
  clientName: string;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function cleanQuestion(text: string): { question: string; source: string | null } {
  const match = text.match(/^\[(.+?)\]\s*(.+)$/);
  if (match) return { source: match[1], question: match[2] };
  return { source: null, question: text };
}

export function ClientPortalTab({ engagementId, clientName }: Props) {
  const [outstanding, setOutstanding] = useState<PortalRequest[]>([]);
  const [responded, setResponded] = useState<PortalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'outstanding' | 'responded'>('outstanding');
  const [viewMode, setViewMode] = useState<Record<string, 'batched' | 'separated'>>({});

  useEffect(() => {
    async function load() {
      try {
        // Get clientId from engagement
        const engRes = await fetch(`/api/engagements/${engagementId}`);
        if (!engRes.ok) return;
        const engData = await engRes.json();
        const clientId = engData.engagement?.clientId;
        if (!clientId) return;

        const [outRes, respRes] = await Promise.all([
          fetch(`/api/portal/requests?clientId=${clientId}&status=outstanding&engagementId=${engagementId}`),
          fetch(`/api/portal/requests?clientId=${clientId}&status=responded&engagementId=${engagementId}`),
        ]);

        if (outRes.ok) setOutstanding((await outRes.json()).requests || []);
        if (respRes.ok) setResponded((await respRes.json()).requests || []);
      } catch {}
      setLoading(false);
    }
    load();
  }, [engagementId]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Client Portal view...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Client Portal View</h2>
          <p className="text-xs text-slate-400">What {clientName} sees in their portal for this period</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">
          <Eye className="h-3 w-3" /> READ ONLY
        </span>
      </div>

      {/* Simulated portal */}
      <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/50">
        {/* Portal header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg px-4 py-3 mb-4 text-white">
          <h3 className="text-sm font-semibold">Welcome, {clientName}</h3>
          <p className="text-[10px] text-blue-100 mt-0.5">Audit Client Support</p>
        </div>

        {/* Toggle */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 mb-4">
          <button onClick={() => setActiveView('outstanding')} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${activeView === 'outstanding' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Outstanding
            {outstanding.length > 0 && <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold">{outstanding.length}</span>}
          </button>
          <button onClick={() => setActiveView('responded')} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeView === 'responded' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Responded ({responded.length})
          </button>
        </div>

        {/* Outstanding items */}
        {activeView === 'outstanding' && (
          <div className="space-y-2">
            {outstanding.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
                <p className="text-xs text-slate-500">No outstanding items</p>
              </div>
            ) : outstanding.map(item => {
              const { question, source } = cleanQuestion(item.question);
              const chatMsgs = (item.chatHistory || []).filter(m => m.name !== 'System');
              return (
                <div key={item.id} className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-800 font-medium">{question}</p>
                      {source && <span className="text-[8px] px-1 py-0.5 bg-slate-100 text-slate-400 rounded mt-0.5 inline-block">{source}</span>}
                      <p className="text-[9px] text-slate-400 mt-0.5">Requested by {item.requestedByName} &middot; {formatDate(item.requestedAt)}</p>
                    </div>
                    {/* Batch / Separate toggle */}
                    <div className="flex bg-slate-100 rounded p-0.5 flex-shrink-0">
                      <button
                        onClick={() => setViewMode(prev => ({ ...prev, [item.id]: 'batched' }))}
                        className={`px-2 py-0.5 text-[9px] font-medium rounded transition-colors ${(viewMode[item.id] || 'batched') === 'batched' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                        title="View all requested documents as a single grouped request"
                      >Batched</button>
                      <button
                        onClick={() => setViewMode(prev => ({ ...prev, [item.id]: 'separated' }))}
                        className={`px-2 py-0.5 text-[9px] font-medium rounded transition-colors ${viewMode[item.id] === 'separated' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                        title="View each requested document as an individual line item"
                      >Separated</button>
                    </div>
                  </div>
                  {chatMsgs.length > 0 && (
                    <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-slate-200">
                      {chatMsgs.map((msg, mi) => (
                        <div key={mi} className={`px-2 py-1 rounded text-[10px] ${msg.from === 'client' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                          <span className="font-semibold">{msg.name}</span>
                          <span className="text-slate-400 ml-1 text-[9px]">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          <p className="text-slate-700">{msg.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 px-2 py-1.5 bg-slate-50 rounded border border-slate-200">
                    <p className="text-[10px] text-slate-400 italic">Client response area (read-only view)</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Responded items */}
        {activeView === 'responded' && (
          <div className="space-y-2">
            {responded.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                <p className="text-xs text-slate-500">No responses yet</p>
              </div>
            ) : responded.map(item => {
              const { question, source } = cleanQuestion(item.question);
              const chatMsgs = (item.chatHistory || []).filter(m => m.name !== 'System');
              const isSeparated = viewMode[item.id] === 'separated';
              return (
                <div key={item.id} className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-800 font-medium">{question}</p>
                      {source && <span className="text-[8px] px-1 py-0.5 bg-slate-100 text-slate-400 rounded mt-0.5 inline-block">{source}</span>}
                    </div>
                    <div className="flex bg-slate-100 rounded p-0.5 flex-shrink-0">
                      <button onClick={() => setViewMode(prev => ({ ...prev, [item.id]: 'batched' }))} className={`px-2 py-0.5 text-[9px] font-medium rounded ${(viewMode[item.id] || 'batched') === 'batched' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>Batched</button>
                      <button onClick={() => setViewMode(prev => ({ ...prev, [item.id]: 'separated' }))} className={`px-2 py-0.5 text-[9px] font-medium rounded ${isSeparated ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>Separated</button>
                    </div>
                  </div>
                  {chatMsgs.length > 0 && (
                    <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-slate-200">
                      {chatMsgs.map((msg, mi) => (
                        <div key={mi} className={`px-2 py-1 rounded text-[10px] ${msg.from === 'client' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                          <span className="font-semibold">{msg.name}</span>
                          <span className="text-slate-400 ml-1 text-[9px]">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          <p className="text-slate-700">{msg.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.response && (
                    <div className="mt-1.5 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                      <p className="text-[10px] text-green-700">{item.response}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[9px] text-slate-400">
                    <span>{formatDate(item.requestedAt)}</span>
                    {item.respondedAt && <span>Responded: {formatDate(item.respondedAt)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
