'use client';

/**
 * Shared "Rounding: [select]" dropdown used by every tab that
 * displays monetary amounts (TBCYvPY, PAR, RMM, Audit Plan,
 * Completion). The selected mode is engagement-wide via
 * `useEngagementRounding` so changing it on one tab takes effect
 * everywhere the user goes next.
 *
 * Display-only — raw values are always stored in whole pounds. The
 * mode dictates the divisor + decimal places when the tab formats a
 * value via `formatRounded(value, mode)`.
 */
import { ROUNDING_LABELS, type RoundingMode } from '@/lib/audit-rounding';
import { useEngagementRounding } from '@/hooks/useEngagementRounding';

interface Props {
  engagementId: string;
  /** Compact label / dropdown — used inside cramped headers. */
  compact?: boolean;
  /** Optional render-side override of the label; defaults to "Rounding". */
  label?: string;
}

export function RoundingDropdown({ engagementId, compact, label }: Props) {
  const { mode, setMode, options, loading } = useEngagementRounding(engagementId);
  return (
    <label className={`inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'} text-slate-500`}>
      {label ?? 'Rounding'}
      <select
        value={mode}
        onChange={e => setMode(e.target.value as RoundingMode)}
        disabled={loading}
        className={`border border-slate-200 rounded px-1.5 py-0.5 ${compact ? 'text-[11px]' : 'text-xs'} bg-white focus:outline-none focus:border-blue-400 disabled:opacity-60`}
        title="Display all amounts in this unit across every tab. Raw pounds are always stored."
      >
        {options.map(o => (
          <option key={o} value={o}>{ROUNDING_LABELS[o]}</option>
        ))}
      </select>
    </label>
  );
}
