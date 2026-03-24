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

  const rows = await prisma.auditPARRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { rows } = body as { rows: { id?: string; particulars: string; currentYear?: number; priorYear?: number; absVariance?: number; absVariancePercent?: number; significantChange?: boolean; sentToManagement?: boolean; managementResponseStatus?: string; reasons?: string; sortOrder: number }[] };

  const existingIds = rows.filter(r => r.id).map(r => r.id!);
  await prisma.auditPARRow.deleteMany({ where: { engagementId, id: { notIn: existingIds } } });

  for (const row of rows) {
    const data = {
      particulars: row.particulars,
      currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
      absVariance: row.absVariance ?? null, absVariancePercent: row.absVariancePercent ?? null,
      significantChange: row.significantChange ?? false,
      sentToManagement: row.sentToManagement ?? false,
      managementResponseStatus: row.managementResponseStatus,
      reasons: row.reasons, sortOrder: row.sortOrder,
    };
    if (row.id) {
      await prisma.auditPARRow.update({ where: { id: row.id }, data });
    } else {
      await prisma.auditPARRow.create({ data: { engagementId, ...data } });
    }
  }

  const updated = await prisma.auditPARRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows: updated });
}
