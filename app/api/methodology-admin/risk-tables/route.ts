import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tableType = searchParams.get('tableType');
  const firmId = session.user.firmId;

  // Single table lookup
  if (tableType) {
    const table = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType } },
    });
    return NextResponse.json({ table: table ? { tableType: table.tableType, data: table.data } : null });
  }

  // All tables
  const tables = await prisma.methodologyRiskTable.findMany({ where: { firmId } });
  const result: Record<string, any> = {};
  for (const t of tables) result[t.tableType] = t.data;
  return NextResponse.json({ tables: result });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const firmId = session.user.firmId;

  // Support both formats:
  // 1. Single: { tableType: 'xxx', data: {...} }
  // 2. Batch:  { tables: { xxx: data, yyy: data } }
  if (body.tableType && body.data !== undefined) {
    await prisma.methodologyRiskTable.upsert({
      where: { firmId_tableType: { firmId, tableType: body.tableType } },
      create: { firmId, tableType: body.tableType, data: body.data as any },
      update: { data: body.data as any },
    });
    return NextResponse.json({ success: true });
  }

  if (body.tables) {
    const ops = Object.entries(body.tables).map(([tableType, data]) =>
      prisma.methodologyRiskTable.upsert({
        where: { firmId_tableType: { firmId, tableType } },
        create: { firmId, tableType, data: data as any },
        update: { data: data as any },
      })
    );
    await Promise.all(ops);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Missing tableType+data or tables' }, { status: 400 });
}
