import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    // Test 1: Can Prisma connect?
    const userCount = await prisma.user.count();

    // Test 2: Can we read isMethodologyAdmin?
    const stuart = await prisma.user.findFirst({
      where: { email: 'stuart@acumon.com' },
      select: {
        id: true,
        email: true,
        name: true,
        isMethodologyAdmin: true,
        isSuperAdmin: true,
        firmId: true,
      },
    });

    // Test 3: Can we include firm?
    let firmTest = null;
    if (stuart) {
      const withFirm = await prisma.user.findUnique({
        where: { id: stuart.id },
        include: { firm: true },
      });
      firmTest = withFirm ? { firmName: withFirm.firm.name, firmId: withFirm.firmId } : null;
    }

    return NextResponse.json({
      status: 'ok',
      userCount,
      stuart: stuart ? { ...stuart } : null,
      firmTest,
      prismaVersion: '5.22.0',
      nodeVersion: process.version,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({
      status: 'error',
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5),
    }, { status: 500 });
  }
}
