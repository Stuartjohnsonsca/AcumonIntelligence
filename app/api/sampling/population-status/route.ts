import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

/**
 * GET /api/sampling/population-status?populationId=X
 * Poll for bank statement parsing completion.
 * Returns status + parsed data when ready.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const populationId = searchParams.get('populationId');
  if (!populationId) return NextResponse.json({ error: 'populationId required' }, { status: 400 });

  const population = await prisma.samplingPopulation.findUnique({
    where: { id: populationId },
    include: {
      engagement: { select: { clientId: true } },
    },
  });

  if (!population) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Verify access — prevent cross-client contamination
  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    population.engagement.clientId,
  );
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Check if parsing is complete by looking at parsedData
  const parsedData = population.parsedData as {
    rows?: Record<string, unknown>[];
    columns?: string[];
    metadata?: Record<string, unknown>;
    error?: string;
  } | null;

  if (parsedData?.error) {
    return NextResponse.json({
      status: 'failed',
      error: parsedData.error,
    });
  }

  if (parsedData?.rows && parsedData.rows.length > 0) {
    return NextResponse.json({
      status: 'complete',
      rows: parsedData.rows,
      columns: parsedData.columns || [],
      metadata: parsedData.metadata || {},
      recordCount: population.recordCount,
    });
  }

  // Still parsing
  return NextResponse.json({
    status: 'parsing',
    message: 'Extracting transactions from bank statement...',
  });
}
