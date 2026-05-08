'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/utils';

interface ActionItem {
  id: string;
  description: string;
  type: 'action' | 'decision';
  assignee: string | null;
  dueDate: string | null;
  status: string;
}

interface ActionTrackerProps {
  meetingId?: string;
  showAll?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  action: 'bg-blue-100 text-blue-700',
  decision: 'bg-purple-100 text-purple-700',
};

const STATUS_OPTIONS = ['open', 'in_progress', 'completed', 'cancelled'];

export function ActionTracker({ meetingId, showAll }: ActionTrackerProps) {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newAction, setNewAction] = useState({
    description: '',
    type: 'action' as 'action' | 'decision',
    assignee: '',
    dueDate: '',
  });

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url: string;
      if (showAll) {
        url = '/api/board/actions?status=open';
      } else if (meetingId) {
        url = `/api/board/meetings/${meetingId}/actions`;
      } else {
        setLoading(false);
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load actions');
      const data = await res.json();
      setActions(data.actions || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [meetingId, showAll]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  async function handleAddAction() {
    if (!newAction.description.trim()) return;
    try {
      const url = meetingId
        ? `/api/board/meetings/${meetingId}/actions`
        : '/api/board/actions';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newAction.description.trim(),
          type: newAction.type,
          assignee: newAction.assignee.trim() || null,
          dueDate: newAction.dueDate || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to add action');
      setNewAction({ description: '', type: 'action', assignee: '', dueDate: '' });
      setShowAddRow(false);
      await fetchActions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add action');
    }
  }

  async function handleStatusChange(actionId: string, newStatus: string) {
    try {
      const url = meetingId
        ? `/api/board/meetings/${meetingId}/actions/${actionId}`
        : `/api/board/actions/${actionId}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchActions();
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="flex items-center text-sm text-slate-400 py-4">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading actions...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-700">
          Actions & Decisions
          {actions.length > 0 && (
            <span className="text-xs text-slate-400 ml-1">({actions.length})</span>
          )}
        </h4>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowAddRow(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs">Description</th>
              <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs w-20">Type</th>
              <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs w-28">Assignee</th>
              <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs w-28">Due Date</th>
              <th className="text-left py-2 px-3 font-medium text-slate-500 text-xs w-28">Status</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => (
              <tr key={action.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 px-3 text-slate-800">{action.description}</td>
                <td className="py-2 px-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[action.type] || 'bg-slate-100 text-slate-600'}`}>
                    {action.type}
                  </span>
                </td>
                <td className="py-2 px-3 text-slate-600">{action.assignee || '—'}</td>
                <td className="py-2 px-3 text-slate-600">
                  {action.dueDate ? formatDate(action.dueDate) : '—'}
                </td>
                <td className="py-2 px-3">
                  <select
                    value={action.status}
                    onChange={(e) => handleStatusChange(action.id, e.target.value)}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}

            {/* Inline add row */}
            {showAddRow && (
              <tr className="border-b border-blue-100 bg-blue-50/30">
                <td className="py-2 px-3">
                  <Input
                    className="h-7 text-sm"
                    placeholder="Description..."
                    value={newAction.description}
                    onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddAction();
                      if (e.key === 'Escape') setShowAddRow(false);
                    }}
                    autoFocus
                  />
                </td>
                <td className="py-2 px-3">
                  <select
                    value={newAction.type}
                    onChange={(e) => setNewAction({ ...newAction, type: e.target.value as 'action' | 'decision' })}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white h-7"
                  >
                    <option value="action">action</option>
                    <option value="decision">decision</option>
                  </select>
                </td>
                <td className="py-2 px-3">
                  <Input
                    className="h-7 text-sm"
                    placeholder="Assignee"
                    value={newAction.assignee}
                    onChange={(e) => setNewAction({ ...newAction, assignee: e.target.value })}
                  />
                </td>
                <td className="py-2 px-3">
                  <Input
                    type="date"
                    className="h-7 text-sm"
                    value={newAction.dueDate}
                    onChange={(e) => setNewAction({ ...newAction, dueDate: e.target.value })}
                  />
                </td>
                <td className="py-2 px-3">
                  <div className="flex gap-1">
                    <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddAction}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2"
                      onClick={() => setShowAddRow(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {actions.length === 0 && !showAddRow && (
          <p className="text-sm text-slate-400 py-4 text-center">No actions or decisions recorded.</p>
        )}
      </div>
    </div>
  );
}
