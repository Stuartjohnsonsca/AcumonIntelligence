'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/board/StatusBadge';
import { AttendanceRegister } from '@/components/board/AttendanceRegister';
import { NotesEditor } from '@/components/board/NotesEditor';
import { ActionTracker } from '@/components/board/ActionTracker';
import { formatDate } from '@/lib/utils';

interface Meeting {
  id: string;
  title: string;
  date: string | null;
  location: string | null;
  status: string;
}

interface AgendaItem {
  id: string;
  title: string;
  sortOrder: number;
  parentId: string | null;
  children: AgendaItem[];
}

interface LiveMeetingViewProps {
  meetingId: string;
}

function flattenItems(items: AgendaItem[], depth: number = 0): { item: AgendaItem; depth: number }[] {
  const result: { item: AgendaItem; depth: number }[] = [];
  for (const item of items) {
    result.push({ item, depth });
    if (item.children && item.children.length > 0) {
      result.push(...flattenItems(item.children, depth + 1));
    }
  }
  return result;
}

export function LiveMeetingView({ meetingId }: LiveMeetingViewProps) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [attendanceExpanded, setAttendanceExpanded] = useState(true);
  const [completing, setCompleting] = useState(false);

  const flatItems = flattenItems(agendaItems);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [meetingRes, agendaRes] = await Promise.all([
        fetch(`/api/board/meetings/${meetingId}`),
        fetch(`/api/board/meetings/${meetingId}/agenda`),
      ]);
      if (!meetingRes.ok) throw new Error('Failed to load meeting');
      if (!agendaRes.ok) throw new Error('Failed to load agenda');

      const meetingData = await meetingRes.json();
      const agendaData = await agendaRes.json();
      setMeeting(meetingData.meeting);
      setAgendaItems(agendaData.items || []);

      // Auto-select first item
      const flat = flattenItems(agendaData.items || []);
      if (flat.length > 0 && !selectedItemId) {
        setSelectedItemId(flat[0].item.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [meetingId, selectedItemId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCompleteMeeting() {
    setCompleting(true);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) throw new Error('Failed to complete meeting');
      router.push(`/tools/board/historic/${meetingId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete meeting');
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading meeting...
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error || 'Meeting not found.'}
        </div>
        <Link href="/tools/board/present" className="text-sm text-blue-600 hover:underline mt-4 inline-block">
          Back to meetings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-start gap-3">
          <Link
            href="/tools/board/present"
            className="mt-1 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{meeting.title}</h1>
              <StatusBadge status={meeting.status} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
              {meeting.date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(meeting.date)}
                </span>
              )}
              {meeting.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {meeting.location}
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          disabled={completing}
          onClick={handleCompleteMeeting}
        >
          {completing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-1" />
          )}
          Complete Meeting
        </Button>
      </div>

      {/* Attendance (collapsible) */}
      <div className="bg-white rounded-lg border border-slate-200">
        <button
          onClick={() => setAttendanceExpanded(!attendanceExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span>Attendance Register</span>
          {attendanceExpanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>
        {attendanceExpanded && (
          <div className="px-4 pb-4">
            <AttendanceRegister meetingId={meetingId} />
          </div>
        )}
      </div>

      {/* Main split */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left sidebar: agenda items list */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-0.5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2">
              Agenda
            </h3>
            {flatItems.length === 0 ? (
              <p className="text-sm text-slate-400 px-2 py-2">No agenda items.</p>
            ) : (
              flatItems.map(({ item, depth }) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                    selectedItemId === item.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  style={{ paddingLeft: `${depth * 16 + 8}px` }}
                >
                  {item.title}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main area: notes + actions */}
        <div className="lg:col-span-3 space-y-4">
          {selectedItemId ? (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <NotesEditor meetingId={meetingId} agendaItemId={selectedItemId} />
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-400">
              Select an agenda item to take notes.
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <ActionTracker meetingId={meetingId} />
          </div>
        </div>
      </div>
    </div>
  );
}
