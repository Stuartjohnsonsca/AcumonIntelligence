'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Clock, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

interface Approval {
  userId: string;
  userName: string;
  approvedAt: string;
}

interface ApprovalPanelProps {
  meetingId: string;
  userRoles: string[];
}

const APPROVER_ROLES = ['BOARD_APPROVER', 'BOARD_ADMIN'];

export function ApprovalPanel({ meetingId, userRoles }: ApprovalPanelProps) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const canApprove = userRoles.some((r) => APPROVER_ROLES.includes(r));
  const hasApproved = currentUserId
    ? approvals.some((a) => a.userId === currentUserId)
    : false;

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/approve`);
      if (!res.ok) throw new Error('Failed to load approvals');
      const data = await res.json();
      setApprovals(data.approvals || []);
      setCurrentUserId(data.currentUserId || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/meetings/${meetingId}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to approve');
      }
      await fetchApprovals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center text-sm text-slate-400 py-4">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading approvals...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4" />
        Minute Approvals
      </h4>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}

      {approvals.length > 0 ? (
        <ul className="space-y-2">
          {approvals.map((approval) => (
            <li key={approval.userId} className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              <span className="font-medium text-slate-800">{approval.userName}</span>
              <span className="text-xs text-slate-400">
                approved {formatDate(approval.approvedAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock className="h-4 w-4" />
          No approvals yet.
        </div>
      )}

      {canApprove && !hasApproved && (
        <Button
          onClick={handleApprove}
          disabled={approving}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {approving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-1" />
          )}
          Approve Minutes
        </Button>
      )}

      {canApprove && hasApproved && (
        <p className="text-sm text-emerald-600 flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4" />
          You have approved these minutes.
        </p>
      )}
    </div>
  );
}
