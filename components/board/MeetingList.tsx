'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/board/StatusBadge';
import { NewMeetingDialog } from '@/components/board/NewMeetingDialog';
import { formatDate } from '@/lib/utils';

interface Meeting {
  id: string;
  title: string;
  date: string | null;
  status: string;
  actionCount: number;
}

interface MeetingListProps {
  statusFilter?: string[];
}

function linkForMeeting(meeting: Meeting): string {
  switch (meeting.status) {
    case 'draft':
    case 'scheduled':
      return `/tools/board/prepare/${meeting.id}`;
    case 'in_progress':
      return `/tools/board/present/${meeting.id}`;
    case 'completed':
    case 'approved':
    case 'archived':
      return `/tools/board/historic/${meeting.id}`;
    default:
      return `/tools/board/prepare/${meeting.id}`;
  }
}

export function MeetingList({ statusFilter }: MeetingListProps) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter.length > 0) {
        statusFilter.forEach((s) => params.append('status', s));
      }
      const res = await fetch(`/api/board/meetings?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load meetings');
      const data = await res.json();
      setMeetings(data.meetings || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Meetings</h2>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Meeting
        </Button>
      </div>

      {showNew && (
        <NewMeetingDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            fetchMeetings();
          }}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading meetings...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && meetings.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">No meetings found.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create your first meeting
          </Button>
        </div>
      )}

      {!loading && !error && meetings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-medium text-slate-500">Title</th>
                <th className="text-left py-3 px-4 font-medium text-slate-500">Date</th>
                <th className="text-left py-3 px-4 font-medium text-slate-500">Status</th>
                <th className="text-center py-3 px-4 font-medium text-slate-500">Actions</th>
                <th className="text-right py-3 px-4 font-medium text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((meeting) => (
                <tr key={meeting.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-900">{meeting.title}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {meeting.date ? formatDate(meeting.date) : <span className="text-slate-400">No date</span>}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={meeting.status} />
                  </td>
                  <td className="py-3 px-4 text-center text-slate-600">{meeting.actionCount}</td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      href={linkForMeeting(meeting)}
                      className="inline-flex items-center text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
