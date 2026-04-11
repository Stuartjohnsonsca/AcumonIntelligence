import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

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
    orderBy: [{ status: 'asc' }, { chatNumber: 'asc' }], // open first, then by chat number
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
    const point = await prisma.auditPoint.update({ where: { id }, data: { responses } });
    return NextResponse.json({ point });
  }

  // Close point
  if (action === 'close') {
    const point = await prisma.auditPoint.update({
      where: { id },
      data: { status: 'closed', closedById: session.user.id, closedByName: session.user.name || '', closedAt: new Date() },
    });
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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
