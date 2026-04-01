'use client';

import { useState, useEffect } from 'react';
import { Loader2, MessageSquare, CheckCircle2 } from 'lucide-react';

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
}

interface Props {
  engagementId: string;
  clientId: string;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function CommunicationTab({ engagementId, clientId }: Props) {
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

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  if (items.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg">
        <MessageSquare className="h-10 w-10 mx-auto mb-3 text-slate-300" />
        <p className="text-sm text-slate-500">No committed communications yet</p>
        <p className="text-xs text-slate-400 mt-1">Items committed from the Outstanding tab will appear here</p>
      </div>
    );
  }

  return (
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
                <div className="mt-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-[10px] text-blue-500 font-medium mb-0.5">
                    {item.respondedByName || 'Client'} &middot; {item.respondedAt ? formatDate(item.respondedAt) : ''}
                  </p>
                  <p className="text-xs text-slate-700">{item.response}</p>
                </div>
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
  );
}
