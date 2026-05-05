import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Methodology Admin → Independence Bars.
 *
 * Lists every team member who is currently barred from an engagement
 * because they declared they were not independent (status='declined'),
 * scoped to the caller's firm. Methodology Admin / Super User only.
 *
 * The matching POST endpoint at .../unbar/route.ts clears a single bar
 * and writes a history row tagged action='unbar'.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  let rows;
  try {
    rows = await prisma.auditMemberIndependence.findMany({
      where: {
        status: 'declined',
        engagement: { firmId },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        engagement: {
          select: {
            id: true,
            auditType: true,
            client: { select: { id: true, clientName: true } },
            period: { select: { id: true, startDate: true, endDate: true } },
          },
        },
      },
      orderBy: { confirmedAt: 'desc' },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/audit_member_independence/.test(msg) && /does not exist/i.test(msg)) {
      return NextResponse.json({
        error: 'Independence table not migrated yet. Run scripts/sql/independence-gate.sql on Supabase.',
      }, { status: 503 });
    }
    throw err;
  }

  const bars = rows.map(r => ({
    id: r.id,
    engagementId: r.engagementId,
    auditType: r.engagement.auditType,
    client: r.engagement.client,
    period: r.engagement.period,
    user: r.user,
    declinedAt: r.confirmedAt,
    notifiedAt: r.notifiedAt,
    answers: r.answers,
    notes: r.notes,
  }));
  return NextResponse.json({ bars });
}
