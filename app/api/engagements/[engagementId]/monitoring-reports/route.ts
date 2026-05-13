/**
 * /api/engagements/[engagementId]/monitoring-reports
 *
 *   GET  → list every monitoring report on the engagement (with the
 *          last run's status + when the next is due).
 *   POST → create a new report. Body: { name, questions[], frequency,
 *          emailRecipients?[] }
 *
 * Auth: firm user with engagement read access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { computeNextRunAt, type Frequency } from '@/lib/audit-file-monitoring';

const FREQUENCIES: ReadonlyArray<Frequency> = ['manual', 'daily', 'weekly', 'monthly'];

export async function GET(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const reports = await prisma.auditFileMonitoringReport.findMany({
    where: { engagementId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      questions: true,
      frequency: true,
      isActive: true,
      nextRunAt: true,
      lastRunAt: true,
      emailRecipients: true,
      createdByName: true,
      createdAt: true,
      runs: {
        orderBy: { runAt: 'desc' },
        take: 1,
        select: { id: true, runAt: true, status: true, trigger: true },
      },
    },
  });
  return NextResponse.json({ reports });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const questions: string[] = Array.isArray(body.questions)
    ? body.questions
      .filter((q: unknown) => typeof q === 'string')
      .map((q: string) => q.trim())
      .filter((q: string) => q.length > 0)
    : [];

  const frequency: Frequency = FREQUENCIES.includes(body.frequency)
    ? body.frequency
    : 'weekly';
  const emailRecipients: string[] = Array.isArray(body.emailRecipients)
    ? body.emailRecipients.filter((e: unknown) => typeof e === 'string' && /\S+@\S+\.\S+/.test(e as string))
    : [];

  const report = await prisma.auditFileMonitoringReport.create({
    data: {
      engagementId,
      firmId: eng.firmId,
      name,
      questions: questions as any,
      frequency,
      nextRunAt: computeNextRunAt(frequency),
      emailRecipients: emailRecipients.length ? (emailRecipients as any) : undefined,
      createdById: session.user.id,
      createdByName: session.user.name || session.user.email || null,
    },
  });
  return NextResponse.json({ report });
}
