import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ERROR_SCHEDULE_SAFE_SELECT } from '@/lib/error-schedule-select';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: All error schedule entries
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const errors = await prisma.auditErrorSchedule.findMany({
    where: { engagementId },
    orderBy: { createdAt: 'desc' },
    // Explicit select — production Supabase lacks the `linked_from_type`
    // / `linked_from_id` columns on this table until
    // scripts/sql/raise-as-linked-from.sql is applied. Without this,
    // Prisma selects those columns by default and the query 500s.
    select: ERROR_SCHEDULE_SAFE_SELECT,
  });
  return NextResponse.json({ errors });
}

// POST: Commit errors to schedule
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();

  // Commit multiple errors from a conclusion
  if (body.action === 'commit_from_conclusion') {
    const { conclusionId, items } = body as { action: string; conclusionId: string; items: { description: string; errorAmount: number; errorType: string; explanation?: string; isFraud?: boolean }[] };
    if (!conclusionId || !items?.length) return NextResponse.json({ error: 'conclusionId and items required' }, { status: 400 });

    const conclusion = await prisma.auditTestConclusion.findUnique({ where: { id: conclusionId } });
    if (!conclusion) return NextResponse.json({ error: 'Conclusion not found' }, { status: 404 });

    const created = await prisma.auditErrorSchedule.createMany({
      data: items.map(item => ({
        engagementId,
        conclusionId,
        fsLine: conclusion.fsLine,
        accountCode: conclusion.accountCode,
        description: item.description,
        errorAmount: item.errorAmount,
        errorType: item.errorType || 'factual',
        explanation: item.explanation || null,
        isFraud: item.isFraud || false,
        committedBy: session.user.id,
        committedByName: session.user.name || session.user.email || '',
        committedAt: new Date(),
      })),
    });

    return NextResponse.json({ committed: created.count });
  }

  // Single error
  const error = await prisma.auditErrorSchedule.create({
    data: {
      engagementId,
      conclusionId: body.conclusionId || null,
      fsLine: body.fsLine,
      accountCode: body.accountCode || null,
      description: body.description,
      errorAmount: body.errorAmount,
      errorType: body.errorType || 'factual',
      explanation: body.explanation || null,
      isFraud: body.isFraud || false,
      committedBy: session.user.id,
      committedByName: session.user.name || session.user.email || '',
      committedAt: new Date(),
    },
  });
  return NextResponse.json({ error });
}

// DELETE: Remove error from schedule
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const { id } = await req.json();
  await prisma.auditErrorSchedule.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
