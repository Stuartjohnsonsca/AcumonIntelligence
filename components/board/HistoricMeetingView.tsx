'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar, MapPin, FileText, Paperclip, Loader2 } from 'lucide-react';
import { StatusBadge } from '@/components/board/StatusBadge';
import { AttendanceRegister } from '@/components/board/AttendanceRegister';
import { ApprovalPanel } from '@/components/board/ApprovalPanel';
import { ActionTracker } from '@/components/board/ActionTracker';
import { formatDate } from '@/lib/utils';

interface Meeting {
  id: string;
  title: string;
  date: string | null;
  location: string | null;
  status: string;
}

interface AgendaItemWithDetails {
  id: string;
  title: string;
  sortOrder: number;
  parentId: string | null;
  notes: string | null;
  attachments: {
    id: string;
    filename: string;
    downloadUrl: string;
  }[];
  actions: {
    id: string;
    description: string;
    type: string;
    assignee: string | null;
    status: string;
  }[];
  children: AgendaItemWithDetails[];
}

interface HistoricMeetingViewProps {
  meetingId: string;
}

export function HistoricMeetingView({ meetingId }: HistoricMeetingViewProps) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItemWithDetails[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [meetingRes, agendaRes] = await Promise.all([
        fetch(`/api/board/meetings/${meetingId}`),
        fetch(`/api/board/meetings/${meetingId}/agenda?includeDetails=true`),
      ]);
      if (!meetingRes.ok) throw new Error('Failed to load meeting');
      if (!agendaRes.ok) throw new Error('Failed to load agenda');

      const meetingData = await meetingRes.json();
      const agendaData = await agendaRes.json();
      setMeeting(meetingData.meeting);
      setAgendaItems(agendaData.items || []);
      setUserRoles(meetingData.userRoles || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function renderAgendaItem(item: AgendaItemWithDetails, depth: number) {
    return (
      <div key={item.id} className="space-y-2">
        <div
          className="border-b border-slate-100 pb-3"
          style={{ marginLeft: `${depth * 24}px` }}
        >
          <h4
            className={`font-medium text-slate-800 ${depth === 0 ? 'text-base' : 'text-sm'}`}
          >
            {item.title}
          </h4>

          {item.notes && (
            <div className="mt-2 flex items-start gap-2">
              <FileText className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{item.notes}</p>
            </div>
          )}

          {item.attachments && item.attachments.length > 0 && (
            <div className="mt-2 flex items-start gap-2">
              <Paperclip className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex flex-wrap gap-2">
                {item.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    {att.filename}
                  </a>
                ))}
              </div>
            </div>
          )}

          {item.actions && item.actions.length > 0 && (
            <div className="mt-2 space-y-1">
              {item.actions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center gap-2 text-sm text-slate-600"
                >
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      action.type === 'decision'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {action.type}
                  </span>
                  <span>{action.description}</span>
                  {action.assignee && (
                    <span className="text-slate-400">({action.assignee})</span>
                  )}
                  <span
                    className={`text-xs ${
                      action.status === 'completed'
                        ? 'text-green-600'
                        : action.status === 'open'
                        ? 'text-amber-600'
                        : 'text-slate-400'
                    }`}
                  >
                    {action.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {item.children &&
          item.children.map((child) => renderAgendaItem(child, depth + 1))}
      </div>
    );
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
        <Link
          href="/tools/board/historic"
          className="text-sm text-blue-600 hover:underline mt-4 inline-block"
        >
          Back to meetings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-start gap-3 pb-4 border-b border-slate-200">
        <Link
          href="/tools/board/historic"
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

      {/* Attendance */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <AttendanceRegister meetingId={meetingId} readOnly />
      </div>

      {/* Agenda items with notes, attachments, actions */}
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Minutes</h3>
        {agendaItems.length === 0 ? (
          <p className="text-sm text-slate-400">No agenda items recorded.</p>
        ) : (
          agendaItems.map((item) => renderAgendaItem(item, 0))
        )}
      </div>

      {/* All actions */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <ActionTracker meetingId={meetingId} />
      </div>

      {/* Approval panel */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <ApprovalPanel meetingId={meetingId} userRoles={userRoles} />
      </div>
    </div>
  );
}
