import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tables = await prisma.methodologyRiskTable.findMany({
    where: { firmId: session.user.firmId },
  });

  const result: Record<string, any> = {};
  for (const t of tables) {
    result[t.tableType] = t.data;
  }

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
  const { tables } = body;

  if (!tables) {
    return NextResponse.json({ error: 'Missing tables data' }, { status: 400 });
  }

  const firmId = session.user.firmId;

  // Upsert each table type
  const ops = Object.entries(tables).map(([tableType, data]) =>
    prisma.methodologyRiskTable.upsert({
      where: { firmId_tableType: { firmId, tableType } },
      create: { firmId, tableType, data: data as any },
      update: { data: data as any },
    })
  );

  await Promise.all(ops);

  return NextResponse.json({ success: true });
}
