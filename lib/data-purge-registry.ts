/**
 * Data-purge registry — Methodology Admin → Reset Tab Data.
 *
 * Maps a "tab" key to one or more deleteMany operations against the
 * engagement-scoped Prisma models that back that tab. The
 * /api/methodology-admin/data-purge endpoint resolves the firm's
 * engagements, then runs each entry's deleteMany scoped to those
 * engagement ids.
 *
 * Adding a new tab: append to TAB_PURGE_DEFS with the model name
 * (must match prisma client property casing) and an optional
 * extraWhere for sub-section filters (e.g. AuditPermanentFile rows
 * where sectionKey='specialists_items' to wipe only Specialists chats
 * without dropping the rest of the permanent file).
 *
 * The registry is the single source of truth — both the API and the
 * admin UI import it so dropdown options and server behaviour stay
 * in sync.
 */

export interface PurgeTarget {
  /** Prisma client property name, e.g. 'auditPermanentFile'. */
  model: string;
  /**
   * Extra `where` filter merged with the engagementId scope. Lets a
   * tab purge only a slice of a multi-purpose table (the permanent
   * file is shared by Specialists, Communication, and others — each
   * lives in its own sectionKey).
   */
  extraWhere?: Record<string, unknown>;
}

export interface PurgeTabDef {
  /** Stable key used on the wire and persisted in audit logs. */
  key: string;
  /** User-visible dropdown label. */
  label: string;
  /** One-line description shown next to the label so the admin
   *  understands exactly what gets deleted. */
  description: string;
  /** One or more model deletes that together wipe the tab's data. */
  targets: PurgeTarget[];
}

export const TAB_PURGE_DEFS: PurgeTabDef[] = [
  {
    key: 'permanent_file',
    label: 'Permanent File',
    description:
      'Deletes every Permanent File answer across all engagements (Entity Details, Understanding the Entity, IT Environment, Taxation, etc.). Section-specific sub-tabs below let you wipe just one slice.',
    targets: [{ model: 'auditPermanentFile' }],
  },
  {
    key: 'permanent_file_specialists_chats',
    label: 'Specialists chats only (within Permanent File)',
    description:
      'Deletes only the schedule-action / specialist chats stored under the permanent_file section "specialists_items". Does NOT touch the rest of the Permanent File.',
    targets: [{ model: 'auditPermanentFile', extraWhere: { sectionKey: 'specialists_items' } }],
  },
  {
    key: 'permanent_file_overall_signoffs',
    label: 'Specialist tab overall sign-offs (Permanent File)',
    description:
      'Deletes the cached aggregate sign-off blob (sectionKey "tax_technical_overall_signoffs") used by the Specialists tab-bar dots. Safe to delete — it is recomputed automatically on next save.',
    targets: [{ model: 'auditPermanentFile', extraWhere: { sectionKey: 'tax_technical_overall_signoffs' } }],
  },
  {
    key: 'ethics',
    label: 'Ethics',
    description: 'Deletes every Ethics questionnaire answer set (one row per engagement).',
    targets: [{ model: 'auditEthics' }],
  },
  {
    key: 'continuance',
    label: 'Continuance',
    description: 'Deletes every Client Continuance questionnaire (one row per engagement).',
    targets: [{ model: 'auditContinuance' }],
  },
  {
    key: 'new_client_takeon',
    label: 'New Client Take-On',
    description: 'Deletes every New Client Take-On questionnaire (one row per engagement).',
    targets: [{ model: 'auditNewClientTakeOn' }],
  },
  {
    key: 'subsequent_events',
    label: 'Subsequent Events',
    description: 'Deletes every Subsequent Events questionnaire (one row per engagement).',
    targets: [{ model: 'auditSubsequentEvents' }],
  },
  {
    key: 'materiality',
    label: 'Materiality',
    description: 'Deletes every materiality assessment (benchmark, percentages, performance materiality).',
    targets: [{ model: 'auditMateriality' }],
  },
  {
    key: 'vat_reconciliation',
    label: 'VAT Reconciliation',
    description: 'Deletes every VAT Reconciliation calculator state (revenue mappings, period rows, conclusions).',
    targets: [{ model: 'auditVatReconciliation' }],
  },
  {
    key: 'tax_on_profits',
    label: 'Tax on Profits',
    description: 'Deletes every Tax on Profits / Corporation Tax tool state (jurisdictions, adjustments, audit-test rows, AI verification).',
    targets: [{ model: 'auditTaxOnProfits' }],
  },
  {
    key: 'rmm_rows',
    label: 'Risk Matrix (RMM)',
    description: 'Deletes every Risk Matrix row across all engagements.',
    targets: [{ model: 'auditRMMRow' }],
  },
  {
    key: 'par_rows',
    label: 'Planning Analytical Review (PAR)',
    description: 'Deletes every PAR row across all engagements.',
    targets: [{ model: 'auditPARRow' }],
  },
  {
    key: 'trial_balance',
    label: 'Trial Balance',
    description: 'Deletes every imported TB row across all engagements (re-import will be required).',
    targets: [{ model: 'auditTBRow' }],
  },
  {
    key: 'test_conclusions',
    label: 'Test Conclusions',
    description: 'Deletes every test conclusion (per-FS-line / per-test sign-off) across all engagements.',
    targets: [{ model: 'auditTestConclusion' }],
  },
  {
    key: 'analytical_reviews',
    label: 'Analytical Reviews',
    description: 'Deletes every analytical-review run across all engagements.',
    targets: [{ model: 'auditAnalyticalReview' }],
  },
  {
    key: 'payroll_tests',
    label: 'Payroll Tests',
    description: 'Deletes every payroll-test run across all engagements.',
    targets: [{ model: 'auditPayrollTest' }],
  },
  {
    key: 'error_schedule',
    label: 'Error Schedule',
    description: 'Deletes every Error Schedule entry across all engagements (uncorrected misstatements).',
    targets: [{ model: 'auditErrorSchedule' }],
  },
  {
    key: 'audit_points',
    label: 'Audit Points',
    description: 'Deletes every Audit Point (Review Points / RI Matters / Discussion Points) across all engagements.',
    targets: [{ model: 'auditPoint' }],
  },
  {
    key: 'tax_chats',
    label: 'Tax Chats (legacy Tax Technical tab)',
    description: 'Deletes every legacy Tax Technical chat. The new Specialists tab uses the permanent_file section instead.',
    targets: [{ model: 'auditTaxChat' }],
  },
  {
    key: 'meetings',
    label: 'Meetings',
    description: 'Deletes every meeting record across all engagements.',
    targets: [{ model: 'auditMeeting' }],
  },
  {
    key: 'documents',
    label: 'Documents',
    description: 'Deletes every audit document record (request rows, upload metadata) across all engagements. Blob storage is NOT touched.',
    targets: [{ model: 'auditDocument' }],
  },
  {
    key: 'information_requests',
    label: 'Information Requests',
    description: 'Deletes every information-request record (per engagement).',
    targets: [{ model: 'auditInformationRequest' }],
  },
  {
    key: 'agreed_dates',
    label: 'Audit Timetable (Agreed Dates)',
    description: 'Deletes every agreed-date / audit-timetable entry across all engagements.',
    targets: [{ model: 'auditAgreedDate' }],
  },
  {
    key: 'specialists',
    label: 'Specialist assignments (Opening tab)',
    description: 'Deletes every engagement-level Specialist assignment (the rows from the Opening-tab Team panel). Firm-wide specialist roles are NOT touched.',
    targets: [{ model: 'auditSpecialist' }],
  },
  {
    key: 'client_contacts',
    label: 'Client Contacts',
    description: 'Deletes every engagement-level Client Contact row.',
    targets: [{ model: 'auditClientContact' }],
  },
  {
    key: 'team_members',
    label: 'Engagement Team Members',
    description: 'Deletes every engagement-level Team Member row (Junior / Manager / RI / EQR assignments).',
    targets: [{ model: 'auditTeamMember' }],
  },
];

export function findPurgeTabDef(key: string): PurgeTabDef | undefined {
  return TAB_PURGE_DEFS.find(t => t.key === key);
}
