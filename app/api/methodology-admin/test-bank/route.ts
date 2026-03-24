import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { firmId, industryId, fsLine, tests } = await req.json();

  const entry = await prisma.methodologyTestBank.upsert({
    where: {
      firmId_industryId_fsLine: { firmId, industryId, fsLine },
    },
    create: { firmId, industryId, fsLine, tests },
    update: { tests },
  });

  return NextResponse.json({ entry });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();

  // Copy action: copy all test bank entries from one industry to another
  if (body.action === 'copy') {
    const { firmId, sourceIndustryId, targetIndustryId } = body;

    const sourceEntries = await prisma.methodologyTestBank.findMany({
      where: { firmId, industryId: sourceIndustryId },
    });

    // Delete existing target entries
    await prisma.methodologyTestBank.deleteMany({
      where: { firmId, industryId: targetIndustryId },
    });

    // Create copies
    const entries = await Promise.all(
      sourceEntries.map((entry) =>
        prisma.methodologyTestBank.create({
          data: {
            firmId,
            industryId: targetIndustryId,
            fsLine: entry.fsLine,
            tests: entry.tests as any,
            assertions: entry.assertions as any,
          },
        })
      )
    );

    return NextResponse.json({ entries });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.methodologyTestBank.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
