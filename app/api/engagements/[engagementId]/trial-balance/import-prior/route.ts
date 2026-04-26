import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { shouldCarryForward } from '@/lib/carry-forward-config';

/**
 * POST /api/engagements/:engagementId/trial-balance/import-prior
 *
 * "Import from prior period" — fills in the priorYear column on the
 * current engagement's TB rows by reading the linked prior period
 * engagement's TB rows and matching on accountCode. Populates only
 * rows where priorYear is currently null/zero so existing prior
 * figures aren't overwritten silently.
 *
 * Gates:
 *   • Engagement must have `priorPeriodEngagementId` set.
 *   • Firm Wide Assumptions → Bring Forward → cell for this audit
 *     type × `tb_figures` must be ticked.
 *
 * Response:
 *   { populated: number, skipped: number, missing: string[] }
 *   - populated:  rows that received a priorYear value
 *   - skipped:    rows that already had a priorYear value (left alone)
 *   - missing:    accountCodes from current that didn't appear in prior
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, auditType: true, priorPeriodEngagementId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!eng.priorPeriodEngagementId) {
    return NextResponse.json({
      error: 'No prior period engagement linked to this one',
      reason: 'no_prior_engagement',
    }, { status: 422 });
  }

  // Honour the firm's bring-forward matrix. If the admin hasn't ticked
  // tb_figures for this audit type, the import is disallowed — keeps
  // the carry-forward decisions in one place rather than silently
  // letting any user import.
  const allowed = await shouldCarryForward(eng.firmId, eng.auditType, 'tb_figures');
  if (!allowed) {
    return NextResponse.json({
      error: 'TB figures are not configured to carry forward for this audit type',
      reason: 'carry_forward_disabled',
      detail: 'Firm Wide Assumptions → Bring Forward to Next Period: tick "TB figures" for this audit type to enable.',
    }, { status: 422 });
  }

  // Pull prior period's TB rows. We use `currentYear` from prior as
  // the source for `priorYear` on the new engagement — prior's
  // current-year values become this period's prior-year column.
  const priorRows = await prisma.auditTBRow.findMany({
    where: { engagementId: eng.priorPeriodEngagementId },
    select: { accountCode: true, currentYear: true },
  });
  const priorByCode = new Map<string, number | null>();
  for (const r of priorRows) {
    if (r.accountCode) priorByCode.set(String(r.accountCode), r.currentYear);
  }

  const currentRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    select: { id: true, accountCode: true, priorYear: true },
  });

  // Update current rows in chunks of 20 (same envelope as the RMM
  // PUT — keeps total time well under Vercel's 10s timeout).
  let populated = 0;
  let skipped = 0;
  const missing: string[] = [];

  const targets: Array<{ id: string; priorYear: number }> = [];
  for (const row of currentRows) {
    if (!row.accountCode) continue;
    const code = String(row.accountCode);
    const priorVal = priorByCode.get(code);
    if (priorVal == null) {
      missing.push(code);
      continue;
    }
    // Skip rows that already have a non-null priorYear value — don't
    // overwrite the auditor's existing prior column even if the
    // values would match.
    if (row.priorYear != null) {
      skipped++;
      continue;
    }
    targets.push({ id: row.id, priorYear: priorVal });
  }

  const CHUNK = 20;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK);
    await Promise.all(slice.map(t =>
      prisma.auditTBRow.update({ where: { id: t.id }, data: { priorYear: t.priorYear } }),
    ));
  }
  populated = targets.length;

  return NextResponse.json({
    populated,
    skipped,
    missing: missing.slice(0, 20),
    missingCount: missing.length,
  });
}
