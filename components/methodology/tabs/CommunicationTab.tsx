'use client';

import { useState, useEffect } from 'react';
import { Loader2, MessageSquare, CheckCircle2 } from 'lucide-react';
import { MeetingsPanel } from '../panels/MeetingsPanel';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url: string }[];
}

interface CommittedItem {
  id: string;
  question: string;
  response: string;
  requestedByName: string;
  requestedAt: string;
  respondedByName?: string;
  respondedAt?: string;
  committedAt?: string;
  committedByName?: string;
  chatHistory?: ChatMessage[];
}

interface Props {
  engagementId: string;
  clientId: string;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type SubTab = 'communications' | 'meetings';

export function CommunicationTab({ engagementId, clientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('communications');
  const [items, setItems] = useState<CommittedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/portal/requests?clientId=${clientId}&status=committed`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.requests || []);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [clientId]);

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 mb-4">
        <button
          onClick={() => setSubTab('communications')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
            subTab === 'communications' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Communications
        </button>
        <button
          onClick={() => setSubTab('meetings')}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
            subTab === 'meetings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Meetings
        </button>
      </div>

      {/* Sub-tab content */}
      {subTab === 'meetings' ? (
        <MeetingsPanel engagementId={engagementId} />
      ) : (
        <>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 border rounded-lg">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">No committed communications yet</p>
              <p className="text-xs text-slate-400 mt-1">Items committed from the Outstanding tab will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">
                Committed Communications
                <span className="ml-2 text-xs font-normal text-slate-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              </h3>

              <div className="border rounded-lg divide-y">
                {items.map(item => (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-slate-800 font-medium">{item.question}</p>
                        {item.response && (
                          <div className="mt-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                            <p className="text-[10px] text-blue-500 font-medium mb-0.5">
                              {item.respondedByName || 'Client'} &middot; {item.respondedAt ? formatDate(item.respondedAt) : ''}
                            </p>
                            <p className="text-xs text-slate-700">{item.response}</p>
                          </div>
                        )}
                        {item.chatHistory && item.chatHistory.length > 0 && (
                          <div className="mt-2 space-y-1 pl-2 border-l-2 border-slate-200">
                            {item.chatHistory.filter(m => m.name !== 'System').map((msg, mi) => (
                              <div key={mi} className={`px-2 py-1 rounded text-xs ${msg.from === 'firm' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                                <span className="font-semibold text-[10px] text-slate-600">{msg.name}</span>
                                <span className="text-[9px] text-slate-400 ml-1">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                <p className="text-slate-700 mt-0.5">{msg.message}</p>
                                {msg.attachments && msg.attachments.length > 0 && (
                                  <div className="flex gap-1 mt-0.5">{msg.attachments.map((a, ai) => <a key={ai} href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">📎 {a.name}</a>)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-400">
                          <span>Requested by {item.requestedByName}</span>
                          <span>&middot;</span>
                          <span>{formatDate(item.requestedAt)}</span>
                          {item.committedByName && (
                            <>
                              <span>&middot;</span>
                              <span>Committed by {item.committedByName} {item.committedAt ? formatDate(item.committedAt) : ''}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
