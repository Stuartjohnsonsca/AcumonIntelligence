/**
 * /api/engagements/[engagementId]/monitoring-reports/[reportId]
 *
 *   GET    → load the report + its run history (last 50).
 *   PUT    → update name / questions / frequency / recipients / active.
 *   DELETE → remove the report and its runs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { computeNextRunAt, type Frequency } from '@/lib/audit-file-monitoring';

const FREQUENCIES: ReadonlyArray<Frequency> = ['manual', 'daily', 'weekly', 'monthly'];

type Ctx = { params: Promise<{ engagementId: string; reportId: string }> };

async function guard(ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  const { engagementId, reportId } = await ctx.params;
  const report = await prisma.auditFileMonitoringReport.findUnique({
    where: { id: reportId },
    select: { id: true, engagementId: true, firmId: true },
  });
  if (!report || report.engagementId !== engagementId) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const;
  }
  if (!session.user.isSuperAdmin && report.firmId !== session.user.firmId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  return { session, report } as const;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ('error' in g) return g.error;

  const report = await prisma.auditFileMonitoringReport.findUnique({
    where: { id: g.report.id },
    include: {
      runs: {
        orderBy: { runAt: 'desc' },
        take: 50,
        select: { id: true, runAt: true, status: true, trigger: true, answers: true, errorMessage: true, emailedTo: true },
      },
    },
  });
  return NextResponse.json({ report });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ('error' in g) return g.error;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body.questions)) {
    patch.questions = body.questions
      .filter((q: unknown) => typeof q === 'string')
      .map((q: string) => q.trim())
      .filter((q: string) => q.length > 0);
  }
  if (typeof body.frequency === 'string' && FREQUENCIES.includes(body.frequency)) {
    patch.frequency = body.frequency;
    // Re-anchor the schedule when the frequency changes so a switch
    // from weekly→daily doesn't leave the next run a week away.
    patch.nextRunAt = computeNextRunAt(body.frequency);
  }
  if (Array.isArray(body.emailRecipients)) {
    patch.emailRecipients = body.emailRecipients.filter(
      (e: unknown) => typeof e === 'string' && /\S+@\S+\.\S+/.test(e as string),
    );
  }
  // Delivery method dropdown — Email and/or Teams. Empty array means
  // in-app only (a paused channel without losing recipient details).
  if (Array.isArray(body.deliveryMethods)) {
    patch.deliveryMethods = body.deliveryMethods
      .filter((m: unknown): m is string => typeof m === 'string')
      .filter((m: string) => m === 'email' || m === 'teams');
  }
  // Teams webhook URL. Validate HTTPS to catch typos before the
  // runner tries (and logs) a failed POST. Null clears the value.
  if ('teamsWebhookUrl' in body) {
    if (body.teamsWebhookUrl === null) {
      patch.teamsWebhookUrl = null;
    } else if (typeof body.teamsWebhookUrl === 'string') {
      const trimmed = body.teamsWebhookUrl.trim();
      if (!trimmed) {
        patch.teamsWebhookUrl = null;
      } else if (/^https:\/\//i.test(trimmed)) {
        patch.teamsWebhookUrl = trimmed;
      } else {
        return NextResponse.json({ error: 'Teams webhook URL must start with https://' }, { status: 400 });
      }
    }
  }
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No writeable fields supplied' }, { status: 400 });
  }

  const report = await prisma.auditFileMonitoringReport.update({
    where: { id: g.report.id },
    data: patch,
  });
  return NextResponse.json({ report });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ('error' in g) return g.error;
  await prisma.auditFileMonitoringReport.delete({ where: { id: g.report.id } });
  return NextResponse.json({ ok: true });
}
