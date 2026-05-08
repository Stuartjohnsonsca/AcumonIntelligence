'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, MapPin, Play, CalendarCheck, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/board/StatusBadge';
import { AgendaTree } from '@/components/board/AgendaTree';
import { NotesEditor } from '@/components/board/NotesEditor';
import { AttachmentPanel } from '@/components/board/AttachmentPanel';
import { ActionTracker } from '@/components/board/ActionTracker';
import { formatDate } from '@/lib/utils';

interface Meeting {
  id: string;
  title: string;
  date: string | null;
  location: string | null;
  status: string;
}

interface MeetingPrepareViewProps {
  meetingId: string;
}

export function MeetingPrepareView({ meetingId }: MeetingPrepareViewProps) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchMeeting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}`);
      if (!res.ok) throw new Error('Failed to load meeting');
      const data = await res.json();
      setMeeting(data.meeting);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load meeting');
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  async function handleStatusChange(newStatus: string) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update meeting');
      const data = await res.json();
      setMeeting(data.meeting);

      if (newStatus === 'in_progress') {
        router.push(`/tools/board/present/${meetingId}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdating(false);
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
        <Link href="/tools/board/prepare" className="text-sm text-blue-600 hover:underline mt-4 inline-block">
          Back to meetings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-start gap-3">
          <Link
            href="/tools/board/prepare"
            className="mt-1 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{meeting.title}</h1>
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
              <StatusBadge status={meeting.status} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {meeting.status === 'draft' && (
            <Button
              variant="outline"
              size="sm"
              disabled={updating}
              onClick={() => handleStatusChange('scheduled')}
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CalendarCheck className="h-4 w-4 mr-1" />}
              Schedule
            </Button>
          )}
          {(meeting.status === 'draft' || meeting.status === 'scheduled') && (
            <Button
              size="sm"
              disabled={updating}
              onClick={() => handleStatusChange('in_progress')}
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Start Meeting
            </Button>
          )}
        </div>
      </div>

      {/* Main workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Agenda tree */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Agenda</h3>
            <AgendaTree
              meetingId={meetingId}
              onSelectItem={setSelectedItemId}
              selectedItemId={selectedItemId}
            />
          </div>
        </div>

        {/* Right: Detail panel */}
        <div className="lg:col-span-2 space-y-4">
          {selectedItemId ? (
            <Tabs defaultValue="notes">
              <TabsList>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="attachments">Attachments</TabsTrigger>
              </TabsList>
              <TabsContent value="notes" className="mt-4">
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <NotesEditor meetingId={meetingId} agendaItemId={selectedItemId} />
                </div>
              </TabsContent>
              <TabsContent value="attachments" className="mt-4">
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <AttachmentPanel meetingId={meetingId} agendaItemId={selectedItemId} />
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-400">
              Select an agenda item to view notes and attachments.
            </div>
          )}

          {/* Meeting-level attachments */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <AttachmentPanel meetingId={meetingId} />
          </div>
        </div>
      </div>

      {/* Bottom: Actions */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <ActionTracker meetingId={meetingId} />
      </div>
    </div>
  );
}
