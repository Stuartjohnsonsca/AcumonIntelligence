import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/firm/fs-lines
 *
 * Active financial-statement lines for the current user's firm. Used
 * by the Documents tab's "Mapped to" dropdown — auditors pick the FS
 * line(s) a requested document evidences. Read-only and auth-only;
 * admin write operations live at /api/methodology-admin/fs-lines.
 *
 * Returns the lines in display order (sortOrder asc) so the dropdown
 * matches the order the methodology admin curated.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fsLines = await prisma.methodologyFsLine.findMany({
    where: { firmId: session.user.firmId, isActive: true },
    select: {
      id: true,
      name: true,
      fsCategory: true,
      fsLevelName: true,
      fsStatementName: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ fsLines });
}
