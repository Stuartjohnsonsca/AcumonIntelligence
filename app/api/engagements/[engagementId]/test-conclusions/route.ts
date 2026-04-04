import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: All conclusions for engagement
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const conclusions = await prisma.auditTestConclusion.findMany({
    where: { engagementId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ conclusions });
}

// POST: Create or update conclusion
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  // Upsert by executionId + testDescription (or create new)
  if (body.id) {
    // Update existing
    const conclusion = await prisma.auditTestConclusion.update({
      where: { id: body.id },
      data: {
        ...(body.conclusion !== undefined && { conclusion: body.conclusion }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.totalErrors !== undefined && { totalErrors: body.totalErrors }),
        ...(body.extrapolatedError !== undefined && { extrapolatedError: body.extrapolatedError }),
        ...(body.populationSize !== undefined && { populationSize: body.populationSize }),
        ...(body.sampleSize !== undefined && { sampleSize: body.sampleSize }),
        ...(body.errors !== undefined && { errors: body.errors }),
        ...(body.controlRelianceConcern !== undefined && { controlRelianceConcern: body.controlRelianceConcern }),
        ...(body.extrapolationExceedsTM !== undefined && { extrapolationExceedsTM: body.extrapolationExceedsTM }),
        ...(body.auditorNotes !== undefined && { auditorNotes: body.auditorNotes }),
        ...(body.followUpActions !== undefined && { followUpActions: body.followUpActions }),
        ...(body.followUpData !== undefined && { followUpData: body.followUpData }),
      },
    });
    return NextResponse.json({ conclusion });
  }

  // Create new
  const conclusion = await prisma.auditTestConclusion.create({
    data: {
      engagementId,
      executionId: body.executionId || null,
      fsLine: body.fsLine,
      testDescription: body.testDescription,
      accountCode: body.accountCode || null,
      conclusion: body.conclusion || null,
      totalErrors: body.totalErrors || 0,
      extrapolatedError: body.extrapolatedError || 0,
      populationSize: body.populationSize || 0,
      sampleSize: body.sampleSize || 0,
      errors: body.errors || null,
    },
  });
  return NextResponse.json({ conclusion });
}

// PATCH: Review signoff
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { id, action } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if (action === 'review') {
    const conclusion = await prisma.auditTestConclusion.update({
      where: { id },
      data: {
        status: 'reviewed',
        reviewedBy: session.user.id,
        reviewedByName: session.user.name || session.user.email || '',
        reviewedAt: new Date(),
      },
    });
    return NextResponse.json({ conclusion });
  }

  if (action === 'unreview') {
    const existing = await prisma.auditTestConclusion.findUnique({ where: { id } });
    if (existing?.reviewedBy !== session.user.id) return NextResponse.json({ error: 'Only reviewer can unreview' }, { status: 403 });
    const conclusion = await prisma.auditTestConclusion.update({
      where: { id },
      data: { status: 'concluded', reviewedBy: null, reviewedByName: null, reviewedAt: null },
    });
    return NextResponse.json({ conclusion });
  }

  if (action === 'ri_signoff') {
    const conclusion = await prisma.auditTestConclusion.update({
      where: { id },
      data: {
        status: 'signed_off',
        riSignedBy: session.user.id,
        riSignedByName: session.user.name || session.user.email || '',
        riSignedAt: new Date(),
      },
    });
    return NextResponse.json({ conclusion });
  }

  if (action === 'ri_unsignoff') {
    const existing = await prisma.auditTestConclusion.findUnique({ where: { id } });
    if (existing?.riSignedBy !== session.user.id) return NextResponse.json({ error: 'Only RI can unsign' }, { status: 403 });
    const conclusion = await prisma.auditTestConclusion.update({
      where: { id },
      data: { status: 'reviewed', riSignedBy: null, riSignedByName: null, riSignedAt: null },
    });
    return NextResponse.json({ conclusion });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
