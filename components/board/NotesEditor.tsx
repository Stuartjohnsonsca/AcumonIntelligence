'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Loader2, Check } from 'lucide-react';

interface NotesEditorProps {
  meetingId: string;
  agendaItemId: string;
  initialNotes?: string;
  readOnly?: boolean;
}

export function NotesEditor({ meetingId, agendaItemId, initialNotes, readOnly }: NotesEditorProps) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!!initialNotes);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/agenda/${agendaItemId}/notes`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || '');
      }
    } catch {
      // ignore fetch errors for notes
    } finally {
      setLoaded(true);
    }
  }, [meetingId, agendaItemId]);

  useEffect(() => {
    if (!initialNotes && initialNotes !== '') {
      fetchNotes();
    }
  }, [initialNotes, fetchNotes]);

  async function saveNotes(text: string) {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/agenda/${agendaItemId}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text }),
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleChange(value: string) {
    setNotes(value);
    if (readOnly) return;

    // Debounced auto-save
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveNotes(value);
    }, 1500);
  }

  function handleBlur() {
    if (readOnly) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    saveNotes(notes);
  }

  if (!loaded) {
    return (
      <div className="flex items-center text-sm text-slate-400 py-4">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading notes...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">Notes</label>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {saving && (
            <span className="flex items-center">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Saving...
            </span>
          )}
          {saved && (
            <span className="flex items-center text-green-600">
              <Check className="h-3 w-3 mr-1" />
              Saved
            </span>
          )}
          {error && <span className="text-red-500">{error}</span>}
          {!readOnly && !saving && !saved && (
            <button
              onClick={() => saveNotes(notes)}
              className="flex items-center text-slate-400 hover:text-blue-600 transition-colors"
              title="Save now"
            >
              <Save className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <textarea
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 resize-y min-h-[120px]"
        rows={6}
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={readOnly ? 'No notes recorded.' : 'Enter notes for this agenda item...'}
        disabled={readOnly}
      />
    </div>
  );
}
