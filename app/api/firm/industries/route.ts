import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/firm/industries
 *
 * Active industries for the current user's firm. Used by the Opening
 * tab industry dropdown (and anywhere else an authenticated user
 * needs to pick from the firm's MethodologyIndustry catalogue).
 *
 * Read-only and auth-only — admin write operations live at
 * /api/methodology-admin/industries.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const industries = await prisma.methodologyIndustry.findMany({
    where: { firmId: session.user.firmId, isActive: true },
    select: { id: true, name: true, code: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return NextResponse.json({ industries });
}
