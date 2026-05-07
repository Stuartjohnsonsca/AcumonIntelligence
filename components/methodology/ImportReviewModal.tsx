'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProposalRow } from '@/lib/import-options/types';

interface Props {
  engagementId: string;
  extractionId: string;
  /** Called once the user clicks Approve and the apply call finishes. */
  onApplied: (counts: { applied: number; skipped: number }) => void;
  /** Called when the user clicks Cancel — proposals are marked cancelled. */
  onCancelled: () => void;
}

interface ProposalApiPayload {
  id: string;
  status: string;
  sourceLabel: string | null;
  proposals: ProposalRow[];
}

const TAB_LABEL: Record<string, string> = {
  opening: 'Opening',
  'prior-period': 'Prior Period',
  'permanent-file': 'Permanent File',
  ethics: 'Ethics',
  continuance: 'Continuance',
  'new-client': 'New Client Take-On',
  materiality: 'Materiality',
  par: 'PAR',
  walkthroughs: 'Walkthroughs',
  documents: 'Documents',
  outstanding: 'Outstanding',
  communication: 'Communication',
  'tax-technical': 'Specialists',
  'subsequent-events': 'Subsequent Events',
};

export function ImportReviewModal({ engagementId, extractionId, onApplied, onCancelled }: Props) {
  const [data, setData] = useState<ProposalApiPayload | null>(null);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'apply' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/engagements/${engagementId}/import-options/proposals/${extractionId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: { proposal: ProposalApiPayload }) => {
        setData(j.proposal);
        setRows(j.proposal.proposals || []);
        const firstTab = (j.proposal.proposals || []).find(r => !r.deleted)?.destination.tabKey;
        if (firstTab) setActiveTab(firstTab);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load proposals'))
      .finally(() => setLoading(false));
  }, [engagementId, extractionId]);

  const tabsWithRows = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(r => {
      if (r.deleted) return;
      const key = r.destination.tabKey;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  function tabLabel(key: string) { return TAB_LABEL[key] || key; }

  function updateRow(id: string, patch: Partial<ProposalRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  async function handleApprove() {
    setBusy('apply');
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractionId, proposals: rows }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Apply failed (${res.status})`);
      }
      const json = await res.json();
      onApplied({ applied: json.applied || 0, skipped: json.skipped || 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!confirm('Discard all proposed mappings? Nothing will be written to the engagement.')) return;
    setBusy('cancel');
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/import-options/proposals/${extractionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Cancel failed (${res.status})`);
      }
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
      setBusy(null);
    }
  }

  const visibleRows = rows.filter(r => !r.deleted && r.destination.tabKey === activeTab);
  const totalKept = rows.filter(r => !r.deleted).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Review Proposed Imports</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {data?.sourceLabel ? `From: ${data.sourceLabel}. ` : ''}
            Edit proposed values, delete rows you don&apos;t want, then approve.
            Imported fields will be highlighted with an orange dashed surround on each tab.
          </p>
        </div>

        {error && (
          <div className="mx-6 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-slate-500 animate-pulse">Loading proposals...</div>
          </div>
        ) : (
          <>
            <div className="px-6 pt-3 border-b border-slate-200">
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {tabsWithRows.length === 0 ? (
                  <span className="text-xs text-slate-400">No proposals.</span>
                ) : (
                  tabsWithRows.map(([key, count]) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`px-3 py-1.5 text-xs rounded-t-md font-medium whitespace-nowrap ${
                        activeTab === key
                          ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {tabLabel(key)} <span className="text-slate-400">({count})</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab && (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide w-1/4">Field</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">Proposed Value</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600 uppercase tracking-wide w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(row => (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/40 align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{row.fieldLabel}</div>
                          <div
                            className="text-[10px] text-slate-400 italic mt-0.5"
                            title={row.sourceLocation}
                          >
                            From: {row.sourceLocation}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {typeof row.proposedValue === 'string' && row.proposedValue.length > 80 ? (
                            <textarea
                              value={String(row.proposedValue ?? '')}
                              onChange={e => updateRow(row.id, { proposedValue: e.target.value })}
                              rows={3}
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          ) : (
                            <input
                              type={typeof row.proposedValue === 'number' ? 'number' : 'text'}
                              value={row.proposedValue === null || row.proposedValue === undefined ? '' : String(row.proposedValue)}
                              onChange={e => {
                                const val = typeof row.proposedValue === 'number'
                                  ? (e.target.value === '' ? null : Number(e.target.value))
                                  : e.target.value;
                                updateRow(row.id, { proposedValue: val });
                              }}
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => updateRow(row.id, { deleted: true })}
                            title="Remove this row from the import"
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            🗑 Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-8 text-center text-slate-400 italic">
                          No rows in this tab.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {totalKept} row{totalKept !== 1 ? 's' : ''} will be applied.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={busy !== null}
              className="text-sm px-4 py-2 text-slate-600 hover:text-slate-800 disabled:opacity-50"
            >
              {busy === 'cancel' ? 'Cancelling...' : 'Cancel'}
            </button>
            <button
              onClick={handleApprove}
              disabled={busy !== null || totalKept === 0}
              className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {busy === 'apply' ? 'Applying...' : 'Approve & Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
