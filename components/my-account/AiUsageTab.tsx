'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';

interface ClientUsage {
  clientId: string;
  clientName: string;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface FirmSummary {
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ActionSummary {
  action: string;
  calls: number;
  estimatedCostUsd: number;
}

interface ModelSummary {
  model: string;
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ClientDetailAction {
  action: string;
  operation: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ClientDetailModel {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ClientDetail {
  summary: FirmSummary;
  byAction: ClientDetailAction[];
  byModel: ClientDetailModel[];
  recentRecords: {
    id: string;
    action: string;
    model: string;
    operation: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    createdAt: string;
  }[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatGbp(usd: number): string {
  const gbp = usd * 0.79;
  if (gbp < 0.01) return `£${gbp.toFixed(6)}`;
  if (gbp < 1) return `£${gbp.toFixed(4)}`;
  return `£${gbp.toFixed(2)}`;
}

type Period = 'all' | 'month' | 'week';

export function AiUsageTab() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('all');
  const [firmSummary, setFirmSummary] = useState<FirmSummary | null>(null);
  const [clients, setClients] = useState<ClientUsage[]>([]);
  const [byAction, setByAction] = useState<ActionSummary[]>([]);
  const [byModel, setByModel] = useState<ModelSummary[]>([]);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-usage?period=${p}`);
      if (!res.ok) return;
      const data = await res.json();
      setFirmSummary(data.firmSummary);
      setClients(data.clients || []);
      setByAction(data.byAction || []);
      setByModel(data.byModel || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(period); }, [period, fetchData]);

  async function toggleClient(clientId: string) {
    if (expandedClient === clientId) {
      setExpandedClient(null);
      setClientDetail(null);
      return;
    }
    setExpandedClient(clientId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/ai-usage?clientId=${clientId}&period=${period}`);
      if (res.ok) {
        const data = await res.json();
        setClientDetail(data);
      }
    } catch { /* non-fatal */ }
    setLoadingDetail(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-800">AI Usage & Costs</h2>
        </div>
        <div className="flex gap-1">
          {(['week', 'month', 'all'] as Period[]).map(p => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              className="text-xs h-7"
              onClick={() => setPeriod(p)}
            >
              {p === 'week' ? '7 days' : p === 'month' ? '30 days' : 'All time'}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : !firmSummary || firmSummary.totalCalls === 0 ? (
        <div className="text-center py-12 text-sm text-slate-400">
          No AI usage recorded yet. Costs will appear here once documents are extracted.
        </div>
      ) : (
        <>
          {/* Firm-wide summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Total AI Calls" value={firmSummary.totalCalls.toLocaleString()} />
            <SummaryCard label="Input Tokens" value={formatTokens(firmSummary.promptTokens)} />
            <SummaryCard label="Output Tokens" value={formatTokens(firmSummary.completionTokens)} />
            <SummaryCard
              label="Estimated Cost"
              value={formatCost(firmSummary.estimatedCostUsd)}
              subValue={formatGbp(firmSummary.estimatedCostUsd)}
            />
          </div>

          {/* Action + Model summary */}
          {(byAction.length > 0 || byModel.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {byAction.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">By Action</h3>
                  <div className="space-y-1.5">
                    {byAction.map(a => (
                      <div key={a.action} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-2">
                        <div>
                          <span className="text-sm font-medium text-slate-800">{a.action}</span>
                          <span className="text-xs text-slate-400 ml-2">{a.calls.toLocaleString()} calls</span>
                        </div>
                        <span className="text-sm font-bold text-slate-800">{formatCost(a.estimatedCostUsd)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {byModel.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">By Model</h3>
                  <div className="space-y-1.5">
                    {byModel.map(m => (
                      <div key={m.model} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-2">
                        <div>
                          <span className="text-sm font-medium text-slate-800 font-mono">{m.model}</span>
                          <span className="text-xs text-slate-400 ml-2">{m.calls.toLocaleString()} calls · {formatTokens(m.totalTokens)} tokens</span>
                        </div>
                        <span className="text-sm font-bold text-slate-800">{formatCost(m.estimatedCostUsd)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-client breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Breakdown by Client</h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Client</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">Calls</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide hidden md:table-cell">Tokens</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">Cost (USD)</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">Cost (GBP)</th>
                    <th className="px-4 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <ClientRow
                      key={c.clientId}
                      client={c}
                      isExpanded={expandedClient === c.clientId}
                      detail={expandedClient === c.clientId ? clientDetail : null}
                      loadingDetail={expandedClient === c.clientId && loadingDetail}
                      onToggle={() => toggleClient(c.clientId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, subValue }: { label: string; value: string; subValue?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-800">{value}</div>
      {subValue && <div className="text-xs text-slate-400 mt-0.5">≈ {subValue}</div>}
    </div>
  );
}

function ClientRow({
  client, isExpanded, detail, loadingDetail, onToggle,
}: {
  client: ClientUsage;
  isExpanded: boolean;
  detail: ClientDetail | null;
  loadingDetail: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3 font-medium text-slate-800">{client.clientName}</td>
        <td className="px-4 py-3 text-right text-slate-600">{client.totalCalls.toLocaleString()}</td>
        <td className="px-4 py-3 text-right text-slate-600 hidden md:table-cell">{formatTokens(client.totalTokens)}</td>
        <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCost(client.estimatedCostUsd)}</td>
        <td className="px-4 py-3 text-right text-slate-500">{formatGbp(client.estimatedCostUsd)}</td>
        <td className="px-4 py-3 text-center">
          {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-3">
            {loadingDetail ? (
              <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading details...
              </div>
            ) : detail ? (
              <div className="space-y-3">
                {/* Action + Operation breakdown */}
                {detail.byAction.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1.5">By Action & Operation</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detail.byAction.map(a => (
                        <div key={`${a.action}-${a.operation}`} className="bg-white border border-slate-200 rounded px-3 py-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-slate-700">{a.action}</span>
                            <span className="text-xs font-bold text-slate-800">{formatCost(a.estimatedCostUsd)}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            <span className="capitalize">{a.operation}</span> · {a.calls} calls · {formatTokens(a.promptTokens)} in · {formatTokens(a.completionTokens)} out
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Model breakdown */}
                {detail.byModel.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1.5">By Model</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detail.byModel.map(m => (
                        <div key={m.model} className="bg-white border border-slate-200 rounded px-3 py-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-slate-700 font-mono">{m.model}</span>
                            <span className="text-xs font-bold text-slate-800">{formatCost(m.estimatedCostUsd)}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {m.calls} calls · {formatTokens(m.totalTokens)} tokens
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent records */}
                {detail.recentRecords.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1.5">Recent Activity (last {detail.recentRecords.length})</div>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="text-left py-1 pr-2">Time</th>
                            <th className="text-left py-1 pr-2">Action</th>
                            <th className="text-left py-1 pr-2">Model</th>
                            <th className="text-left py-1 pr-2">Operation</th>
                            <th className="text-right py-1 pr-2">In</th>
                            <th className="text-right py-1 pr-2">Out</th>
                            <th className="text-right py-1">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.recentRecords.map(r => (
                            <tr key={r.id} className="border-t border-slate-100">
                              <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">
                                {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-1 pr-2 text-slate-700 whitespace-nowrap">{r.action}</td>
                              <td className="py-1 pr-2 text-slate-500 font-mono whitespace-nowrap">{r.model}</td>
                              <td className="py-1 pr-2 capitalize text-slate-500">{r.operation}</td>
                              <td className="py-1 pr-2 text-right text-slate-500">{formatTokens(r.promptTokens)}</td>
                              <td className="py-1 pr-2 text-right text-slate-500">{formatTokens(r.completionTokens)}</td>
                              <td className="py-1 text-right font-medium text-slate-700">{formatCost(r.estimatedCostUsd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-400 py-2">No details available</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
