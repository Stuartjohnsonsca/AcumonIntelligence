/**
 * POST /api/engagements/[engagementId]/monitoring-reports/[reportId]/run
 *
 * Manual "Run now" — fires every question through the InterrogateBot
 * straight away and returns the new run row. Doesn't bump nextRunAt
 * (scheduled cadence is unaffected).
 *
 * Auth: firm user with engagement read access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runMonitoringReport } from '@/lib/audit-file-monitoring';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ engagementId: string; reportId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId, reportId } = await ctx.params;

  const report = await prisma.auditFileMonitoringReport.findUnique({
    where: { id: reportId },
    select: { engagementId: true, firmId: true },
  });
  if (!report || report.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!session.user.isSuperAdmin && report.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await runMonitoringReport(reportId, { trigger: 'manual' });
    const run = await prisma.auditFileMonitoringRun.findUnique({
      where: { id: result.runId },
    });
    return NextResponse.json({ run });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Run failed' }, { status: 500 });
  }
}
