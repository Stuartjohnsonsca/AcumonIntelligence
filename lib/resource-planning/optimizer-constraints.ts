// ─── Resource Optimizer Constraint Definitions ───────────────────────────────

export interface ConstraintDef {
  id: string;
  label: string;
  description: string;
}

/** Hard constraints — never breakable, not shown in reorder UI */
export const HARD_CONSTRAINTS: ConstraintDef[] = [
  {
    id: 'no-specialist-on-team',
    label: 'No specialist on audit team',
    description:
      'A staff member assigned as Ethics, EQR, or Technical specialist on a job cannot also fill a Preparer, Reviewer, or RI role on that same job.',
  },
  {
    id: 'one-ri-per-job',
    label: 'Exactly one RI per job',
    description: 'Every job must have exactly one Responsible Individual (RI) allocation.',
  },
  {
    id: 'exact-role-hours',
    label: 'Exact budget hours per role',
    description:
      'The total hours assigned per role on a job must equal the budget hours for that role exactly.',
  },
];

/** Breakable constraints in default priority order (index 0 = highest priority / hardest to break) */
export const BREAKABLE_CONSTRAINTS: ConstraintDef[] = [
  {
    id: 'custom-completion-date',
    label: 'Meet custom completion date',
    description:
      'The job must be completed on or before its custom deadline. If no custom deadline is set, the target completion date applies.',
  },
  {
    id: 'ri-no-preparer',
    label: 'RI should not do Preparer work',
    description: 'Staff who hold the RI role should not be assigned as Preparers on the same job.',
  },
  {
    id: 'no-overtime',
    label: 'Do not exceed overtime hours',
    description:
      "Staff should not be allocated more hours than their standard weekly capacity plus any authorised overtime.",
  },
  {
    id: 'locked-jobs',
    label: 'Do not change locked jobs',
    description:
      'Allocations on jobs that have been schedule-locked should not be altered.',
  },
  {
    id: 'ri-no-reviewer',
    label: 'RI should not do Reviewer work',
    description: 'Staff who hold the RI role should not be assigned as Reviewers on the same job.',
  },
  {
    id: 'job-count-limit',
    label: 'Respect per-role job limits',
    description:
      "Staff should not be allocated to more concurrent jobs in a role than their configured job limit for that role.",
  },
  {
    id: 'reviewer-no-preparer',
    label: 'Reviewer should not do Preparer work',
    description: 'Staff who are Reviewers should not be assigned as Preparers on the same job.',
  },
  {
    id: 'standard-hours',
    label: 'Do not exceed standard hours',
    description:
      'Staff should not be allocated more hours than their standard weekly capacity (excluding overtime).',
  },
  {
    id: 'started-team',
    label: 'Do not change a started team',
    description:
      'If any allocation for a job has already started (start date is in the past), the team should not be changed.',
  },
  {
    id: 'forty-pct-rule',
    label: '40% minimum per person per role',
    description:
      'If more than one person is assigned to the same role on a job, each person must contribute at least 40% of that role\'s total hours.',
  },
  {
    id: 'reviewer-min-hours',
    label: 'Reviewer minimum 1 h/day',
    description: 'Reviewer allocations must be at least 1 hour per day.',
  },
  {
    id: 'preparer-min-hours',
    label: 'Preparer minimum 3.5 h/day',
    description: 'Preparer allocations must be at least 3.5 hours per day.',
  },
];

export const DEFAULT_CONSTRAINT_ORDER: string[] = BREAKABLE_CONSTRAINTS.map((c) => c.id);
