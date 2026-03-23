import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { findingId, isSignificantRisk, userResponse, addToTesting, reviewed } = body;

    if (!findingId) {
      return NextResponse.json({ error: 'findingId required' }, { status: 400 });
    }

    // Verify the finding exists
    const existing = await prisma.docSummaryFinding.findUnique({
      where: { id: findingId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
    }

    // Build update data — only include fields that were provided
    const updateData: Record<string, unknown> = {};
    if (typeof isSignificantRisk === 'boolean') updateData.isSignificantRisk = isSignificantRisk;
    if (typeof userResponse === 'string') updateData.userResponse = userResponse;
    if (typeof addToTesting === 'boolean') updateData.addToTesting = addToTesting;
    if (typeof reviewed === 'boolean') updateData.reviewed = reviewed;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await prisma.docSummaryFinding.update({
      where: { id: findingId },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:UpdateFinding] Failed | error=${msg}`);
    return NextResponse.json({ error: 'Failed to update finding' }, { status: 500 });
  }
}
