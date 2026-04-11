'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, MessageSquare, RefreshCw, AlertTriangle, Sparkles } from 'lucide-react';

/**
 * Communications — Overall sub-tab.
 *
 * Shows a consolidated position across every meeting on the engagement,
 * organised under the firm-configured "Summary of Communication Headings"
 * (default seed: Impacts Financial Statements / Going Concern / Profitability
 * / Indicated Significant Decision). Each heading is synthesised by the AI
 * from all underlying meetings and can be regenerated on demand.
 */

interface HeadingSummary {
  content: string;
  flagged: boolean;
  evidence: string[];
}

interface OverallSummary {
  headings: Record<string, HeadingSummary>;
  overallNarrative: string;
  generatedAt?: string;
  generatedBy?: string;
  meetingCount?: number;
}

interface Props {
  engagementId: string;
  onNavigate: (subTab: string) => void;
}

function fmtTimestamp(d: string) {
  try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return d; }
}

export function CommunicationOverallPanel({ engagementId, onNavigate }: Props) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [headings, setHeadings] = useState<string[]>([]);
  const [summary, setSummary] = useState<OverallSummary | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/communication`);
      if (res.ok) {
        const data = await res.json();
        setHeadings(data.headings || []);
        setSummary(data.summary || null);
        setCounts(data.counts || {});
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    }
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { load(); }, [load]);

  async function handleRegenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/communication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate_overall' }),
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to generate summary');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    setGenerating(false);
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading overall summary...</div>;

  const totalMeetings = Object.values(counts).reduce((a, b) => a + b, 0);
  const typeSummary = [
    { key: 'board_minutes', label: 'Board Minutes', tab: 'board-minutes' },
    { key: 'tcwg', label: 'TCWG', tab: 'tcwg' },
    { key: 'shareholders', label: 'Shareholders', tab: 'shareholders' },
    { key: 'client', label: 'Client', tab: 'client' },
    { key: 'internal', label: 'Internal', tab: 'internal' },
    { key: 'expert', label: 'Expert', tab: 'expert' },
  ];

  return (
    <div className="space-y-4">
      {/* Top bar — counts + regenerate */}
      <div className="flex items-center justify-between border border-slate-200 rounded-lg bg-white px-3 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-700">
            {totalMeetings} {totalMeetings === 1 ? 'meeting' : 'meetings'} on file
          </span>
          <div className="flex items-center gap-1.5">
            {typeSummary.map(t => {
              const c = counts[t.key] || 0;
              if (c === 0) return null;
              return (
                <button
                  key={t.key}
                  onClick={() => onNavigate(t.tab)}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                  title={`Open ${t.label}`}
                >
                  {t.label}: {c}
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={generating || totalMeetings === 0}
          className="text-[10px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {generating ? 'Generating...' : summary ? 'Regenerate Summary' : 'Generate Summary'}
        </button>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 rounded px-3 py-2 text-[11px] text-red-700 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* No meetings */}
      {totalMeetings === 0 && !summary && (
        <div className="text-center py-12 border border-slate-200 rounded-lg">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">No communications recorded yet</p>
          <p className="text-xs text-slate-300 mt-1">Upload board minutes, TCWG documents, or record meetings in the other sub-tabs, then come back here to generate the overall position.</p>
        </div>
      )}

      {/* No summary yet */}
      {totalMeetings > 0 && !summary && (
        <div className="border border-dashed border-blue-200 bg-blue-50/40 rounded-lg p-6 text-center">
          <Sparkles className="h-8 w-8 mx-auto mb-2 text-blue-400" />
          <p className="text-sm text-slate-700 font-medium mb-1">Ready to consolidate</p>
          <p className="text-xs text-slate-500 mb-3">
            Click <em>Generate Summary</em> above to have the AI synthesise a firm-wide Communications position
            across every meeting, organised under your firm's Summary of Communication Headings.
          </p>
          <p className="text-[10px] text-slate-400">
            Configured headings: {headings.length > 0 ? headings.join(' · ') : <em>not yet set</em>}
          </p>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="space-y-3">
          {summary.generatedAt && (
            <p className="text-[10px] text-slate-400">
              Last generated {fmtTimestamp(summary.generatedAt)}
              {summary.generatedBy && <> by {summary.generatedBy}</>}
              {summary.meetingCount !== undefined && <> · across {summary.meetingCount} meeting{summary.meetingCount === 1 ? '' : 's'}</>}
            </p>
          )}

          {/* Overall narrative */}
          {summary.overallNarrative && (
            <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-4">
              <h4 className="text-[11px] font-semibold text-blue-800 mb-1.5 uppercase tracking-wide">Overall Position</h4>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{summary.overallNarrative}</p>
            </div>
          )}

          {/* Per-heading cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {headings.map(h => {
              const entry = summary.headings[h];
              if (!entry) return null;
              const hasContent = entry.content && entry.content.trim().length > 0;
              return (
                <div
                  key={h}
                  className={`border rounded-lg p-3 ${
                    entry.flagged
                      ? 'border-amber-300 bg-amber-50/40'
                      : hasContent
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-200 bg-slate-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h5 className="text-xs font-semibold text-slate-800">{h}</h5>
                    {entry.flagged && (
                      <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium uppercase tracking-wide">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        Flagged
                      </span>
                    )}
                  </div>
                  {hasContent ? (
                    <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 italic">No material evidence across reviewed meetings.</p>
                  )}
                  {entry.evidence.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100">
                      <p className="text-[9px] text-slate-400 uppercase tracking-wide mb-1">Evidence</p>
                      <ul className="text-[10px] text-slate-500 space-y-0.5">
                        {entry.evidence.map((e, i) => (
                          <li key={i} className="pl-2 border-l border-slate-200">{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
