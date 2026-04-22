import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { logEngagementAction, resolveActor } from '@/lib/engagement-action-log';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: List audit points by type
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const pointType = url.searchParams.get('type');
  const status = url.searchParams.get('status');

  const where: any = { engagementId };
  if (pointType) where.pointType = pointType;
  if (status) where.status = status;

  const points = await prisma.auditPoint.findMany({
    where,
    // Newest activity first: most recently updated wins. updatedAt
    // ticks on every response/close/colour change so an item that
    // got a new reply this morning rises above a quieter one. Closed
    // items still appear but sink to the bottom via the status sort.
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });

  return NextResponse.json({ points });
}

// POST: Create new audit point
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  // EQR users are allowed into this route but only for review_point pointType.
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session, { allowEQR: true });
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { pointType, description, heading, body: bodyText, reference, attachments } = body;

  if (!pointType || !description?.trim()) {
    return NextResponse.json({ error: 'pointType and description required' }, { status: 400 });
  }

  // Additional EQR restriction: they can only create review points.
  if (__eqrGuard.role === 'EQR' && pointType !== 'review_point') {
    return NextResponse.json({ error: 'EQR users can only raise review points' }, { status: 403 });
  }

  // Auto-assign chat number (max + 1 for this type in this engagement)
  const maxChat = await prisma.auditPoint.aggregate({
    where: { engagementId, pointType },
    _max: { chatNumber: true },
  });
  const chatNumber = (maxChat._max.chatNumber || 0) + 1;

  const point = await prisma.auditPoint.create({
    data: {
      engagementId,
      pointType,
      chatNumber,
      description: description.trim(),
      heading: heading || null,
      body: bodyText || null,
      reference: reference || null,
      attachments: attachments || null,
      createdById: session.user.id,
      createdByName: session.user.name || session.user.email || '',
    },
  });

  return NextResponse.json({ point });
}

// PATCH: Update point (add response, close, commit, cancel)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  // EQR users may respond/close/update on review_point points only.
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session, { allowEQR: true });
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { id, action } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const existing = await prisma.auditPoint.findUnique({ where: { id } });
  if (!existing || existing.engagementId !== engagementId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (__eqrGuard.role === 'EQR' && existing.pointType !== 'review_point') {
    return NextResponse.json({ error: 'EQR users can only act on review points' }, { status: 403 });
  }

  // Add response to thread
  if (action === 'respond') {
    const { message, attachments: respAttachments } = body;
    const responses = (existing.responses as any[]) || [];
    responses.push({
      id: crypto.randomUUID(),
      userId: session.user.id,
      userName: session.user.name || session.user.email || '',
      message: message || '',
      attachments: respAttachments || [],
      createdAt: new Date().toISOString(),
    });
    // Matter becomes "open" on first reply — anything with a thread
    // is no longer "new". Preserves closed/committed/cancelled.
    const data: any = { responses };
    if (existing.status === 'new') data.status = 'open';
    const point = await prisma.auditPoint.update({ where: { id }, data });
    return NextResponse.json({ point });
  }

  // Set the traffic-light colour. Kept separate from `update` so the
  // UI can fire it on a single click without sending the rest of the
  // record back. Any user can recolour.
  if (action === 'colour') {
    const { colour } = body;
    // Accept null/empty to clear, plus a small set of canonical tones.
    // New values can be whitelisted here later without a migration.
    const allowed = new Set(['green', 'amber', 'red', null, '']);
    const next = colour === '' ? null : colour;
    if (!allowed.has(next)) {
      return NextResponse.json({ error: 'Invalid colour' }, { status: 400 });
    }
    const point = await prisma.auditPoint.update({ where: { id }, data: { colour: next } });
    return NextResponse.json({ point });
  }

  // Close point — RI only for ri_matter (user requirement). Other
  // point types keep their existing permissions; EQR already checked
  // at the top of the handler for review_point scope.
  if (action === 'close') {
    if (existing.pointType === 'ri_matter') {
      // Look up the caller's team membership to confirm they're the RI
      // (or a Partner). Anyone else gets 403 even if they're on the
      // engagement. The user's spec says "Only RI can close an item".
      const member = await prisma.auditTeamMember.findFirst({
        where: { engagementId, userId: session.user.id },
        select: { role: true },
      });
      const isRI = member?.role === 'RI' || member?.role === 'Partner' || session.user.isSuperAdmin;
      if (!isRI) {
        return NextResponse.json({ error: 'Only the RI can close an RI matter' }, { status: 403 });
      }
    }
    const point = await prisma.auditPoint.update({
      where: { id },
      data: { status: 'closed', closedById: session.user.id, closedByName: session.user.name || '', closedAt: new Date() },
    });
    // Audit trail — closing is a decision worth logging separately
    // from generic PATCH updates. Actor + matter id land in the
    // Outstanding tab's audit panel.
    const actor = await resolveActor(engagementId, session);
    if (actor) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: 'audit-point.close',
        summary: `Closed ${existing.pointType.replace(/_/g, ' ')} #${existing.chatNumber}: ${(existing.description || '').slice(0, 120)}${(existing.description || '').length > 120 ? '…' : ''}`,
        targetType: 'audit_point',
        targetId: id,
        metadata: { pointType: existing.pointType, chatNumber: existing.chatNumber },
      });
    }
    return NextResponse.json({ point });
  }

  // Commit (management/representation — Reviewer/RI only)
  if (action === 'commit') {
    const point = await prisma.auditPoint.update({
      where: { id },
      data: { status: 'committed', closedById: session.user.id, closedByName: session.user.name || '', closedAt: new Date() },
    });
    return NextResponse.json({ point });
  }

  // Cancel
  if (action === 'cancel') {
    const point = await prisma.auditPoint.update({
      where: { id },
      data: { status: 'cancelled', closedById: session.user.id, closedByName: session.user.name || '', closedAt: new Date() },
    });
    return NextResponse.json({ point });
  }

  // Update content (description, heading, body)
  if (action === 'update') {
    const data: any = {};
    if (body.description !== undefined) data.description = body.description;
    if (body.heading !== undefined) data.heading = body.heading;
    if (body.body !== undefined) data.body = body.body;
    if (body.attachments !== undefined) data.attachments = body.attachments;
    const point = await prisma.auditPoint.update({ where: { id }, data });
    return NextResponse.json({ point });
  }

  // Raise as … (error | management | representation).
  //
  // Creates a NEW record in the target table with a back-link
  // (linkedFromType='ri_matter', linkedFromId=existing.id). The
  // target's description is seeded from the matter's description;
  // the user can tweak in the target's own panel afterwards.
  //
  // For 'error' the target is AuditErrorSchedule and we need fsLine +
  // errorAmount + errorType. These are passed in the body (AI-
  // pre-filled on the client side) and the auditor verifies before
  // submitting. fsLine defaults to 'Unclassified' when not provided
  // so the raise never fails silently.
  if (action === 'raise') {
    const { raiseAs, raiseFields } = body as {
      raiseAs: 'error' | 'management' | 'representation';
      raiseFields?: Record<string, any>;
    };
    if (!raiseAs) return NextResponse.json({ error: 'raiseAs required' }, { status: 400 });

    const actor = await resolveActor(engagementId, session);
    const summaryText = (existing.description || '').slice(0, 120);

    let created: any = null;
    if (raiseAs === 'error') {
      created = await prisma.auditErrorSchedule.create({
        data: {
          engagementId,
          fsLine: String(raiseFields?.fsLine ?? 'Unclassified'),
          accountCode: raiseFields?.accountCode ?? null,
          description: String(raiseFields?.description ?? existing.description ?? ''),
          errorAmount: Number(raiseFields?.errorAmount ?? 0) || 0,
          errorType: String(raiseFields?.errorType ?? 'judgemental'),
          explanation: raiseFields?.explanation ?? null,
          isFraud: !!raiseFields?.isFraud,
          linkedFromType: 'ri_matter',
          linkedFromId: existing.id,
        },
      });
    } else if (raiseAs === 'management' || raiseAs === 'representation') {
      const pointType = raiseAs; // 'management' | 'representation'
      const maxChat = await prisma.auditPoint.aggregate({
        where: { engagementId, pointType },
        _max: { chatNumber: true },
      });
      const chatNumber = (maxChat._max.chatNumber || 0) + 1;
      created = await prisma.auditPoint.create({
        data: {
          engagementId,
          pointType,
          chatNumber,
          status: 'new',
          description: String(raiseFields?.description ?? existing.description ?? ''),
          heading: raiseFields?.heading ?? null,
          body: raiseFields?.body ?? null,
          createdById: session.user.id,
          createdByName: session.user.name || session.user.email || '',
          linkedFromType: 'ri_matter',
          linkedFromId: existing.id,
        },
      });
    } else {
      return NextResponse.json({ error: 'Unknown raiseAs value' }, { status: 400 });
    }

    // Audit trail — raising is a decision that jumps the matter into
    // a different workflow, worth recording so reviewers can trace
    // the chain back.
    if (actor && created) {
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: `audit-point.raise-${raiseAs}`,
        summary: `Raised RI matter #${existing.chatNumber} as ${raiseAs}${summaryText ? ` — ${summaryText}${(existing.description || '').length > 120 ? '…' : ''}` : ''}`,
        targetType: raiseAs === 'error' ? 'error_schedule' : 'audit_point',
        targetId: created.id,
        metadata: { raisedFromRiMatterId: existing.id, raisedFromChatNumber: existing.chatNumber },
      });
    }

    return NextResponse.json({ raised: created });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
