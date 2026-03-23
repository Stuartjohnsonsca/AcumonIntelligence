import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

// GET - Load existing assertion mappings
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const periodId = searchParams.get('periodId');
  const mappingType = searchParams.get('mappingType');

  if (!clientId || !periodId || !mappingType) {
    return NextResponse.json({ error: 'clientId, periodId, mappingType required' }, { status: 400 });
  }

  const user = session.user as { id: string; firmId: string; isSuperAdmin?: boolean };
  const access = await verifyClientAccess(user, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    const mappings = await prisma.fSAssertionMapping.findMany({
      where: { clientId, periodId, mappingType },
      orderBy: { rowKey: 'asc' },
    });

    return NextResponse.json({ mappings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST - Save assertion mappings
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { clientId, periodId, mappingType, rows } = await req.json();

    if (!clientId || !periodId || !mappingType || !rows?.length) {
      return NextResponse.json({ error: 'clientId, periodId, mappingType, rows required' }, { status: 400 });
    }

    const user = session.user as { id: string; firmId: string; isSuperAdmin?: boolean };
    const access = await verifyClientAccess(user, clientId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
    }

    // Upsert all rows
    for (const row of rows as { rowKey: string; rowLabel: string; completeness: boolean; occurrence: boolean; cutOff: boolean; classification: boolean; presentation: boolean; existence: boolean; valuation: boolean; rights: boolean; source: string }[]) {
      await prisma.fSAssertionMapping.upsert({
        where: {
          clientId_periodId_mappingType_rowKey: {
            clientId, periodId, mappingType, rowKey: row.rowKey,
          },
        },
        create: {
          clientId,
          periodId,
          mappingType,
          rowKey: row.rowKey,
          rowLabel: row.rowLabel,
          completeness: row.completeness,
          occurrence: row.occurrence,
          cutOff: row.cutOff,
          classification: row.classification,
          presentation: row.presentation,
          existence: row.existence,
          valuation: row.valuation,
          rights: row.rights,
          source: row.source || 'manual',
        },
        update: {
          rowLabel: row.rowLabel,
          completeness: row.completeness,
          occurrence: row.occurrence,
          cutOff: row.cutOff,
          classification: row.classification,
          presentation: row.presentation,
          existence: row.existence,
          valuation: row.valuation,
          rights: row.rights,
          source: row.source || 'manual',
        },
      });
    }

    return NextResponse.json({ success: true, saved: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[FSAssertions Save]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
