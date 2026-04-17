'use client';

import { useState } from 'react';

/**
 * Per-sample rows with Red/Orange/Green markers. Dots are editable:
 * clicking one calls the sample-markers PATCH endpoint with the chosen
 * colour, capturing user/timestamp for the override. Other columns are
 * read-only — the reason and calc JSON explain *why* the handler
 * reached the decision it did.
 */

export interface SampleMarker {
  id: string;
  executionId: string;
  stepIndex: number;
  sampleItemRef: string;
  colour: 'red' | 'orange' | 'green';
  reason: string;
  markerType: string | null;
  calcJson: Record<string, any> | null;
  overriddenBy: string | null;
  overriddenByName: string | null;
  overriddenAt: string | null;
  overrideReason: string | null;
  originalColour: string | null;
}

interface Props {
  engagementId: string;
  executionId: string;
  markers: SampleMarker[];
  onMarkersChanged: () => void;
}

const DOT_BG: Record<string, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-400',
  green: 'bg-green-500',
};

function ColourDot({ active, colour, label, onClick, disabled }: { active: boolean; colour: string; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={`w-4 h-4 rounded-full transition-transform ${DOT_BG[colour]} ${active ? 'ring-2 ring-offset-1 ring-slate-700 scale-110' : 'opacity-40 hover:opacity-100'} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    />
  );
}

export function AuditVerificationSection({ engagementId, executionId, markers, onMarkersChanged }: Props) {
  const [saving, setSaving] = useState<string | null>(null);

  async function override(id: string, colour: 'red' | 'orange' | 'green') {
    setSaving(id);
    try {
      const reason = window.prompt('Reason for overriding the system marker? (optional)') || '';
      const res = await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}/sample-markers?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colour, reason }),
      });
      if (res.ok) onMarkersChanged();
    } finally {
      setSaving(null);
    }
  }

  if (markers.length === 0) {
    return (
      <div className="border rounded-lg p-3">
        <h4 className="text-[10px] font-bold text-green-700 uppercase tracking-wider mb-2">Audit Verification</h4>
        <div className="text-[11px] text-slate-400 italic">No verification results yet. Once the Verify Sample step runs, each sample item will appear here with a Red / Orange / Green marker.</div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <div className="bg-green-50 px-3 py-2 border-b flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Audit Verification</h4>
        <div className="flex items-center gap-2 text-[10px] text-slate-600">
          <span><strong className="text-green-700">{markers.filter(m => m.colour === 'green').length}</strong> Green</span>
          <span><strong className="text-orange-600">{markers.filter(m => m.colour === 'orange').length}</strong> Orange</span>
          <span><strong className="text-red-600">{markers.filter(m => m.colour === 'red').length}</strong> Red</span>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {markers.map(m => (
          <div key={m.id} className="px-3 py-2">
            <div className="flex items-start gap-3">
              <div className="flex items-center gap-1.5 pt-0.5">
                {(['red', 'orange', 'green'] as const).map(c => (
                  <ColourDot
                    key={c}
                    colour={c}
                    active={m.colour === c}
                    label={c}
                    disabled={saving === m.id}
                    onClick={() => override(m.id, c)}
                  />
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono">{m.sampleItemRef}</code>
                  {m.markerType && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      m.colour === 'red' ? 'bg-red-100 text-red-700' :
                      m.colour === 'orange' ? 'bg-orange-100 text-orange-700' :
                      'bg-green-100 text-green-700'
                    }`}>{m.markerType}</span>
                  )}
                  {m.overriddenAt && (
                    <span className="text-[9px] text-slate-500 italic">
                      overridden by {m.overriddenByName} on {new Date(m.overriddenAt).toLocaleDateString()}
                      {m.originalColour && ` (was ${m.originalColour})`}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">{m.reason}</div>
                {m.calcJson && Object.keys(m.calcJson).length > 0 && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600">Show calculation</summary>
                    <pre className="text-[10px] bg-slate-50 p-2 mt-1 rounded border overflow-x-auto">{JSON.stringify(m.calcJson, null, 2)}</pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
