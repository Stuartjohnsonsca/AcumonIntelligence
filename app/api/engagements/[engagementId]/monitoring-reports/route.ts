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
const DELIVERY_METHODS = ['email', 'teams', 'wecom'] as const;
type DeliveryMethod = typeof DELIVERY_METHODS[number];

function sanitiseDeliveryMethods(raw: unknown): DeliveryMethod[] {
  if (!Array.isArray(raw)) return [];
  const out: DeliveryMethod[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && (DELIVERY_METHODS as ReadonlyArray<string>).includes(v) && !out.includes(v as DeliveryMethod)) {
      out.push(v as DeliveryMethod);
    }
  }
  return out;
}

function sanitiseTeamsWebhook(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https:\/\//i.test(trimmed)) return null; // Teams webhooks are always HTTPS
  return trimmed;
}

/** WeCom group-robot webhook URLs are always on qyapi.weixin.qq.com
 *  with a `key=` query param. Reject anything else so a typo doesn't
 *  silently never send. */
function sanitiseWeComWebhook(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\/.+key=/.test(trimmed)) return null;
  return trimmed;
}

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
      teamsWebhookUrl: true,
      wecomWebhookUrl: true,
      deliveryMethods: true,
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
  const deliveryMethods = sanitiseDeliveryMethods(body.deliveryMethods);
  const teamsWebhookUrl = sanitiseTeamsWebhook(body.teamsWebhookUrl);
  const wecomWebhookUrl = sanitiseWeComWebhook(body.wecomWebhookUrl);

  const report = await prisma.auditFileMonitoringReport.create({
    data: {
      engagementId,
      firmId: eng.firmId,
      name,
      questions: questions as any,
      frequency,
      nextRunAt: computeNextRunAt(frequency),
      emailRecipients: emailRecipients.length ? (emailRecipients as any) : undefined,
      teamsWebhookUrl: teamsWebhookUrl,
      wecomWebhookUrl: wecomWebhookUrl,
      deliveryMethods: deliveryMethods.length ? (deliveryMethods as any) : undefined,
      createdById: session.user.id,
      createdByName: session.user.name || session.user.email || null,
    },
  });
  return NextResponse.json({ report });
}
