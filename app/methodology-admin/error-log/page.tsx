'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronRight, Filter } from 'lucide-react';

interface ErrorEntry {
  id: string;
  userId: string | null;
  firmId: string | null;
  engagementId: string | null;
  clientId: string | null;
  periodEnd: string | null;
  route: string | null;
  tool: string | null;
  message: string;
  stack: string | null;
  context: string | null;
  severity: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  error: 'bg-red-100 text-red-700',
  warning: 'bg-orange-100 text-orange-700',
};

export default function ErrorLogPage() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [severity, setSeverity] = useState('');
  const [resolved, setResolved] = useState('false');
  const [tool, setTool] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (severity) params.set('severity', severity);
      if (resolved) params.set('resolved', resolved);
      if (tool) params.set('tool', tool);

      const res = await fetch(`/api/methodology-admin/error-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setErrors(data.errors || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [page, severity, resolved, tool]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  async function markResolved(ids: string[]) {
    await fetch('/api/methodology-admin/error-log', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, resolved: true }),
    });
    load();
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function parseContext(ctx: string | null): Record<string, unknown> | null {
    if (!ctx) return null;
    try { return JSON.parse(ctx); } catch { return null; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Error Log</h1>
          <p className="text-xs text-slate-500">{total} error{total !== 1 ? 's' : ''} logged</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-md hover:bg-slate-50">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Filter className="h-3 w-3" /> Filters:
        </div>
        <select value={severity} onChange={e => { setSeverity(e.target.value); setPage(1); }} className="text-xs border border-slate-200 rounded px-2 py-1">
          <option value="">All Severity</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
        </select>
        <select value={resolved} onChange={e => { setResolved(e.target.value); setPage(1); }} className="text-xs border border-slate-200 rounded px-2 py-1">
          <option value="">All Status</option>
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
        </select>
        <select value={tool} onChange={e => { setTool(e.target.value); setPage(1); }} className="text-xs border border-slate-200 rounded px-2 py-1">
          <option value="">All Tools</option>
          <option value="test-execution">Test Execution</option>
          <option value="xero">Xero</option>
          <option value="azure-di">Azure DI</option>
          <option value="client-ui">Client UI</option>
          <option value="together-ai">Together AI</option>
        </select>
        {errors.some(e => !e.resolved) && (
          <button
            onClick={() => markResolved(errors.filter(e => !e.resolved).map(e => e.id))}
            className="text-xs px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100"
          >
            Resolve All Visible
          </button>
        )}
      </div>

      {/* Error table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
              <th className="px-3 py-2 text-left w-32">Time</th>
              <th className="px-2 py-2 text-center w-16">Severity</th>
              <th className="px-2 py-2 text-left w-24">Tool</th>
              <th className="px-2 py-2 text-left">Message</th>
              <th className="px-2 py-2 text-left w-20">Engagement</th>
              <th className="px-2 py-2 text-center w-16">Status</th>
              <th className="px-2 py-2 text-center w-12"></th>
            </tr>
          </thead>
          <tbody>
            {errors.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                {loading ? 'Loading...' : 'No errors found'}
              </td></tr>
            )}
            {errors.map(err => {
              const isExpanded = expandedId === err.id;
              const ctx = parseContext(err.context);
              return (
                <tr key={err.id} className={`border-b border-slate-100 hover:bg-slate-50/50 ${err.resolved ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{formatDate(err.createdAt)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[err.severity] || 'bg-slate-100 text-slate-500'}`}>
                      {err.severity === 'critical' && <XCircle className="h-2.5 w-2.5" />}
                      {err.severity === 'error' && <AlertTriangle className="h-2.5 w-2.5" />}
                      {err.severity}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600 font-medium">{err.tool || '—'}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-start gap-1">
                      <button onClick={() => setExpandedId(isExpanded ? null : err.id)} className="flex-shrink-0 mt-0.5">
                        {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                      </button>
                      <div className="min-w-0">
                        <div className="text-slate-700 truncate max-w-[400px]">{err.message}</div>
                        {isExpanded && (
                          <div className="mt-1.5 space-y-1.5">
                            {err.route && <div className="text-[10px] text-slate-400">Route: {err.route}</div>}
                            {err.stack && (
                              <pre className="text-[10px] text-red-400 bg-red-50 rounded p-2 whitespace-pre-wrap overflow-auto max-h-[150px]">{err.stack}</pre>
                            )}
                            {ctx && (
                              <pre className="text-[10px] text-slate-500 bg-slate-50 rounded p-2 whitespace-pre-wrap overflow-auto max-h-[100px]">{JSON.stringify(ctx, null, 2)}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-slate-400 font-mono text-[10px]">{err.engagementId ? err.engagementId.slice(0, 8) + '...' : '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {err.resolved ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400 mx-auto" />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {!err.resolved && (
                      <button onClick={() => markResolved([err.id])} className="text-[10px] text-green-600 hover:text-green-800 font-medium">
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Page {page} of {totalPages} ({total} total)</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 border rounded disabled:opacity-30">Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 border rounded disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
