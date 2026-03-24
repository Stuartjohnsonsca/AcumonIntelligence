import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await prisma.auditTBRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { rows } = body as { rows: { id?: string; accountCode: string; description: string; category?: string; currentYear?: number; priorYear?: number; fsNoteLevel?: string; fsLevel?: string; fsStatement?: string; groupName?: string; sortOrder: number }[] };

  const existingIds = rows.filter(r => r.id).map(r => r.id!);
  await prisma.auditTBRow.deleteMany({ where: { engagementId, id: { notIn: existingIds } } });

  for (const row of rows) {
    if (row.id) {
      await prisma.auditTBRow.update({
        where: { id: row.id },
        data: {
          accountCode: row.accountCode, description: row.description, category: row.category,
          currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
          fsNoteLevel: row.fsNoteLevel, fsLevel: row.fsLevel, fsStatement: row.fsStatement,
          groupName: row.groupName, sortOrder: row.sortOrder,
        },
      });
    } else {
      await prisma.auditTBRow.create({
        data: { engagementId, accountCode: row.accountCode, description: row.description, category: row.category,
          currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
          fsNoteLevel: row.fsNoteLevel, fsLevel: row.fsLevel, fsStatement: row.fsStatement,
          groupName: row.groupName, sortOrder: row.sortOrder },
      });
    }
  }

  const updated = await prisma.auditTBRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows: updated });
}
