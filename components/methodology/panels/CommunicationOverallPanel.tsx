'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, FileText, Users, MessageSquare } from 'lucide-react';

interface TimelineEntry {
  id: string;
  title: string;
  date: string;
  type: 'board_minutes' | 'tcwg' | 'client' | 'internal' | 'expert' | 'other';
  summary: string;
  status: string;
}

interface Props {
  engagementId: string;
  onNavigate: (subTab: string) => void;
}

const TYPE_CONFIG: Record<string, { label: string; colour: string; icon: 'file' | 'users' | 'message' }> = {
  board_minutes: { label: 'Board Minutes', colour: 'bg-indigo-100 text-indigo-700', icon: 'file' },
  tcwg: { label: 'TCWG', colour: 'bg-violet-100 text-violet-700', icon: 'file' },
  client: { label: 'Client', colour: 'bg-blue-100 text-blue-700', icon: 'users' },
  internal: { label: 'Internal', colour: 'bg-slate-200 text-slate-700', icon: 'users' },
  expert: { label: 'Expert', colour: 'bg-emerald-100 text-emerald-700', icon: 'users' },
  other: { label: 'Other', colour: 'bg-slate-100 text-slate-600', icon: 'message' },
};

const TAB_MAP: Record<string, string> = {
  board_minutes: 'board-minutes',
  tcwg: 'tcwg',
  client: 'client',
  internal: 'internal',
  expert: 'expert',
};

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

const IconForType = ({ type }: { type: string }) => {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.other;
  if (cfg.icon === 'file') return <FileText className="h-3.5 w-3.5" />;
  if (cfg.icon === 'users') return <Users className="h-3.5 w-3.5" />;
  return <MessageSquare className="h-3.5 w-3.5" />;
};

export function CommunicationOverallPanel({ engagementId, onNavigate }: Props) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      // Fetch all meetings (unfiltered) for this engagement
      const res = await fetch(`/api/engagements/${engagementId}/meetings`);
      if (!res.ok) return;
      const data = await res.json();
      const meetings = data.meetings || [];

      const timeline: TimelineEntry[] = meetings.map((m: any) => ({
        id: m.id,
        title: m.title,
        date: m.meetingDate,
        type: m.meetingType || 'other',
        summary: m.minutes?.summary || m.minutes?.headings
          ? Object.values(m.minutes?.headings || {}).filter((h: any) => h?.content).map((h: any) => h.content).join('; ').slice(0, 120)
          : '',
        status: m.minutesStatus,
      }));

      // Sort by date descending
      timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setEntries(timeline);
    } catch {}
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading communications...</div>;

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 border border-slate-200 rounded-lg">
        <MessageSquare className="h-10 w-10 mx-auto mb-3 text-slate-300" />
        <p className="text-sm text-slate-400">No communications recorded yet</p>
        <p className="text-xs text-slate-300 mt-1">Upload board minutes, TCWG documents, or record meetings in the other tabs</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-3">
        All Communications <span className="text-xs font-normal text-slate-400 ml-1">{entries.length}</span>
      </h3>
      <div className="space-y-1.5">
        {entries.map(entry => {
          const cfg = TYPE_CONFIG[entry.type] || TYPE_CONFIG.other;
          return (
            <div key={entry.id}
              className="flex items-center gap-3 px-3 py-2.5 border border-slate-200 rounded-lg hover:bg-slate-50/50 cursor-pointer transition-colors"
              onClick={() => onNavigate(TAB_MAP[entry.type] || 'overall')}>
              <span className={`text-[9px] px-2 py-0.5 rounded font-medium whitespace-nowrap ${cfg.colour}`}>
                <IconForType type={entry.type} />
              </span>
              <span className={`text-[9px] px-2 py-0.5 rounded font-medium whitespace-nowrap ${cfg.colour}`}>
                {cfg.label}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-slate-700">{entry.title}</span>
                {entry.summary && (
                  <p className="text-[10px] text-slate-400 truncate">{entry.summary}</p>
                )}
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtDate(entry.date)}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                entry.status === 'signed_off' ? 'bg-green-100 text-green-600' :
                entry.status === 'generated' ? 'bg-blue-100 text-blue-600' :
                'bg-slate-100 text-slate-500'
              }`}>{entry.status === 'generated' ? 'AI' : entry.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
