'use client';

/**
 * Reusable P/R/RI sign-off dot row.
 *
 * Used everywhere on Communication (overall tab, sub-tab, and per-record rows)
 * and by anywhere else that wants the same look. Drive it with a `signOffs`
 * record (keyed by role → { userId, userName, timestamp }) and an onToggle
 * callback. canUserSign is evaluated here from team + current user.
 */

import { CheckCircle2 } from 'lucide-react';
import { canUserSign, roleNotAllowedTooltip, roleLabel, type TeamMemberLite } from '@/lib/sign-off-helpers';

interface SignOffRecord {
  userId?: string;
  userName?: string;
  timestamp?: string;
}

interface Props {
  signOffs: Record<string, SignOffRecord | undefined>;
  teamMembers: TeamMemberLite[] | undefined;
  currentUserId: string | undefined;
  onToggle: (role: string) => void;
  /** Which roles to render (defaults to preparer/reviewer/ri — EQR is opt-in) */
  roles?: string[];
  /** Compact variant — smaller dots, used in grey sub-tab bars / row headers */
  size?: 'sm' | 'md';
  /** Optional label above the row (e.g. "Overall") */
  label?: string;
  /** Stack labels under each dot (md default) or hide them (compact) */
  hideRoleLabels?: boolean;
}

export function SignOffDots({
  signOffs,
  teamMembers,
  currentUserId,
  onToggle,
  roles = ['preparer', 'reviewer', 'ri'],
  size = 'md',
  label,
  hideRoleLabels = false,
}: Props) {
  const dotSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
  const checkSize = size === 'sm' ? 'h-2 w-2' : 'h-3 w-3';
  const gap = size === 'sm' ? 'gap-3' : 'gap-6';

  return (
    <div className="flex flex-col items-center">
      {label && <span className="text-[9px] text-slate-400 mb-0.5 uppercase tracking-wide">{label}</span>}
      <div className={`flex items-center ${gap}`}>
        {roles.map(role => {
          const so = signOffs[role];
          const isSigned = !!so?.timestamp;
          const canSign = canUserSign(role, currentUserId, teamMembers);
          const dateStr = so?.timestamp ? new Date(so.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
          return (
            <div key={role} className="flex flex-col items-center gap-0.5">
              <button
                onClick={e => { e.stopPropagation(); if (canSign) onToggle(role); }}
                disabled={!canSign && !isSigned}
                className={`${dotSize} rounded-full border-2 transition-colors flex items-center justify-center ${
                  isSigned
                    ? 'bg-green-500 border-green-500'
                    : canSign
                      ? 'border-green-400 hover:bg-green-50 cursor-pointer'
                      : 'border-slate-200 cursor-not-allowed opacity-50'
                }`}
                title={
                  isSigned ? `${so?.userName || ''} — ${dateStr}` :
                  canSign ? `Sign as ${roleLabel(role)}` :
                  roleNotAllowedTooltip(role)
                }
              >
                {isSigned && <CheckCircle2 className={`${checkSize} text-white`} />}
              </button>
              {!hideRoleLabels && (
                <span className="text-[7px] text-slate-500 font-medium">{roleLabel(role)}</span>
              )}
              {!hideRoleLabels && isSigned && <span className="text-[6px] text-green-600 max-w-[60px] truncate">{so?.userName}</span>}
              {!hideRoleLabels && isSigned && dateStr && <span className="text-[6px] text-slate-400">{dateStr}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
