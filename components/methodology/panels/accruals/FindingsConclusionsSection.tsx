'use client';

import { useEffect, useState } from 'react';
import type { SampleMarker } from './AuditVerificationSection';

/**
 * Findings & Conclusions: the Red items from Audit Verification,
 * rendered as a schedule with Date / Description / Amount columns plus
 * two mutually-exclusive resolution buttons: Error (book to the error
 * schedule) and In TB (mark as already reflected, no materiality impact).
 *
 * Resolution state is persisted via POST to the sample-markers route,
 * which creates/updates an AuditErrorSchedule row linked by
 * sampleItemMarkerId. Selecting one clears the other server-side.
 */

interface Props {
  engagementId: string;
  executionId: string;
  redMarkers: SampleMarker[];
  onResolved: () => void;
}

interface ErrorScheduleRow {
  id: string;
  sampleItemMarkerId: string | null;
  resolution: 'error' | 'in_tb' | null;
  errorAmount: number;
  description: string;
}

export function FindingsConclusionsSection({ engagementId, executionId, redMarkers, onResolved }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, 'error' | 'in_tb' | null>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // Fetch existing error-schedule rows for this engagement so each Red
  // item can show its current resolution on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/error-schedule`).catch(() => null);
        if (!res || !res.ok) return;
        const data = await res.json();
        const rows: ErrorScheduleRow[] = Array.isArray(data.items) ? data.items : (Array.isArray(data.errorSchedule) ? data.errorSchedule : []);
        if (cancelled) return;
        const next: Record<string, 'error' | 'in_tb' | null> = {};
        for (const r of rows) {
          if (r.sampleItemMarkerId && (r.resolution === 'error' || r.resolution === 'in_tb')) {
            next[r.sampleItemMarkerId] = r.resolution;
          }
        }
        setResolutions(next);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [engagementId, redMarkers.length]);

  async function resolve(marker: SampleMarker, resolution: 'error' | 'in_tb') {
    setSaving(marker.id);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}/sample-markers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: marker.id, resolution }),
      });
      if (res.ok) {
        setResolutions(prev => ({ ...prev, [marker.id]: resolution }));
        onResolved();
      }
    } finally {
      setSaving(null);
    }
  }

  if (redMarkers.length === 0) {
    return (
      <div className="border rounded-lg p-3">
        <h4 className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-2">Findings &amp; Conclusions</h4>
        <div className="text-[11px] text-slate-400 italic">No Red items — nothing to conclude.</div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <div className="bg-amber-50 px-3 py-2 border-b flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Findings &amp; Conclusions</h4>
        <span className="text-[10px] text-slate-600">{redMarkers.length} Red item{redMarkers.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Date</th>
              <th className="text-left px-3 py-1.5 font-medium">Description</th>
              <th className="text-right px-3 py-1.5 font-medium">Amount</th>
              <th className="text-center px-3 py-1.5 font-medium w-20">Error</th>
              <th className="text-center px-3 py-1.5 font-medium w-20">In TB</th>
            </tr>
          </thead>
          <tbody>
            {redMarkers.map(m => {
              const calc = m.calcJson || {};
              const date: string = (calc as any).obligation_date || (calc as any).service_end || '';
              const amount = (calc as any).sample_amount ?? (calc as any).variance ?? null;
              const description = `${m.markerType || 'Finding'} — ${m.reason}`;
              const picked = resolutions[m.id] || null;
              return (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-700">{date || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-700 max-w-[40ch] truncate" title={description}>{description}</td>
                  <td className="px-3 py-1.5 text-slate-700 text-right">{amount != null ? Number(amount).toLocaleString() : '—'}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button
                      disabled={saving === m.id}
                      onClick={() => resolve(m, 'error')}
                      className={`inline-block w-5 h-5 rounded-full transition-all ${
                        picked === 'error' ? 'bg-red-600 ring-2 ring-red-300' : 'bg-red-200 hover:bg-red-400'
                      }`}
                      title="Book this finding to the error schedule"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button
                      disabled={saving === m.id}
                      onClick={() => resolve(m, 'in_tb')}
                      className={`inline-block w-5 h-5 rounded-full transition-all ${
                        picked === 'in_tb' ? 'bg-green-600 ring-2 ring-green-300' : 'bg-green-200 hover:bg-green-400'
                      }`}
                      title="Mark as already in TB (no error booked)"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
