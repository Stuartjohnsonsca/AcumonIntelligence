import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ValidationRulesClient } from '@/components/methodology-admin/ValidationRulesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';
import type { ValidationRule } from '@/lib/validation-rules';

/**
 * Methodology Admin → Validation Rules.
 *
 * Firm-wide rules that flag issues on engagement schedules — e.g.
 * "audit fees must be >= 25% of total fees" or "non-audit fees must
 * not exceed 30% of audit fees". Each rule targets a schedule and
 * evaluates a formula expression; violations render as banners at
 * the top of the affected schedule.
 */
export default async function ValidationRulesPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/validation-rules');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const firmId = session.user.firmId;

  // Initial rule list
  let initialRules: ValidationRule[] = [];
  try {
    const row = await prisma.methodologyTemplate.findUnique({
      where: {
        firmId_templateType_auditType: {
          firmId,
          templateType: 'validation_rules',
          auditType: 'ALL',
        },
      },
    });
    if (Array.isArray(row?.items)) initialRules = row!.items as unknown as ValidationRule[];
  } catch { /* tolerant */ }

  // Discover schedules available on this firm so the "Schedule"
  // dropdown can show real options. Master schedules live in
  // methodologyRiskTable (NOT methodologyTemplate) under
  // tableType='master_schedules', with the list at data.schedules.
  // When the firm hasn't customised the list we fall back to the
  // default master schedules the audit-type-schedules API serves.
  const DEFAULT_MASTER_SCHEDULES = [
    { key: 'permanent_file_questions',   label: 'Permanent File' },
    { key: 'ethics_questions',           label: 'Ethics' },
    { key: 'continuance_questions',      label: 'Continuance' },
    { key: 'new_client_takeon_questions',label: 'New Client Take-On' },
    { key: 'prior_period',               label: 'Prior Period' },
    { key: 'trial_balance',              label: 'TBCYvPY' },
    { key: 'materiality_questions',      label: 'Materiality' },
    { key: 'par',                        label: 'PAR' },
    { key: 'walkthroughs',               label: 'Walkthroughs' },
    { key: 'rmm',                        label: 'Identifying & Assessing RMM' },
    { key: 'documents',                  label: 'Documents' },
    { key: 'communication',              label: 'Communication' },
    { key: 'outstanding',                label: 'Outstanding' },
    { key: 'portal',                     label: 'Portal' },
    { key: 'subsequent_events_questions',label: 'Subsequent Events' },
    { key: 'tax_technical_categories',   label: 'Tax Technical' },
    { key: 'audit_summary_memo',         label: 'Audit Summary Memo' },
    { key: 'significant_risk_completion',label: 'Significant Risk (Completion)' },
    { key: 'update_procedures',          label: 'Update Procedures' },
    { key: 'completion_checklist',       label: 'Completion Checklist' },
    { key: 'test_summary_results',       label: 'Test Summary Results' },
    { key: 'overall_review_fs',          label: 'Overall Review of FS' },
    { key: 'fs_review',                  label: 'FS Review' },
    { key: 'adj_tb',                     label: 'Adj TB' },
    { key: 'error_schedule',             label: 'Error Schedule' },
    { key: 'eqr_review',                 label: 'EQR Review' },
  ];
  let scheduleKeys: Array<{ key: string; label: string }> = DEFAULT_MASTER_SCHEDULES;
  try {
    const masterRow = await (prisma as any).methodologyRiskTable?.findUnique?.({
      where: { firmId_tableType: { firmId, tableType: 'master_schedules' } },
    });
    const list = masterRow?.data?.schedules;
    if (Array.isArray(list) && list.length > 0) {
      scheduleKeys = list
        .filter((m: any) => m && typeof m.key === 'string')
        .map((m: any) => ({ key: m.key, label: m.label || m.key }));
    }
  } catch { /* tolerant — keep defaults */ }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Validation Rules</h1>
        <p className="text-sm text-slate-500 mt-1">
          Firm-wide checks applied to engagement schedules. When a rule&rsquo;s expression is truthy,
          a banner appears at the top of the affected schedule. Warnings are advisory; Errors gate
          schedule sign-off (can&rsquo;t mark as complete until resolved).
        </p>
      </div>
      <ValidationRulesClient initialRules={initialRules} scheduleKeys={scheduleKeys} />
    </div>
  );
}
