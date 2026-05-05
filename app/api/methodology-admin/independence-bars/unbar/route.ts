import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Methodology Admin → Independence Bars → Unbar.
 *
 * Resets a single declined Independence row back to `outstanding` so
 * the team member can re-confirm next time they open the engagement.
 * Restricted to Methodology Admin / Super User. Writes an append-only
 * history row with action='unbar' so the audit trail captures who did
 * what and why.
 *
 * Body: { memberIndependenceId: string, reason?: string }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const actorId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const memberIndependenceId = typeof body.memberIndependenceId === 'string' ? body.memberIndependenceId : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!memberIndependenceId) {
    return NextResponse.json({ error: 'memberIndependenceId is required' }, { status: 400 });
  }

  // Confirm the row exists, is declined, and belongs to the caller's firm.
  const row = await prisma.auditMemberIndependence.findUnique({
    where: { id: memberIndependenceId },
    include: { engagement: { select: { firmId: true } } },
  });
  if (!row || row.engagement.firmId !== firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status !== 'declined') {
    return NextResponse.json({ error: `Row is ${row.status}, not declined — nothing to unbar.` }, { status: 409 });
  }

  // Reset the live row. Status -> outstanding so the user re-confirms; we
  // wipe isIndependent and the previous answers payload because they
  // belong to the prior decline that has now been reviewed.
  const updated = await prisma.auditMemberIndependence.update({
    where: { id: row.id },
    data: {
      status: 'outstanding',
      isIndependent: null,
      answers: undefined,
      notes: null,
      confirmedAt: null,
      notifiedAt: null,
    },
  });

  // Append an audit-trail history row. action='unbar' distinguishes this
  // from team-member submissions; actorUserId records the admin who
  // performed it. Best-effort — if the new columns aren't present (pre
  // independence-unbar.sql), we still consider the unbar successful but
  // log a warning.
  try {
    await prisma.auditMemberIndependenceHistory.create({
      data: {
        memberIndependenceId: row.id,
        engagementId: row.engagementId,
        userId: row.userId,
        status: 'outstanding',
        isIndependent: null,
        notes: reason || null,
        action: 'unbar',
        actorUserId: actorId,
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/action|actor_user_id/i.test(msg) && /does not exist|column/i.test(msg)) {
      console.warn('[independence] unbar: history columns missing — run scripts/sql/independence-unbar.sql.');
    } else {
      console.error('[independence] unbar: history insert failed:', err);
    }
  }

  return NextResponse.json({ ok: true, status: updated.status });
}
