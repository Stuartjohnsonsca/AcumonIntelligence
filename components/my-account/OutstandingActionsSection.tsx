'use client';

import { useState, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, MapPin, FileCheck, MessageSquare,
  CheckCircle2, Loader2, X, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Action {
  id: string;
  type: string;
  title: string;
  description: string;
  engagementId: string | null;
  engagementContext: {
    clientName: string;
    auditType: string;
    periodEnd: string;
  } | null;
  data: any;
  createdAt: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  land_registry_selection: <MapPin className="h-4 w-4 text-blue-500" />,
  evidence_verification: <FileCheck className="h-4 w-4 text-orange-500" />,
  portal_response: <MessageSquare className="h-4 w-4 text-green-500" />,
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount);
}

export function OutstandingActionsSection() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  useEffect(() => {
    loadActions();
  }, []);

  async function loadActions() {
    try {
      const res = await fetch('/api/user/outstanding-actions');
      if (res.ok) {
        const data = await res.json();
        setActions(data.actions || []);
      }
    } catch (err) {
      console.error('Failed to load outstanding actions:', err);
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
        setActions(actions.filter(a => a.id !== actionId));
      }
    } finally {
      setResolving(null);
    }
  }

  async function handleDismiss(actionId: string) {
    if (!confirm('Dismiss this action? It will be removed from your list.')) return;
    const res = await fetch(`/api/user/outstanding-actions/${actionId}`, { method: 'DELETE' });
    if (res.ok) {
      setActions(actions.filter(a => a.id !== actionId));
    }
  }

  if (loading) return null;
  if (actions.length === 0) return null;

  // Group by engagement
  const grouped = new Map<string, Action[]>();
  for (const action of actions) {
    const key = action.engagementContext
      ? `${action.engagementContext.clientName} — ${action.engagementContext.auditType} (${action.engagementContext.periodEnd})`
      : 'General';
    const list = grouped.get(key) || [];
    list.push(action);
    grouped.set(key, list);
  }

  return (
    <div className="mb-6 border-2 border-green-200 bg-green-50 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-green-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold">
            {actions.length}
          </span>
          <span className="text-sm font-semibold text-green-800">Outstanding Actions</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-green-600" /> : <ChevronDown className="h-4 w-4 text-green-600" />}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {Array.from(grouped.entries()).map(([groupLabel, groupActions]) => (
            <div key={groupLabel}>
              <div className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1.5 mt-2">
                {groupLabel}
              </div>
              <div className="space-y-2">
                {groupActions.map(action => (
                  <div key={action.id} className="bg-white rounded-lg border border-green-200 p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2">
                        {TYPE_ICONS[action.type] || <FileCheck className="h-4 w-4 text-slate-400" />}
                        <div>
                          <p className="text-sm font-medium text-slate-800">{action.title}</p>
                          {action.description && <p className="text-xs text-slate-500 mt-0.5">{action.description}</p>}
                          <span className="text-[10px] text-slate-400">{formatDate(action.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                          className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 font-medium"
                        >
                          {expandedAction === action.id ? 'Collapse' : 'Review'}
                        </button>
                        <button
                          onClick={() => handleDismiss(action.id)}
                          className="p-1 hover:bg-red-50 rounded"
                          title="Dismiss"
                        >
                          <X className="h-3 w-3 text-slate-400" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded: show selectable data */}
                    {expandedAction === action.id && action.type === 'land_registry_selection' && action.data?.results && (
                      <div className="mt-3 border-t pt-3 space-y-2">
                        <p className="text-xs font-medium text-slate-600 mb-2">Select the correct property:</p>
                        {(action.data.results as any[]).map((result: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2 bg-slate-50 rounded-md border hover:border-blue-300 transition-colors"
                          >
                            <div className="text-xs">
                              <span className="font-medium text-slate-800">
                                {result.address?.paon} {result.address?.street}, {result.address?.town}
                              </span>
                              <span className="text-slate-400 ml-2">{result.address?.postcode}</span>
                              <div className="text-slate-500 mt-0.5">
                                {result.pricePaid != null && (
                                  <span className="font-medium text-blue-600">{formatCurrency(result.pricePaid)}</span>
                                )}
                                {result.transactionDate && (
                                  <span className="ml-2">{formatDate(result.transactionDate)}</span>
                                )}
                                {result.propertyType && (
                                  <span className="ml-2 text-slate-400">{result.propertyType}</span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleResolve(action.id, result)}
                              disabled={resolving === action.id}
                            >
                              {resolving === action.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                              )}
                              Select
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Generic action: Go to link */}
                    {expandedAction === action.id && action.type !== 'land_registry_selection' && action.engagementId && (
                      <div className="mt-3 border-t pt-3">
                        <a
                          href={`/methodology/sme-audit?engagementId=${action.engagementId}`}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          <ExternalLink className="h-3 w-3" /> Go to Engagement
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
