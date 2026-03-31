'use client';

import { useState, useEffect } from 'react';
import {
  MapPin, FileCheck, MessageSquare, CheckCircle2, Loader2, X,
  ExternalLink, Clock, AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Action {
  id: string;
  type: string;
  title: string;
  description: string;
  data: any;
  createdAt: string;
}

interface PortalRequest {
  id: string;
  category: string;
  description: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  respondedAt: string | null;
}

interface Props {
  engagementId: string;
  clientId: string;
  currentUserId: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  land_registry_selection: <MapPin className="h-3.5 w-3.5 text-blue-500" />,
  evidence_verification: <FileCheck className="h-3.5 w-3.5 text-orange-500" />,
  portal_response: <MessageSquare className="h-3.5 w-3.5 text-green-500" />,
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount);
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export function EngagementOutstandingTab({ engagementId, clientId, currentUserId }: Props) {
  const [jobActions, setJobActions] = useState<Action[]>([]);
  const [clientRequests, setClientRequests] = useState<PortalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [engagementId, clientId]);

  async function loadData() {
    setLoading(true);
    try {
      // Load job actions (user_actions for this engagement)
      const actionsRes = await fetch('/api/user/outstanding-actions');
      if (actionsRes.ok) {
        const data = await actionsRes.json();
        // Filter to this engagement
        setJobActions((data.actions || []).filter((a: Action & { engagementId?: string }) =>
          a.engagementId === engagementId || !a.engagementId
        ));
      }

      // Load client portal requests (outstanding items sent to the client)
      const portalRes = await fetch(`/api/portal/requests?clientId=${clientId}&status=pending`);
      if (portalRes.ok) {
        const data = await portalRes.json();
        setClientRequests(data.requests || []);
      }
    } catch (err) {
      console.error('Failed to load outstanding data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(actionId: string, selectedData: any) {
    setResolving(actionId);
    try {
      const res = await fetch(`/api/user/outstanding-actions/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedData }),
      });
      if (res.ok) {
        setJobActions(jobActions.filter(a => a.id !== actionId));
      }
    } finally {
      setResolving(null);
    }
  }

  async function handleDismiss(actionId: string) {
    if (!confirm('Dismiss this action?')) return;
    const res = await fetch(`/api/user/outstanding-actions/${actionId}`, { method: 'DELETE' });
    if (res.ok) setJobActions(jobActions.filter(a => a.id !== actionId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" />
        <span className="text-sm text-slate-500">Loading outstanding items...</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* LEFT: Job Outstanding Actions (actionable by the audit team user) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Job Actions</h3>
          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
            jobActions.length === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {jobActions.length}
          </span>
        </div>

        {jobActions.length === 0 ? (
          <div className="border rounded-lg p-8 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
            <p className="text-sm text-slate-500">No outstanding job actions</p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobActions.map(action => (
              <div key={action.id} className="border rounded-lg bg-white p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    {TYPE_ICONS[action.type] || <AlertCircle className="h-3.5 w-3.5 text-slate-400" />}
                    <div>
                      <p className="text-xs font-medium text-slate-800">{action.title}</p>
                      {action.description && <p className="text-[10px] text-slate-500">{action.description}</p>}
                      <span className="text-[10px] text-slate-400">{formatDate(action.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                      className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium"
                    >
                      {expandedAction === action.id ? 'Hide' : 'Action'}
                    </button>
                    <button onClick={() => handleDismiss(action.id)} className="p-0.5 hover:bg-red-50 rounded">
                      <X className="h-3 w-3 text-slate-400" />
                    </button>
                  </div>
                </div>

                {/* Land Registry selection */}
                {expandedAction === action.id && action.type === 'land_registry_selection' && action.data?.results && (
                  <div className="mt-2 border-t pt-2 space-y-1.5">
                    <p className="text-[10px] font-medium text-slate-600">Select the correct property:</p>
                    {(action.data.results as any[]).map((result: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded border text-xs hover:border-blue-300">
                        <div>
                          <span className="font-medium text-slate-800">
                            {result.address?.paon} {result.address?.street}, {result.address?.town}
                          </span>
                          <span className="text-slate-400 ml-1">{result.address?.postcode}</span>
                          {result.pricePaid != null && (
                            <span className="ml-2 font-medium text-blue-600">{formatCurrency(result.pricePaid)}</span>
                          )}
                          {result.transactionDate && (
                            <span className="ml-1 text-slate-500">{formatDate(result.transactionDate)}</span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleResolve(action.id, result)}
                          disabled={resolving === action.id}
                        >
                          {resolving === action.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Select'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: Client Outstanding Actions (requests sent to client portal) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Client Requests</h3>
          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
            clientRequests.length === 0 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
          }`}>
            {clientRequests.length}
          </span>
        </div>

        {clientRequests.length === 0 ? (
          <div className="border rounded-lg p-8 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
            <p className="text-sm text-slate-500">No outstanding client requests</p>
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {/* Header */}
            <div className="grid grid-cols-[1fr,auto,auto] gap-2 px-3 py-2 bg-slate-50 text-[10px] font-semibold text-slate-500 uppercase">
              <span>Request</span>
              <span className="w-20 text-center">Requested</span>
              <span className="w-16 text-center">Days</span>
            </div>
            {clientRequests.map(req => {
              const days = daysSince(req.requestedAt);
              return (
                <div key={req.id} className="grid grid-cols-[1fr,auto,auto] gap-2 px-3 py-2 items-center hover:bg-slate-50">
                  <div>
                    <p className="text-xs text-slate-800">{req.description}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{req.category}</span>
                      <span className="text-[10px] text-slate-400">by {req.requestedBy}</span>
                    </div>
                  </div>
                  <span className="w-20 text-center text-[10px] text-slate-500">{formatDate(req.requestedAt)}</span>
                  <span className={`w-16 text-center text-[10px] font-bold ${
                    days > 14 ? 'text-red-600' : days > 7 ? 'text-orange-600' : 'text-slate-600'
                  }`}>
                    {days}d
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
