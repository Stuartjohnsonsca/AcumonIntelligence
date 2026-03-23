import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { clientId, periodId, mappingType } = await req.json();
    if (!clientId || !periodId || !mappingType) {
      return NextResponse.json({ error: 'clientId, periodId, mappingType required' }, { status: 400 });
    }

    const user = session.user as { id: string; firmId: string; isSuperAdmin?: boolean };
    const access = await verifyClientAccess(user, clientId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
    }

    // Find the period that ends the day before the current period starts
    const currentPeriod = await prisma.clientPeriod.findUnique({
      where: { id: periodId },
    });

    if (!currentPeriod) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 });
    }

    // Find previous period for this client
    const prevPeriod = await prisma.clientPeriod.findFirst({
      where: {
        clientId,
        endDate: {
          lt: currentPeriod.startDate,
        },
      },
      orderBy: { endDate: 'desc' },
    });

    if (!prevPeriod) {
      return NextResponse.json({ error: 'No previous period found' }, { status: 404 });
    }

    // Load PY mappings
    const pyMappings = await prisma.fSAssertionMapping.findMany({
      where: {
        clientId,
        periodId: prevPeriod.id,
        mappingType,
      },
    });

    if (!pyMappings.length) {
      return NextResponse.json({ error: 'No mappings found for previous period' }, { status: 404 });
    }

    // Return PY mappings with import_py source
    const mappings = pyMappings.map(m => ({
      rowKey: m.rowKey,
      rowLabel: m.rowLabel,
      completeness: m.completeness,
      occurrence: m.occurrence,
      cutOff: m.cutOff,
      classification: m.classification,
      presentation: m.presentation,
      existence: m.existence,
      valuation: m.valuation,
      rights: m.rights,
      source: 'import_py',
    }));

    return NextResponse.json({ mappings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[FSAssertions ImportPY]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
