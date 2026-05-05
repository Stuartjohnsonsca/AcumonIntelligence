'use client';

import { useState } from 'react';
import { ShieldOff, Loader2, Check, AlertOctagon } from 'lucide-react';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';

export interface IndependenceBar {
  id: string;
  engagementId: string;
  auditType: string;
  clientId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  userId: string;
  userName: string;
  userEmail: string;
  declinedAt: string | null;
  notifiedAt: string | null;
  flaggedQuestions: Array<{ text: string; notes?: string }>;
  notes: string | null;
}

interface Props { initialBars: IndependenceBar[]; }

export function IndependenceBarsClient({ initialBars }: Props) {
  const [bars, setBars] = useState<IndependenceBar[]>(initialBars);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  async function unbar(bar: IndependenceBar) {
    const reason = (reasonById[bar.id] || '').trim();
    const confirmed = confirm(
      `Unbar ${bar.userName} for ${bar.clientName} (${formatPeriod(bar.periodStart, bar.periodEnd)})?\n\n`
      + `They will be re-prompted for the Independence questionnaire next time they open the engagement. `
      + `This action is recorded in the audit trail.`
    );
    if (!confirmed) return;
    setBusyId(bar.id);
    setError(null);
    try {
      const res = await fetch('/api/methodology-admin/independence-bars/unbar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIndependenceId: bar.id, reason: reason || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Unbar failed (${res.status})`);
        return;
      }
      setBars(prev => prev.filter(b => b.id !== bar.id));
    } catch (err: any) {
      setError(err?.message || 'Unbar failed');
    } finally {
      setBusyId(null);
    }
  }

  if (bars.length === 0) {
    return (
      <div className="border border-dashed border-slate-200 rounded-lg p-10 text-center">
        <Check className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
        <p className="text-sm text-slate-700 font-medium">No active Independence bars.</p>
        <p className="text-xs text-slate-500 mt-1">
          When a team member declares they are not independent on an engagement, they will appear here for review.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
      )}
      <div className="space-y-4">
        {bars.map(bar => (
          <div key={bar.id} className="border border-red-200 bg-white rounded-lg overflow-hidden">
            <div className="bg-red-50 px-4 py-3 border-b border-red-200 flex items-start gap-3">
              <AlertOctagon className="h-5 w-5 text-red-600 flex-none mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {bar.userName} <span className="text-slate-500 font-normal">— {bar.userEmail}</span>
                </div>
                <div className="text-xs text-slate-700 mt-0.5">
                  {bar.clientName} · {formatPeriod(bar.periodStart, bar.periodEnd)} ·{' '}
                  <span className="text-slate-500">{(AUDIT_TYPE_LABELS as Record<string, string>)[bar.auditType] || bar.auditType}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Declined {formatDate(bar.declinedAt)}
                  {bar.notifiedAt ? <> · RI/Ethics emailed {formatDate(bar.notifiedAt)}</> : null}
                </div>
              </div>
            </div>

            <div className="px-4 py-3 space-y-3">
              {bar.flaggedQuestions.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
                    Questions answered &ldquo;Yes&rdquo;
                  </div>
                  <ul className="text-xs text-slate-700 space-y-1.5">
                    {bar.flaggedQuestions.map((q, i) => (
                      <li key={i} className="border border-slate-200 rounded p-2 bg-slate-50">
                        <div className="font-medium">{q.text}</div>
                        {q.notes && <div className="text-slate-600 mt-1">{q.notes}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {bar.notes && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Submitted notes</div>
                  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-2">{bar.notes}</p>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
                  Reason for unbarring (recorded in audit trail)
                </label>
                <textarea
                  value={reasonById[bar.id] || ''}
                  onChange={e => setReasonById(prev => ({ ...prev, [bar.id]: e.target.value }))}
                  rows={2}
                  placeholder="e.g. shareholding sold and confirmed by Ethics Partner on 5 May"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => unbar(bar)}
                  disabled={busyId === bar.id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm font-medium disabled:opacity-50"
                >
                  {busyId === bar.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                  Unbar this user
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatPeriod(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleDateString('en-GB')} – ${end.toLocaleDateString('en-GB')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB');
}
