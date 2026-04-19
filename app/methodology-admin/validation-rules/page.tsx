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
  // dropdown can show real options. We pull them from the audit-
  // type mappings config — same source the engagement tabs use.
  // Best-effort; falls back to a free-text field client-side.
  let scheduleKeys: Array<{ key: string; label: string }> = [];
  try {
    const masterRow = await prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: 'master_schedules' },
    });
    if (Array.isArray(masterRow?.items)) {
      scheduleKeys = (masterRow!.items as any[])
        .filter(m => m && typeof m.key === 'string')
        .map(m => ({ key: m.key, label: m.label || m.key }));
    }
  } catch { /* tolerant */ }

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
