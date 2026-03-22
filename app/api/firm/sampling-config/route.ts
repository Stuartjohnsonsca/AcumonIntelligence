import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const firmId = searchParams.get('firmId') || session.user.firmId;

  if (!session.user.isSuperAdmin && firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = await prisma.firmSamplingConfig.findUnique({
    where: { firmId },
  });

  if (!config) {
    return NextResponse.json({ confidenceLevel: 95, confidenceFactorTable: null, riskMatrix: null });
  }

  return NextResponse.json({
    confidenceLevel: config.confidenceLevel,
    confidenceFactorTable: config.confidenceFactorTable,
    riskMatrix: config.riskMatrix,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    return NextResponse.json({ error: 'Only Firm Admins can update sampling settings' }, { status: 403 });
  }

  const body = await req.json();
  const { firmId, confidenceLevel, confidenceFactorTable, riskMatrix } = body;

  const targetFirmId = session.user.isSuperAdmin ? firmId : session.user.firmId;

  if (!targetFirmId) {
    return NextResponse.json({ error: 'firmId required' }, { status: 400 });
  }

  const config = await prisma.firmSamplingConfig.upsert({
    where: { firmId: targetFirmId },
    create: {
      firmId: targetFirmId,
      confidenceLevel: confidenceLevel ?? 95,
      confidenceFactorTable: confidenceFactorTable ?? undefined,
      riskMatrix: riskMatrix ?? undefined,
      updatedBy: session.user.id,
    },
    update: {
      confidenceLevel: confidenceLevel ?? 95,
      confidenceFactorTable: confidenceFactorTable ?? undefined,
      riskMatrix: riskMatrix ?? undefined,
      updatedBy: session.user.id,
    },
  });

  return NextResponse.json({ ok: true, id: config.id });
}
