import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/backfill-rmm-fs
 * Backfills fsStatement, fsLevel, fsNote on existing RMM rows
 * by matching lineItem against TB rows' FS hierarchy.
 * Safe to re-run.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get all RMM rows for this firm's engagements that are missing FS fields
  const engagements = await prisma.auditEngagement.findMany({
    where: { firmId: session.user.firmId },
    select: { id: true },
  });

  let updated = 0;
  for (const eng of engagements) {
    const rmmRows = await prisma.auditRMMRow.findMany({
      where: { engagementId: eng.id, fsLevel: null },
    });

    if (rmmRows.length === 0) continue;

    // Get TB rows for this engagement
    const tbRows = await prisma.auditTBRow.findMany({
      where: { engagementId: eng.id },
      select: { fsStatement: true, fsLevel: true, fsNoteLevel: true, description: true },
    });

    // Build lookup: fsLevel → { fsStatement, fsNote }
    const fsLookup: Record<string, { fsStatement: string | null; fsNote: string | null }> = {};
    for (const tb of tbRows) {
      if (tb.fsLevel && !fsLookup[tb.fsLevel.toLowerCase()]) {
        fsLookup[tb.fsLevel.toLowerCase()] = {
          fsStatement: tb.fsStatement || null,
          fsNote: tb.fsNoteLevel || null,
        };
      }
    }

    for (const rmm of rmmRows) {
      const match = fsLookup[rmm.lineItem.toLowerCase()];
      if (match) {
        await prisma.auditRMMRow.update({
          where: { id: rmm.id },
          data: {
            fsLevel: rmm.lineItem,
            fsStatement: match.fsStatement,
            fsNote: match.fsNote,
          },
        });
        updated++;
      }
    }
  }

  return NextResponse.json({ message: `Backfilled ${updated} RMM rows`, updated });
}
