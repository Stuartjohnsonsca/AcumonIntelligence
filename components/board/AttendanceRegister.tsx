'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, UserCheck, UserX, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Attendee {
  id: string;
  name: string;
  role: string;
  present: boolean;
  arrivalTime: string | null;
}

interface AttendanceRegisterProps {
  meetingId: string;
  readOnly?: boolean;
}

export function AttendanceRegister({ meetingId, readOnly }: AttendanceRegisterProps) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newAttendee, setNewAttendee] = useState({ name: '', role: '' });

  const fetchAttendees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/attendance`);
      if (!res.ok) throw new Error('Failed to load attendance');
      const data = await res.json();
      setAttendees(data.attendees || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchAttendees();
  }, [fetchAttendees]);

  async function handleTogglePresent(attendeeId: string, present: boolean) {
    try {
      await fetch(`/api/board/meetings/${meetingId}/attendance/${attendeeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          present,
          arrivalTime: present ? new Date().toISOString() : null,
        }),
      });
      await fetchAttendees();
    } catch {
      // silently fail
    }
  }

  async function handleAddAttendee() {
    if (!newAttendee.name.trim()) return;
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAttendee.name.trim(),
          role: newAttendee.role.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to add attendee');
      setNewAttendee({ name: '', role: '' });
      setShowAddRow(false);
      await fetchAttendees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add attendee');
    }
  }

  async function handleRemoveAttendee(attendeeId: string) {
    try {
      await fetch(`/api/board/meetings/${meetingId}/attendance/${attendeeId}`, {
        method: 'DELETE',
      });
      await fetchAttendees();
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="flex items-center text-sm text-slate-400 py-4">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading attendance...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-700">
          Attendance
          {attendees.length > 0 && (
            <span className="text-xs text-slate-400 ml-1">
              ({attendees.filter((a) => a.present).length}/{attendees.length} present)
            </span>
          )}
        </h4>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowAddRow(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Attendee
          </Button>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {attendees.map((attendee) => (
          <div
            key={attendee.id}
            className={`flex items-center gap-2 p-2 rounded-md border text-sm group ${
              attendee.present
                ? 'bg-green-50 border-green-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            {!readOnly ? (
              <button
                onClick={() => handleTogglePresent(attendee.id, !attendee.present)}
                className={`p-1 rounded-md transition-colors ${
                  attendee.present
                    ? 'text-green-600 hover:bg-green-100'
                    : 'text-slate-400 hover:bg-slate-200'
                }`}
                title={attendee.present ? 'Mark absent' : 'Mark present'}
              >
                {attendee.present ? (
                  <UserCheck className="h-4 w-4" />
                ) : (
                  <UserX className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className={attendee.present ? 'text-green-600' : 'text-slate-400'}>
                {attendee.present ? (
                  <UserCheck className="h-4 w-4" />
                ) : (
                  <UserX className="h-4 w-4" />
                )}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800 truncate">{attendee.name}</p>
              {attendee.role && (
                <p className="text-xs text-slate-500 truncate">{attendee.role}</p>
              )}
            </div>
            {attendee.present && attendee.arrivalTime && (
              <span className="text-xs text-slate-400 flex-shrink-0">
                {new Date(attendee.arrivalTime).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            {!readOnly && (
              <button
                onClick={() => handleRemoveAttendee(attendee.id)}
                className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                title="Remove attendee"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}

        {/* Inline add row */}
        {showAddRow && !readOnly && (
          <div className="flex items-center gap-2 p-2 rounded-md border border-dashed border-blue-300 bg-blue-50/30">
            <Input
              className="h-7 text-sm flex-1"
              placeholder="Name"
              value={newAttendee.name}
              onChange={(e) => setNewAttendee({ ...newAttendee, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddAttendee();
                if (e.key === 'Escape') setShowAddRow(false);
              }}
              autoFocus
            />
            <Input
              className="h-7 text-sm w-24"
              placeholder="Role"
              value={newAttendee.role}
              onChange={(e) => setNewAttendee({ ...newAttendee, role: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddAttendee();
                if (e.key === 'Escape') setShowAddRow(false);
              }}
            />
            <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddAttendee}>
              Add
            </Button>
          </div>
        )}
      </div>

      {attendees.length === 0 && !showAddRow && (
        <p className="text-sm text-slate-400 text-center py-2">No attendees registered.</p>
      )}
    </div>
  );
}
